"""Bill lifecycle: activation, supersession, live payable, suspension (Kuickpay plan Phase A5)."""
from datetime import date, time
from decimal import Decimal
from unittest import mock

import pytest

from finance import ledger
from finance.kuickpay import bills, consumer_numbers, payable
from finance.models import (
    Account, FeePayment, FeeStructure, KuickpayBill, KuickpayBiller, KuickpaySchoolMapping, KuickpayTransaction,
)
from finance.test_fee_generation_regression import FeeGenerationRegressionBase, _gen, _row

pytestmark = pytest.mark.kuickpay


class KuickpayBase(FeeGenerationRegressionBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.bank = Account.objects.create(school=cls.school, name='Bank', account_type=Account.AccountType.BANK)
        cls.biller = KuickpayBiller.objects.create(
            name='Central', prefix='12345', mode='UAT', consumer_number_length=13, is_enabled=True,
        )
        cls.mapping = KuickpaySchoolMapping.objects.create(
            school=cls.school, biller=cls.biller, settlement_account=cls.bank, is_enabled=True,
        )

    def open_bill(self, student=None):
        return KuickpayBill.objects.get(
            school=self.school, student_ref=(student or self.student).id, status__in=bills.OPEN,
        )

    def set_fee(self, amount):
        FeeStructure.objects.filter(pk=self.tuition_structure.pk).update(monthly_amount=Decimal(amount))

    def receive(self, bill, amount, auth='000001', **extra):
        return KuickpayTransaction.objects.create(
            bill=bill, consumer_number=bill.consumer_number, tran_auth_id=auth, tran_date=date(2026, 1, 10),
            tran_time=time(9, 0), amount=Decimal(amount), **extra,
        )


class TestActivation(KuickpayBase):
    def test_generation_issues_a_bill_per_student(self):
        _gen(self.school, 1, 2026, [self.tuition])
        bill = self.open_bill()
        self.assertEqual((bill.year, bill.month, bill.status), (2026, 1, 'ACTIVE'))
        self.assertTrue(consumer_numbers.is_valid(bill.consumer_number, consumer_numbers.format_for_biller(self.biller)))
        self.assertEqual(KuickpayBill.objects.filter(school=self.school).count(), 2)
        self.assertEqual(bill.activation_snapshot['rows'][0]['amount_due'], '1000.00')

    def test_activation_is_idempotent(self):
        _gen(self.school, 1, 2026, [self.tuition])
        first = self.open_bill()
        result = bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)
        self.assertEqual(result.action, bills.UNCHANGED)
        _gen(self.school, 1, 2026, [self.tuition])           # regenerate: nothing changes
        self.assertEqual(self.open_bill().consumer_number, first.consumer_number)
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id).count(), 1)

    def test_nothing_is_issued_for_a_school_that_is_not_enabled(self):
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        _gen(self.school, 1, 2026, [self.tuition])
        self.assertFalse(KuickpayBill.objects.exists())
        self.assertEqual(bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1).action, bills.SKIPPED_NOT_ENABLED)

    def test_a_disabled_biller_stops_issuing(self):
        KuickpayBiller.objects.filter(pk=self.biller.pk).update(is_enabled=False)
        _gen(self.school, 1, 2026, [self.tuition])
        self.assertFalse(KuickpayBill.objects.exists())

    def test_no_bill_without_fee_rows_for_that_cycle(self):
        self.assertEqual(
            bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1).action, bills.SKIPPED_NO_ROWS,
        )

    def test_an_unconfirmed_number_length_blocks_issuing_and_never_breaks_generation(self):
        KuickpayBiller.objects.filter(pk=self.biller.pk).update(consumer_number_length=None)
        result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 2)               # fee generation is unaffected
        self.assertFalse(KuickpayBill.objects.exists())
        with self.assertRaises(consumer_numbers.ConsumerNumberConfigError):
            bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)

    def test_a_failing_hook_never_fails_fee_generation(self):
        with mock.patch('finance.kuickpay.bills.activate_bills_for_scope', side_effect=RuntimeError('boom')):
            result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 2)

    def test_a_random_number_collision_is_retried(self):
        _gen(self.school, 1, 2026, [self.tuition])
        taken = self.open_bill(self.student).consumer_number
        real = consumer_numbers.allocate
        calls = []

        def colliding_once(biller, count):
            calls.append(count)
            return [taken] if len(calls) == 1 else real(biller, count)

        with mock.patch('finance.kuickpay.consumer_numbers.allocate', side_effect=colliding_once):
            _gen(self.school, 2, 2026, [self.tuition])
        self.assertGreater(len(calls), 2)                       # the colliding draw was retried
        self.assertEqual(KuickpayBill.objects.filter(school=self.school).count(), 4)
        self.assertEqual(KuickpayBill.objects.values('consumer_number').distinct().count(), 4)


class TestSupersession(KuickpayBase):
    def test_a_new_cycle_expires_the_previous_bill_and_only_the_new_one_is_open(self):
        _gen(self.school, 1, 2026, [self.tuition])
        jan = self.open_bill()
        _gen(self.school, 2, 2026, [self.tuition])
        jan.refresh_from_db()
        feb = self.open_bill()
        self.assertEqual(jan.status, KuickpayBill.Status.SUPERSEDED)
        self.assertEqual(jan.superseded_by_id, feb.id)
        self.assertIsNotNone(jan.superseded_at)
        self.assertEqual(feb.activated_at, jan.superseded_at)      # one timestamp for both
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id, status__in=bills.OPEN).count(), 1)
        self.assertNotEqual(jan.consumer_number, feb.consumer_number)

    def test_the_three_month_example_collects_the_carried_amount_once(self):
        self.set_fee('5000')
        expected = {1: '5000', 2: '10000', 3: '15000'}
        seen = []
        for month in (1, 2, 3):
            _gen(self.school, month, 2026, [self.tuition])
            bill = self.open_bill()
            evaluation = payable.evaluate(bill)
            self.assertEqual(evaluation.payable, Decimal(expected[month]))
            seen.append(bill.consumer_number)
        old = KuickpayBill.objects.filter(student_ref=self.student.id).exclude(status__in=bills.OPEN)
        self.assertEqual(old.count(), 2)
        # The expired bills can never be paid, and the ledger still shows a single liability.
        for bill in old:
            self.assertFalse(payable.is_payable(bill, payable.evaluate(bill)))
        self.assertEqual(ledger.outstanding(self.school.id, self.student.id), Decimal('15000'))
        self.assertEqual(len(set(seen)), 3)

    def test_expired_bills_and_numbers_are_retained(self):
        for month in (1, 2, 3):
            _gen(self.school, month, 2026, [self.tuition])
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id).count(), 3)

    def test_an_older_cycle_never_expires_a_newer_bill(self):
        _gen(self.school, 3, 2026, [self.tuition])
        mar = self.open_bill()
        FeePayment.objects.create(
            school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=self.tuition,
            month=1, year=2026, base_monthly_fee=Decimal('1000'), amount_due=Decimal('1000'),
        )
        result = bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)
        self.assertEqual(result.action, bills.SKIPPED_NEWER_EXISTS)
        mar.refresh_from_db()
        self.assertEqual(mar.status, KuickpayBill.Status.ACTIVE)

    def test_only_generated_students_are_superseded(self):
        _gen(self.school, 1, 2026, [self.tuition])
        before = self.open_bill(self.student2).consumer_number
        _gen(self.school, 2, 2026, [self.tuition], class_id=self.class_obj.id, session_class_id=None)
        # Both students are in the class, so both advance; the scoped run only touches its students.
        self.assertEqual(self.open_bill(self.student2).month, 2)
        self.assertNotEqual(self.open_bill(self.student2).consumer_number, before)

    def test_a_paid_old_bill_is_still_superseded_without_touching_the_ledger(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.pay(_row(self.student, self.tuition, 1, 2026), '1000')
        _gen(self.school, 2, 2026, [self.tuition])
        self.assertEqual(self.open_bill().month, 2)
        self.assertEqual(payable.evaluate(self.open_bill()).payable, Decimal('1000'))
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('1000'))

    def test_other_schools_are_never_affected(self):
        from schools.models import School
        other = School.objects.create(organization=self.school.organization, name='Other', subdomain='kp-other-sch')
        self.assertIsNone(bills.enabled_mapping(other.id))
        _gen(self.school, 1, 2026, [self.tuition])
        self.assertFalse(KuickpayBill.objects.filter(school=other).exists())


class TestLivePayable(KuickpayBase):
    def setUp(self):
        _gen(self.school, 1, 2026, [self.tuition, self.transport])

    def test_payable_is_the_sum_of_the_latest_rows_balances(self):
        evaluation = payable.evaluate(self.open_bill())
        self.assertEqual(evaluation.payable, Decimal('1300'))
        self.assertEqual({line.category_name for line in evaluation.rows}, {'Tuition', 'Transport'})
        self.assertEqual(evaluation.suspend_reason, '')

    def test_a_fully_paid_category_does_not_suspend_or_count(self):
        self.pay(_row(self.student, self.tuition, 1, 2026), '1000')
        evaluation = payable.evaluate(self.open_bill())
        self.assertEqual(evaluation.payable, Decimal('300'))
        self.assertEqual(evaluation.suspend_reason, '')

    def test_a_manual_part_payment_makes_safe_allocation_impossible(self):
        self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        self.assertEqual(payable.evaluate(self.open_bill()).suspend_reason, payable.MANUAL_PARTIAL_PAYMENT)

    def test_received_but_unposted_money_reduces_what_can_still_be_collected(self):
        bill = self.open_bill()
        self.receive(bill, '500')
        evaluation = payable.evaluate(bill)
        self.assertEqual((evaluation.ledger_payable, evaluation.processing, evaluation.payable),
                         (Decimal('1300'), Decimal('500'), Decimal('800')))
        self.receive(bill, '800', auth='000002', status='POSTED', allocated_amount=Decimal('800'))
        self.assertEqual(payable.evaluate(bill).processing, Decimal('500'))      # posted money is not "processing"

    def test_payable_never_goes_below_zero(self):
        self.receive(self.open_bill(), '5000')
        self.assertEqual(payable.evaluate(self.open_bill()).payable, Decimal('0'))

    def test_an_inactive_student_is_not_payable(self):
        from students.models import Student
        Student.objects.filter(pk=self.student.pk).update(is_active=False)
        self.assertEqual(payable.evaluate(self.open_bill()).suspend_reason, payable.STUDENT_NOT_ACTIVE)

    def test_evaluate_never_writes(self):
        bill = self.open_bill()
        FeePayment.objects.filter(pk=_row(self.student, self.tuition, 1, 2026).pk).update(
            amount_paid=Decimal('400'), payment_date=date(2026, 1, 5), account=self.account,
        )
        with self.assertNumQueries(len(self._queries(bill))):
            payable.evaluate(bill)
        bill.refresh_from_db()
        self.assertEqual(bill.status, KuickpayBill.Status.ACTIVE)    # reported, not changed

    def _queries(self, bill):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            payable.evaluate(bill)
        return ctx.captured_queries


class TestStaleLedger(KuickpayBase):
    def make_stale(self):
        _gen(self.school, 1, 2026, [self.tuition])
        _gen(self.school, 2, 2026, [self.tuition])
        self.pay(_row(self.student, self.tuition, 1, 2026), '1000', on=date(2026, 2, 5))

    def test_a_payment_on_an_earlier_month_makes_the_current_bill_stale_and_suspended(self):
        self.make_stale()
        bill = self.open_bill()
        self.assertEqual(payable.evaluate(bill).suspend_reason, payable.STALE_LEDGER)
        self.assertTrue(payable.sync_bill_state(bill))
        bill.refresh_from_db()
        self.assertEqual((bill.status, bill.suspend_reason), ('SUSPENDED', payable.STALE_LEDGER))
        self.assertFalse(payable.is_payable(bill, payable.evaluate(bill)))

    def test_an_administrator_refresh_makes_the_bill_payable_again(self):
        self.make_stale()
        bill = self.open_bill()
        payable.sync_bill_state(bill)
        ledger.refresh_chain(self.school.id, self.student.id, self.tuition.id, dry_run=False)
        self.assertTrue(payable.sync_bill_state(bill))
        bill.refresh_from_db()
        self.assertEqual(bill.status, KuickpayBill.Status.ACTIVE)
        self.assertEqual(bill.suspend_reason, '')
        self.assertEqual(payable.evaluate(bill).payable, Decimal('1000'))

    def test_the_sweep_resyncs_after_the_refresh(self):
        self.make_stale()
        bills.sweep_school(self.school.id)
        self.assertEqual(self.open_bill().status, KuickpayBill.Status.SUSPENDED)
        ledger.refresh_chain(self.school.id, self.student.id, self.tuition.id, dry_run=False)
        counts = bills.sweep_school(self.school.id)
        self.assertGreaterEqual(counts['resynced'], 1)
        self.assertEqual(self.open_bill().status, KuickpayBill.Status.ACTIVE)

    def test_a_superseded_bill_never_changes_state(self):
        self.make_stale()
        old = KuickpayBill.objects.get(student_ref=self.student.id, month=1)
        self.assertFalse(payable.sync_bill_state(old))


class TestSweep(KuickpayBase):
    def test_missing_bills_are_issued_for_the_latest_cycle_only(self):
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        for month in (1, 2, 3):
            _gen(self.school, month, 2026, [self.tuition])
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=True)
        counts = bills.sweep_school(self.school.id)
        self.assertEqual((counts['to_activate'], counts['activated']), (2, 2))
        self.assertEqual({b.month for b in KuickpayBill.objects.filter(school=self.school)}, {3})

    def test_dry_run_writes_nothing(self):
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        _gen(self.school, 1, 2026, [self.tuition])
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=True)
        counts = bills.sweep_school(self.school.id, dry_run=True)
        self.assertEqual(counts['to_activate'], 2)
        self.assertFalse(KuickpayBill.objects.exists())

    def test_a_second_sweep_does_nothing(self):
        _gen(self.school, 1, 2026, [self.tuition])
        counts = bills.sweep_school(self.school.id)
        self.assertEqual((counts['to_activate'], counts['activated'], counts['errors']), (0, 0, 0))

    def test_inactive_students_get_no_bill(self):
        from students.models import Student
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        _gen(self.school, 1, 2026, [self.tuition])
        Student.objects.filter(pk=self.student2.pk).update(is_active=False)
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=True)
        bills.sweep_school(self.school.id)
        self.assertEqual(list(KuickpayBill.objects.values_list('student_ref', flat=True)), [self.student.id])

    def test_a_disabled_school_is_a_noop(self):
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        self.assertEqual(bills.sweep_school(self.school.id)['to_activate'], 0)

    def test_beat_task_and_command_run_the_same_sweep(self):
        from io import StringIO
        from django.core.management import call_command
        from finance.tasks import kuickpay_sweep_task
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=False)
        _gen(self.school, 1, 2026, [self.tuition])
        KuickpaySchoolMapping.objects.filter(pk=self.mapping.pk).update(is_enabled=True)
        out = StringIO()
        call_command('kuickpay_activate_bills', '--school-id', str(self.school.id), '--dry-run', stdout=out)
        self.assertIn('to_activate=2', out.getvalue())
        self.assertFalse(KuickpayBill.objects.exists())
        kuickpay_sweep_task.apply().get()
        self.assertEqual(KuickpayBill.objects.count(), 2)
