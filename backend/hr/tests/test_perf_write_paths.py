"""The new who-did-it columns are filled by the screens that write those rows."""
from datetime import date
from decimal import Decimal

import pytest

from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from notifications.models import SchoolNotificationConfig

pytestmark = pytest.mark.django_db


def test_manual_attendance_bulk_entry_sets_marked_by(perf, api, enrol_class_1):
    SchoolNotificationConfig.objects.update_or_create(
        school=perf['school_a'], defaults={'absence_notification_enabled': False},
    )
    resp = api.post('/api/attendance/records/bulk_entry/', {
        'class_id': perf['classes'][0].id,
        'academic_year': perf['academic_year'].id,
        'date': '2026-03-02',
        'entries': [{'student_id': s.id, 'status': 'PRESENT'} for s in enrol_class_1],
    }, perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 200, resp.content
    marked = set(AttendanceRecord.objects.filter(date=date(2026, 3, 2)).values_list('marked_by_id', flat=True))
    assert marked == {perf['users']['admin'].id}


def test_face_attendance_confirm_sets_marked_by(perf, api):
    session = perf['face_session']
    resp = api.post(
        f'/api/face-attendance/sessions/{session.id}/confirm/',
        {'present_student_ids': [perf['students'][0].id]},
        perf['tokens']['admin'], perf['SID_A'],
    )
    assert resp.status_code == 200, resp.content
    marked = set(AttendanceRecord.objects.filter(face_session=session).values_list('marked_by_id', flat=True))
    assert marked == {perf['users']['admin'].id}


def test_marks_bulk_entry_sets_entered_by(perf, api, enrol_class_1):
    exam_type = ExamType.objects.create(school=perf['school_a'], name='Mid', weight=Decimal('100'))
    exam = Exam.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], exam_type=exam_type,
        class_obj=perf['classes'][0], name='Midterm',
    )
    es = ExamSubject.objects.create(school=perf['school_a'], exam=exam, subject=perf['subjects'][0])
    resp = api.post('/api/examinations/marks/bulk_entry/', {
        'exam_subject_id': es.id,
        'marks': [{'student_id': enrol_class_1[0].id, 'marks_obtained': 70, 'is_absent': False, 'remarks': ''}],
    }, perf['tokens']['principal'], perf['SID_A'])
    assert resp.status_code == 200, resp.content
    assert StudentMark.objects.get(exam_subject=es).entered_by == perf['users']['principal']
