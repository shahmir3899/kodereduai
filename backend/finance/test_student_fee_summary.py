"""Headline fee figures for a student: paid, pending and charged agree with each other.

Worked example used throughout (one Tuition category, monthly rows carry the unpaid
balance forward, plus one annual fee):

    Jan   base 1000   carried    0   due 1000   paid   0
    Feb   base 1000   carried 1000   due 2000   paid 500
    Mar   base 1000   carried 1500   due 2500   paid   0
    Annual fee                       due  800   paid 300

Actually charged: 3 x 1000 + 800 = 3800.  Paid: 800.  Owed today: 3000.

    BEFORE (summing every row):  total_due 6300, total_paid 800, 'paid' 13%
    AFTER  (shared helper):      total_due 3800, total_paid 800, 'paid' 21%
"""
from datetime import date
from decimal import Decimal

import pytest

from finance.models import Account, FeePayment, MonthlyFeeCategory
from finance.student_balance import student_fee_summary, student_pending_fees
from parents.models import ParentChild, ParentProfile
from schools.models import UserSchoolMembership
from users.models import User


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    category = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition')
    account = Account.objects.create(school=seed_data['school_a'], name='Cash', account_type='CASH')
    return {**seed_data, 'student': student, 'category': category, 'account': account}


def pay(ctx, fee_type, month, due, paid, *, prev='0', base=None, category=True, year=2026):
    paid = Decimal(paid)
    extra = {'payment_date': date(year, max(month, 1), 5), 'account': ctx['account']} if paid else {}
    return FeePayment.objects.create(
        school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
        fee_type=fee_type, month=month, year=year,
        monthly_category=ctx['category'] if fee_type == 'MONTHLY' and category else None,
        amount_due=Decimal(due), previous_balance=Decimal(prev),
        base_monthly_fee=Decimal(base) if base is not None else None,
        amount_paid=paid,
        status='PAID' if Decimal(due) == paid else ('PARTIAL' if paid else 'UNPAID'),
        **extra,
    )


def worked_example(ctx):
    pay(ctx, 'MONTHLY', 1, '1000', '0', prev='0', base='1000')
    pay(ctx, 'MONTHLY', 2, '2000', '500', prev='1000', base='1000')
    pay(ctx, 'MONTHLY', 3, '2500', '0', prev='1500', base='1000')
    pay(ctx, 'ANNUAL', 0, '800', '300')


class TestWorkedExample:
    def test_before_the_fix_every_row_was_summed(self, ctx):
        """Documents the old behaviour so the difference is explicit."""
        worked_example(ctx)
        rows = FeePayment.objects.filter(student=ctx['student'])
        naive_due = sum(r.amount_due for r in rows)
        naive_paid = sum(r.amount_paid for r in rows)
        assert (naive_due, naive_paid) == (Decimal('6300'), Decimal('800'))
        assert round(naive_paid / naive_due * 100) == 13

    def test_after_the_fix_the_figures_are_what_was_charged_paid_and_owed(self, ctx):
        worked_example(ctx)
        fees = student_fee_summary(ctx['student'])
        assert fees == {
            'total_paid': Decimal('800'), 'pending': Decimal('3000'), 'total_due': Decimal('3800'),
        }
        assert round(fees['total_paid'] / fees['total_due'] * 100) == 21

    def test_the_charged_total_matches_the_base_fees_actually_billed(self, ctx):
        worked_example(ctx)
        billed = Decimal('1000') * 3 + Decimal('800')
        assert student_fee_summary(ctx['student'])['total_due'] == billed

    def test_pending_is_the_latest_monthly_row_plus_the_annual_balance(self, ctx):
        worked_example(ctx)
        result = student_pending_fees(ctx['student'])
        assert result['total'] == Decimal('3000')
        balances = sorted(i['balance'] for i in result['items'])
        assert balances == [Decimal('500'), Decimal('2500')]  # annual 500, March 2500; Jan/Feb not added


class TestOtherShapes:
    def test_a_fully_paid_student_owes_nothing_and_is_100_percent(self, ctx):
        pay(ctx, 'MONTHLY', 1, '1000', '1000', base='1000')
        pay(ctx, 'MONTHLY', 2, '1000', '1000', base='1000')
        fees = student_fee_summary(ctx['student'])
        assert fees == {'total_paid': Decimal('2000'), 'pending': Decimal('0'), 'total_due': Decimal('2000')}

    def test_a_student_with_no_fee_rows_has_all_zeros(self, ctx):
        assert student_fee_summary(ctx['student']) == {
            'total_paid': Decimal('0'), 'pending': Decimal('0'), 'total_due': Decimal('0'),
        }

    def test_nothing_paid_yet_means_charged_equals_pending(self, ctx):
        pay(ctx, 'MONTHLY', 1, '1000', '0', base='1000')
        pay(ctx, 'MONTHLY', 2, '2000', '0', prev='1000', base='1000')
        fees = student_fee_summary(ctx['student'])
        assert fees['total_paid'] == 0 and fees['pending'] == fees['total_due'] == Decimal('2000')

    def test_two_monthly_categories_each_count_their_latest_row(self, ctx):
        other = MonthlyFeeCategory.objects.create(school=ctx['school_a'], name='Transport')
        pay(ctx, 'MONTHLY', 1, '1000', '0', base='1000')
        pay(ctx, 'MONTHLY', 2, '2000', '500', prev='1000', base='1000')
        FeePayment.objects.create(
            school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
            fee_type='MONTHLY', monthly_category=other, month=2, year=2026,
            amount_due=Decimal('300'), amount_paid=Decimal('100'), status='PARTIAL',
            payment_date=date(2026, 2, 5), account=ctx['account'],
        )
        fees = student_fee_summary(ctx['student'])
        assert fees['pending'] == Decimal('1500') + Decimal('200')
        assert fees['total_paid'] == Decimal('600')

    def test_a_carried_balance_across_the_new_year_is_not_double_counted(self, ctx):
        pay(ctx, 'MONTHLY', 12, '1000', '0', base='1000', year=2025)
        pay(ctx, 'MONTHLY', 1, '2000', '0', prev='1000', base='1000', year=2026)
        assert student_fee_summary(ctx['student'])['pending'] == Decimal('2000')


class TestProfileSummaryApi:
    def test_the_overview_figures_use_the_shared_calculation(self, api, ctx):
        worked_example(ctx)
        resp = api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['admin'], ctx['SID_A'])
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['total_due'] == 3800.0
        assert body['total_paid'] == 800.0
        assert body['outstanding'] == body['pending_fee'] == 3000.0
        # The Overview card shows paid / due: 800 / 3800 = 21%, not 800 / 6300 = 13%.
        assert round(body['total_paid'] / body['total_due'] * 100) == 21

    def test_the_three_figures_always_add_up(self, api, ctx):
        worked_example(ctx)
        body = api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert body['total_due'] == body['total_paid'] + body['outstanding']

    def test_a_student_with_no_fees_shows_zeros(self, api, ctx):
        body = api.get(f"/api/students/{ctx['student'].id}/profile_summary/", ctx['tokens']['admin'], ctx['SID_A']).json()
        assert (body['total_due'], body['total_paid'], body['outstanding']) == (0.0, 0.0, 0.0)


class TestParentPortal:
    def test_parents_see_the_same_figures_as_staff(self, api, ctx):
        worked_example(ctx)
        parent = User.objects.create_user(
            username='SEED_fee_parent', email='fp@test.com', password=ctx['password'], role='PARENT',
            school=ctx['school_a'], organization=ctx['org'],
        )
        UserSchoolMembership.objects.create(user=parent, school=ctx['school_a'], role='PARENT', is_default=True)
        profile = ParentProfile.objects.create(user=parent, phone='+923001234567')
        ParentChild.objects.create(parent=profile, student=ctx['student'], school=ctx['school_a'], relation='FATHER')
        token = api.login('SEED_fee_parent')

        resp = api.get(f"/api/parents/children/{ctx['student'].id}/overview/", token, ctx['SID_A'])
        assert resp.status_code == 200, resp.content
        fees = resp.json()['fee_summary']
        assert Decimal(fees['total_due']) == Decimal('3800')
        assert Decimal(fees['total_paid']) == Decimal('800')
        assert Decimal(fees['outstanding']) == Decimal('3000')
