import pytest

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord


pytestmark = [pytest.mark.django_db]


def _results(resp):
    data = resp.json()
    if isinstance(data, dict):
        return data.get('results', data)
    return data


def _find_student_row(resp, student_id):
    for row in _results(resp):
        if row.get('id') == student_id:
            return row
    return None


def test_students_status_and_is_active_follow_enrollment_for_academic_year(seed_data, api):
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    school = seed_data['school_a']
    academic_year = seed_data['academic_year']
    student = seed_data['students'][0]

    enrollment = StudentEnrollment.objects.filter(
        school=school,
        student=student,
        academic_year=academic_year,
    ).first()
    if not enrollment:
        enrollment = StudentEnrollment.objects.create(
            school=school,
            student=student,
            academic_year=academic_year,
            class_obj=student.class_obj,
            roll_number=student.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

    # Historical status must be sourced from enrollment, not student snapshot.
    student.status = 'ACTIVE'
    student.save(update_fields=['status'])
    enrollment.status = StudentEnrollment.Status.GRADUATED
    enrollment.is_active = True
    enrollment.save(update_fields=['status', 'is_active', 'updated_at'])

    resp = api.get(
        f'/api/students/?academic_year={academic_year.id}&page_size=9999',
        token,
        sid,
    )
    assert resp.status_code == 200, resp.content[:300]
    row = _find_student_row(resp, student.id)
    assert row is not None
    assert row['status'] == StudentEnrollment.Status.GRADUATED

    # is_active filter must be evaluated against enrollment when academic_year is supplied.
    enrollment.is_active = False
    enrollment.save(update_fields=['is_active', 'updated_at'])

    active_resp = api.get(
        f'/api/students/?academic_year={academic_year.id}&is_active=true&page_size=9999',
        token,
        sid,
    )
    assert active_resp.status_code == 200, active_resp.content[:300]
    assert _find_student_row(active_resp, student.id) is None

    inactive_resp = api.get(
        f'/api/students/?academic_year={academic_year.id}&is_active=false&page_size=9999',
        token,
        sid,
    )
    assert inactive_resp.status_code == 200, inactive_resp.content[:300]
    assert _find_student_row(inactive_resp, student.id) is not None


def test_attendance_class_filter_uses_enrollment_for_historical_year(seed_data, api):
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    school = seed_data['school_a']
    academic_year = seed_data['academic_year']
    student = seed_data['students'][0]
    class_old = seed_data['classes'][0]
    class_new = seed_data['classes'][1]

    enrollment = StudentEnrollment.objects.filter(
        school=school,
        student=student,
        academic_year=academic_year,
    ).first()
    if not enrollment:
        enrollment = StudentEnrollment.objects.create(
            school=school,
            student=student,
            academic_year=academic_year,
            class_obj=class_old,
            roll_number=student.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

    enrollment.class_obj = class_old
    enrollment.is_active = True
    enrollment.save(update_fields=['class_obj', 'is_active', 'updated_at'])

    # Move current snapshot to a different class to reproduce historical mismatch.
    student.class_obj = class_new
    student.save(update_fields=['class_obj', 'updated_at'])

    record = AttendanceRecord.objects.create(
        school=school,
        student=student,
        date='2025-06-20',
        academic_year=academic_year,
        status='PRESENT',
        source='MANUAL',
    )

    old_class_resp = api.get(
        f'/api/attendance/records/?academic_year={academic_year.id}&class_id={class_old.id}&date={record.date}',
        token,
        sid,
    )
    assert old_class_resp.status_code == 200, old_class_resp.content[:300]
    old_class_ids = {row['id'] for row in _results(old_class_resp)}
    assert record.id in old_class_ids

    new_class_resp = api.get(
        f'/api/attendance/records/?academic_year={academic_year.id}&class_id={class_new.id}&date={record.date}',
        token,
        sid,
    )
    assert new_class_resp.status_code == 200, new_class_resp.content[:300]
    new_class_ids = {row['id'] for row in _results(new_class_resp)}
    assert record.id not in new_class_ids


def test_student_enrollment_history_endpoint_returns_enrollment_rows(seed_data, api):
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    school = seed_data['school_a']
    academic_year = seed_data['academic_year']
    student = seed_data['students'][0]

    enrollment = StudentEnrollment.objects.filter(
        school=school,
        student=student,
        academic_year=academic_year,
    ).first()
    if not enrollment:
        enrollment = StudentEnrollment.objects.create(
            school=school,
            student=student,
            academic_year=academic_year,
            class_obj=student.class_obj,
            roll_number=student.roll_number,
            status=StudentEnrollment.Status.ACTIVE,
            is_active=True,
        )

    resp = api.get(f'/api/students/{student.id}/enrollment_history/', token, sid)
    assert resp.status_code == 200, resp.content[:300]

    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0

    row = data[0]
    assert 'academic_year_name' in row
    assert 'class_name' in row
    assert 'section' in row
    assert 'roll_number' in row
    assert 'status' in row
    assert 'is_active' in row
