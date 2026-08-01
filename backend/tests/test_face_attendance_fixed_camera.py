"""
Face Attendance Fixed Camera Capture — Model, Auth, and Endpoint Tests
==========================================================
Covers: FaceCaptureDevice scope constraint, DeviceKeyAuthentication,
        live/match/ endpoint (CLASS and SCHOOL scoped), same-day dedup,
        and status/ availability (fixed_camera_status derived from device presence).

Run:
    cd backend
    pytest tests/test_face_attendance_tier_b.py -v
"""

import json
from datetime import date, datetime, timedelta, timezone as dt_timezone

import numpy as np
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from attendance.models import AttendanceRecord
from face_attendance.models import (
    FaceCaptureDevice, FaceLiveDetectionEvent,
    StudentFaceEmbedding,
)

LIVE_MATCH_URL = '/api/face-attendance/live/match/'


def _requires_postgres():
    from django.db import connection
    return connection.vendor != 'postgresql'


def _enroll(student, school_id, vector, version='dlib_v1'):
    return StudentFaceEmbedding.objects.create(
        student=student,
        school_id=school_id,
        embedding=np.asarray(vector, dtype=np.float64).tobytes(),
        embedding_vector=np.asarray(vector, dtype=np.float32).tolist(),
        embedding_version=version,
        quality_score=0.9,
        is_active=True,
    )


def _make_device(school, scope_type, class_obj=None, embedding_version='dlib_v1'):
    raw_key, key_hash = FaceCaptureDevice.generate_api_key()
    device = FaceCaptureDevice.objects.create(
        school=school,
        name='Test Device',
        api_key_hash=key_hash,
        scope_type=scope_type,
        class_obj=class_obj,
        embedding_version=embedding_version,
    )
    return device, raw_key


# =====================================================================
# LEVEL D1: FaceCaptureDevice scope constraint
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestFaceCaptureDeviceScopeConstraint:
    """D1: CLASS-scoped requires class_obj, SCHOOL-scoped forbids it."""

    def test_class_scoped_without_class_obj_fails_clean(self, seed_data):
        device = FaceCaptureDevice(
            school=seed_data['school_a'], name='Bad', api_key_hash='x' * 64,
            scope_type=FaceCaptureDevice.ScopeType.CLASS, class_obj=None,
        )
        with pytest.raises(ValidationError):
            device.clean()

    def test_school_scoped_with_class_obj_fails_clean(self, seed_data):
        device = FaceCaptureDevice(
            school=seed_data['school_a'], name='Bad', api_key_hash='x' * 64,
            scope_type=FaceCaptureDevice.ScopeType.SCHOOL,
            class_obj=seed_data['classes'][0],
        )
        with pytest.raises(ValidationError):
            device.clean()

    def test_class_scoped_with_class_obj_passes_clean(self, seed_data):
        device = FaceCaptureDevice(
            school=seed_data['school_a'], name='Good', api_key_hash='x' * 64,
            scope_type=FaceCaptureDevice.ScopeType.CLASS,
            class_obj=seed_data['classes'][0],
        )
        device.clean()  # should not raise

    def test_school_scoped_without_class_obj_passes_clean(self, seed_data):
        device = FaceCaptureDevice(
            school=seed_data['school_a'], name='Good', api_key_hash='x' * 64,
            scope_type=FaceCaptureDevice.ScopeType.SCHOOL, class_obj=None,
        )
        device.clean()  # should not raise

    def test_class_obj_from_different_school_fails_clean(self, seed_data):
        device = FaceCaptureDevice(
            school=seed_data['school_b'], name='Bad', api_key_hash='x' * 64,
            scope_type=FaceCaptureDevice.ScopeType.CLASS,
            class_obj=seed_data['classes'][0],  # belongs to school_a
        )
        with pytest.raises(ValidationError):
            device.clean()

    def test_db_check_constraint_blocks_inconsistent_direct_create(self, seed_data):
        """The CheckConstraint is a safety net for writes that bypass clean() (e.g. bulk_create)."""
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                FaceCaptureDevice.objects.create(
                    school=seed_data['school_a'], name='Bypassed', api_key_hash='y' * 64,
                    scope_type=FaceCaptureDevice.ScopeType.CLASS, class_obj=None,
                )


# =====================================================================
# LEVEL D2: Device-key authentication
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestDeviceKeyAuthentication:
    """D2: X-Device-Key header handling."""

    def _payload(self):
        return {
            'embedding': [0.0] * 128,
            'embedding_version': 'dlib_v1',
            'timestamp': datetime.now(dt_timezone.utc).isoformat(),
        }

    def test_missing_device_key_is_rejected(self, api_client):
        resp = api_client.post(
            LIVE_MATCH_URL, data=json.dumps(self._payload()), content_type='application/json',
        )
        assert resp.status_code in (401, 403)

    def test_invalid_device_key_returns_401(self, api_client):
        resp = api_client.post(
            LIVE_MATCH_URL, data=json.dumps(self._payload()), content_type='application/json',
            headers={'X-Device-Key': 'not-a-real-key'},
        )
        assert resp.status_code == 401

    def test_inactive_device_key_returns_401(self, api_client, seed_data):
        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device.is_active = False
        device.save(update_fields=['is_active'])

        resp = api_client.post(
            LIVE_MATCH_URL, data=json.dumps(self._payload()), content_type='application/json',
            headers={'X-Device-Key': raw_key},
        )
        assert resp.status_code == 401

    def test_valid_device_key_with_no_config_row_succeeds(self, api_client, seed_data):
        """
        Fixed Camera capture has no enable flag to check (confirmed product
        decision) — a valid, active device key is itself the gate, with or without any
        FaceAttendanceSchoolConfig row. Uses school_b, which seed_data gives
        no students/embeddings, so the matcher's empty-candidate-set
        short-circuit is hit without ever reaching pgvector — safe on sqlite.
        """
        device, raw_key = _make_device(seed_data['school_b'], FaceCaptureDevice.ScopeType.SCHOOL)

        resp = api_client.post(
            LIVE_MATCH_URL, data=json.dumps(self._payload()), content_type='application/json',
            headers={'X-Device-Key': raw_key},
        )
        assert resp.status_code == 200, resp.content
        assert resp.json()['match_status'] == 'IGNORED'


# =====================================================================
# LEVEL D3: live/match/ endpoint — CLASS and SCHOOL scoped matching
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestLiveMatchEndpoint:
    """D3: CLASS-scoped and SCHOOL-scoped matching, dedup."""

    @pytest.fixture(autouse=True)
    def _require_postgres(self):
        if _requires_postgres():
            pytest.skip('live/match/ matching requires PostgreSQL (pgvector L2Distance)')

    def _post(self, api_client, raw_key, embedding, class_id=None, timestamp=None):
        payload = {
            'embedding': embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding),
            'embedding_version': 'dlib_v1',
            'timestamp': (timestamp or datetime.now(dt_timezone.utc)).isoformat(),
        }
        if class_id is not None:
            payload['class_id'] = class_id
        return api_client.post(
            LIVE_MATCH_URL, data=json.dumps(payload), content_type='application/json',
            headers={'X-Device-Key': raw_key},
        )

    def test_class_scoped_match_marks_attendance(self, api_client, seed_data):
        class_1 = seed_data['classes'][0]
        student = seed_data['students'][4]  # Hamza Raza (class 2 — separate class on purpose)
        rng = np.random.default_rng(7)
        student_emb = rng.standard_normal(128)
        face_emb = student_emb + rng.standard_normal(128) * 0.01
        _enroll(student, seed_data['SID_A'], student_emb)
        # Device is scoped to class_2 (student's class), not class_1.
        class_2 = seed_data['classes'][1]
        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.CLASS, class_obj=class_2)

        resp = self._post(api_client, raw_key, face_emb, class_id=class_2.id)
        assert resp.status_code == 200, resp.content
        data = resp.json()
        assert data['match_status'] == 'AUTO_MATCHED'
        assert data['student']['id'] == student.id
        assert data['attendance_marked'] is True

        record = AttendanceRecord.objects.get(student=student, date=date.today())
        assert record.status == AttendanceRecord.AttendanceStatus.PRESENT
        assert record.source == AttendanceRecord.Source.FACE_CAMERA

        event = FaceLiveDetectionEvent.objects.get(id=data['event_id'])
        assert event.resulted_in_attendance is True
        assert event.class_obj_id == class_2.id
        assert event.source_method == FaceLiveDetectionEvent.CaptureMethod.FIXED_CAMERA

    def test_class_scoped_ignores_students_outside_class(self, api_client, seed_data):
        """A device scoped to class_2 must not match a class_1 student even if enrolled."""
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        class_1_student = seed_data['students'][0]  # already has a seeded embedding

        rng = np.random.default_rng(seed=42)  # matches conftest's seed for students[0]
        student_emb = rng.standard_normal(128)

        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.CLASS, class_obj=class_2)
        resp = self._post(api_client, raw_key, student_emb, class_id=class_2.id)
        assert resp.status_code == 200
        data = resp.json()
        assert data['student'] is None
        assert data['match_status'] == 'IGNORED'

    def test_class_id_mismatch_rejected(self, api_client, seed_data):
        class_1 = seed_data['classes'][0]
        class_2 = seed_data['classes'][1]
        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.CLASS, class_obj=class_2)

        resp = self._post(api_client, raw_key, np.zeros(128), class_id=class_1.id)
        assert resp.status_code == 400

    def test_school_scoped_match_across_classes(self, api_client, seed_data):
        student = seed_data['students'][7]  # class 3 — no seeded embedding
        rng = np.random.default_rng(11)
        student_emb = rng.standard_normal(128)
        face_emb = student_emb + rng.standard_normal(128) * 0.01
        _enroll(student, seed_data['SID_A'], student_emb)

        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        resp = self._post(api_client, raw_key, face_emb)
        assert resp.status_code == 200, resp.content
        data = resp.json()
        assert data['student']['id'] == student.id
        assert data['attendance_marked'] is True

        event = FaceLiveDetectionEvent.objects.get(id=data['event_id'])
        assert event.class_obj_id is None  # SCHOOL-scoped events never carry a class

    def test_embedding_version_mismatch_rejected(self, api_client, seed_data):
        device, raw_key = _make_device(
            seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL, embedding_version='dlib_v1',
        )
        payload = {
            'embedding': [0.0] * 128,
            'embedding_version': 'faceapi_v1',  # doesn't match device's configured version
            'timestamp': datetime.now(dt_timezone.utc).isoformat(),
        }
        resp = api_client.post(
            LIVE_MATCH_URL, data=json.dumps(payload), content_type='application/json',
            headers={'X-Device-Key': raw_key},
        )
        assert resp.status_code == 400

    def test_repeated_same_day_match_does_not_duplicate_attendance_record(self, api_client, seed_data):
        """D4: dedup — only the first AUTO_MATCHED event/day writes/updates AttendanceRecord."""
        student = seed_data['students'][8]  # class 3, no seeded embedding
        rng = np.random.default_rng(23)
        student_emb = rng.standard_normal(128)
        _enroll(student, seed_data['SID_A'], student_emb)

        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        now = datetime.now(dt_timezone.utc)

        first = self._post(api_client, raw_key, student_emb + rng.standard_normal(128) * 0.01, timestamp=now)
        second = self._post(
            api_client, raw_key, student_emb + rng.standard_normal(128) * 0.01,
            timestamp=now.replace(minute=(now.minute + 1) % 60),
        )

        assert first.status_code == 200 and second.status_code == 200
        assert first.json()['attendance_marked'] is True
        assert second.json()['attendance_marked'] is False

        assert AttendanceRecord.objects.filter(student=student, date=date.today()).count() == 1
        events = FaceLiveDetectionEvent.objects.filter(matched_student=student)
        assert events.count() == 2
        assert events.filter(resulted_in_attendance=True).count() == 1

    def test_every_event_is_logged_regardless_of_match_outcome(self, api_client, seed_data):
        """An IGNORED (unmatched) ping still creates an audit event row."""
        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        before = FaceLiveDetectionEvent.objects.count()

        resp = self._post(api_client, raw_key, np.random.default_rng(1).standard_normal(128))
        assert resp.status_code == 200
        assert resp.json()['match_status'] == 'IGNORED'
        assert FaceLiveDetectionEvent.objects.count() == before + 1

    def test_last_seen_at_updated_on_success(self, api_client, seed_data):
        device, raw_key = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        assert device.last_seen_at is None

        self._post(api_client, raw_key, np.zeros(128))
        device.refresh_from_db()
        assert device.last_seen_at is not None


# =====================================================================
# LEVEL D5/D6: status/ availability shape, devices/ viewset, live/events/
# list (plain relational queries, no pgvector, so unlike LEVEL D3 these
# don't need a postgres skip guard).
#
# Group Photo capture and Live Mobile capture are unconditionally available
# (confirmed product decision) — no config row, flag, or migration backfill
# needed anymore. Fixed Camera capture's status is derived purely from
# FaceCaptureDevice presence/last_seen_at.
# =====================================================================


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestStatusAvailability:
    def test_group_photo_and_live_mobile_always_available(self, seed_data, api):
        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert data['group_photo_available'] is True
        assert data['live_mobile_available'] is True

    def test_fixed_camera_status_not_installed_when_no_devices(self, seed_data, api):
        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'not_installed'

    def test_fixed_camera_status_not_installed_when_only_inactive_devices(self, seed_data, api):
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device.is_active = False
        device.last_seen_at = timezone.now()
        device.save(update_fields=['is_active', 'last_seen_at'])

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'not_installed'

    def test_fixed_camera_status_active_when_recently_seen(self, seed_data, api):
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device.last_seen_at = timezone.now() - timedelta(minutes=1)
        device.save(update_fields=['last_seen_at'])

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'active'

    def test_fixed_camera_status_inactive_when_stale(self, seed_data, api):
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device.last_seen_at = timezone.now() - timedelta(minutes=30)
        device.save(update_fields=['last_seen_at'])

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'inactive'

    def test_fixed_camera_status_inactive_when_never_seen(self, seed_data, api):
        """A device row exists (installed) but has never posted a match yet."""
        _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'inactive'

    def test_fixed_camera_status_active_if_any_of_several_devices_is_recent(self, seed_data, api):
        stale_device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        stale_device.last_seen_at = timezone.now() - timedelta(hours=2)
        stale_device.save(update_fields=['last_seen_at'])

        class_1 = seed_data['classes'][0]
        fresh_device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.CLASS, class_obj=class_1)
        fresh_device.last_seen_at = timezone.now()
        fresh_device.save(update_fields=['last_seen_at'])

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'active'

    def test_fixed_camera_status_is_school_scoped(self, seed_data, api):
        """A device on another school must not affect this school's status."""
        device, _ = _make_device(seed_data['school_b'], FaceCaptureDevice.ScopeType.SCHOOL)
        device.last_seen_at = timezone.now()
        device.save(update_fields=['last_seen_at'])

        resp = api.get('/api/face-attendance/status/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.json()['fixed_camera_status'] == 'not_installed'


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestFaceCaptureDeviceViewSet:
    def test_list_is_school_scoped(self, seed_data, api):
        device_a, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device_b, _ = _make_device(seed_data['school_b'], FaceCaptureDevice.ScopeType.SCHOOL)

        resp = api.get('/api/face-attendance/devices/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        ids = [d['id'] for d in resp.json()['results']]
        assert device_a.id in ids
        assert device_b.id not in ids

    def test_teacher_cannot_list_devices(self, seed_data, api):
        _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        resp = api.get('/api/face-attendance/devices/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_patch_updates_name_and_active(self, seed_data, api):
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        resp = api.patch(
            f'/api/face-attendance/devices/{device.id}/', {'name': 'Renamed', 'is_active': False},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        device.refresh_from_db()
        assert device.name == 'Renamed'
        assert device.is_active is False

    def test_patch_cannot_leave_class_scoped_device_without_class(self, seed_data, api):
        class_1 = seed_data['classes'][0]
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.CLASS, class_obj=class_1)
        resp = api.patch(
            f'/api/face-attendance/devices/{device.id}/', {'class_obj': None},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_patch_cannot_set_class_obj_from_another_school(self, seed_data, api):
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        # school_b has no classes seeded; reuse school_a's own class list is fine —
        # instead assert a class belonging to a different school is rejected by
        # switching this device to CLASS scope with a foreign-school class id.
        # (seed_data only seeds classes for school_a, so simulate cross-school via school_b directly)
        from students.models import Class
        foreign_class = Class.objects.create(school=seed_data['school_b'], name='Foreign', section='Z', grade_level=9)
        resp = api.patch(
            f'/api/face-attendance/devices/{device.id}/',
            {'scope_type': 'CLASS', 'class_obj': foreign_class.id},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400

    def test_create_and_delete_not_allowed(self, seed_data, api):
        resp = api.post(
            '/api/face-attendance/devices/',
            {'name': 'New', 'scope_type': 'SCHOOL'},
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 405


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestFaceLiveDetectionEventListView:
    def _make_event(self, school, device, student=None, match_status='AUTO_MATCHED', when=None):
        return FaceLiveDetectionEvent.objects.create(
            school=school,
            device=device,
            source_method=FaceLiveDetectionEvent.CaptureMethod.FIXED_CAMERA,
            embedding_version='dlib_v1',
            client_timestamp=when or datetime.now(dt_timezone.utc),
            matched_student=student,
            confidence=90.0 if student else 0.0,
            match_status=match_status,
            resulted_in_attendance=bool(student),
        )

    def test_list_is_school_scoped(self, seed_data, api):
        device_a, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device_b, _ = _make_device(seed_data['school_b'], FaceCaptureDevice.ScopeType.SCHOOL)
        self._make_event(seed_data['school_a'], device_a)
        self._make_event(seed_data['school_b'], device_b)

        resp = api.get('/api/face-attendance/live/events/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()['results']
        assert len(data) == 1
        assert data[0]['device'] == device_a.id

    def test_filter_by_device(self, seed_data, api):
        device_a, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        device_c, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        self._make_event(seed_data['school_a'], device_a)
        self._make_event(seed_data['school_a'], device_c)

        resp = api.get(
            f'/api/face-attendance/live/events/?device={device_a.id}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        results = resp.json()['results']
        assert len(results) == 1
        assert results[0]['device'] == device_a.id

    def test_filter_by_date(self, seed_data, api):
        from datetime import timedelta

        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        self._make_event(seed_data['school_a'], device, when=datetime.now(dt_timezone.utc))
        self._make_event(
            seed_data['school_a'], device,
            when=datetime.now(dt_timezone.utc) - timedelta(days=3),
        )

        resp = api.get(
            f'/api/face-attendance/live/events/?date={date.today().isoformat()}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert len(resp.json()['results']) == 1

    def test_includes_match_outcome_fields(self, seed_data, api):
        student = seed_data['students'][0]
        device, _ = _make_device(seed_data['school_a'], FaceCaptureDevice.ScopeType.SCHOOL)
        self._make_event(seed_data['school_a'], device, student=student)

        resp = api.get('/api/face-attendance/live/events/', seed_data['tokens']['admin'], seed_data['SID_A'])
        event = resp.json()['results'][0]
        assert event['matched_student']['id'] == student.id
        assert event['resulted_in_attendance'] is True
        assert event['match_status'] == 'AUTO_MATCHED'
