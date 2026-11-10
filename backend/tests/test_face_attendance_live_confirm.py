"""
Face Attendance — live-camera "Is this <name>?" confirmation (Yes on an uncertain match)
=======================================================================================
Covers: POST live/events/<id>/confirm/ — who may confirm, scope of the chosen
student, idempotency, the attendance write, and the labelled sample it records.

Run:
    cd backend
    pytest tests/test_face_attendance_live_confirm.py -v
"""

import uuid
from datetime import date, datetime, timezone as dt_timezone

import pytest

from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from face_attendance.models import (
    FaceAuditLog, FaceLiveDetectionEvent, FaceMatchThresholdSample,
)


def _confirm_url(event_id):
    return f'/api/face-attendance/live/events/{event_id}/confirm/'


def _flagged_event(seed_data, *, student, captured_by, class_obj=None,
                   match_status='FLAGGED', distance=0.48,
                   source_method=FaceLiveDetectionEvent.CaptureMethod.LIVE_MOBILE):
    return FaceLiveDetectionEvent.objects.create(
        school=seed_data['school_a'],
        class_obj=class_obj,
        source_method=source_method,
        embedding_version='faceapi_v1',
        client_timestamp=datetime.now(dt_timezone.utc),
        matched_student=student,
        captured_by=captured_by,
        confidence=20.0,
        distance=distance,
        match_status=match_status,
    )


def _students_in_class(seed_data, class_index, n=2):
    class_obj = seed_data['classes'][class_index]
    found = [s for s in seed_data['students'] if s.class_obj_id == class_obj.id]
    assert len(found) >= n, 'seed_data needs at least %d students in class %d' % (n, class_index)
    return class_obj, found[:n]


def _assign_teacher(seed_data, staff_index, class_obj):
    ClassTeacherAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=class_obj, teacher=seed_data['staff'][staff_index], is_active=True,
    )
    return seed_data['staff'][staff_index].user


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestConfirmUncertainMatch:
    def test_yes_on_the_suggested_student_marks_present_and_labels_it_correct(self, seed_data, api):
        class_obj, (suggested, _other) = _students_in_class(seed_data, 0)
        admin = seed_data['users']['admin']
        event = _flagged_event(seed_data, student=suggested, captured_by=admin, class_obj=class_obj)

        resp = api.post(
            _confirm_url(event.id), {'student_id': suggested.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert body['attendance_marked'] is True and body['already_marked'] is False
        assert body['student']['id'] == suggested.id

        record = AttendanceRecord.objects.get(student=suggested, date=event.client_timestamp.date())
        assert record.status == AttendanceRecord.AttendanceStatus.PRESENT
        event.refresh_from_db()
        assert event.resulted_in_attendance is True and event.attendance_record_id == record.id

        sample = FaceMatchThresholdSample.objects.get()
        assert sample.is_correct is True and sample.distance == 0.48
        assert sample.predicted_match_status == 'FLAGGED'

        audit = FaceAuditLog.objects.get(event_type=FaceAuditLog.EventType.ATTENDANCE_MATCH, student=suggested)
        assert audit.metadata['confirmed_by_operator'] is True

    def test_choosing_another_student_marks_that_student_and_labels_the_suggestion_wrong(self, seed_data, api):
        class_obj, (suggested, other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=suggested, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )

        resp = api.post(
            _confirm_url(event.id), {'student_id': other.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        assert AttendanceRecord.objects.filter(student=other, date=event.client_timestamp.date()).exists()
        assert not AttendanceRecord.objects.filter(student=suggested, date=event.client_timestamp.date()).exists()
        event.refresh_from_db()
        assert event.matched_student_id == other.id
        assert FaceMatchThresholdSample.objects.get().is_correct is False

    def test_already_present_student_is_not_rewritten(self, seed_data, api):
        class_obj, (suggested, _other) = _students_in_class(seed_data, 0)
        today = datetime.now(dt_timezone.utc).date()
        AttendanceRecord.objects.create(
            student=suggested, date=today, school=seed_data['school_a'],
            academic_year=seed_data['academic_year'],
            status=AttendanceRecord.AttendanceStatus.PRESENT,
            source=AttendanceRecord.Source.MANUAL,
        )
        event = _flagged_event(
            seed_data, student=suggested, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )

        resp = api.post(
            _confirm_url(event.id), {'student_id': suggested.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        assert resp.json()['already_marked'] is True and resp.json()['attendance_marked'] is False
        assert AttendanceRecord.objects.get(student=suggested, date=today).source == AttendanceRecord.Source.MANUAL

    def test_confirming_twice_is_rejected(self, seed_data, api):
        class_obj, (suggested, _other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=suggested, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )
        args = (_confirm_url(event.id), {'student_id': suggested.id},
                seed_data['tokens']['admin'], seed_data['SID_A'])
        assert api.post(*args).status_code == 200
        assert api.post(*args).status_code == 409
        assert FaceMatchThresholdSample.objects.count() == 1


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestConfirmGuards:
    def test_student_outside_the_scans_class_is_rejected(self, seed_data, api):
        class_obj, (suggested, _other) = _students_in_class(seed_data, 0)
        outsider = next(s for s in seed_data['students'] if s.class_obj_id != class_obj.id)
        event = _flagged_event(
            seed_data, student=suggested, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )

        resp = api.post(
            _confirm_url(event.id), {'student_id': outsider.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400
        assert not AttendanceRecord.objects.filter(student=outsider).exists()

    def test_confident_matches_cannot_be_confirmed(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=student, captured_by=seed_data['users']['admin'],
            class_obj=class_obj, match_status='AUTO_MATCHED', distance=0.2,
        )
        resp = api.post(
            _confirm_url(event.id), {'student_id': student.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_fixed_camera_events_cannot_be_confirmed(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=student, captured_by=None, class_obj=class_obj,
            source_method=FaceLiveDetectionEvent.CaptureMethod.FIXED_CAMERA,
        )
        resp = api.post(
            _confirm_url(event.id), {'student_id': student.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_teacher_who_did_not_capture_it_is_rejected(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        capturing_teacher = _assign_teacher(seed_data, 0, class_obj)
        other_class = seed_data['classes'][1]
        _assign_teacher(seed_data, 1, other_class)
        other_token = api.login(f"{seed_data['prefix']}staff_teacher2")
        event = _flagged_event(seed_data, student=student, captured_by=capturing_teacher, class_obj=class_obj)

        resp = api.post(_confirm_url(event.id), {'student_id': student.id}, other_token, seed_data['SID_A'])
        assert resp.status_code == 403
        assert not AttendanceRecord.objects.filter(student=student).exists()

    def test_capturing_teacher_can_confirm(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        teacher = _assign_teacher(seed_data, 0, class_obj)
        token = api.login(f"{seed_data['prefix']}staff_teacher1")
        event = _flagged_event(seed_data, student=student, captured_by=teacher, class_obj=class_obj)

        resp = api.post(_confirm_url(event.id), {'student_id': student.id}, token, seed_data['SID_A'])
        assert resp.status_code == 200, resp.content

    def test_unknown_event_is_404(self, seed_data, api):
        resp = api.post(
            _confirm_url(uuid.uuid4()), {'student_id': 1},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 404

    def test_missing_student_id_is_rejected(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=student, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )
        resp = api.post(_confirm_url(event.id), {}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400

    def test_unauthenticated_is_rejected(self, seed_data, api):
        class_obj, (student, _other) = _students_in_class(seed_data, 0)
        event = _flagged_event(
            seed_data, student=student, captured_by=seed_data['users']['admin'], class_obj=class_obj,
        )
        resp = api.client.post(
            _confirm_url(event.id), data='{"student_id": %d}' % student.id, content_type='application/json',
        )
        assert resp.status_code in (401, 403)
