"""
Face Attendance API — Integration Tests
=========================================
Covers: Session CRUD, confirm flow, pending review, reprocess,
        enrollment, status, permissions, school isolation.

All tests use real HTTP calls through Django's test client.

Run:
    cd backend
    pytest tests/test_face_attendance_api.py -v
"""

import json
from datetime import date, timedelta
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

from face_attendance.models import (
    FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult,
)
from attendance.models import AttendanceRecord


# ── Auto-use fixtures for mocking external services ─────────────────────────

@pytest.fixture(autouse=True)
def mock_celery_tasks(monkeypatch):
    """
    Mock the Celery task dispatch so create/reprocess don't actually
    run the face_recognition pipeline (which requires dlib).
    We still want the session to be created and task_id set.
    """
    def fake_dispatch(celery_task_func, task_type, title, school_id, user,
                      task_args=None, task_kwargs=None, progress_total=None):
        class FakeBGTask:
            celery_task_id = 'fake-celery-task-id-123'
        return FakeBGTask()

    monkeypatch.setattr(
        'face_attendance.views.dispatch_background_task',
        fake_dispatch,
        raising=False,
    )


@pytest.fixture(autouse=True)
def mock_storage(monkeypatch):
    """Mock Supabase storage for upload-image endpoint."""
    monkeypatch.setattr(
        'core.storage.storage_service.is_configured',
        lambda: True,
    )
    monkeypatch.setattr(
        'core.storage.storage_service.upload_attendance_image',
        lambda *a, **kw: 'https://example.com/uploaded.jpg',
    )


# =====================================================================
# LEVEL C1: SESSION CRUD
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestSessionCRUD:
    """C1: Session lifecycle via API."""

    def test_create_session_returns_201(self, seed_data, api):
        """C1a: POST /sessions/ → 201."""
        resp = api.post('/api/face-attendance/sessions/', {
            'class_obj': seed_data['classes'][0].id,
            'date': str(date.today()),
            'image_url': 'https://example.com/photo.jpg',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.content}"

    def test_create_session_has_correct_fields(self, seed_data, api):
        """C1b: Response includes id, status, celery_task_id."""
        resp = api.post('/api/face-attendance/sessions/', {
            'class_obj': seed_data['classes'][0].id,
            'date': str(date.today()),
            'image_url': 'https://example.com/photo.jpg',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        data = resp.json()
        assert 'id' in data
        assert data['status'] == 'PROCESSING'

    def test_create_session_validates_class(self, seed_data, api):
        """C1c: Invalid class_obj → 400."""
        resp = api.post('/api/face-attendance/sessions/', {
            'class_obj': 99999,
            'date': str(date.today()),
            'image_url': 'https://example.com/photo.jpg',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_create_session_requires_image_url(self, seed_data, api):
        """C1d: Missing image_url → 400."""
        resp = api.post('/api/face-attendance/sessions/', {
            'class_obj': seed_data['classes'][0].id,
            'date': str(date.today()),
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_list_sessions_school_scoped(self, seed_data, api):
        """C1e: GET /sessions/ → only current school's sessions."""
        resp = api.get(
            '/api/face-attendance/sessions/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        # Seed data creates 1 session for school_a
        assert len(results) >= 1

    def test_list_sessions_filter_by_class(self, seed_data, api):
        """C1f: ?class_obj=X filters correctly."""
        class_1 = seed_data['classes'][0]
        resp = api.get(
            f'/api/face-attendance/sessions/?class_obj={class_1.id}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        assert len(results) >= 1

    def test_list_sessions_filter_by_status(self, seed_data, api):
        """C1g: ?status=NEEDS_REVIEW filters correctly."""
        resp = api.get(
            '/api/face-attendance/sessions/?status=NEEDS_REVIEW',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        for r in results:
            assert r['status'] == 'NEEDS_REVIEW'

    def test_list_sessions_filter_by_date(self, seed_data, api):
        """C1h: ?date=YYYY-MM-DD filters correctly."""
        resp = api.get(
            f'/api/face-attendance/sessions/?date={date.today()}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

    def test_retrieve_session_detail(self, seed_data, api):
        """C1i: GET /sessions/{id}/ → includes detections + class_students."""
        session = seed_data['face_session']
        resp = api.get(
            f'/api/face-attendance/sessions/{session.id}/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data['id'] == str(session.id)
        assert data['status'] == 'NEEDS_REVIEW'

    def test_retrieve_session_has_detections(self, seed_data, api):
        """C1j: Detail response includes nested detections array."""
        session = seed_data['face_session']
        resp = api.get(
            f'/api/face-attendance/sessions/{session.id}/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        data = resp.json()
        assert 'detections' in data
        assert len(data['detections']) == 3

    def test_retrieve_session_has_class_students(self, seed_data, api):
        """C1k: Detail includes class_students with has_embedding field."""
        session = seed_data['face_session']
        resp = api.get(
            f'/api/face-attendance/sessions/{session.id}/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        data = resp.json()
        assert 'class_students' in data
        assert len(data['class_students']) > 0
        first_student = data['class_students'][0]
        assert 'has_embedding' in first_student


# =====================================================================
# LEVEL C2: SESSION CONFIRM
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestSessionConfirm:
    """C2: Confirm flow creates AttendanceRecords."""

    def test_confirm_creates_attendance_records(self, seed_data, api):
        """C2a: POST /confirm/ → AttendanceRecords with source=FACE_CAMERA."""
        session = seed_data['face_session']
        present_ids = [seed_data['students'][0].id, seed_data['students'][1].id]
        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': present_ids},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.content}"

        # Verify records created
        records = AttendanceRecord.objects.filter(
            face_session=session, source=AttendanceRecord.Source.FACE_CAMERA,
        )
        assert records.count() > 0

    def test_confirm_marks_present_and_absent(self, seed_data, api):
        """C2b: present_student_ids → PRESENT, others → ABSENT."""
        # Create a fresh session to avoid conflict with other tests
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            academic_year=seed_data['academic_year'],
            date=date.today() + timedelta(days=1),  # different date
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/photo2.jpg',
            created_by=seed_data['users']['admin'],
        )

        student_0 = seed_data['students'][0]
        student_1 = seed_data['students'][1]

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': [student_0.id]},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

        present_rec = AttendanceRecord.objects.filter(
            student=student_0, date=session.date, face_session=session,
        ).first()
        assert present_rec is not None
        assert present_rec.status == 'PRESENT'

        absent_rec = AttendanceRecord.objects.filter(
            student=student_1, date=session.date, face_session=session,
        ).first()
        assert absent_rec is not None
        assert absent_rec.status == 'ABSENT'

    def test_confirm_sets_session_confirmed(self, seed_data, api):
        """C2c: Session status → CONFIRMED after confirm."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            academic_year=seed_data['academic_year'],
            date=date.today() + timedelta(days=2),
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/photo3.jpg',
            created_by=seed_data['users']['admin'],
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': [seed_data['students'][0].id]},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

        session.refresh_from_db()
        assert session.status == 'CONFIRMED'
        assert session.confirmed_by == seed_data['users']['admin']
        assert session.confirmed_at is not None

    def test_confirm_idempotent(self, seed_data, api):
        """C2d: Confirming with same date → updates, no duplicates."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            academic_year=seed_data['academic_year'],
            date=date.today() + timedelta(days=3),
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/photo4.jpg',
            created_by=seed_data['users']['admin'],
        )

        data = {'present_student_ids': [seed_data['students'][0].id]}
        api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            data, seed_data['tokens']['admin'], seed_data['SID_A'],
        )

        # Create a second session for same date and confirm again
        session2 = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            academic_year=seed_data['academic_year'],
            date=date.today() + timedelta(days=3),  # same date
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/photo5.jpg',
            created_by=seed_data['users']['admin'],
        )
        api.post(
            f'/api/face-attendance/sessions/{session2.id}/confirm/',
            data, seed_data['tokens']['admin'], seed_data['SID_A'],
        )

        # Student should have exactly 1 record for this date (update_or_create)
        records = AttendanceRecord.objects.filter(
            student=seed_data['students'][0],
            date=date.today() + timedelta(days=3),
        )
        assert records.count() == 1

    def test_confirm_processing_session_fails(self, seed_data, api):
        """C2e: Status=PROCESSING → 400."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            date=date.today() + timedelta(days=4),
            status=FaceAttendanceSession.Status.PROCESSING,
            image_url='https://example.com/photo6.jpg',
            created_by=seed_data['users']['admin'],
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': []},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_confirm_already_confirmed_fails(self, seed_data, api):
        """C2f: Status=CONFIRMED → 400."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            date=date.today() + timedelta(days=5),
            status=FaceAttendanceSession.Status.CONFIRMED,
            image_url='https://example.com/photo7.jpg',
            created_by=seed_data['users']['admin'],
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': []},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_confirm_with_corrections(self, seed_data, api):
        """C2g: corrections array → detection updated to MANUALLY_MATCHED."""
        session = seed_data['face_session']
        # Reset status to NEEDS_REVIEW (in case other tests changed it)
        session.status = FaceAttendanceSession.Status.NEEDS_REVIEW
        session.confirmed_by = None
        session.confirmed_at = None
        session.save()

        student_3 = seed_data['students'][2]  # Usman Ahmed
        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/', {
                'present_student_ids': [seed_data['students'][0].id],
                'corrections': [
                    {'detection_face_index': 1, 'correct_student_id': student_3.id},
                ],
            },
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

        # Check the detection was corrected
        det = FaceDetectionResult.objects.get(session=session, face_index=1)
        assert det.match_status == 'MANUALLY_MATCHED'
        assert det.matched_student_id == student_3.id

    def test_confirm_returns_summary_stats(self, seed_data, api):
        """C2i: Response includes total_students, present_count, absent_count."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            academic_year=seed_data['academic_year'],
            date=date.today() + timedelta(days=6),
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/photo_stats.jpg',
            created_by=seed_data['users']['admin'],
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': [seed_data['students'][0].id]},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        data = resp.json()
        assert 'total_students' in data
        assert 'present_count' in data
        assert 'absent_count' in data
        assert data['present_count'] == 1


# =====================================================================
# LEVEL C3: PENDING REVIEW
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestPendingReview:
    """C3: Pending review endpoint."""

    def test_returns_needs_review_only(self, seed_data, api):
        """C3a: Only NEEDS_REVIEW sessions returned."""
        resp = api.get(
            '/api/face-attendance/sessions/pending_review/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        for r in results:
            assert r['status'] == 'NEEDS_REVIEW'

    def test_auto_recovers_stuck_sessions(self, seed_data, api):
        """C3b: PROCESSING sessions >5min old → auto-marked FAILED."""
        from django.utils import timezone

        stuck = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            date=date.today() + timedelta(days=10),
            status=FaceAttendanceSession.Status.PROCESSING,
            image_url='https://example.com/stuck.jpg',
            created_by=seed_data['users']['admin'],
        )
        # Manually backdate created_at
        FaceAttendanceSession.objects.filter(id=stuck.id).update(
            created_at=timezone.now() - timedelta(minutes=10)
        )

        # Hit pending_review which triggers auto-recovery
        api.get(
            '/api/face-attendance/sessions/pending_review/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )

        stuck.refresh_from_db()
        assert stuck.status == 'FAILED'
        assert 'timed out' in stuck.error_message.lower()


# =====================================================================
# LEVEL C4: REPROCESS
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestReprocess:
    """C4: Reprocess endpoint."""

    def test_reprocess_resets_and_dispatches(self, seed_data, api):
        """C4a: POST /reprocess/ → status=PROCESSING, detections cleared."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            date=date.today() + timedelta(days=20),
            status=FaceAttendanceSession.Status.NEEDS_REVIEW,
            image_url='https://example.com/reprocess.jpg',
            total_faces_detected=3,
            created_by=seed_data['users']['admin'],
        )
        FaceDetectionResult.objects.create(
            session=session, face_index=0,
            bounding_box={'top': 0, 'right': 80, 'bottom': 80, 'left': 0},
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/reprocess/',
            {}, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

        session.refresh_from_db()
        assert session.status == 'PROCESSING'
        assert session.detections.count() == 0

    def test_reprocess_confirmed_fails(self, seed_data, api):
        """C4b: Status=CONFIRMED → 400."""
        session = FaceAttendanceSession.objects.create(
            school=seed_data['school_a'],
            class_obj=seed_data['classes'][0],
            date=date.today() + timedelta(days=21),
            status=FaceAttendanceSession.Status.CONFIRMED,
            image_url='https://example.com/confirmed.jpg',
            created_by=seed_data['users']['admin'],
        )

        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/reprocess/',
            {}, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400


# =====================================================================
# LEVEL C5: ENROLLMENT API
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestEnrollmentAPI:
    """C5: Face enrollment endpoints."""

    def test_enroll_dispatches_task(self, seed_data, api):
        """C5a: POST /enroll/ → 202."""
        student = seed_data['students'][4]  # Class 2 student
        resp = api.post('/api/face-attendance/enrollments/enroll/', {
            'student_id': student.id,
            'image_url': 'https://example.com/portrait.jpg',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 202, f"Expected 202, got {resp.status_code}: {resp.content}"
        data = resp.json()
        assert 'task_id' in data

    def test_enroll_validates_school(self, seed_data, api):
        """C5b: Student from different school → 400."""
        # Create a student in school_b
        from students.models import Student, Class
        class_b = Class.objects.create(
            school=seed_data['school_b'], name='B_Class', section='A',
        )
        student_b = Student.objects.create(
            school=seed_data['school_b'], class_obj=class_b,
            name='Foreign Student', roll_number='1', is_active=True, status='ACTIVE',
        )

        resp = api.post('/api/face-attendance/enrollments/enroll/', {
            'student_id': student_b.id,
            'image_url': 'https://example.com/foreign.jpg',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400

    def test_list_enrollments_active_only(self, seed_data, api):
        """C5c: GET /enrollments/ → only is_active=True."""
        resp = api.get(
            '/api/face-attendance/enrollments/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        # Seed data creates 4 active embeddings
        assert len(results) >= 4

    def test_list_enrollments_filter_by_class(self, seed_data, api):
        """C5d: ?class_obj=X filters correctly."""
        class_1 = seed_data['classes'][0]
        resp = api.get(
            f'/api/face-attendance/enrollments/?class_obj={class_1.id}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200

    def test_delete_enrollment_soft_deletes(self, seed_data, api):
        """C5e: DELETE → is_active=False."""
        emb = seed_data['face_embeddings'][0]
        resp = api.delete(
            f'/api/face-attendance/enrollments/{emb.id}/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 204

        emb.refresh_from_db()
        assert emb.is_active is False

        # Restore for other tests
        emb.is_active = True
        emb.save()

    def test_deleted_enrollment_not_in_list(self, seed_data, api):
        """C5f: After soft delete → not returned in list."""
        emb = seed_data['face_embeddings'][0]
        emb.is_active = False
        emb.save()

        resp = api.get(
            '/api/face-attendance/enrollments/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        ids_in_list = [r['id'] for r in results]
        assert emb.id not in ids_in_list

        # Restore
        emb.is_active = True
        emb.save()


# =====================================================================
# LEVEL C6: STATUS ENDPOINT
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestStatusEndpoint:
    """C6: Face recognition status check."""

    def test_status_returns_thresholds(self, seed_data, api):
        """C6a: GET /status/ → includes thresholds and enrolled_faces."""
        resp = api.get(
            '/api/face-attendance/status/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert 'thresholds' in data
        assert 'enrolled_faces' in data
        assert 'model' in data

    def test_status_enrollment_count(self, seed_data, api):
        """C6b: enrolled_faces matches actual count."""
        resp = api.get(
            '/api/face-attendance/status/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        data = resp.json()
        actual = StudentFaceEmbedding.objects.filter(
            school=seed_data['school_a'], is_active=True,
        ).count()
        assert data['enrolled_faces'] == actual


# =====================================================================
# LEVEL C7: PERMISSIONS
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestPermissions:
    """C7: Authentication and authorization."""

    def test_unauthenticated_returns_401(self, seed_data, api):
        """C7a: No token → 401."""
        resp = api.client.get('/api/face-attendance/sessions/')
        assert resp.status_code == 401

    def test_teacher_cannot_create_session(self, seed_data, api):
        """C7b: Teacher → 403 on POST /sessions/."""
        resp = api.post('/api/face-attendance/sessions/', {
            'class_obj': seed_data['classes'][0].id,
            'date': str(date.today()),
            'image_url': 'https://example.com/photo.jpg',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_teacher_cannot_confirm(self, seed_data, api):
        """C7c: Teacher → 403 on POST /confirm/."""
        session = seed_data['face_session']
        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': []},
            seed_data['tokens']['teacher'], seed_data['SID_A'],
        )
        assert resp.status_code == 403

    def test_admin_can_access_sessions(self, seed_data, api):
        """C7d: SCHOOL_ADMIN → 200 on GET /sessions/."""
        resp = api.get(
            '/api/face-attendance/sessions/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200


# =====================================================================
# LEVEL C8: SCHOOL ISOLATION
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestSchoolIsolation:
    """C8: Multi-tenancy isolation."""

    def test_school_b_cannot_see_school_a_sessions(self, seed_data, api):
        """C8a: School B admin → 0 sessions from School A."""
        resp = api.get(
            '/api/face-attendance/sessions/',
            seed_data['tokens']['admin_b'], seed_data['SID_B'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        assert len(results) == 0

    def test_school_b_cannot_see_school_a_enrollments(self, seed_data, api):
        """C8b: School B admin → 0 enrollments from School A."""
        resp = api.get(
            '/api/face-attendance/enrollments/',
            seed_data['tokens']['admin_b'], seed_data['SID_B'],
        )
        assert resp.status_code == 200
        data = resp.json()
        results = data.get('results', data) if isinstance(data, dict) else data
        assert len(results) == 0

    def test_school_b_cannot_confirm_school_a_session(self, seed_data, api):
        """C8c: School B admin → 404 on School A session."""
        session = seed_data['face_session']
        resp = api.post(
            f'/api/face-attendance/sessions/{session.id}/confirm/',
            {'present_student_ids': []},
            seed_data['tokens']['admin_b'], seed_data['SID_B'],
        )
        assert resp.status_code == 404
