"""Lock behaviour of fee generation and manual payments (Kuickpay plan Phase A2, approval F-8).

SQLite ignores row and advisory locks, so these run only on PostgreSQL (set DATABASE_URL-style
settings, see docs/KUICKPAY_A0_IMPACT_ANALYSIS.md). On SQLite they are skipped, not faked.
"""
import threading
import time
from datetime import date
from decimal import Decimal

import pytest
from django.db import close_old_connections, connection, transaction
from django.test import TransactionTestCase

from finance import ledger
from finance.models import Account, FeePayment, MonthlyFeeCategory
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = [
    pytest.mark.kuickpay,
    pytest.mark.skipif(connection.vendor != 'postgresql', reason='row/advisory locks need PostgreSQL'),
]

HOLD_SECONDS = 1.5


def _in_thread(fn, results, key):
    def run():
        try:
            results[key] = fn()
        except Exception as exc:  # surfaced by the assertions below
            results[key] = exc
        finally:
            connection.close()
    thread = threading.Thread(target=run)
    thread.start()
    return thread


class TestFeeLocks(TransactionTestCase):
    def setUp(self):
        org = Organization.objects.create(name='Lock Org', slug='lock-org')
        self.school = School.objects.create(organization=org, name='Lock School', subdomain='lock-school')
        klass = Class.objects.create(school=self.school, name='C1', grade_level=1)
        self.student = Student.objects.create(school=self.school, class_obj=klass, name='S', roll_number='1')
        self.category = MonthlyFeeCategory.objects.create(school=self.school, name='Tuition', is_active=True)
        self.account = Account.objects.create(school=self.school, name='Cash', account_type='CASH')
        self.row = FeePayment.objects.create(
            school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=self.category,
            month=1, year=2026, base_monthly_fee=Decimal('1000'), previous_balance=0, amount_due=Decimal('1000'),
        )

    def test_a_payment_waits_for_generation_to_finish_reading_balances(self):
        holding = threading.Event()
        timeline = {}

        def generation():
            with transaction.atomic():
                ledger.carry_in_balances(self.school.id, [self.student.id], self.category.id, 2026, 2, lock=True)
                holding.set()
                time.sleep(HOLD_SECONDS)
                timeline['generation_done'] = time.monotonic()

        def payment():
            holding.wait(5)
            started = time.monotonic()
            with transaction.atomic():
                row = FeePayment.objects.select_for_update().get(pk=self.row.pk)
                timeline['payment_got_lock'] = time.monotonic()
                row.amount_paid, row.payment_date, row.account = Decimal('400'), date(2026, 1, 20), self.account
                row.save()
            return time.monotonic() - started

        results = {}
        threads = [_in_thread(generation, results, 'g'), _in_thread(payment, results, 'p')]
        for t in threads:
            t.join(15)
        close_old_connections()
        for value in results.values():
            self.assertNotIsInstance(value, Exception, value)
        self.assertGreaterEqual(timeline['payment_got_lock'], timeline['generation_done'])
        self.assertGreater(results['p'], HOLD_SECONDS * 0.5)
        self.row.refresh_from_db()
        self.assertEqual(self.row.amount_paid, Decimal('400'))

    def test_two_generations_for_the_same_month_run_one_after_the_other(self):
        holding = threading.Event()
        order = []

        def first():
            with transaction.atomic():
                ledger.lock_generation(self.school.id, 2026, 2)
                holding.set()
                order.append('first_in')
                time.sleep(HOLD_SECONDS)
                order.append('first_out')

        def second():
            holding.wait(5)
            with transaction.atomic():
                ledger.lock_generation(self.school.id, 2026, 2)
                order.append('second_in')

        results = {}
        threads = [_in_thread(first, results, 'a'), _in_thread(second, results, 'b')]
        for t in threads:
            t.join(15)
        close_old_connections()
        self.assertEqual(order, ['first_in', 'first_out', 'second_in'])

    def test_generation_for_a_different_month_is_not_blocked(self):
        holding = threading.Event()
        marks = {}

        def first():
            with transaction.atomic():
                ledger.lock_generation(self.school.id, 2026, 2)
                holding.set()
                time.sleep(HOLD_SECONDS)

        def other_month():
            holding.wait(5)
            started = time.monotonic()
            with transaction.atomic():
                ledger.lock_generation(self.school.id, 2026, 3)
            marks['waited'] = time.monotonic() - started

        results = {}
        threads = [_in_thread(first, results, 'a'), _in_thread(other_month, results, 'b')]
        for t in threads:
            t.join(15)
        close_old_connections()
        self.assertLess(marks['waited'], HOLD_SECONDS / 2)
