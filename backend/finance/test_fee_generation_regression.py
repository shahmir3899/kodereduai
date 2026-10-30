"""
Characterization tests for the existing monthly fee-generation workflow.

These pin the behaviour of finance.tasks.generate_monthly_fees_task and the FeePayment
ledger *as it is today*, before any change is made to fee generation (Kuickpay plan,
docs/KUICKPAY_TECHNICAL_ASSESSMENT.md, Phase A0, cases R-1 .. R-25).

Tests tagged CHARACTERIZATION document a known defect (D1, D4 in the plan). They assert the
current, defective behaviour on purpose so that a later change to it is a deliberate,
reviewed flip rather than an accident. Do not "fix" them without the matching approval (F-1, F-2).
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from academic_sessions.models import AcademicYear
from finance.models import (
    Account, Discount, FeePayment, FeeStructure, MonthlyClosing, MonthlyFeeCategory, StudentDiscount,
)
from finance.student_balance import student_pending_fees
from finance.tasks import _is_monthly_conflict, generate_monthly_fees_task
from schools.models import Organization, School
from students.models import Class, Student

pytestmark = pytest.mark.fee_regression

TUITION_FEE = Decimal('1000')
TRANSPORT_FEE = Decimal('300')


def _gen(school, month, year, categories, strategy='skip', **extra):
    return generate_monthly_fees_task.apply(kwargs={
        'school_id': school.id,
        'month': month,
        'year': year,
        'monthly_category_ids': [c.id for c in categories],
        'conflict_strategy': strategy,
        **extra,
    }).get()


def _row(student, category, month, year):
    return FeePayment.objects.get(
        student=student, monthly_category=category, month=month, year=year, fee_type='MONTHLY',
    )


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class FeeGenerationRegressionBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Regression Org', slug='regression-org-fees')
        cls.school = School.objects.create(organization=org, name='Regression School', subdomain='regr-fees')
        cls.class_obj = Class.objects.create(school=cls.school, name='Class 1', grade_level=1)
        cls.student = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, name='Student One', roll_number='1',
        )
        cls.student2 = Student.objects.create(
            school=cls.school, class_obj=cls.class_obj, name='Student Two', roll_number='2',
        )
        cls.tuition = MonthlyFeeCategory.objects.create(school=cls.school, name='Tuition', is_active=True)
        cls.transport = MonthlyFeeCategory.objects.create(school=cls.school, name='Transport', is_active=True)
        cls.tuition_structure = FeeStructure.objects.create(
            school=cls.school, class_obj=cls.class_obj, fee_type='MONTHLY',
            monthly_category=cls.tuition, monthly_amount=TUITION_FEE, effective_from=date(2024, 1, 1),
        )
        cls.transport_structure = FeeStructure.objects.create(
            school=cls.school, class_obj=cls.class_obj, fee_type='MONTHLY',
            monthly_category=cls.transport, monthly_amount=TRANSPORT_FEE, effective_from=date(2024, 1, 1),
        )
        cls.account = Account.objects.create(
            school=cls.school, name='Cash Box', account_type=Account.AccountType.CASH,
        )

    def pay(self, row, amount, on=date(2026, 1, 20)):
        row.amount_paid = Decimal(amount)
        row.payment_date = on
        row.account = self.account
        row.save()
        row.refresh_from_db()
        return row


class TestGenerationBasics(FeeGenerationRegressionBase):
    def test_r1_one_row_per_active_student_per_category_class_amount(self):
        result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 2)
        row = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual(row.base_monthly_fee, TUITION_FEE)
        self.assertEqual(row.previous_balance, 0)
        self.assertEqual(row.amount_due, TUITION_FEE)
        self.assertEqual(row.amount_paid, 0)
        self.assertEqual(row.status, FeePayment.PaymentStatus.UNPAID)

    def test_r1_student_level_structure_overrides_class_level(self):
        FeeStructure.objects.create(
            school=self.school, student=self.student, fee_type='MONTHLY',
            monthly_category=self.tuition, monthly_amount=Decimal('750'), effective_from=date(2024, 1, 1),
        )
        _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_due, Decimal('750'))
        self.assertEqual(_row(self.student2, self.tuition, 1, 2026).amount_due, TUITION_FEE)

    def test_r1_inactive_students_are_not_billed(self):
        Student.objects.filter(pk=self.student2.pk).update(is_active=False)
        result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 1)
        self.assertFalse(FeePayment.objects.filter(student=self.student2).exists())

    def test_r10_second_run_is_idempotent(self):
        _gen(self.school, 1, 2026, [self.tuition])
        result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 0)
        self.assertEqual(result['skipped'], 2)
        self.assertEqual(FeePayment.objects.filter(fee_type='MONTHLY').count(), 2)

    def test_r18_fee_structure_validity_is_resolved_against_today_not_billing_month(self):
        # D7: a structure that starts in the future is invisible for every billing month.
        FeeStructure.objects.all().delete()
        FeeStructure.objects.create(
            school=self.school, class_obj=self.class_obj, fee_type='MONTHLY',
            monthly_category=self.tuition, monthly_amount=TUITION_FEE,
            effective_from=timezone.localdate() + timedelta(days=30),
        )
        result = _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(result['created'], 0)
        self.assertEqual(result['no_fee_structure'], 2)

    def test_r19_discounts_and_scholarships_do_not_change_generated_amounts(self):
        # D6: generation never reads Discount/Scholarship/StudentDiscount.
        year = AcademicYear.objects.create(
            school=self.school, name='2025-2026', start_date=date(2025, 8, 1), end_date=date(2026, 7, 31),
        )
        discount = Discount.objects.create(
            school=self.school, academic_year=year, name='Half', discount_type='PERCENTAGE', value=Decimal('50'),
        )
        StudentDiscount.objects.create(
            school=self.school, student=self.student, discount=discount, academic_year=year, is_active=True,
        )
        _gen(self.school, 1, 2026, [self.tuition])
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_due, TUITION_FEE)


class TestCarryForward(FeeGenerationRegressionBase):
    def test_r2_unpaid_balance_carries_into_next_month(self):
        _gen(self.school, 1, 2026, [self.tuition])
        _gen(self.school, 2, 2026, [self.tuition])
        feb = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual(feb.previous_balance, TUITION_FEE)
        self.assertEqual(feb.base_monthly_fee, TUITION_FEE)
        self.assertEqual(feb.amount_due, TUITION_FEE * 2)

    def test_r2_r12_partial_payment_carries_only_the_remainder(self):
        _gen(self.school, 1, 2026, [self.tuition])
        jan = self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        self.assertEqual(jan.status, FeePayment.PaymentStatus.PARTIAL)
        _gen(self.school, 2, 2026, [self.tuition])
        feb = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual(feb.previous_balance, Decimal('600'))
        self.assertEqual(feb.amount_due, Decimal('1600'))

    def test_r2_overpayment_carries_a_negative_balance_unclamped(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.pay(_row(self.student, self.tuition, 1, 2026), '1500')
        _gen(self.school, 2, 2026, [self.tuition])
        feb = _row(self.student, self.tuition, 2, 2026)
        self.assertEqual(feb.previous_balance, Decimal('-500'))
        self.assertEqual(feb.amount_due, Decimal('500'))

    def test_r3_carry_forward_wraps_the_year_boundary(self):
        _gen(self.school, 12, 2025, [self.tuition])
        _gen(self.school, 1, 2026, [self.tuition])
        jan = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual(jan.previous_balance, TUITION_FEE)

    def test_r4_characterization_missing_intervening_row_drops_the_balance(self):
        # CHARACTERIZATION of defect D1 (flips under approval F-1).
        # January is unpaid, no February row exists, March is generated: January's balance is lost.
        _gen(self.school, 1, 2026, [self.tuition])
        _gen(self.school, 3, 2026, [self.tuition])
        mar = _row(self.student, self.tuition, 3, 2026)
        self.assertEqual(mar.previous_balance, Decimal('0'))
        self.assertEqual(mar.amount_due, TUITION_FEE)
        # The staff-visible outstanding (latest row per category) silently loses January too.
        self.assertEqual(student_pending_fees(self.student)['total'], TUITION_FEE)

    def test_r5_categories_carry_independently(self):
        _gen(self.school, 1, 2026, [self.tuition, self.transport])
        self.pay(_row(self.student, self.tuition, 1, 2026), '1000')  # tuition fully paid
        _gen(self.school, 2, 2026, [self.tuition, self.transport])
        self.assertEqual(_row(self.student, self.tuition, 2, 2026).previous_balance, Decimal('0'))
        self.assertEqual(_row(self.student, self.transport, 2, 2026).previous_balance, TRANSPORT_FEE)
        self.assertEqual(
            FeePayment.objects.filter(student=self.student, month=2, year=2026, fee_type='MONTHLY').count(), 2,
        )

    def test_r5_pending_total_uses_only_the_latest_row_per_category(self):
        _gen(self.school, 1, 2026, [self.tuition, self.transport])
        _gen(self.school, 2, 2026, [self.tuition, self.transport])
        self.assertEqual(student_pending_fees(self.student)['total'], (TUITION_FEE + TRANSPORT_FEE) * 2)

    def test_r11_closed_previous_month_still_carries_forward(self):
        _gen(self.school, 1, 2026, [self.tuition])
        MonthlyClosing.objects.create(school=self.school, year=2026, month=1)
        _gen(self.school, 2, 2026, [self.tuition])
        self.assertEqual(_row(self.student, self.tuition, 2, 2026).previous_balance, TUITION_FEE)

    def test_r11_closed_target_period_blocks_generation(self):
        MonthlyClosing.objects.create(school=self.school, year=2026, month=3)
        result = _gen(self.school, 3, 2026, [self.tuition])
        self.assertIn('error', result)
        self.assertFalse(FeePayment.objects.filter(month=3, year=2026).exists())


class TestConflictStrategies(FeeGenerationRegressionBase):
    def setUp(self):
        _gen(self.school, 1, 2026, [self.tuition])
        FeeStructure.objects.filter(pk=self.tuition_structure.pk).update(monthly_amount=Decimal('1200'))

    def test_r6_skip_leaves_a_conflicting_row_untouched(self):
        result = _gen(self.school, 1, 2026, [self.tuition], strategy='skip')
        self.assertEqual(result['conflicts_detected'], 2)
        self.assertEqual(result['updated'], 0)
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_due, TUITION_FEE)

    def test_r7_update_refreshes_amounts_and_status(self):
        result = _gen(self.school, 1, 2026, [self.tuition], strategy='update')
        self.assertEqual(result['updated'], 2)
        row = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual(row.amount_due, Decimal('1200'))
        self.assertEqual(row.base_monthly_fee, Decimal('1200'))

    def test_r7_update_is_protected_when_paid_exceeds_the_new_due(self):
        # Pay 1500 against 1000 due (overpaid); new due is 1200 < paid, so the row is protected.
        self.pay(_row(self.student, self.tuition, 1, 2026), '1500')
        result = _gen(self.school, 1, 2026, [self.tuition], strategy='update')
        self.assertEqual(result['protected_conflict'], 1)
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_due, TUITION_FEE)

    def test_r8_delete_recreate_replaces_an_unpaid_row(self):
        old_id = _row(self.student, self.tuition, 1, 2026).id
        result = _gen(self.school, 1, 2026, [self.tuition], strategy='delete_recreate')
        self.assertEqual(result['deleted_recreated'], 2)
        new = _row(self.student, self.tuition, 1, 2026)
        self.assertNotEqual(new.id, old_id)
        self.assertEqual(new.amount_due, Decimal('1200'))

    def test_r9_characterization_delete_recreate_destroys_a_recorded_payment(self):
        # CHARACTERIZATION of defect D4 (flips under approval F-2).
        self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        _gen(self.school, 1, 2026, [self.tuition], strategy='delete_recreate')
        new = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual(new.amount_paid, Decimal('0'))
        self.assertIsNone(new.payment_date)
        self.assertIsNone(new.account)

    def test_r13_rows_carried_from_a_transfer_are_never_regenerated(self):
        carried = SimpleNamespace(
            carried_from_exit_id=1, previous_balance=Decimal('0'), base_monthly_fee=Decimal('0'),
            amount_due=Decimal('999'),
        )
        self.assertFalse(_is_monthly_conflict(carried, Decimal('5'), Decimal('6'), Decimal('11')))


class TestLedgerSafeguards(FeeGenerationRegressionBase):
    def test_r25_payment_requires_date_and_account(self):
        _gen(self.school, 1, 2026, [self.tuition])
        row = _row(self.student, self.tuition, 1, 2026)
        row.amount_paid = Decimal('100')
        with self.assertRaises(ValidationError):
            row.save()

    def test_r25_closed_period_blocks_saves_and_deletes_of_monthly_rows(self):
        _gen(self.school, 1, 2026, [self.tuition])
        row = _row(self.student, self.tuition, 1, 2026)
        MonthlyClosing.objects.create(school=self.school, year=2026, month=1)
        row.amount_paid = Decimal('100')
        row.payment_date = date(2026, 1, 20)
        row.account = self.account
        with self.assertRaises(ValidationError):
            row.save()
        with self.assertRaises(ValidationError):
            row.delete()

    def test_r25_queryset_delete_bypasses_the_period_lock(self):
        # CHARACTERIZATION of defect D5: generation's delete_recreate uses queryset deletes.
        _gen(self.school, 1, 2026, [self.tuition])
        MonthlyClosing.objects.create(school=self.school, year=2026, month=1)
        FeePayment.objects.filter(month=1, year=2026).delete()
        self.assertFalse(FeePayment.objects.filter(month=1, year=2026).exists())

    def test_r25_compute_status_derivation(self):
        _gen(self.school, 1, 2026, [self.tuition])
        row = _row(self.student, self.tuition, 1, 2026)
        self.assertEqual(row.status, FeePayment.PaymentStatus.UNPAID)
        self.assertEqual(self.pay(row, '1000').status, FeePayment.PaymentStatus.PAID)
        self.assertEqual(self.pay(row, '1200').status, FeePayment.PaymentStatus.PAID)  # overpayment uncapped
        self.assertEqual(self.pay(row, '300').status, FeePayment.PaymentStatus.PARTIAL)

    def test_r21_manual_update_overwrites_amount_paid_rather_than_adding(self):
        # D8: there is no payment history; a later edit replaces the earlier amount.
        _gen(self.school, 1, 2026, [self.tuition])
        row = _row(self.student, self.tuition, 1, 2026)
        user = get_user_model().objects.create_superuser(
            username='regr_admin', email='regr_admin@test.com', password='test12345',
        )
        client = APIClient()
        client.force_authenticate(user)
        headers = {'HTTP_X_SCHOOL_ID': str(self.school.id)}
        for amount in ('800', '300'):
            response = client.post(
                '/api/finance/fee-payments/bulk_update/',
                {'records': [{'id': row.id, 'amount_paid': amount, 'account': self.account.id}]},
                format='json', **headers,
            )
            self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.amount_paid, Decimal('300'))
        self.assertEqual(row.status, FeePayment.PaymentStatus.PARTIAL)
