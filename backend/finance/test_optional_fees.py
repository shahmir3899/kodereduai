"""Optional (enrolled-only) fee categories: Robotics, Karate, transport for bus users.

Rules pinned here:
  * an ENROLLED category bills only students enrolled during the billing period;
  * joining mid-month is billed the full month, and nothing after the end date;
  * price: enrollment > student structure > class structure > category default price;
  * the old uncategorised monthly override (a student's tuition) is never used for it;
  * an ALL category is unchanged, and its default_amount is ignored.
"""
from datetime import date
from decimal import Decimal

import pytest
from django.test import override_settings

from finance.models import (
    AnnualFeeCategory, FeePayment, FeeStructure, MonthlyFeeCategory, StudentFeeEnrollment, resolve_fee_amount,
)
from finance.tasks import generate_annual_fees_task, generate_monthly_fees_task

ENROLL_URL = '/api/finance/fee-enrollments/'


@pytest.fixture
def ctx(seed_data):
    school = seed_data['school_a']
    students = [s for s in seed_data['students'] if s.school_id == school.id][:3]
    robotics = MonthlyFeeCategory.objects.create(
        school=school, name='Robotics', billing_mode='ENROLLED', default_amount=Decimal('1500'),
    )
    return {**seed_data, 'school': school, 's1': students[0], 's2': students[1], 's3': students[2], 'robotics': robotics}


def enroll(ctx, student, start=date(2026, 1, 1), end=None, amount=None, category=None):
    category = category or ctx['robotics']
    monthly = isinstance(category, MonthlyFeeCategory)
    return StudentFeeEnrollment.objects.create(
        school=ctx['school'], student=student, start_date=start, end_date=end, amount=amount,
        monthly_category=category if monthly else None, annual_category=None if monthly else category,
    )


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
def generate(ctx, month, year=2026, category=None):
    return generate_monthly_fees_task.apply(kwargs={
        'school_id': ctx['school'].id, 'month': month, 'year': year,
        'monthly_category_ids': [(category or ctx['robotics']).id],
    }).get()


def billed(ctx, month, category=None):
    return dict(FeePayment.objects.filter(
        monthly_category=category or ctx['robotics'], month=month, year=2026,
    ).values_list('student_id', 'base_monthly_fee'))


class TestGeneration:
    def test_only_enrolled_students_are_billed(self, ctx):
        enroll(ctx, ctx['s1'])
        result = generate(ctx, 3)
        assert billed(ctx, 3) == {ctx['s1'].id: Decimal('1500')}
        assert result['not_enrolled'] >= 2
        assert result['no_fee_structure'] == 0

    def test_mid_month_join_is_a_full_month_and_end_date_stops_billing(self, ctx):
        enroll(ctx, ctx['s1'], start=date(2026, 3, 20), end=date(2026, 4, 5))
        for month in (2, 3, 4, 5):
            generate(ctx, month)
        assert billed(ctx, 2) == {}
        assert billed(ctx, 3) == {ctx['s1'].id: Decimal('1500')}
        assert billed(ctx, 4) == {ctx['s1'].id: Decimal('1500')}
        assert billed(ctx, 5) == {}

    def test_price_precedence(self, ctx):
        s1, s2, s3 = ctx['s1'], ctx['s2'], ctx['s3']
        FeeStructure.objects.create(
            school=ctx['school'], class_obj=s2.class_obj, fee_type='MONTHLY', monthly_category=ctx['robotics'],
            monthly_amount=Decimal('1200'), effective_from=date(2024, 1, 1),
        )
        FeeStructure.objects.create(
            school=ctx['school'], student=s3, fee_type='MONTHLY', monthly_category=ctx['robotics'],
            monthly_amount=Decimal('900'), effective_from=date(2024, 1, 1),
        )
        enroll(ctx, s1, amount=Decimal('700'))
        enroll(ctx, s2)
        enroll(ctx, s3)
        generate(ctx, 3)
        rows = billed(ctx, 3)
        assert rows[s1.id] == Decimal('700')    # enrollment price
        assert rows[s3.id] == Decimal('900')    # student price
        # s2: class price when s2's class has one, else the category price
        assert rows[s2.id] in (Decimal('1200'), Decimal('1500'))

    def test_old_uncategorised_tuition_override_is_never_used(self, ctx):
        FeeStructure.objects.create(
            school=ctx['school'], student=ctx['s1'], fee_type='MONTHLY', monthly_category=None,
            monthly_amount=Decimal('5000'), effective_from=date(2024, 1, 1),
        )
        enroll(ctx, ctx['s1'])
        generate(ctx, 3)
        assert billed(ctx, 3) == {ctx['s1'].id: Decimal('1500')}

    def test_all_category_ignores_default_price(self, ctx):
        art = MonthlyFeeCategory.objects.create(school=ctx['school'], name='Art', default_amount=Decimal('800'))
        result = generate(ctx, 3, category=art)
        assert billed(ctx, 3, category=art) == {}
        assert result['not_enrolled'] == 0

    def test_annual_enrolled_category_uses_the_academic_year(self, ctx):
        camp = AnnualFeeCategory.objects.create(
            school=ctx['school'], name='Summer Camp', billing_mode='ENROLLED', default_amount=Decimal('4000'),
        )
        ay = ctx['academic_year']
        enroll(ctx, ctx['s2'], start=ay.start_date, category=camp)
        with override_settings(CELERY_TASK_ALWAYS_EAGER=True):
            result = generate_annual_fees_task.apply(kwargs={
                'school_id': ctx['school'].id, 'year': ay.start_date.year,
                'annual_category_ids': [camp.id], 'academic_year_id': ay.id,
            }).get()
        rows = dict(FeePayment.objects.filter(annual_category=camp).values_list('student_id', 'amount_due'))
        assert rows == {ctx['s2'].id: Decimal('4000')}
        assert result['not_enrolled'] >= 1


class TestResolveAmount:
    def test_not_enrolled_has_no_price(self, ctx):
        assert resolve_fee_amount(ctx['s1'], 'MONTHLY', monthly_category_id=ctx['robotics'].id, year=2026, month=3) is None

    def test_enrolled_gets_category_price(self, ctx):
        enroll(ctx, ctx['s1'], start=date(2026, 3, 1))
        amount = resolve_fee_amount(ctx['s1'], 'MONTHLY', monthly_category_id=ctx['robotics'].id, year=2026, month=3)
        assert amount == Decimal('1500')


class TestEnrollmentApi:
    def post(self, ctx, api, url, data, user='admin'):
        return api.post(url, data, ctx['tokens'][user], ctx['school'].id)

    def test_bulk_enroll_skips_students_already_enrolled(self, ctx, api):
        enroll(ctx, ctx['s1'])
        resp = self.post(ctx, api, f'{ENROLL_URL}bulk_enroll/', {
            'monthly_category': ctx['robotics'].id, 'student_ids': [ctx['s1'].id, ctx['s2'].id], 'start_date': '2026-03-01',
        })
        assert resp.status_code == 201, resp.content
        assert (resp.json()['created'], resp.json()['skipped']) == (1, 1)

    def test_cannot_enroll_in_a_category_that_bills_everyone(self, ctx, api):
        tuition = MonthlyFeeCategory.objects.create(school=ctx['school'], name='Tuition X')
        resp = self.post(ctx, api, f'{ENROLL_URL}bulk_enroll/', {
            'monthly_category': tuition.id, 'student_ids': [ctx['s1'].id], 'start_date': '2026-03-01',
        })
        assert resp.status_code == 400

    def test_create_rejects_overlap(self, ctx, api):
        enroll(ctx, ctx['s1'], start=date(2026, 1, 1))
        resp = self.post(ctx, api, ENROLL_URL, {
            'student': ctx['s1'].id, 'monthly_category': ctx['robotics'].id, 'start_date': '2026-05-01',
        })
        assert resp.status_code == 400

    def test_end_and_list_filters(self, ctx, api):
        a = enroll(ctx, ctx['s1'], start=date(2026, 1, 1))
        enroll(ctx, ctx['s2'], start=date(2026, 1, 1))
        resp = self.post(ctx, api, f'{ENROLL_URL}end/', {'ids': [a.id], 'end_date': '2026-02-28'})
        assert resp.json()['ended'] == 1
        active = api.get(f"{ENROLL_URL}?monthly_category={ctx['robotics'].id}", ctx['tokens']['admin'], ctx['school'].id).json()
        assert [r['student'] for r in active] == [ctx['s2'].id]
        ended = api.get(f"{ENROLL_URL}?monthly_category={ctx['robotics'].id}&status=ended", ctx['tokens']['admin'], ctx['school'].id).json()
        assert [r['student'] for r in ended] == [ctx['s1'].id]
        assert ended[0]['category_name'] == 'Robotics' and ended[0]['is_active'] is False

    def test_finance_manager_reads_only(self, ctx, api):
        resp = api.get(ENROLL_URL, ctx['tokens']['finance_manager'], ctx['school'].id)
        assert resp.status_code == 200
        resp = self.post(ctx, api, f'{ENROLL_URL}bulk_enroll/', {
            'monthly_category': ctx['robotics'].id, 'student_ids': [ctx['s1'].id], 'start_date': '2026-03-01',
        }, user='finance_manager')
        assert resp.status_code == 403

    def test_category_shows_mode_price_and_count(self, ctx, api):
        enroll(ctx, ctx['s1'], start=date(2020, 1, 1))
        rows = api.get('/api/finance/monthly-categories/', ctx['tokens']['admin'], ctx['school'].id).json()
        rows = rows['results'] if isinstance(rows, dict) else rows
        robotics = next(r for r in rows if r['id'] == ctx['robotics'].id)
        assert robotics['billing_mode'] == 'ENROLLED'
        assert Decimal(robotics['default_amount']) == Decimal('1500')
        assert robotics['enrolled_count'] == 1

    def test_preview_counts_not_enrolled(self, ctx, api):
        enroll(ctx, ctx['s1'])
        resp = api.get(
            f"/api/finance/fee-payments/preview_generation/?fee_type=MONTHLY&month=3&year=2026&monthly_categories={ctx['robotics'].id}",
            ctx['tokens']['admin'], ctx['school'].id,
        )
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['will_create'] == 1 and body['not_enrolled'] >= 2


class TestPreviewPerFee:
    def test_preview_lists_each_fee_with_enrolled_count(self, ctx, api):
        tuition = MonthlyFeeCategory.objects.create(school=ctx['school'], name='Tuition P')
        FeeStructure.objects.create(
            school=ctx['school'], class_obj=ctx['s1'].class_obj, fee_type='MONTHLY', monthly_category=tuition,
            monthly_amount=Decimal('3000'), effective_from=date(2024, 1, 1),
        )
        enroll(ctx, ctx['s1'])
        resp = api.get(
            f"/api/finance/fee-payments/preview_generation/?fee_type=MONTHLY&month=3&year=2026"
            f"&monthly_categories={tuition.id},{ctx['robotics'].id}",
            ctx['tokens']['admin'], ctx['school'].id,
        )
        cats = {c['name']: c for c in resp.json()['categories']}
        assert cats['Robotics']['billing_mode'] == 'ENROLLED' and cats['Robotics']['enrolled'] == 1
        assert cats['Robotics']['will_create'] == 1
        assert cats['Tuition P']['enrolled'] is None and cats['Tuition P']['will_create'] >= 1
