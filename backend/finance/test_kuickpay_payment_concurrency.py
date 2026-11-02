"""Simultaneous payment callbacks (Kuickpay Track B). PostgreSQL only: SQLite has one writer."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import connection
from django.db.models import Sum
from django.test import TransactionTestCase
from django.utils import timezone

from finance.kuickpay import bills, contract, services
from finance.models import (
    Account, FeePayment, KuickpayBill, KuickpayBiller, KuickpayPaymentAllocation, KuickpaySchoolMapping,
    KuickpayTransaction, MonthlyFeeCategory,
)
from finance.test_kuickpay_bills_concurrency import _run_together
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = [
    pytest.mark.kuickpay,
    pytest.mark.skipif(connection.vendor != 'postgresql', reason='concurrent writers need PostgreSQL'),
]


def request(number, amount='1000', auth='111111', when=None):
    when = when or (timezone.now() - timedelta(minutes=1))
    day, clock, tran_at = contract.parse_transaction_moment(
        when.strftime('%Y%m%d'), when.strftime('%H%M%S'), 'UTC',
    )
    return contract.PaymentRequest(number, auth, Decimal(amount), day, clock, tran_at, 'KPY', {})


def _run_two(first, second):
    """Run two different callables at the same instant; returns [first's result, second's result]."""
    import threading
    from django.db import close_old_connections
    barrier = threading.Barrier(2)
    results = [None, None]

    def run(i, fn):
        try:
            barrier.wait(10)
            results[i] = fn()
        except Exception as exc:
            results[i] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(0, first)), threading.Thread(target=run, args=(1, second))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    close_old_connections()
    return results


class TestConcurrentPayments(TransactionTestCase):
    def setUp(self):
        org = Organization.objects.create(name='PC Org', slug='pc-org')
        self.school = School.objects.create(
            organization=org, name='PC School', subdomain='pc-school',
            contact_email='office@pc.pk', contact_phone='03001234567',
        )
        klass = Class.objects.create(school=self.school, name='C1', grade_level=1)
        self.student = Student.objects.create(school=self.school, class_obj=klass, name='Some Student', roll_number='1')
        self.category = MonthlyFeeCategory.objects.create(school=self.school, name='Tuition', is_active=True)
        bank = Account.objects.create(school=self.school, name='Bank', account_type='BANK')
        biller = KuickpayBiller.objects.create(
            name='B', prefix='12345', mode='UAT', consumer_number_length=13, is_enabled=True,
        )
        KuickpaySchoolMapping.objects.create(school=self.school, biller=biller, settlement_account=bank, is_enabled=True)
        # January unpaid; February (generated later) carries it. A consistent chain keeps bills ACTIVE.
        self.jan_row = self.row(1, 0)
        bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)
        self.jan = KuickpayBill.objects.get(student_ref=self.student.id, month=1)

    def row(self, month, carried):
        return FeePayment.objects.create(
            school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=self.category,
            month=month, year=2026, base_monthly_fee=1000, previous_balance=carried, amount_due=1000 + carried,
        )

    def credited(self):
        return FeePayment.objects.filter(student=self.student).aggregate(t=Sum('amount_paid'))['t'] or 0

    def assertNoErrors(self, results):
        for r in results:
            self.assertNotIsInstance(r, Exception, r)

    def test_simultaneous_identical_callbacks_credit_exactly_once(self):
        results = _run_together(lambda: services.record_payment(request(self.jan.consumer_number))[0]['response_Code'])
        self.assertNoErrors(results)
        self.assertEqual(sorted(results), ['00', '03', '03', '03'])
        self.assertEqual(KuickpayTransaction.objects.count(), 1)
        self.assertEqual(KuickpayPaymentAllocation.objects.count(), 1)
        self.assertEqual(self.credited(), Decimal('1000'))

    def test_two_different_payments_for_the_same_bill_credit_the_liability_only_once(self):
        counter = iter(range(100000, 100100))
        results = _run_together(
            lambda: services.record_payment(request(self.jan.consumer_number, auth=str(next(counter))))[0]['response_Code'],
            workers=3,
        )
        self.assertNoErrors(results)
        self.assertEqual(sorted(results), ['00', '02', '02'])           # the others find nothing left to pay
        self.assertEqual(self.credited(), Decimal('1000'))
        statuses = sorted(KuickpayTransaction.objects.values_list('status', flat=True))
        self.assertEqual(statuses, ['HELD', 'HELD', 'POSTED'])
        self.assertTrue(all(t.urgent for t in KuickpayTransaction.objects.filter(status='HELD')))

    def test_a_payment_racing_the_next_cycle_is_credited_exactly_once_and_one_bill_stays_open(self):
        self.row(2, 1000)

        def pay():
            return services.record_payment(request(self.jan.consumer_number, auth='222222'))[0]['response_Code']

        def supersede():
            return bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 2).action

        barrier_results = _run_two(pay, supersede)
        self.assertNoErrors(barrier_results)
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id, status__in=bills.OPEN).count(), 1)
        self.assertEqual(KuickpayTransaction.objects.count(), 1)
        self.assertLessEqual(KuickpayPaymentAllocation.objects.count(), 1)
        self.assertLessEqual(self.credited(), Decimal('1000'))                 # never credited twice
