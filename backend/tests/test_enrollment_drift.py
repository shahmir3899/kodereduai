"""
Drift checks and the nightly alert. The Student snapshot means the latest
placement: promotion moves it to next year's class before that year is
current, so it is compared with the latest enrollment, not the current year's.
"""
from datetime import date

import pytest

from academic_sessions.drift import drift_checks
from academic_sessions.enrollment_service import move_student
from academic_sessions.models import AcademicYear, StudentEnrollment
from academic_sessions.tasks import check_enrollment_drift
from notifications.models import NotificationLog


pytestmark = pytest.mark.django_db


def _counts(school_id):
    return {key: qs.count() for key, _title, qs in drift_checks(school_id=school_id)}


def _enroll(seed_data, student, year, class_obj, roll, **extra):
    return StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=year,
        class_obj=class_obj, roll_number=roll, status='ACTIVE', is_active=True, **extra,
    )


@pytest.fixture
def next_year(seed_data):
    return AcademicYear.objects.create(
        school=seed_data['school_a'], name='PYTEST_2026-2027',
        start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=False, is_active=True,
    )


def test_snapshot_mismatch_is_flagged(seed_data):
    student = seed_data['students'][0]  # snapshot: Class_1A, roll 1
    _enroll(seed_data, student, seed_data['academic_year'], seed_data['classes'][1], '9')

    assert _counts(seed_data['SID_A'])['snapshot_mismatch'] == 1


def test_promoted_snapshot_matching_next_year_is_not_drift(seed_data, next_year):
    student = seed_data['students'][0]
    _enroll(seed_data, student, seed_data['academic_year'], seed_data['classes'][0], student.roll_number)
    _enroll(seed_data, student, next_year, seed_data['classes'][1], '4')
    student.class_obj = seed_data['classes'][1]
    student.roll_number = '4'
    student.save(update_fields=['class_obj', 'roll_number'])

    assert _counts(seed_data['SID_A'])['snapshot_mismatch'] == 0


def test_correcting_the_latest_enrollment_updates_snapshot_before_that_year_is_current(seed_data, next_year):
    student = seed_data['students'][0]
    _enroll(seed_data, student, seed_data['academic_year'], seed_data['classes'][0], student.roll_number)
    upcoming = _enroll(seed_data, student, next_year, seed_data['classes'][1], '4')

    move_student(upcoming, class_obj=seed_data['classes'][2], roll_number='7')

    student.refresh_from_db()
    assert (student.class_obj_id, student.roll_number) == (seed_data['classes'][2].id, '7')


def test_nightly_check_alerts_admins_once_per_day(seed_data):
    _enroll(seed_data, seed_data['students'][0], seed_data['academic_year'], seed_data['classes'][1], '9')

    check_enrollment_drift()
    check_enrollment_drift()

    alerts = NotificationLog.objects.filter(
        recipient_user=seed_data['users']['admin'], event_type='GENERAL', title__startswith='Class records need attention',
    )
    assert alerts.count() == 1
    assert seed_data['students'][0].name in alerts.first().body


def test_enrollment_without_section_is_only_flagged_when_the_class_has_sections(seed_data, seed_sections):
    # Class_1A has sections (seed_sections); Class_2B has none.
    no_section_in_split_class = _enroll(
        seed_data, seed_data['students'][4], seed_data['academic_year'], seed_data['classes'][0], '8',
    )
    _enroll(seed_data, seed_data['students'][5], seed_data['academic_year'], seed_data['classes'][1], '2')

    flagged = dict((key, qs) for key, _title, qs in drift_checks(school_id=seed_data['SID_A']))['no_section']
    assert list(flagged) == [no_section_in_split_class]


def test_nightly_check_is_silent_when_records_agree(seed_data):
    student = seed_data['students'][0]
    _enroll(seed_data, student, seed_data['academic_year'], student.class_obj, student.roll_number)

    check_enrollment_drift()

    assert not NotificationLog.objects.filter(title__startswith='Class records need attention').exists()
