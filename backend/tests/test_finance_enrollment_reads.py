"""
Finance reads placement from the enrollment for the record's year. The
Student.class_obj snapshot is the latest class, so a promoted student's
past-year fees were priced, filtered and labelled with the new class.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from academic_sessions.roster import placement_label, placement_roll
from finance.ai_agent import _payment_class_q
from finance.models import FeePayment, FeeStructure, resolve_fee_amount
from finance.views import _current_students_in_classes_q


pytestmark = pytest.mark.django_db


def _enroll(seed_data, student, year, class_obj, roll='7'):
    return StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=year,
        class_obj=class_obj, roll_number=roll, status='ACTIVE', is_active=True,
    )


@pytest.fixture
def past_year(seed_data):
    return AcademicYear.objects.create(
        school=seed_data['school_a'], name='PYTEST_2024-2025',
        start_date=date(2024, 4, 1), end_date=date(2025, 3, 31), is_current=False, is_active=True,
    )


def _class_fee(seed_data, class_obj, amount):
    FeeStructure.objects.create(
        school=seed_data['school_a'], class_obj=class_obj, fee_type='MONTHLY',
        monthly_amount=Decimal(amount), effective_from=date.today() - timedelta(days=1), is_active=True,
    )


def test_past_year_fee_is_priced_by_that_years_class(seed_data, past_year):
    class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
    student = seed_data['students'][0]  # snapshot: Class_1A (promoted since)
    _enroll(seed_data, student, past_year, class_2)
    _class_fee(seed_data, class_1, '1000')
    _class_fee(seed_data, class_2, '2000')

    assert resolve_fee_amount(student, 'MONTHLY', academic_year_id=past_year.id) == Decimal('2000')


def test_teacher_fee_scope_follows_current_enrollment(seed_data):
    class_1, class_2 = seed_data['classes'][0], seed_data['classes'][1]
    moved = seed_data['students'][0]  # snapshot Class_1A, enrolled in Class_2B this year
    _enroll(seed_data, moved, seed_data['academic_year'], class_2)
    stayed = seed_data['students'][1]
    _enroll(seed_data, stayed, seed_data['academic_year'], class_1)
    for student in (moved, stayed):
        FeePayment.objects.create(
            school=seed_data['school_a'], student=student, fee_type='MONTHLY', month=4, year=2025,
            amount_due=Decimal('100'), amount_paid=Decimal('0'),
        )

    q = _current_students_in_classes_q(seed_data['SID_A'], [class_2.id])
    ids = set(FeePayment.objects.filter(school=seed_data['school_a']).filter(q).values_list('student_id', flat=True))

    assert ids == {moved.id}


def test_ai_class_filter_uses_the_payments_own_year(seed_data, past_year):
    class_2 = seed_data['classes'][1]
    student = seed_data['students'][0]  # snapshot Class_1A
    _enroll(seed_data, student, past_year, class_2)
    payment = FeePayment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=past_year,
        fee_type='MONTHLY', month=5, year=2024, amount_due=Decimal('100'), amount_paid=Decimal('0'),
    )

    by_class_2 = FeePayment.objects.filter(_payment_class_q(class_2.name))
    by_class_1 = FeePayment.objects.filter(_payment_class_q(seed_data['classes'][0].name))

    assert payment in by_class_2
    assert payment not in by_class_1


def test_placement_helpers_prefer_enrollment_and_fall_back_to_snapshot(seed_data, seed_sections):
    student = seed_sections['a_students'][0]
    enrollment = StudentEnrollment.objects.get(student=student)
    enrollment.roll_number = '12'
    enrollment.save(update_fields=['roll_number'])

    assert placement_label(enrollment, student) == seed_sections['section_a'].label
    assert placement_roll(enrollment, student) == '12'
    # No enrollment (legacy year): the snapshot, with a legacy section letter.
    assert placement_label(None, student) == f"{student.class_obj.name} - A"
    assert placement_roll(None, student) == student.roll_number
