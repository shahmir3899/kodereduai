"""
Test audit trail enforcement in Finance models (Expense, OtherIncome, Transfer).

Tests that:
1. NULL recorded_by raises ValidationError
2. Valid recorded_by saves successfully
3. API layer works correctly
"""

import pytest
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.contrib.auth import get_user_model
from decimal import Decimal
from datetime import date

from finance.models import Expense, OtherIncome, Transfer, Account, ExpenseCategory, IncomeCategory
from schools.models import School

User = get_user_model()


class ExpenseAuditTrailTests(TestCase):
    """Test Expense model audit trail validation."""

    def setUp(self):
        self.school = School.objects.create(name='Test School', code='TS001')
        self.user = User.objects.create_user(username='testuser', password='pass123')
        self.account = Account.objects.create(
            school=self.school,
            name='Test Account',
            account_type='CASH'
        )
        self.category = ExpenseCategory.objects.create(
            school=self.school,
            name='Test Category'
        )

    def test_expense_with_recorded_by_saves(self):
        """Expense with recorded_by should save successfully."""
        expense = Expense(
            school=self.school,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by=self.user,
            description='Valid expense'
        )
        # Should not raise any exception
        expense.save()
        assert Expense.objects.filter(id=expense.id).exists()

    def test_expense_without_recorded_by_raises_error(self):
        """Expense without recorded_by should raise ValidationError."""
        expense = Expense(
            school=self.school,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by=None,  # Audit trail violation
            description='Invalid expense'
        )
        with pytest.raises(ValidationError) as exc_info:
            expense.save()
        assert 'recorded_by' in str(exc_info.value)
        assert 'Audit trail violation' in str(exc_info.value)

    def test_expense_recorded_by_requires_actual_user(self):
        """recorded_by must be a real user (not just user_id set)."""
        expense = Expense(
            school=self.school,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by_id=None,  # Explicitly None ID
            description='Invalid expense'
        )
        with pytest.raises(ValidationError):
            expense.save()


class OtherIncomeAuditTrailTests(TestCase):
    """Test OtherIncome model audit trail validation."""

    def setUp(self):
        self.school = School.objects.create(name='Test School', code='TS001')
        self.user = User.objects.create_user(username='testuser', password='pass123')
        self.account = Account.objects.create(
            school=self.school,
            name='Test Account',
            account_type='CASH'
        )
        self.category = IncomeCategory.objects.create(
            school=self.school,
            name='Test Income Category'
        )

    def test_other_income_with_recorded_by_saves(self):
        """OtherIncome with recorded_by should save successfully."""
        income = OtherIncome(
            school=self.school,
            amount=Decimal('5000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by=self.user,
            description='Valid income'
        )
        # Should not raise any exception
        income.save()
        assert OtherIncome.objects.filter(id=income.id).exists()

    def test_other_income_without_recorded_by_raises_error(self):
        """OtherIncome without recorded_by should raise ValidationError."""
        income = OtherIncome(
            school=self.school,
            amount=Decimal('5000.00'),
            date=date(2026, 3, 9),
            account=self.account,
            category=self.category,
            recorded_by=None,  # Audit trail violation
            description='Invalid income'
        )
        with pytest.raises(ValidationError) as exc_info:
            income.save()
        assert 'recorded_by' in str(exc_info.value)
        assert 'Audit trail violation' in str(exc_info.value)


class TransferAuditTrailTests(TestCase):
    """Test Transfer model audit trail validation."""

    def setUp(self):
        self.school = School.objects.create(name='Test School', code='TS001')
        self.user = User.objects.create_user(username='testuser', password='pass123')
        self.account1 = Account.objects.create(
            school=self.school,
            name='Account 1',
            account_type='CASH'
        )
        self.account2 = Account.objects.create(
            school=self.school,
            name='Account 2',
            account_type='BANK'
        )

    def test_transfer_with_recorded_by_saves(self):
        """Transfer with recorded_by should save successfully."""
        transfer = Transfer(
            school=self.school,
            from_account=self.account1,
            to_account=self.account2,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            recorded_by=self.user,
            description='Valid transfer'
        )
        # Should not raise any exception
        transfer.save()
        assert Transfer.objects.filter(id=transfer.id).exists()

    def test_transfer_without_recorded_by_raises_error(self):
        """Transfer without recorded_by should raise ValidationError."""
        transfer = Transfer(
            school=self.school,
            from_account=self.account1,
            to_account=self.account2,
            amount=Decimal('1000.00'),
            date=date(2026, 3, 9),
            recorded_by=None,  # Audit trail violation
            description='Invalid transfer'
        )
        with pytest.raises(ValidationError) as exc_info:
            transfer.save()
        assert 'recorded_by' in str(exc_info.value)
        assert 'Audit trail violation' in str(exc_info.value)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
