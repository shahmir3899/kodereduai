"""
Schema-level tests for the Kuickpay models (plan Phase A3, docs/KUICKPAY_TECHNICAL_ASSESSMENT.md §10).

They assert the database guarantees the design leans on: one open bill per student, permanent
unique consumer numbers, transaction identity uniqueness that does NOT treat the 6-digit
authorization id as globally unique, and that a fee row holding confirmed Kuickpay money cannot
be deleted. Constraint behaviour is checked through the ORM so the same tests run on SQLite and
on PostgreSQL.
"""
from datetime import date, time, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from django.utils import timezone

from finance.models import (
    Account, FeePayment, KuickpayBill, KuickpayBiller, KuickpayPaymentAllocation,
    KuickpaySchoolMapping, KuickpayTransaction, MonthlyFeeCategory,
)
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = pytest.mark.kuickpay


class KuickpayModelBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='KP Org', slug='kp-org-models')
        cls.school = School.objects.create(organization=org, name='KP School', subdomain='kp-models')
        cls.other_school = School.objects.create(organization=org, name='KP Other', subdomain='kp-other')
        cls.klass = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.student = Student.objects.create(school=cls.school, class_obj=cls.klass, name='S1', roll_number='1')
        cls.student2 = Student.objects.create(school=cls.school, class_obj=cls.klass, name='S2', roll_number='2')
        cls.biller = KuickpayBiller.objects.create(name='Central', prefix='12345', mode='UAT')
        cls.tuition = MonthlyFeeCategory.objects.create(school=cls.school, name='Tuition', is_active=True)

    def bill(self, student=None, year=2026, month=1, number='1234500000001', status='ACTIVE', **extra):
        student = student or self.student
        return KuickpayBill.objects.create(
            school=self.school, biller=self.biller, student=student, student_ref=student.id,
            year=year, month=month, consumer_number=number, status=status, **extra,
        )

    def fee_row(self, student=None, month=1):
        student = student or self.student
        return FeePayment.objects.create(
            school=self.school, student=student, fee_type='MONTHLY', monthly_category=self.tuition,
            month=month, year=2026, amount_due=Decimal('1000'), base_monthly_fee=Decimal('1000'),
        )

    def txn(self, bill, auth='123456', amount='1000', on=date(2026, 1, 10), at=time(10, 0), **extra):
        return KuickpayTransaction.objects.create(
            bill=bill, consumer_number=bill.consumer_number, tran_auth_id=auth,
            tran_date=on, tran_time=at, amount=Decimal(amount), **extra,
        )

    def assertRejected(self, fn):
        with self.assertRaises(IntegrityError), transaction.atomic():
            fn()


class TestBillerAndMapping(KuickpayModelBase):
    def test_prefix_must_be_digits(self):
        biller = KuickpayBiller(name='Bad', prefix='12a45', mode='PROD')
        with self.assertRaises(ValidationError):
            biller.full_clean()

    def test_prefix_is_unique_per_mode_but_may_repeat_across_modes(self):
        KuickpayBiller.objects.create(name='Prod', prefix='12345', mode='PROD')
        self.assertRejected(lambda: KuickpayBiller.objects.create(name='Dup', prefix='12345', mode='UAT'))

    def test_mapping_requires_a_bank_account_of_the_same_school(self):
        bank = Account.objects.create(school=self.school, name='Bank', account_type=Account.AccountType.BANK)
        cash = Account.objects.create(school=self.school, name='Cash', account_type=Account.AccountType.CASH)
        foreign = Account.objects.create(school=self.other_school, name='Bank X', account_type=Account.AccountType.BANK)
        KuickpaySchoolMapping(school=self.school, biller=self.biller, settlement_account=bank).clean()
        with self.assertRaises(ValidationError):
            KuickpaySchoolMapping(school=self.school, biller=self.biller, settlement_account=cash).clean()
        with self.assertRaises(ValidationError):
            KuickpaySchoolMapping(school=self.school, biller=self.biller, settlement_account=foreign).clean()

    def test_one_mapping_per_school(self):
        bank = Account.objects.create(school=self.school, name='Bank', account_type=Account.AccountType.BANK)
        KuickpaySchoolMapping.objects.create(school=self.school, biller=self.biller, settlement_account=bank)
        self.assertRejected(lambda: KuickpaySchoolMapping.objects.create(
            school=self.school, biller=self.biller, settlement_account=bank,
        ))


class TestBillConstraints(KuickpayModelBase):
    def test_consumer_number_is_unique_forever(self):
        self.bill()
        self.assertRejected(lambda: self.bill(student=self.student2, number='1234500000001'))

    def test_only_one_open_bill_per_student(self):
        self.bill(month=1, number='1234500000001')
        self.assertRejected(lambda: self.bill(month=2, number='1234500000002'))

    def test_a_suspended_bill_still_counts_as_open(self):
        self.bill(month=1, number='1234500000001', status='SUSPENDED')
        self.assertRejected(lambda: self.bill(month=2, number='1234500000002'))

    def test_supersession_sequence_keeps_history_and_one_open_bill(self):
        old = self.bill(month=1, number='1234500000001')
        old.status = 'SUPERSEDED'
        old.superseded_at = timezone.now()
        old.save()
        new = self.bill(month=2, number='1234500000002')
        old.superseded_by = new
        old.save()
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id).count(), 2)
        self.assertEqual(KuickpayBill.objects.filter(student_ref=self.student.id, status='ACTIVE').count(), 1)

    def test_one_bill_per_student_cycle(self):
        old = self.bill(month=1, number='1234500000001', status='SUPERSEDED', superseded_at=timezone.now())
        self.assertRejected(lambda: self.bill(month=1, number='1234500000009'))

    def test_open_bills_of_different_students_do_not_conflict(self):
        self.bill(student=self.student, number='1234500000001')
        self.bill(student=self.student2, number='1234500000002')

    def test_superseded_status_requires_a_timestamp_and_vice_versa(self):
        self.assertRejected(lambda: self.bill(number='1234500000001', status='SUPERSEDED'))
        self.assertRejected(lambda: self.bill(
            number='1234500000002', status='ACTIVE', superseded_at=timezone.now(),
        ))

    def test_month_must_be_1_to_12(self):
        self.assertRejected(lambda: self.bill(month=13, number='1234500000001'))
        self.assertRejected(lambda: self.bill(month=0, number='1234500000002'))

    def test_consumer_number_keeps_leading_zeros(self):
        bill = self.bill(number='0012300000042')
        bill.refresh_from_db()
        self.assertEqual(bill.consumer_number, '0012300000042')


class TestTransactionConstraints(KuickpayModelBase):
    def setUp(self):
        self.b1 = self.bill(student=self.student, number='1234500000001')
        self.b2 = self.bill(student=self.student2, number='1234500000002')

    def test_identical_identity_is_rejected(self):
        self.txn(self.b1)
        self.assertRejected(lambda: self.txn(self.b1))

    def test_same_authorization_id_for_a_different_consumer_is_accepted(self):
        self.txn(self.b1, auth='000123')
        self.txn(self.b2, auth='000123')

    def test_same_authorization_id_on_a_different_date_or_time_is_accepted(self):
        self.txn(self.b1, auth='000123')
        self.txn(self.b1, auth='000123', on=date(2026, 1, 11))
        self.txn(self.b1, auth='000123', at=time(10, 0, 1))
        self.assertEqual(KuickpayTransaction.objects.filter(tran_auth_id='000123').count(), 3)

    def test_amount_must_be_positive(self):
        self.assertRejected(lambda: self.txn(self.b1, amount='0'))
        self.assertRejected(lambda: self.txn(self.b1, auth='999999', amount='-5'))

    def test_allocated_plus_held_cannot_exceed_the_amount(self):
        self.assertRejected(lambda: self.txn(self.b1, auth='111111', allocated_amount=Decimal('800'), held_amount=Decimal('300')))
        self.txn(self.b1, auth='222222', allocated_amount=Decimal('800'), held_amount=Decimal('200'))
        self.txn(self.b1, auth='333333', allocated_amount=Decimal('0'), held_amount=Decimal('1000'))

    def test_parts_cannot_be_negative(self):
        self.assertRejected(lambda: self.txn(self.b1, auth='444444', allocated_amount=Decimal('-1')))
        self.assertRejected(lambda: self.txn(self.b1, auth='555555', held_amount=Decimal('-1')))

    def test_default_status_is_received(self):
        self.assertEqual(self.txn(self.b1).status, KuickpayTransaction.Status.RECEIVED)


class TestAllocationAndProtection(KuickpayModelBase):
    def setUp(self):
        self.b1 = self.bill()
        self.row = self.fee_row()
        self.t = self.txn(self.b1, allocated_amount=Decimal('1000'))
        self.alloc = KuickpayPaymentAllocation.objects.create(
            transaction=self.t, fee_payment=self.row, fee_payment_ref=self.row.id, amount=Decimal('1000'),
            period_year=2026, period_month=1, category_id=self.tuition.id,
            row_balance_before=Decimal('1000'), row_balance_after=Decimal('0'), posting_date=date(2026, 1, 12),
        )

    def test_one_allocation_per_transaction_and_row(self):
        self.assertRejected(lambda: KuickpayPaymentAllocation.objects.create(
            transaction=self.t, fee_payment=self.row, fee_payment_ref=self.row.id, amount=Decimal('1'),
            period_year=2026, period_month=1, row_balance_before=Decimal('1'),
            row_balance_after=Decimal('0'), posting_date=date(2026, 1, 12),
        ))

    def test_allocation_amount_must_be_positive(self):
        other = self.fee_row(student=self.student2)
        self.assertRejected(lambda: KuickpayPaymentAllocation.objects.create(
            transaction=self.t, fee_payment=other, fee_payment_ref=other.id, amount=Decimal('0'),
            period_year=2026, period_month=1, row_balance_before=Decimal('1'),
            row_balance_after=Decimal('1'), posting_date=date(2026, 1, 12),
        ))

    def test_fee_row_with_an_allocation_cannot_be_deleted(self):
        with self.assertRaises(ProtectedError):
            self.row.delete()

    def test_queryset_delete_of_an_allocated_fee_row_is_also_blocked(self):
        # The path generation's delete_recreate uses: it bypasses FeePayment.delete(), so only
        # the PROTECT foreign key stops it.
        with self.assertRaises(ProtectedError):
            FeePayment.objects.filter(pk=self.row.pk).delete()
        self.assertTrue(FeePayment.objects.filter(pk=self.row.pk).exists())

    def test_unallocated_fee_rows_are_still_deletable(self):
        free = self.fee_row(student=self.student2)
        free.delete()
        self.assertFalse(FeePayment.objects.filter(pk=free.pk).exists())

    def test_bill_and_transaction_with_history_cannot_be_deleted(self):
        with self.assertRaises(ProtectedError):
            self.b1.delete()
        with self.assertRaises(ProtectedError):
            self.t.delete()


class TestSchemaIntegrity(TestCase):
    def test_models_and_migrations_are_in_sync(self):
        # Fails if a model change is missing its migration, or the migration drifts from the models.
        call_command('makemigrations', '--check', '--dry-run', verbosity=0)

    def test_fee_payment_columns_are_unchanged(self):
        expected = {
            'id', 'school', 'academic_year', 'student', 'fee_type', 'annual_category', 'monthly_category',
            'month', 'year', 'amount_due', 'previous_balance', 'base_monthly_fee', 'amount_paid', 'status',
            'payment_date', 'payment_method', 'receipt_number', 'notes', 'collected_by', 'account',
            'handed_over_to_exit', 'carried_from_exit', 'created_at', 'updated_at',
        }
        concrete = {f.name for f in FeePayment._meta.concrete_fields}
        self.assertEqual(concrete, expected)
