"""Discounts and scholarships per fee type (decision 2026-11-26).

Before this, no generation path read discounts at all: a "50% sibling discount" never lowered a
bill. Now a discount cuts only the fee categories it lists; with none listed it cuts nothing.
The row stores what is charged (base_monthly_fee / amount_due, after discount) plus the discount
taken, so the carry-forward ledger keeps working on what is owed.

Billing months used here (Feb/Mar 2026) sit inside the shared seed's 2025-26 academic year.
"""
from datetime import date
from decimal import Decimal

import pytest
from django.test import override_settings

from finance.fee_discounts import apply
from finance.models import (
    AnnualFeeCategory, Discount, FeePayment, FeeStructure, MonthlyFeeCategory, Scholarship, StudentDiscount,
)
from finance.tasks import generate_annual_fees_task, generate_monthly_fees_task
from finance.vouchers import compute_voucher

D = Decimal


def rule(kind='PERCENTAGE', value='10', stackable=False, what='discount', name='R'):
    return {'name': name, 'kind': what, 'type': kind, 'value': D(value), 'stackable': stackable}


class TestApply:
    def test_percentage_fixed_and_full(self):
        assert apply(D('3000'), [rule('PERCENTAGE', '10')])[0] == D('300.00')
        assert apply(D('3000'), [rule('FIXED', '500')])[0] == D('500')
        assert apply(D('300'), [rule('FIXED', '500')])[0] == D('300')
        assert apply(D('3000'), [rule('FULL', '0', what='scholarship')])[0] == D('3000')

    def test_non_stackable_stands_alone_best_wins(self):
        total, detail = apply(D('1000'), [rule('PERCENTAGE', '10', name='A'), rule('FIXED', '250', name='B')])
        assert total == D('250') and [d['name'] for d in detail] == ['B']

    def test_stackables_add_up_and_never_exceed_the_charge(self):
        total, detail = apply(D('1000'), [
            rule('PERCENTAGE', '50', stackable=True, name='Sibling'),
            rule('PERCENTAGE', '60', stackable=True, what='scholarship', name='Merit'),
        ])
        assert total == D('1000')
        assert [(d['name'], d['amount']) for d in detail] == [('Sibling', '500.00'), ('Merit', '500.00')]

    def test_nothing_to_apply(self):
        assert apply(D('1000'), []) == (D('0'), [])
        assert apply(D('1000'), [rule('TUITION', '50', what='scholarship')]) == (D('0'), [])


@pytest.fixture
def ctx(seed_data):
    school = seed_data['school_a']
    ay = seed_data['academic_year']
    students = [s for s in seed_data['students'] if s.school_id == school.id][:2]
    s1, s2 = students
    tuition = MonthlyFeeCategory.objects.create(school=school, name='Tuition D')
    transport = MonthlyFeeCategory.objects.create(school=school, name='Transport D')
    for st in students:
        for cat, amount in ((tuition, '3000'), (transport, '1000')):
            FeeStructure.objects.create(
                school=school, student=st, fee_type='MONTHLY', monthly_category=cat,
                monthly_amount=D(amount), effective_from=date(2024, 1, 1),
            )
    sibling = Discount.objects.create(
        school=school, academic_year=ay, name='Sibling 10%', discount_type='PERCENTAGE', value=D('10'),
        applies_to='SIBLING',
    )
    StudentDiscount.objects.create(school=school, student=s1, discount=sibling, academic_year=ay)
    return {**seed_data, 'school': school, 'ay': ay, 's1': s1, 's2': s2,
            'tuition': tuition, 'transport': transport, 'sibling': sibling}


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
def generate(ctx, month, categories, strategy='skip'):
    return generate_monthly_fees_task.apply(kwargs={
        'school_id': ctx['school'].id, 'month': month, 'year': 2026,
        'monthly_category_ids': [c.id for c in categories], 'conflict_strategy': strategy,
    }).get()


def row(student, category, month):
    return FeePayment.objects.get(student=student, monthly_category=category, month=month, year=2026)


class TestGeneration:
    def test_discount_without_fee_types_changes_nothing(self, ctx):
        generate(ctx, 2, [ctx['tuition']])
        r = row(ctx['s1'], ctx['tuition'], 2)
        assert (r.base_monthly_fee, r.discount_amount) == (D('3000'), D('0'))

    def test_discount_cuts_only_the_fee_types_it_lists(self, ctx):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        generate(ctx, 2, [ctx['tuition'], ctx['transport']])
        t = row(ctx['s1'], ctx['tuition'], 2)
        assert (t.base_monthly_fee, t.amount_due, t.discount_amount) == (D('2700'), D('2700'), D('300'))
        assert t.discount_detail == [{'name': 'Sibling 10%', 'kind': 'discount', 'amount': '300.00'}]
        assert row(ctx['s1'], ctx['transport'], 2).base_monthly_fee == D('1000')
        assert row(ctx['s2'], ctx['tuition'], 2).base_monthly_fee == D('3000')

    def test_unpaid_net_amount_carries_forward(self, ctx):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        generate(ctx, 2, [ctx['tuition']])
        generate(ctx, 3, [ctx['tuition']])
        march = row(ctx['s1'], ctx['tuition'], 3)
        assert (march.previous_balance, march.base_monthly_fee, march.amount_due) == (D('2700'), D('2700'), D('5400'))

    def test_update_strategy_applies_a_new_discount_to_an_existing_bill(self, ctx):
        generate(ctx, 2, [ctx['tuition']])
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        result = generate(ctx, 2, [ctx['tuition']], strategy='update')
        assert result['updated'] >= 1
        assert row(ctx['s1'], ctx['tuition'], 2).discount_amount == D('300')

    def test_discount_outside_its_dates_is_not_applied(self, ctx):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        Discount.objects.filter(pk=ctx['sibling'].pk).update(start_date=date(2026, 3, 1))
        generate(ctx, 2, [ctx['tuition']])
        assert row(ctx['s1'], ctx['tuition'], 2).discount_amount == D('0')

    def test_inactive_assignment_is_not_applied(self, ctx):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        StudentDiscount.objects.filter(student=ctx['s1']).update(is_active=False)
        generate(ctx, 2, [ctx['tuition']])
        assert row(ctx['s1'], ctx['tuition'], 2).discount_amount == D('0')

    def test_scholarship_on_an_annual_fee(self, ctx):
        lab = AnnualFeeCategory.objects.create(school=ctx['school'], name='Lab D')
        FeeStructure.objects.create(
            school=ctx['school'], student=ctx['s2'], fee_type='ANNUAL', annual_category=lab,
            monthly_amount=D('5000'), effective_from=date(2024, 1, 1),
        )
        merit = Scholarship.objects.create(
            school=ctx['school'], academic_year=ctx['ay'], name='Merit', scholarship_type='MERIT',
            coverage='PERCENTAGE', value=D('40'),
        )
        merit.annual_categories.add(lab)
        StudentDiscount.objects.create(school=ctx['school'], student=ctx['s2'], scholarship=merit, academic_year=ctx['ay'])
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True):
            generate_annual_fees_task.apply(kwargs={
                'school_id': ctx['school'].id, 'year': 2025, 'annual_category_ids': [lab.id],
                'academic_year_id': ctx['ay'].id,
            }).get()
        r = FeePayment.objects.get(student=ctx['s2'], annual_category=lab)
        assert (r.amount_due, r.discount_amount) == (D('3000'), D('2000'))


class TestOtherPaths:
    def test_generate_single_applies_the_discount(self, ctx, api):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        resp = api.post('/api/finance/fee-payments/generate_single/', {
            'student': ctx['s1'].id, 'fee_type': 'MONTHLY', 'month': 2, 'year': 2026,
            'monthly_category': ctx['tuition'].id, 'academic_year': ctx['ay'].id,
        }, ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code in (200, 201), resp.content
        assert D(resp.json()['record']['amount_due']) == D('2700')
        assert D(resp.json()['record']['discount_amount']) == D('300')

    def test_preview_shows_net_total(self, ctx, api):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        resp = api.get(
            f"/api/finance/fee-payments/preview_generation/?fee_type=MONTHLY&month=2&year=2026"
            f"&monthly_categories={ctx['tuition'].id}&student_ids={ctx['s1'].id}",
            ctx['tokens']['admin'], ctx['school'].id,
        )
        body = resp.json()
        mine = next(r for r in body['students'] if r['student_id'] == ctx['s1'].id)
        assert (D(mine['amount']), D(mine['discount'])) == (D('2700'), D('300'))

    def test_discount_api_saves_fee_types_and_rejects_other_schools(self, ctx, api):
        resp = api.patch(f"/api/finance/discounts/{ctx['sibling'].id}/", {
            'monthly_categories': [ctx['tuition'].id],
        }, ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 200, resp.content
        assert resp.json()['fee_types'] == [{'id': ctx['tuition'].id, 'name': 'Tuition D', 'kind': 'MONTHLY'}]
        foreign = MonthlyFeeCategory.objects.create(school=ctx['school_b'], name='Foreign')
        resp = api.patch(f"/api/finance/discounts/{ctx['sibling'].id}/", {
            'monthly_categories': [foreign.id],
        }, ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 400

    def test_breakdown_is_per_fee_type(self, ctx, api):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        resp = api.get(f"/api/finance/fee-breakdown/{ctx['s1'].id}/?year=2026&month=2", ctx['tokens']['admin'], ctx['school'].id)
        assert resp.status_code == 200, resp.content
        fees = {f['category_name']: f for f in resp.json()['fees']}
        assert (D(fees['Tuition D']['discount']), D(fees['Transport D']['discount'])) == (D('300'), D('0'))
        assert D(resp.json()['final_amount']) == D(resp.json()['base_amount']) - D('300')

    def test_voucher_shows_full_fee_less_discount(self, ctx):
        ctx['sibling'].monthly_categories.add(ctx['tuition'])
        generate(ctx, 2, [ctx['tuition']])
        rows = list(FeePayment.objects.filter(student=ctx['s1']).select_related('monthly_category', 'annual_category'))
        v = compute_voucher(rows, 2026, 2)
        assert v['lines'] == [{'label': 'Tuition D', 'amount': D('3000')}]
        assert (v['discount'], v['total_payable']) == (D('300'), D('2700'))
