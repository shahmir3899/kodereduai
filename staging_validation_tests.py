"""
Staging Validation Tests for Plan 1 & Plan 2 Implementations
Tests actual PRINCIPAL and TEACHER account filtering
"""

import os
import sys
import django
from decimal import Decimal
from datetime import date

# Setup Django
sys.path.insert(0, '/d/Personal/smart-attendance/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import RequestFactory
from django.contrib.auth import get_user_model
from schools.models import Organization, School, UserSchoolMembership
from finance.models import Expense, ExpenseCategory, Account, OtherIncome, Transfer, FeePayment
from finance.views import ExpenseViewSet, OtherIncomeViewSet, TransferViewSet, AccountViewSet, FeePaymentViewSet
from academics.models import ClassSubject, Subject
from students.models import Class, Student
from hr.models import StaffMember
from core.permissions import _is_data_restricted_user, get_effective_role, ADMIN_ROLES

User = get_user_model()

# Test counters
tests_passed = 0
tests_failed = 0

def test_case(name, condition, expected=True):
    """Helper to run a test case"""
    global tests_passed, tests_failed
    result = condition == expected
    status = "✅ PASS" if result else "❌ FAIL"
    print(f"{status}: {name}")
    if result:
        tests_passed += 1
    else:
        tests_failed += 1
    return result


print("\n" + "="*80)
print("STAGING VALIDATION TEST SUITE")
print("Testing Plan 1 & Plan 2 Implementations")
print("="*80 + "\n")

# Setup test data
print("Setting up test data...")
factory = RequestFactory()

# Organization and School
org, _ = Organization.objects.get_or_create(name="Test Org", code="TEST_ORG")
school, _ = School.objects.get_or_create(
    organization=org, name="Test School", code="TEST_SCH", is_active=True
)

# Test Users
admin_user, _ = User.objects.get_or_create(
    username="test_admin", defaults={'email': 'admin@test.com', 'role': 'SCHOOL_ADMIN'}
)
principal_user, _ = User.objects.get_or_create(
    username="test_principal", defaults={'email': 'principal@test.com', 'role': 'PRINCIPAL'}
)
staff_user, _ = User.objects.get_or_create(
    username="test_staff", defaults={'email': 'staff@test.com', 'role': 'STAFF'}
)
teacher_user, _ = User.objects.get_or_create(
    username="test_teacher", defaults={'email': 'teacher@test.com', 'role': 'TEACHER'}
)

# Memberships
UserSchoolMembership.objects.get_or_create(user=admin_user, school=school, defaults={'role': 'SCHOOL_ADMIN'})
UserSchoolMembership.objects.get_or_create(user=principal_user, school=school, defaults={'role': 'PRINCIPAL'})
UserSchoolMembership.objects.get_or_create(user=staff_user, school=school, defaults={'role': 'STAFF'})
UserSchoolMembership.objects.get_or_create(user=teacher_user, school=school, defaults={'role': 'TEACHER'})

# Test Account
account, _ = Account.objects.get_or_create(
    school=school, name="Test Account",
    defaults={
        'account_type': 'BANK',
        'opening_balance': Decimal("50000.00"),
        'is_active': True,
        'staff_visible': True
    }
)

# Test Category
category, _ = ExpenseCategory.objects.get_or_create(
    school=school, name="Test Category", defaults={'is_active': True}
)

print("✓ Test data ready\n")

# ============================================================================
# TEST SECTION 1: _is_data_restricted_user() Function (Plan 1)
# ============================================================================
print("\n" + "="*80)
print("SECTION 1: Data Restricted User Function (Plan 1)")
print("="*80 + "\n")

# Create requests for each role
request_admin = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
request_admin.user = admin_user

request_principal = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
request_principal.user = principal_user

request_staff = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
request_staff.user = staff_user

request_teacher = factory.get('/', HTTP_X_SCHOOL_ID=str(school.id))
request_teacher.user = teacher_user

# Test data restriction
test_case("ADMIN not data-restricted", _is_data_restricted_user(request_admin), expected=False)
test_case("PRINCIPAL IS data-restricted (Plan 1 fix)", _is_data_restricted_user(request_principal), expected=True)
test_case("STAFF IS data-restricted", _is_data_restricted_user(request_staff), expected=True)
test_case("TEACHER IS data-restricted", _is_data_restricted_user(request_teacher), expected=True)

# ============================================================================
# TEST SECTION 2: PRINCIPAL Sensitive Expense Filtering (Plan 1 - Issue 1A)
# ============================================================================
print("\n" + "="*80)
print("SECTION 2: PRINCIPAL Sensitive Expense Filtering (Plan 1 - Issue 1A)")
print("="*80 + "\n")

# Create test expenses
normal_expense, _ = Expense.objects.get_or_create(
    school=school, category=category,
    date=date(2024, 1, 1),
    defaults={
        'amount': Decimal("1000.00"),
        'description': "Normal Expense",
        'recorded_by': admin_user,
        'account': account,
        'is_sensitive': False
    }
)

sensitive_expense, _ = Expense.objects.get_or_create(
    school=school, category=category,
    date=date(2024, 1, 2),
    defaults={
        'amount': Decimal("2000.00"),
        'description': "Sensitive Expense",
        'recorded_by': admin_user,
        'account': account,
        'is_sensitive': True
    }
)

# Test ADMIN can see both
viewset_admin = ExpenseViewSet()
viewset_admin.request = request_admin
admin_queryset = viewset_admin.get_queryset()
test_case("ADMIN sees normal expense", normal_expense in admin_queryset)
test_case("ADMIN sees sensitive expense", sensitive_expense in admin_queryset)

# Test PRINCIPAL cannot see sensitive
viewset_principal = ExpenseViewSet()
viewset_principal.request = request_principal
principal_queryset = viewset_principal.get_queryset()
test_case("PRINCIPAL sees normal expense", normal_expense in principal_queryset)
test_case("PRINCIPAL CANNOT see sensitive expense", sensitive_expense not in principal_queryset)

# Test STAFF cannot see sensitive
viewset_staff = ExpenseViewSet()
viewset_staff.request = request_staff
staff_queryset = viewset_staff.get_queryset()
test_case("STAFF sees normal expense", normal_expense in staff_queryset)
test_case("STAFF CANNOT see sensitive expense", sensitive_expense not in staff_queryset)

# ============================================================================
# TEST SECTION 3: Account Ownership Filtering (Plan 2 - Issue 2)
# ============================================================================
print("\n" + "="*80)
print("SECTION 3: Account Ownership Filtering (Plan 2 - Issue 2)")
print("="*80 + "\n")

# Create accounts with different visibility
shared_account, _ = Account.objects.get_or_create(
    school=school, name="Shared Account",
    defaults={
        'account_type': 'BANK',
        'opening_balance': Decimal("10000.00"),
        'is_active': True,
        'staff_visible': True,  # Visible to all staff
        'account_owner': None
    }
)

teacher_personal_account, _ = Account.objects.get_or_create(
    school=school, name="Teacher Personal Account",
    defaults={
        'account_type': 'PERSON',
        'opening_balance': Decimal("5000.00"),
        'is_active': True,
        'staff_visible': False,  # Only visible to owner
        'account_owner': teacher_user
    }
)

staff_personal_account, _ = Account.objects.get_or_create(
    school=school, name="Staff Personal Account",
    defaults={
        'account_type': 'PERSON',
        'opening_balance': Decimal("3000.00"),
        'is_active': True,
        'staff_visible': False,
        'account_owner': staff_user
    }
)

# Test ADMIN sees all accounts
viewset_account_admin = AccountViewSet()
viewset_account_admin.request = request_admin
admin_accounts = viewset_account_admin.get_queryset()
test_case("ADMIN sees shared account", shared_account in admin_accounts)
test_case("ADMIN sees teacher personal account", teacher_personal_account in admin_accounts)
test_case("ADMIN sees staff personal account", staff_personal_account in admin_accounts)

# Test TEACHER sees shared + owned account only
viewset_account_teacher = AccountViewSet()
viewset_account_teacher.request = request_teacher
teacher_accounts = viewset_account_teacher.get_queryset()
test_case("TEACHER sees shared account", shared_account in teacher_accounts)
test_case("TEACHER sees own personal account", teacher_personal_account in teacher_accounts)
test_case("TEACHER CANNOT see staff personal account", staff_personal_account not in teacher_accounts)

# Test STAFF sees shared + owned account only
viewset_account_staff = AccountViewSet()
viewset_account_staff.request = request_staff
staff_accounts = viewset_account_staff.get_queryset()
test_case("STAFF sees shared account", shared_account in staff_accounts)
test_case("STAFF sees own personal account", staff_personal_account in staff_accounts)
test_case("STAFF CANNOT see teacher personal account", teacher_personal_account not in staff_accounts)

# ============================================================================
# TEST SECTION 4: Other Income & Transfer Sensitive Filtering (Plan 2)
# ============================================================================
print("\n" + "="*80)
print("SECTION 4: OtherIncome & Transfer Sensitive Filtering (Plan 2)")
print("="*80 + "\n")

# Create other income entries
normal_income, _ = OtherIncome.objects.get_or_create(
    school=school, category='DONATION',
    date=date(2024, 1, 1),
    defaults={
        'amount': Decimal("500.00"),
        'description': "Normal Donation",
        'recorded_by': admin_user,
        'account': account,
        'is_sensitive': False
    }
)

sensitive_income, _ = OtherIncome.objects.get_or_create(
    school=school, category='GRANT',
    date=date(2024, 1, 2),
    defaults={
        'amount': Decimal("1000.00"),
        'description': "Sensitive Grant",
        'recorded_by': admin_user,
        'account': account,
        'is_sensitive': True
    }
)

# Test OtherIncome filtering
viewset_income_principal = OtherIncomeViewSet()
viewset_income_principal.request = request_principal
income_qs = viewset_income_principal.get_queryset()
test_case("PRINCIPAL sees normal income", normal_income in income_qs)
test_case("PRINCIPAL CANNOT see sensitive income", sensitive_income not in income_qs)

# Create transfers
account2, _ = Account.objects.get_or_create(
    school=school, name="Transfer Account",
    defaults={
        'account_type': 'BANK',
        'opening_balance': Decimal("20000.00"),
        'is_active': True,
        'staff_visible': True
    }
)

normal_transfer, _ = Transfer.objects.get_or_create(
    school=school,
    from_account=account,
    to_account=account2,
    date=date(2024, 1, 1),
    defaults={
        'amount': Decimal("500.00"),
        'description': "Normal Transfer",
        'recorded_by': admin_user,
        'is_sensitive': False
    }
)

sensitive_transfer, _ = Transfer.objects.get_or_create(
    school=school,
    from_account=account,
    to_account=account2,
    date=date(2024, 1, 2),
    defaults={
        'amount': Decimal("1000.00"),
        'description': "Sensitive Transfer",
        'recorded_by': admin_user,
        'is_sensitive': True
    }
)

# Test Transfer filtering
viewset_transfer_principal = TransferViewSet()
viewset_transfer_principal.request = request_principal
transfer_qs = viewset_transfer_principal.get_queryset()
test_case("PRINCIPAL sees normal transfer", normal_transfer in transfer_qs)
test_case("PRINCIPAL CANNOT see sensitive transfer", sensitive_transfer not in transfer_qs)

# ============================================================================
# TEST SECTION 5: TEACHER Class-Level Fee Filtering (Plan 1 - Issue 3A)
# ============================================================================
print("\n" + "="*80)
print("SECTION 5: TEACHER Class-Level Fee Filtering (Plan 1 - Issue 3A)")
print("="*80 + "\n")

# Create classes
class_a, _ = Class.objects.get_or_create(
    school=school, name="Class A", code="CLA",
    defaults={'is_active': True}
)

class_b, _ = Class.objects.get_or_create(
    school=school, name="Class B", code="CLB",
    defaults={'is_active': True}
)

# Create students
student_a, _ = Student.objects.get_or_create(
    school=school, name="Student A", admission_number="ADM_A",
    date_of_birth=date(2010, 1, 1),
    defaults={'class_obj': class_a}
)

student_b, _ = Student.objects.get_or_create(
    school=school, name="Student B", admission_number="ADM_B",
    date_of_birth=date(2010, 2, 1),
    defaults={'class_obj': class_b}
)

# Create StaffMember for teacher if not exist
staff_member, _ = StaffMember.objects.get_or_create(
    user=teacher_user, school=school,
    defaults={
        'first_name': 'Test',
        'last_name': 'Teacher',
        'employee_id': 'T001'
    }
)

# Create subject
subject, _ = Subject.objects.get_or_create(
    school=school, name="Math", code="MATH",
    defaults={'is_active': True}
)

# Assign teacher to Class A only
ClassSubject.objects.get_or_create(
    school=school, class_obj=class_a, subject=subject, teacher=staff_member,
    defaults={'is_active': True}
)

# Create fee payments
fee_a, _ = FeePayment.objects.get_or_create(
    school=school, student=student_a,
    month=1, year=2024,
    defaults={
        'amount': Decimal("5000.00"),
        'status': 'PENDING',
        'fee_type': 'TUITION'
    }
)

fee_b, _ = FeePayment.objects.get_or_create(
    school=school, student=student_b,
    month=1, year=2024,
    defaults={
        'amount': Decimal("5000.00"),
        'status': 'PENDING',
        'fee_type': 'TUITION'
    }
)

# Test TEACHER sees only assigned class fees
viewset_fee_teacher = FeePaymentViewSet()
viewset_fee_teacher.request = request_teacher
teacher_fees = viewset_fee_teacher.get_queryset()
test_case("TEACHER sees fee for assigned class", fee_a in teacher_fees)
test_case("TEACHER CANNOT see fee for unassigned class", fee_b not in teacher_fees)

# Test ADMIN sees all fees
viewset_fee_admin = FeePaymentViewSet()
viewset_fee_admin.request = request_admin
admin_fees = viewset_fee_admin.get_queryset()
test_case("ADMIN sees all fees", fee_a in admin_fees and fee_b in admin_fees)

# ============================================================================
# RESULTS
# ============================================================================
print("\n" + "="*80)
print("TEST RESULTS")
print("="*80)
print(f"\n✅ Passed: {tests_passed}")
print(f"❌ Failed: {tests_failed}")
print(f"Total: {tests_passed + tests_failed}\n")

if tests_failed == 0:
    print("🎉 ALL TESTS PASSED - STAGING VALIDATION SUCCESSFUL!\n")
    sys.exit(0)
else:
    print(f"⚠️  {tests_failed} test(s) failed\n")
    sys.exit(1)
