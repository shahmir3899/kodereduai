"""Tests for the fee-generation improvements (Kuickpay plan Phase A2, approvals F-1..F-4, F-8)."""
from datetime import date, time
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import ProtectedError
from rest_framework.test import APIClient

from core.views import custom_exception_handler
from finance import ledger
from finance.models import (
    AnnualFeeCategory, FeePayment, FeeStructure, KuickpayBill, KuickpayBiller, KuickpayPaymentAllocation,
    KuickpayTransaction,
)
from finance.tasks import generate_annual_fees_task
from finance.test_fee_generation_regression import (
    TUITION_FEE, FeeGenerationRegressionBase, _gen, _row,
)

pytestmark = pytest.mark.kuickpay


class ImprovementBase(FeeGenerationRegressionBase):
    def kuickpay_credit(self, row, amount):
        """Give a fee row a confirmed Kuickpay allocation, as the payment service eventually will."""
        biller = KuickpayBiller.objects.get_or_create(prefix='12345', mode='UAT', defaults={'name': 'B'})[0]
        bill = KuickpayBill.objects.create(
            school=self.school, biller=biller, student=row.student, student_ref=row.student_id,
            year=row.year, month=row.month, consumer_number=f'12345{row.id:08d}',
        )
        txn = KuickpayTransaction.objects.create(
            bill=bill, consumer_number=bill.consumer_number, tran_auth_id='000001',
            tran_date=date(2026, 1, 10), tran_time=time(9, 0), amount=Decimal(amount),
            allocated_amount=Decimal(amount),
        )
        row.amount_paid, row.payment_date, row.account = Decimal(amount), date(2026, 1, 10), self.account
        row.save()
        return KuickpayPaymentAllocation.objects.create(
            transaction=txn, fee_payment=row, fee_payment_ref=row.id, amount=Decimal(amount),
            period_year=row.year, period_month=row.month, category_id=row.monthly_category_id,
            row_balance_before=Decimal('1000'), row_balance_after=Decimal('1000') - Decimal(amount),
            posting_date=date(2026, 1, 10),
        )


class TestCarryForwardAcrossGaps(ImprovementBase):
    def test_bulk_generation_carries_each_category_from_its_own_latest_row(self):
        _gen(self.school, 1, 2026, [self.tuition, self.transport])
        _gen(self.school, 2, 2026, [self.tuition])          # transport skipped in February
        _gen(self.school, 3, 2026, [self.tuition, self.transport])
        self.assertEqual(_row(self.student, self.tuition, 3, 2026).previous_balance, TUITION_FEE * 2)
        self.assertEqual(_row(self.student, self.transport, 3, 2026).previous_balance, Decimal('300'))

    def test_carry_across_the_year_boundary_with_a_vacation_gap(self):
        _gen(self.school, 5, 2025, [self.tuition])
        _gen(self.school, 8, 2025, [self.tuition])
        self.assertEqual(_row(self.student, self.tuition, 8, 2025).previous_balance, TUITION_FEE)

    def test_generate_single_uses_the_same_gap_rule(self):
        _gen(self.school, 1, 2026, [self.tuition])
        user = get_user_model().objects.create_superuser('imp_admin', 'imp@test.com', 'pw12345678')
        client = APIClient()
        client.force_authenticate(user)
        response = client.post(
            '/api/finance/fee-payments/generate_single/',
            {'student': self.student.id, 'fee_type': 'MONTHLY', 'month': 4, 'year': 2026,
             'monthly_category': self.tuition.id},
            format='json', HTTP_X_SCHOOL_ID=str(self.school.id),
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['record']['previous_balance'], '1000.00')

    def test_regeneration_with_update_repairs_a_row_made_by_the_old_logic(self):
        _gen(self.school, 1, 2026, [self.tuition])
        FeePayment.objects.create(
            school=self.school, student=self.student, fee_type='MONTHLY', monthly_category=self.tuition,
            month=3, year=2026, previous_balance=0, base_monthly_fee=TUITION_FEE, amount_due=TUITION_FEE,
        )
        result = _gen(self.school, 3, 2026, [self.tuition], strategy='update')
        self.assertGreaterEqual(result['updated'], 1)
        self.assertEqual(_row(self.student, self.tuition, 3, 2026).amount_due, TUITION_FEE * 2)

    def test_generation_still_runs_under_the_new_locks(self):
        self.assertEqual(ledger.lock_generation(self.school.id, 2026, 1), None)
        self.assertEqual(_gen(self.school, 1, 2026, [self.tuition])['created'], 2)


class TestPaidRowsSurviveRegeneration(ImprovementBase):
    def setUp(self):
        _gen(self.school, 1, 2026, [self.tuition])
        FeeStructure.objects.filter(pk=self.tuition_structure.pk).update(monthly_amount=Decimal('1200'))

    def test_a_row_with_a_kuickpay_allocation_is_protected_even_at_zero_cash(self):
        row = _row(self.student, self.tuition, 1, 2026)
        self.kuickpay_credit(row, '300')
        result = _gen(self.school, 1, 2026, [self.tuition], strategy='delete_recreate')
        self.assertEqual(result['protected_conflict'], 1)
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).id, row.id)

    def test_update_mode_keeps_recorded_payments(self):
        row = self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        _gen(self.school, 1, 2026, [self.tuition], strategy='update')
        row.refresh_from_db()
        self.assertEqual(row.amount_paid, Decimal('400'))
        self.assertEqual(row.amount_due, Decimal('1200'))

    def test_annual_delete_recreate_protects_a_paid_row(self):
        cat = AnnualFeeCategory.objects.create(school=self.school, name='Annual', is_active=True)
        FeeStructure.objects.create(
            school=self.school, class_obj=self.class_obj, fee_type='ANNUAL', annual_category=cat,
            monthly_amount=Decimal('5000'), effective_from=date(2024, 1, 1),
        )
        generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id, 'year': 2026, 'annual_category_ids': [cat.id],
        }).get()
        row = FeePayment.objects.get(student=self.student, fee_type='ANNUAL', annual_category=cat)
        self.pay(row, '1000')
        FeeStructure.objects.filter(annual_category=cat).update(monthly_amount=Decimal('6000'))
        result = generate_annual_fees_task.apply(kwargs={
            'school_id': self.school.id, 'year': 2026, 'annual_category_ids': [cat.id],
            'conflict_strategy': 'delete_recreate',
        }).get()
        self.assertEqual(result['protected_conflict'], 1)
        row.refresh_from_db()
        self.assertEqual(row.amount_paid, Decimal('1000'))

    def test_generate_single_delete_recreate_refuses_a_paid_row(self):
        self.pay(_row(self.student, self.tuition, 1, 2026), '400')
        user = get_user_model().objects.create_superuser('imp_admin2', 'imp2@test.com', 'pw12345678')
        client = APIClient()
        client.force_authenticate(user)
        response = client.post(
            '/api/finance/fee-payments/generate_single/',
            {'student': self.student.id, 'fee_type': 'MONTHLY', 'month': 1, 'year': 2026,
             'monthly_category': self.tuition.id, 'conflict_strategy': 'delete_recreate'},
            format='json', HTTP_X_SCHOOL_ID=str(self.school.id),
        )
        self.assertEqual(response.status_code, 409)
        self.assertTrue(response.json()['protected_conflict'])
        self.assertEqual(_row(self.student, self.tuition, 1, 2026).amount_paid, Decimal('400'))


class TestKuickpayMoneyIsProtected(ImprovementBase):
    def setUp(self):
        _gen(self.school, 1, 2026, [self.tuition])
        self.row = _row(self.student, self.tuition, 1, 2026)
        self.kuickpay_credit(self.row, '600')
        self.row.refresh_from_db()
        user = get_user_model().objects.create_superuser('imp_admin3', 'imp3@test.com', 'pw12345678')
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.headers = {'HTTP_X_SCHOOL_ID': str(self.school.id)}

    def test_model_save_refuses_to_lower_amount_paid_below_the_allocation(self):
        self.row.amount_paid = Decimal('599.99')
        with self.assertRaises(ValidationError):
            self.row.save()

    def test_model_save_allows_paying_more_or_the_same(self):
        self.row.amount_paid = Decimal('600')
        self.row.save()
        self.row.amount_paid = Decimal('900')
        self.row.save()
        self.assertEqual(FeePayment.objects.get(pk=self.row.pk).amount_paid, Decimal('900'))

    def test_api_patch_below_the_allocation_is_rejected_with_a_field_message(self):
        response = self.client.patch(
            f'/api/finance/fee-payments/{self.row.id}/',
            {'amount_paid': '100', 'account': self.account.id}, format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('amount_paid', response.json())
        self.row.refresh_from_db()
        self.assertEqual(self.row.amount_paid, Decimal('600'))

    def test_api_patch_at_or_above_the_allocation_still_works(self):
        response = self.client.patch(
            f'/api/finance/fee-payments/{self.row.id}/',
            {'amount_paid': '800', 'account': self.account.id}, format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 200)

    def test_bulk_update_below_the_allocation_is_reported_as_an_error(self):
        response = self.client.post(
            '/api/finance/fee-payments/bulk_update/',
            {'records': [{'id': self.row.id, 'amount_paid': '100', 'account': self.account.id}]},
            format='json', **self.headers,
        )
        body = response.json()
        self.assertEqual(body['updated'], 0)
        self.assertEqual(len(body['errors']), 1)
        self.row.refresh_from_db()
        self.assertEqual(self.row.amount_paid, Decimal('600'))

    def test_a_record_holding_kuickpay_money_cannot_be_deleted(self):
        with self.assertRaises(ValidationError):
            self.row.delete()
        response = self.client.post(
            '/api/finance/fee-payments/bulk_delete/', {'ids': [self.row.id]}, format='json', **self.headers,
        )
        self.assertEqual(response.json()['deleted'], 0)
        self.assertTrue(FeePayment.objects.filter(pk=self.row.pk).exists())

    def test_delete_through_the_api_is_refused_not_a_server_error(self):
        response = self.client.delete(f'/api/finance/fee-payments/{self.row.id}/', **self.headers)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(FeePayment.objects.filter(pk=self.row.pk).exists())

    def test_protected_error_becomes_a_409_not_a_500(self):
        response = custom_exception_handler(ProtectedError('protected', set()), {})
        self.assertEqual(response.status_code, 409)

    def test_rows_without_allocations_behave_exactly_as_before(self):
        other = _row(self.student2, self.tuition, 1, 2026)
        other.amount_paid, other.payment_date, other.account = Decimal('300'), date(2026, 1, 10), self.account
        other.save()
        other.amount_paid = Decimal('100')
        other.save()
        other.delete()
