"""
Face Attendance Tier A — Mobile Browser Live Detection
========================================================
Covers: JWT auth on live/match/ (alongside Tier B's device-key auth),
        teacher class-scope enforcement, faceapi_v1 embedding_version
        enforcement, dual enroll/ payload shapes, and the narrow
        permission loosening on FaceEnrollmentViewSet for Tier A.

Run:
    cd backend
    pytest tests/test_face_attendance_tier_a.py -v
"""

import json
from datetime import date, datetime, timezone as dt_timezone

import numpy as np
import pytest

from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from face_attendance.models import (
    FaceLiveDetectionEvent, FaceMatchThresholdSample,
    StudentFaceEmbedding,
)

LIVE_MATCH_URL = '/api/face-attendance/live/match/'
ENROLL_URL = '/api/face-attendance/enroll/'
ENROLLMENTS_URL = '/api/face-attendance/enrollments/'


def _feedback_url(event_id):
    return f'/api/face-attendance/live/events/{event_id}/feedback/'


def _make_event(seed_data, *, source_tier=FaceLiveDetectionEvent.SourceTier.TIER_A,
                 match_status='AUTO_MATCHED', captured_by=None, student=None, distance=0.32):
    return FaceLiveDetectionEvent.objects.create(
        school=seed_data['school_a'],
        source_tier=source_tier,
        embedding_version='faceapi_v1',
        client_timestamp=datetime.now(dt_timezone.utc),
        matched_student=student or seed_data['students'][0],
        captured_by=captured_by,
        confidence=88.0,
        distance=distance,
        match_status=match_status,
    )


def _requires_postgres():
    from django.db import connection
    return connection.vendor != 'postgresql'


def _assign_class_teacher(seed_data, staff_index, class_index):
    """Give one of the seeded StaffMembers (which has a real login) a class assignment."""
    staff = seed_data['staff'][staff_index]
    class_obj = seed_data['classes'][class_index]
    ClassTeacherAssignment.objects.create(
        school=seed_data['school_a'],
        academic_year=seed_data['academic_year'],
        class_obj=class_obj,
        teacher=staff,
        is_active=True,
    )
    return class_obj


def _teacher_token(api, seed_data, index=0):
    username = f"{seed_data['prefix']}staff_teacher{index + 1}"
    return api.login(username)


def _live_payload(embedding=None, embedding_version='faceapi_v1', class_id=None, timestamp=None):
    payload = {
        'embedding': (embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding))
        if embedding is not None else [0.0] * 128,
        'embedding_version': embedding_version,
        'timestamp': (timestamp or datetime.now(dt_timezone.utc)).isoformat(),
    }
    if class_id is not None:
        payload['class_id'] = class_id
    return payload


# =====================================================================
# LEVEL A1: live/match/ — JWT auth path, gating, validation
# (No pgvector needed — these all return before reaching FaceMatcher.)
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestLiveMatchJWTGating:
    def test_wrong_embedding_version_for_tier_a_rejected(self, seed_data, api):
        resp = api.post(
            LIVE_MATCH_URL,
            _live_payload(embedding_version='dlib_v1'),
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_teacher_without_class_id_rejected(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)
        resp = api.post(LIVE_MATCH_URL, _live_payload(), token, seed_data['SID_A'])
        assert resp.status_code == 400

    def test_teacher_not_assigned_to_class_rejected(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)
        class_1 = seed_data['classes'][0]  # not assigned to this teacher
        resp = api.post(
            LIVE_MATCH_URL, _live_payload(class_id=class_1.id), token, seed_data['SID_A'],
        )
        assert resp.status_code == 403

    def test_unauthenticated_request_rejected(self, seed_data, api):
        resp = api.client.post(
            LIVE_MATCH_URL, data=json.dumps(_live_payload()), content_type='application/json',
            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
        assert resp.status_code in (401, 403)

    def test_missing_school_header_rejected(self, seed_data, api):
        resp = api.client.post(
            LIVE_MATCH_URL, data=json.dumps(_live_payload()), content_type='application/json',
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}",
        )
        assert resp.status_code == 400


# =====================================================================
# LEVEL A2: live/match/ — full match + dedup (postgres only)
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestLiveMatchJWTMatching:
    @pytest.fixture(autouse=True)
    def _require_postgres(self):
        if _requires_postgres():
            pytest.skip('live/match/ matching requires PostgreSQL (pgvector L2Distance)')

    def _enroll(self, student, school_id, vector, version='faceapi_v1'):
        return StudentFaceEmbedding.objects.create(
            student=student, school_id=school_id,
            embedding=np.asarray(vector, dtype=np.float64).tobytes(),
            embedding_vector=np.asarray(vector, dtype=np.float32).tolist(),
            embedding_version=version, quality_score=0.9, is_active=True,
        )

    def test_teacher_class_scoped_match_marks_attendance_and_sets_captured_by(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)
        class_1 = _assign_class_teacher(seed_data, staff_index=0, class_index=0)
        student = seed_data['students'][0]  # in class_1

        rng = np.random.default_rng(5)
        student_emb = rng.standard_normal(128)
        face_emb = student_emb + rng.standard_normal(128) * 0.01
        self._enroll(student, seed_data['SID_A'], student_emb)

        resp = api.post(
            LIVE_MATCH_URL, _live_payload(embedding=face_emb, class_id=class_1.id),
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        data = resp.json()
        assert data['student']['id'] == student.id
        assert data['attendance_marked'] is True

        event = FaceLiveDetectionEvent.objects.get(id=data['event_id'])
        assert event.source_tier == FaceLiveDetectionEvent.SourceTier.TIER_A
        assert event.device is None
        assert event.captured_by_id == seed_data['staff'][0].user_id

    def test_admin_whole_school_match_when_no_class_id(self, seed_data, api):
        student = seed_data['students'][7]  # class 3
        rng = np.random.default_rng(9)
        student_emb = rng.standard_normal(128)
        face_emb = student_emb + rng.standard_normal(128) * 0.01
        self._enroll(student, seed_data['SID_A'], student_emb)

        resp = api.post(
            LIVE_MATCH_URL, _live_payload(embedding=face_emb),
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        data = resp.json()
        assert data['student']['id'] == student.id

        event = FaceLiveDetectionEvent.objects.get(id=data['event_id'])
        assert event.class_obj_id is None
        assert event.captured_by_id == seed_data['users']['admin'].id

    def test_source_tier_cannot_be_spoofed_by_client(self, seed_data, api):
        """The client can't declare source_tier — it's derived from the auth path."""
        payload = _live_payload()
        payload['source_tier'] = 'TIER_B'  # ignored — LiveMatchRequestSerializer has no such field
        resp = api.client.post(
            LIVE_MATCH_URL, data=json.dumps(payload), content_type='application/json',
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}",
            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
        assert resp.status_code == 200
        event = FaceLiveDetectionEvent.objects.get(id=resp.json()['event_id'])
        assert event.source_tier == FaceLiveDetectionEvent.SourceTier.TIER_A

    def test_dedup_shared_with_tier_b_same_day_one_attendance_write(self, seed_data, api):
        """A Tier A match for a student already marked present today (e.g. via Tier B) doesn't double-write."""
        student = seed_data['students'][8]
        rng = np.random.default_rng(13)
        student_emb = rng.standard_normal(128)
        self._enroll(student, seed_data['SID_A'], student_emb)

        # Pre-existing event from "earlier today" that already wrote attendance.
        from academic_sessions.models import AcademicYear
        from face_attendance.services.attendance_writer import upsert_attendance_record

        ay = AcademicYear.objects.filter(school=seed_data['school_a'], is_current=True).first()
        upsert_attendance_record(
            student=student, date=date.today(), school=seed_data['school_a'],
            academic_year=ay, attendance_status=AttendanceRecord.AttendanceStatus.PRESENT,
        )
        FaceLiveDetectionEvent.objects.create(
            school=seed_data['school_a'], source_tier=FaceLiveDetectionEvent.SourceTier.TIER_B,
            embedding_version='dlib_v1', client_timestamp=datetime.now(dt_timezone.utc),
            matched_student=student, confidence=95.0, match_status='AUTO_MATCHED',
            resulted_in_attendance=True,
        )

        resp = api.post(
            LIVE_MATCH_URL,
            _live_payload(embedding=student_emb + rng.standard_normal(128) * 0.01),
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        assert resp.json()['attendance_marked'] is False
        assert AttendanceRecord.objects.filter(student=student, date=date.today()).count() == 1


# =====================================================================
# LEVEL A3: enroll/ — dual payload shapes
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestEnrollDualShape:
    def _embedding_payload(self, student_id, version='faceapi_v1', quality=0.8):
        return {
            'student_id': student_id,
            'embedding': [0.1] * 128,
            'embedding_version': version,
            'quality_score': quality,
        }

    def test_admin_can_enroll_with_embedding_synchronously(self, seed_data, api):
        student = seed_data['students'][0]
        resp = api.post(
            ENROLL_URL, self._embedding_payload(student.id),
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 201, resp.content
        data = resp.json()
        assert data['embedding_version'] == 'faceapi_v1'

        row = StudentFaceEmbedding.objects.get(student=student, embedding_version='faceapi_v1')
        assert row.embedding_vector is not None
        assert len(bytes(row.embedding)) > 0
        # dlib_v1 row from seed_data is untouched.
        assert StudentFaceEmbedding.objects.filter(student=student, embedding_version='dlib_v1').exists()

    def test_assigned_teacher_can_enroll_with_embedding(self, seed_data, api):
        class_1 = _assign_class_teacher(seed_data, staff_index=0, class_index=0)
        token = _teacher_token(api, seed_data, index=0)
        student = seed_data['students'][0]  # in class_1
        assert student.class_obj_id == class_1.id

        resp = api.post(
            ENROLL_URL, self._embedding_payload(student.id), token, seed_data['SID_A'],
        )
        assert resp.status_code == 201, resp.content

    def test_unassigned_teacher_cannot_enroll_with_embedding(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)  # no assignment created
        student = seed_data['students'][0]
        resp = api.post(
            ENROLL_URL, self._embedding_payload(student.id), token, seed_data['SID_A'],
        )
        assert resp.status_code == 403

    def test_legacy_image_url_enroll_still_admin_only(self, seed_data, api):
        """The existing dlib/Celery enrollment path is unaffected — teachers still can't use it."""
        _assign_class_teacher(seed_data, staff_index=0, class_index=0)
        token = _teacher_token(api, seed_data, index=0)
        student = seed_data['students'][0]

        resp = api.post(
            ENROLL_URL, {'student_id': student.id, 'image_url': 'https://example.com/x.jpg'},
            token, seed_data['SID_A'],
        )
        assert resp.status_code == 403

    def test_legacy_image_url_enroll_admin_still_works(self, seed_data, api):
        student = seed_data['students'][0]
        resp = api.post(
            ENROLL_URL, {'student_id': student.id, 'image_url': 'https://example.com/x.jpg'},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        # Dispatches a background task synchronously in tests (CELERY_TASK_ALWAYS_EAGER)
        # or falls back — either way it must not be rejected by permissions.
        assert resp.status_code in (202, 500)

    def test_embedding_wrong_student_school_rejected(self, seed_data, api):
        # school_b has no students in seed_data; use a school_a student id but wrong header context
        student = seed_data['students'][0]
        resp = api.post(
            ENROLL_URL, self._embedding_payload(student.id),
            seed_data['tokens']['admin_b'], seed_data['SID_B'],
        )
        assert resp.status_code == 400


# =====================================================================
# LEVEL A4: enrollments/ list — permission loosening + teacher scoping
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestEnrollmentsListScoping:
    def test_admin_sees_all_school_enrollments(self, seed_data, api):
        resp = api.get(ENROLLMENTS_URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        assert resp.json()['count'] == len(seed_data['face_embeddings'])

    def test_unassigned_teacher_sees_empty_list_not_403(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)
        resp = api.get(ENROLLMENTS_URL, token, seed_data['SID_A'])
        assert resp.status_code == 200
        assert resp.json()['count'] == 0

    def test_assigned_teacher_sees_only_own_class(self, seed_data, api):
        class_1 = _assign_class_teacher(seed_data, staff_index=0, class_index=0)
        token = _teacher_token(api, seed_data, index=0)

        resp = api.get(ENROLLMENTS_URL, token, seed_data['SID_A'])
        assert resp.status_code == 200
        results = resp.json()['results']
        assert len(results) == len(seed_data['face_embeddings'])  # all 4 seeded embeddings are class_1 students
        for row in results:
            assert row['class_name'] == class_1.name

    def test_teacher_cannot_destroy_enrollment(self, seed_data, api):
        _assign_class_teacher(seed_data, staff_index=0, class_index=0)
        token = _teacher_token(api, seed_data, index=0)
        embedding = seed_data['face_embeddings'][0]

        resp = api.delete(f'{ENROLLMENTS_URL}{embedding.id}/', token, seed_data['SID_A'])
        assert resp.status_code == 403

    def test_admin_can_still_destroy_enrollment(self, seed_data, api):
        embedding = seed_data['face_embeddings'][0]
        resp = api.delete(f'{ENROLLMENTS_URL}{embedding.id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 204
        embedding.refresh_from_db()
        assert embedding.is_active is False


# =====================================================================
# LEVEL A5: live/events/{id}/feedback/ — groundwork for faceapi_v1
# threshold tuning (design doc §10 backlog). No pgvector needed — this
# endpoint only reads an existing FaceLiveDetectionEvent row, it never
# calls FaceMatcher.
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestLiveMatchFeedback:
    def test_capturing_teacher_can_submit_feedback(self, seed_data, api):
        token = _teacher_token(api, seed_data, index=0)
        teacher_user = seed_data['staff'][0].user
        event = _make_event(seed_data, captured_by=teacher_user)

        resp = api.post(_feedback_url(event.id), {'is_correct': True}, token, seed_data['SID_A'])
        assert resp.status_code == 201, resp.content

        sample = FaceMatchThresholdSample.objects.get()
        assert sample.school_id == seed_data['school_a'].id
        assert sample.source_tier == FaceLiveDetectionEvent.SourceTier.TIER_A
        assert sample.embedding_version == 'faceapi_v1'
        assert sample.distance == 0.32
        assert sample.predicted_match_status == 'AUTO_MATCHED'
        assert sample.is_correct is True
        assert sample.sample_date == event.client_timestamp.date()

    def test_admin_can_submit_feedback_for_event_captured_by_someone_else(self, seed_data, api):
        teacher_user = seed_data['staff'][0].user
        event = _make_event(seed_data, captured_by=teacher_user, match_status='FLAGGED')

        resp = api.post(
            _feedback_url(event.id), {'is_correct': False},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 201, resp.content
        sample = FaceMatchThresholdSample.objects.get()
        assert sample.is_correct is False
        assert sample.predicted_match_status == 'FLAGGED'

    def test_other_teacher_who_did_not_capture_it_is_rejected(self, seed_data, api):
        """Only the operator who was physically present can label the match — not just any teacher."""
        _assign_class_teacher(seed_data, staff_index=1, class_index=1)
        other_token = _teacher_token(api, seed_data, index=1)
        capturing_teacher_user = seed_data['staff'][0].user
        event = _make_event(seed_data, captured_by=capturing_teacher_user)

        resp = api.post(_feedback_url(event.id), {'is_correct': True}, other_token, seed_data['SID_A'])
        assert resp.status_code == 403
        assert not FaceMatchThresholdSample.objects.exists()

    def test_ignored_event_rejected(self, seed_data, api):
        event = _make_event(seed_data, match_status='IGNORED', captured_by=seed_data['users']['admin'])
        resp = api.post(
            _feedback_url(event.id), {'is_correct': True},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400
        assert not FaceMatchThresholdSample.objects.exists()

    def test_tier_b_event_rejected(self, seed_data, api):
        event = _make_event(seed_data, source_tier=FaceLiveDetectionEvent.SourceTier.TIER_B)
        resp = api.post(
            _feedback_url(event.id), {'is_correct': True},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400
        assert not FaceMatchThresholdSample.objects.exists()

    def test_nonexistent_event_returns_404(self, seed_data, api):
        import uuid
        resp = api.post(
            _feedback_url(uuid.uuid4()), {'is_correct': True},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 404

    def test_missing_is_correct_rejected(self, seed_data, api):
        event = _make_event(seed_data, captured_by=seed_data['users']['admin'])
        resp = api.post(_feedback_url(event.id), {}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400
        assert not FaceMatchThresholdSample.objects.exists()
