"""
A class + year scope must match that year's enrollment only.

Chained enrollment filters used to match an enrollment from *any* year for the
class condition, so "Class 1, 2025-26" also reached last year's Class 1 cohort
(promoted to Class 2); past-year fee pages filtered on the student's current
class hid those students' records. Builds on the shared seed_data fixture:
its current year (2025-26) plus a 2024-25 year added here.
"""
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from finance.models import Account, Discount, FeePayment, FeeStructure, MonthlyFeeCategory, StudentDiscount
from finance.tasks import generate_monthly_fees_task
from finance.views import _filter_students_by_scope
from students.models import Student


pytestmark = pytest.mark.django_db


@pytest.fixture
def cohorts(seed_data):
    """Promoted: Class 1 in 2024-25, Class 2 now. Newcomer: Class 1 now only."""
    school, this_year = seed_data['school_a'], seed_data['academic_year']
    class_old, class_new = seed_data['classes'][0], seed_data['classes'][1]
    last_year = AcademicYear.objects.create(
        school=school, name='PYTEST_2024-2025',
        start_date=date(2024, 4, 1), end_date=date(2025, 3, 31),
        is_current=False, is_active=True,
    )

    promoted, newcomer = seed_data['students'][0], seed_data['students'][1]
    promoted.class_obj = class_new
    promoted.save(update_fields=['class_obj'])
    StudentEnrollment.objects.create(
        school=school, student=promoted, academic_year=last_year, class_obj=class_old,
        roll_number='1', status=StudentEnrollment.Status.PROMOTED, is_active=True,
    )
    StudentEnrollment.objects.create(
        school=school, student=promoted, academic_year=this_year, class_obj=class_new,
        roll_number='1', status=StudentEnrollment.Status.ACTIVE, is_active=True,
    )
    StudentEnrollment.objects.create(
        school=school, student=newcomer, academic_year=this_year, class_obj=class_old,
        roll_number='2', status=StudentEnrollment.Status.ACTIVE, is_active=True,
    )

    category = MonthlyFeeCategory.objects.create(school=school, name='Monthly Tuition', is_active=True)
    for class_obj, amount in ((class_old, '1200'), (class_new, '2200')):
        FeeStructure.objects.create(
            school=school, class_obj=class_obj, fee_type='MONTHLY',
            monthly_category=category, monthly_amount=Decimal(amount), effective_from=date(2024, 1, 1),
        )
    account = Account.objects.create(school=school, name='Fee Scope Cash', account_type=Account.AccountType.CASH)

    def payment(student, academic_year, month, year, due, paid):
        # A paid amount must carry payment_date + account (FeePayment.save).
        return FeePayment.objects.create(
            school=school, student=student, academic_year=academic_year,
            fee_type='MONTHLY', monthly_category=category,
            month=month, year=year, amount_due=Decimal(due), amount_paid=Decimal(paid),
            payment_date=date(year, month, 10), account=account,
        )

    return {
        'class_old': class_old, 'class_new': class_new,
        'last_year': last_year, 'this_year': this_year,
        'promoted': promoted, 'newcomer': newcomer,
        'category': category, 'payment': payment,
    }


def test_class_and_year_scope_excludes_last_years_cohort(seed_data, cohorts):
    students = list(_filter_students_by_scope(
        Student.objects.filter(school=seed_data['school_a'], is_active=True),
        seed_data['SID_A'],
        class_id=cohorts['class_old'].id,
        academic_year_id=cohorts['this_year'].id,
    ))
    assert [s.id for s in students] == [cohorts['newcomer'].id]


def test_delete_recreate_for_one_class_leaves_other_class_paid_record(seed_data, cohorts):
    # Promoted student's own (Class 2) record, already paid, with an amount
    # that would count as a conflict if they were in scope.
    paid_row = cohorts['payment'](cohorts['promoted'], cohorts['this_year'], 5, 2025, due='999', paid='999')

    result = generate_monthly_fees_task.apply(kwargs={
        'school_id': seed_data['SID_A'],
        'month': 5,
        'year': 2025,
        'class_id': cohorts['class_old'].id,
        'academic_year_id': cohorts['this_year'].id,
        'monthly_category_ids': [cohorts['category'].id],
        'conflict_strategy': 'delete_recreate',
    }).get()

    assert result['deleted_recreated'] == 0
    paid_row.refresh_from_db()
    assert paid_row.amount_paid == Decimal('999')
    assert FeePayment.objects.filter(
        student=cohorts['newcomer'], month=5, year=2025, amount_due=Decimal('1200'),
    ).exists()


def test_fee_list_past_year_class_filter_shows_promoted_students(seed_data, cohorts, api):
    row = cohorts['payment'](cohorts['promoted'], cohorts['last_year'], 3, 2025, due='1200', paid='1200')

    response = api.get(
        '/api/finance/fee-payments/'
        f"?class_id={cohorts['class_old'].id}&academic_year={cohorts['last_year'].id}"
        '&month=3&year=2025&fee_type=MONTHLY&page_size=100',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    data = response.json()
    rows = data.get('results', data)
    assert [r['id'] for r in rows] == [row.id]
    # The fee page filters rows client-side by class_obj_id, so it must be
    # that year's class (Class 1), not the student's current Class 2.
    assert rows[0]['class_obj_id'] == cohorts['class_old'].id


def test_monthly_summary_groups_past_year_under_that_years_class(seed_data, cohorts, api):
    cohorts['payment'](cohorts['promoted'], cohorts['last_year'], 3, 2025, due='1200', paid='600')

    response = api.get(
        f"/api/finance/fee-payments/monthly_summary/?month=3&year=2025&academic_year={cohorts['last_year'].id}",
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    by_class = response.json()['by_class']
    assert len(by_class) == 1
    assert by_class[0]['class_id'] == cohorts['class_old'].id
    assert by_class[0]['class_name'] == cohorts['class_old'].name
    assert by_class[0]['count'] == 1


def test_bulk_discount_by_class_uses_that_years_enrollment(seed_data, cohorts, api):
    discount = Discount.objects.create(
        school=seed_data['school_a'], academic_year=cohorts['last_year'], name='Sibling 10%',
        discount_type='PERCENTAGE', value=Decimal('10'),
    )

    response = api.post(
        '/api/finance/student-discounts/bulk_assign/',
        {
            'discount_id': discount.id,
            'class_id': cohorts['class_old'].id,
            'academic_year_id': cohorts['last_year'].id,
        },
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code in (200, 201), response.content[:300]
    assigned = set(StudentDiscount.objects.filter(discount=discount).values_list('student_id', flat=True))
    assert assigned == {cohorts['promoted'].id}
