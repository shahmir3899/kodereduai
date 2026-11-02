"""Tests for finance.ledger (Kuickpay plan Phase A1): the single source of "what is owed"."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.db import transaction
from django.test import TestCase

from finance import ledger
from finance.models import Account, FeePayment, MonthlyClosing, MonthlyFeeCategory
from finance.student_balance import student_pending_fees
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = pytest.mark.kuickpay


class LedgerBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Ledger Org', slug='ledger-org')
        cls.school = School.objects.create(organization=org, name='Ledger School', subdomain='ledger-school')
        klass = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.student = Student.objects.create(school=cls.school, class_obj=klass, name='S1', roll_number='1')
        cls.tuition = MonthlyFeeCategory.objects.create(school=cls.school, name='Tuition', is_active=True)
        cls.transport = MonthlyFeeCategory.objects.create(school=cls.school, name='Transport', is_active=True)
        cls.account = Account.objects.create(school=cls.school, name='Cash', account_type='CASH')

    def row(self, month, *, year=2026, category=None, base='1000', prev='0', paid='0', **extra):
        category = category or self.tuition
        base, prev, paid = Decimal(base), Decimal(prev), Decimal(paid)
        kwargs = dict(
            school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=category,
            month=month, year=year, base_monthly_fee=base, previous_balance=prev, amount_due=prev + base,
            amount_paid=paid,
        )
        if paid:
            kwargs.update(payment_date=date(year, month, 15), account=self.account)
        kwargs.update(extra)
        return FeePayment.objects.create(**kwargs)

    def carry(self, year, month, category=None, **kw):
        return ledger.carry_in_balance(self.school.id, self.student.id, (category or self.tuition).id, year, month, **kw)


class TestCarryIn(LedgerBase):
    def test_previous_month_balance_carries(self):
        self.row(1)
        self.assertEqual(self.carry(2026, 2), Decimal('1000'))

    def test_partial_payment_carries_only_the_remainder(self):
        self.row(1, paid='400')
        self.assertEqual(self.carry(2026, 2), Decimal('600'))

    def test_overpayment_carries_a_negative_balance(self):
        self.row(1, paid='1500')
        self.assertEqual(self.carry(2026, 2), Decimal('-500'))

    def test_a_missing_intervening_month_does_not_lose_the_balance(self):
        self.row(1)
        self.assertEqual(self.carry(2026, 3), Decimal('1000'))

    def test_balance_carries_across_a_long_gap_and_the_year_boundary(self):
        self.row(11, year=2025)
        self.assertEqual(self.carry(2026, 3), Decimal('1000'))

    def test_the_latest_earlier_row_wins_over_older_ones(self):
        self.row(1)
        self.row(2, prev='1000')           # due 2000, already contains January
        self.assertEqual(self.carry(2026, 5), Decimal('2000'))

    def test_rows_in_or_after_the_target_month_are_ignored(self):
        self.row(3, prev='0')
        self.assertEqual(self.carry(2026, 3), Decimal('0'))
        self.assertEqual(self.carry(2026, 2), Decimal('0'))

    def test_nothing_is_carried_when_there_is_no_earlier_row(self):
        self.assertEqual(self.carry(2026, 1), Decimal('0'))
        self.assertNotIn(self.student.id, ledger.carry_in_balances(
            self.school.id, [self.student.id], self.tuition.id, 2026, 1,
        ))

    def test_categories_do_not_mix(self):
        self.row(1, category=self.tuition, paid='1000')
        self.row(1, category=self.transport, base='300')
        self.assertEqual(self.carry(2026, 2, category=self.tuition), Decimal('0'))
        self.assertEqual(self.carry(2026, 2, category=self.transport), Decimal('300'))

    def test_a_handed_over_balance_carries_nothing_and_no_older_row_takes_its_place(self):
        self.assertEqual(ledger._carry_value(SimpleNamespace(
            handed_over_to_exit_id=7, amount_due=Decimal('900'), amount_paid=Decimal('0'),
        )), Decimal('0'))

    def test_lock_mode_returns_the_same_balances_inside_a_transaction(self):
        self.row(1, paid='250')
        with transaction.atomic():
            self.assertEqual(self.carry(2026, 2, lock=True), Decimal('750'))

    def test_many_students_in_one_call(self):
        other = Student.objects.create(
            school=self.school, class_obj=self.student.class_obj, name='S2', roll_number='2',
        )
        self.row(1)
        FeePayment.objects.create(
            school=self.school, student=other, fee_type='MONTHLY', monthly_category=self.tuition,
            month=12, year=2025, base_monthly_fee=Decimal('500'), previous_balance=0, amount_due=Decimal('500'),
        )
        result = ledger.carry_in_balances(
            self.school.id, [self.student.id, other.id], self.tuition.id, 2026, 3,
        )
        self.assertEqual(result, {self.student.id: Decimal('1000'), other.id: Decimal('500')})


class TestOutstanding(LedgerBase):
    def assertMatchesStaffView(self):
        staff = sum(
            (i['balance'] for i in student_pending_fees(self.student)['items'] if i['fee_type'] == 'MONTHLY'),
            Decimal('0'),
        )
        self.assertEqual(ledger.outstanding(self.school.id, self.student.id), staff)
        return staff

    def test_no_rows_means_nothing_owed(self):
        self.assertEqual(self.assertMatchesStaffView(), 0)

    def test_only_the_latest_row_per_category_counts(self):
        self.row(1)
        self.row(2, prev='1000')
        self.assertEqual(self.assertMatchesStaffView(), Decimal('2000'))

    def test_multiple_categories_are_summed(self):
        self.row(1, paid='1000')
        self.row(1, category=self.transport, base='300')
        self.assertEqual(self.assertMatchesStaffView(), Decimal('300'))

    def test_credit_on_one_category_never_offsets_another(self):
        self.row(1, paid='1500')                       # tuition overpaid by 500
        self.row(1, category=self.transport, base='300')
        self.assertEqual(self.assertMatchesStaffView(), Decimal('300'))

    def test_a_category_whose_latest_row_is_older_is_still_counted(self):
        self.row(1, category=self.transport, base='300')
        self.row(3)
        self.assertEqual(self.assertMatchesStaffView(), Decimal('1300'))

    def test_member_rows_are_the_latest_per_category_in_period_order(self):
        self.row(1)
        latest = self.row(2, prev='1000')
        t = self.row(1, category=self.transport, base='300')
        self.assertEqual(
            [r.id for r in ledger.monthly_member_rows(self.school.id, self.student.id)], [t.id, latest.id],
        )

    def test_annual_rows_are_not_part_of_the_monthly_figure(self):
        self.row(1, paid='1000')
        FeePayment.objects.create(
            school=self.school, student=self.student, fee_type='ANNUAL', month=0, year=2026,
            amount_due=Decimal('4000'),
        )
        self.assertEqual(ledger.outstanding(self.school.id, self.student.id), 0)


class TestChainIntegrity(LedgerBase):
    def findings(self, kind=None):
        found = ledger.chain_integrity(self.school.id, [self.student.id])
        return [f for f in found if kind is None or f['kind'] == kind]

    def test_a_consistent_chain_has_no_findings(self):
        self.row(1, paid='400')
        self.row(2, prev='600')
        self.assertEqual(self.findings(), [])

    def test_payment_recorded_on_an_earlier_month_after_generation_makes_the_next_row_stale(self):
        jan = self.row(1)
        self.row(2, prev='1000')                      # generated while January was unpaid
        jan.amount_paid, jan.payment_date, jan.account = Decimal('1000'), date(2026, 2, 5), self.account
        jan.save()
        stale = self.findings('stale')
        self.assertEqual(len(stale), 1)
        self.assertEqual(stale[0]['period'], (2026, 2))
        self.assertEqual(stale[0]['stored_previous_balance'], Decimal('1000'))
        self.assertEqual(stale[0]['expected_previous_balance'], Decimal('0'))

    def test_a_gap_is_reported_but_the_balance_across_it_is_expected(self):
        self.row(1)
        self.row(3, prev='1000')
        self.assertEqual(len(self.findings('gap')), 1)
        self.assertEqual(self.findings('stale'), [])

    def test_a_gap_that_dropped_the_balance_is_stale(self):
        self.row(1)
        self.row(3, prev='0')                          # generated by the old M-1-only logic
        self.assertEqual(len(self.findings('stale')), 1)

    def test_pinned_rows_are_never_reported_stale(self):
        self.row(1)
        self.row(2, prev='0', base_monthly_fee=None)   # legacy row: override cannot be separated
        self.assertEqual(self.findings('stale'), [])


class TestRefreshChain(LedgerBase):
    def refresh(self, **kw):
        return ledger.refresh_chain(self.school.id, self.student.id, self.tuition.id, **kw)

    def make_stale(self):
        jan = self.row(1)
        feb = self.row(2, prev='1000')
        mar = self.row(3, prev='2000')
        jan.amount_paid, jan.payment_date, jan.account = Decimal('1000'), date(2026, 2, 5), self.account
        jan.save()
        return jan, feb, mar

    def test_dry_run_reports_the_cascade_and_changes_nothing(self):
        jan, feb, mar = self.make_stale()
        result = self.refresh(dry_run=True)
        self.assertEqual([r['action'] for r in result], ['would_update', 'would_update'])
        self.assertEqual(result[0]['new_amount_due'], Decimal('1000'))
        self.assertEqual(result[1]['new_amount_due'], Decimal('2000'))
        feb.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('2000'))

    def test_refresh_rebuilds_the_chain(self):
        jan, feb, mar = self.make_stale()
        result = self.refresh(dry_run=False)
        self.assertEqual([r['action'] for r in result], ['updated', 'updated'])
        feb.refresh_from_db()
        mar.refresh_from_db()
        self.assertEqual((feb.previous_balance, feb.amount_due), (Decimal('0'), Decimal('1000')))
        self.assertEqual((mar.previous_balance, mar.amount_due), (Decimal('1000'), Decimal('2000')))
        self.assertEqual(ledger.chain_integrity(self.school.id, [self.student.id]), [])

    def test_manual_override_of_amount_due_is_preserved(self):
        jan = self.row(1)
        feb = self.row(2, prev='1000')
        FeePayment.objects.filter(pk=feb.pk).update(amount_due=Decimal('2100'))   # +100 manual surcharge
        jan.amount_paid, jan.payment_date, jan.account = Decimal('1000'), date(2026, 2, 5), self.account
        jan.save()
        self.refresh(dry_run=False)
        feb.refresh_from_db()
        self.assertEqual(feb.previous_balance, Decimal('0'))
        self.assertEqual(feb.amount_due, Decimal('1100'))

    def test_a_row_paid_beyond_its_new_amount_due_is_protected(self):
        jan = self.row(1)
        feb = self.row(2, prev='1000', paid='1500')
        jan.amount_paid, jan.payment_date, jan.account = Decimal('1000'), date(2026, 2, 5), self.account
        jan.save()
        result = self.refresh(dry_run=False)
        self.assertEqual([r['action'] for r in result], ['protected'])
        feb.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('2000'))

    def test_pinned_rows_are_left_alone(self):
        self.row(1, paid='1000')
        pinned = self.row(2, prev='1000', base_monthly_fee=None)
        self.assertEqual(self.refresh(dry_run=False), [])
        pinned.refresh_from_db()
        self.assertEqual(pinned.previous_balance, Decimal('1000'))

    def test_a_closed_period_is_never_bypassed(self):
        jan, feb, mar = self.make_stale()
        MonthlyClosing.objects.create(school=self.school, year=2026, month=2)
        result = self.refresh(dry_run=False)
        self.assertEqual([r['action'] for r in result], ['period_closed'])
        feb.refresh_from_db()
        mar.refresh_from_db()
        self.assertEqual(feb.amount_due, Decimal('2000'))
        self.assertEqual(mar.amount_due, Decimal('3000'))   # untouched: the chain stops at the closed month
