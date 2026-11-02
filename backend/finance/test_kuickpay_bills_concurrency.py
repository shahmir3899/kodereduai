"""Simultaneous bill activation (Kuickpay plan Phase A5). PostgreSQL only: SQLite has one writer."""
import threading
import time

import pytest
from django.db import close_old_connections, connection
from django.test import TransactionTestCase

from finance.kuickpay import bills
from finance.models import (
    Account, FeePayment, KuickpayBill, KuickpayBiller, KuickpaySchoolMapping, MonthlyFeeCategory,
)
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = [
    pytest.mark.kuickpay,
    pytest.mark.skipif(connection.vendor != 'postgresql', reason='concurrent writers need PostgreSQL'),
]


def _run_together(fn, workers=4):
    barrier = threading.Barrier(workers)
    results = [None] * workers

    def run(i):
        try:
            barrier.wait(10)
            results[i] = fn()
        except Exception as exc:
            results[i] = exc
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    close_old_connections()
    return results


class TestConcurrentActivation(TransactionTestCase):
    def setUp(self):
        org = Organization.objects.create(name='CC Org', slug='cc-org')
        self.school = School.objects.create(organization=org, name='CC School', subdomain='cc-school')
        klass = Class.objects.create(school=self.school, name='C1', grade_level=1)
        self.student = Student.objects.create(school=self.school, class_obj=klass, name='S', roll_number='1')
        self.category = MonthlyFeeCategory.objects.create(school=self.school, name='Tuition', is_active=True)
        bank = Account.objects.create(school=self.school, name='Bank', account_type='BANK')
        biller = KuickpayBiller.objects.create(
            name='B', prefix='12345', mode='UAT', consumer_number_length=13, is_enabled=True,
        )
        KuickpaySchoolMapping.objects.create(school=self.school, biller=biller, settlement_account=bank, is_enabled=True)
        # January unpaid, February carries it (a consistent chain, so bills stay ACTIVE).
        for month, carried in ((1, 0), (2, 1000)):
            FeePayment.objects.create(
                school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=self.category,
                month=month, year=2026, base_monthly_fee=1000, previous_balance=carried,
                amount_due=1000 + carried,
            )

    def activate(self, month):
        return lambda: bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, month)

    def assertAllFine(self, results):
        for r in results:
            self.assertNotIsInstance(r, Exception, r)

    def test_simultaneous_first_activations_create_exactly_one_bill(self):
        results = _run_together(self.activate(1))
        self.assertAllFine(results)
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id).count(), 1)
        self.assertEqual(sorted(r.action for r in results).count(bills.CREATED), 1)

    def test_simultaneous_supersession_leaves_exactly_one_open_bill(self):
        bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)
        results = _run_together(self.activate(2))
        self.assertAllFine(results)
        all_bills = KuickpayBill.objects.filter(student_ref=self.student.id)
        self.assertEqual(all_bills.count(), 2)
        self.assertEqual(all_bills.filter(status__in=bills.OPEN).count(), 1)
        jan, feb = all_bills.get(month=1), all_bills.get(month=2)
        self.assertEqual((jan.status, jan.superseded_by_id), ('SUPERSEDED', feb.id))
        self.assertEqual(sorted(r.action for r in results).count(bills.CREATED), 1)

    def test_activating_an_old_cycle_while_a_new_one_is_activated_never_expires_the_new_bill(self):
        results = _run_together(lambda: bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 2), workers=2)
        self.assertAllFine(results)
        late = bills.activate_bill_for_cycle(self.school.id, self.student.id, 2026, 1)
        self.assertEqual(late.action, bills.SKIPPED_NEWER_EXISTS)
        self.assertEqual(KuickpayBill.objects.get(student_ref=self.student.id, month=2).status, 'ACTIVE')
