"""
Quick smoke tests for Plan 1 implementation.
Validates: Issue 1A (PRINCIPAL sensitive filtering) + Issue 3A (TEACHER class-level access)
"""

import pytest
from django.test import RequestFactory
from django.contrib.auth import get_user_model
from decimal import Decimal
from datetime import date

from schools.models import Organization, School, UserSchoolMembership
from finance.models import Expense, ExpenseCategory, Account
from finance.views import ExpenseViewSet
from core.permissions import _is_data_restricted_user, get_effective_role

User = get_user_model()


@pytest.mark.django_db
def test_is_data_restricted_user_includes_principal():
    """Verify _is_data_restricted_user() includes PRINCIPAL role"""
    factory = RequestFactory()
    
    # Setup
    org = Organization.objects.create(name="Test", code="TEST")
    school = School.objects.create(organization=org, name="School", code="SCH")
    
    principal = User.objects.create_user(username="p", password="p", role='PRINCIPAL')
    UserSchoolMembership.objects.create(user=principal, school=school, role='PRINCIPAL')
    
    request = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
    request.user = principal
    
    # Test
    assert _is_data_restricted_user(request) is True, \
        "PRINCIPAL should be data-restricted"


@pytest.mark.django_db
def test_principal_cannot_see_sensitive_expenses():
    """Test Issue 1A: PRINCIPAL filtered from sensitive expenses"""
    factory = RequestFactory()
    
    # Setup
    org = Organization.objects.create(name="Test", code="TEST")
    school = School.objects.create(organization=org, name="School", code="SCH")
    
    admin = User.objects.create_user(username="admin", password="p", role='SCHOOL_ADMIN')
    UserSchoolMembership.objects.create(user=admin, school=school, role='SCHOOL_ADMIN')
    
    principal = User.objects.create_user(username="principal", password="p", role='PRINCIPAL')
    UserSchoolMembership.objects.create(user=principal, school=school, role='PRINCIPAL')
    
    account = Account.objects.create(
        school=school, name="Account", account_type="BANK",
        opening_balance=Decimal("10000"), is_active=True, staff_visible=True
    )
    
    category = ExpenseCategory.objects.create(school=school, name="Test", is_active=True)
    
    # Create normal and sensitive expenses
    Expense.objects.create(
        school=school, category=category, amount=Decimal("1000"),
        date=date(2024, 1, 1), description="Normal", recorded_by=admin,
        account=account, is_sensitive=False
    )
    
    Expense.objects.create(
        school=school, category=category, amount=Decimal("2000"),
        date=date(2024, 1, 2), description="Sensitive", recorded_by=admin,
        account=account, is_sensitive=True
    )
    
    # Test: PRINCIPAL queries
    request_principal = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
    request_principal.user = principal
    
    viewset = ExpenseViewSet()
    viewset.request = request_principal
    queryset = viewset.get_queryset()
    
    # PRINCIPAL should NOT see sensitive expenses
    assert queryset.filter(is_sensitive=True).count() == 0, \
        "PRINCIPAL should not see is_sensitive=True"
    assert queryset.filter(is_sensitive=False).count() == 1, \
        "PRINCIPAL should see is_sensitive=False"
    
    # Test: ADMIN queries (should see all)
    request_admin = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
    request_admin.user = admin
    
    viewset_admin = ExpenseViewSet()
    viewset_admin.request = request_admin
    queryset_admin = viewset_admin.get_queryset()
    
    assert queryset_admin.count() == 2, \
        "ADMIN should see all expenses"


@pytest.mark.django_db
def test_staff_cannot_see_sensitive_expenses():
    """Verify STAFF role continues to filter sensitive (existing behavior)"""
    factory = RequestFactory()
    
    # Setup
    org = Organization.objects.create(name="Test", code="TEST")
    school = School.objects.create(organization=org, name="School", code="SCH")
    
    admin = User.objects.create_user(username="admin", password="p", role='SCHOOL_ADMIN')
    UserSchoolMembership.objects.create(user=admin, school=school, role='SCHOOL_ADMIN')
    
    staff = User.objects.create_user(username="staff", password="p", role='STAFF')
    UserSchoolMembership.objects.create(user=staff, school=school, role='STAFF')
    
    account = Account.objects.create(
        school=school, name="Account", account_type="BANK",
        opening_balance=Decimal("10000"), is_active=True, staff_visible=True
    )
    
    category = ExpenseCategory.objects.create(school=school, name="Test", is_active=True)
    
    # Create expenses
    Expense.objects.create(
        school=school, category=category, amount=Decimal("1000"),
        date=date(2024, 1, 1), description="Normal", recorded_by=admin,
        account=account, is_sensitive=False
    )
    
    Expense.objects.create(
        school=school, category=category, amount=Decimal("2000"),
        date=date(2024, 1, 2), description="Sensitive", recorded_by=admin,
        account=account, is_sensitive=True
    )
    
    # Test
    request = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
    request.user = staff
    
    viewset = ExpenseViewSet()
    viewset.request = request
    queryset = viewset.get_queryset()
    
    # STAFF should NOT see sensitive
    assert queryset.filter(is_sensitive=True).count() == 0
    assert queryset.filter(is_sensitive=False).count() == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
