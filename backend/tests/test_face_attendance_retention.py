"""
Face Attendance Phase 3.5 — Retention Policy
==============================================
Covers: FaceLiveDetectionEvent purge (design doc §8/§9.3) and the
        previously-unscheduled cleanup_old_face_sessions task.

Run:
    cd backend
    pytest tests/test_face_attendance_retention.py -v
"""

from datetime import date, timedelta

import pytest
from django.conf import settings
from django.utils import timezone as django_timezone

from attendance.models import AttendanceRecord
from face_attendance.models import FaceLiveDetectionEvent
from face_attendance.services.attendance_writer import upsert_attendance_record
from face_attendance.tasks import cleanup_old_live_detection_events

RETENTION_HOURS = settings.FACE_RECOGNITION_SETTINGS['LIVE_EVENT_RETENTION_HOURS']


def timezone_now():
    return django_timezone.now()


def _make_event(school, when, resulted_in_attendance=False, matched_student=None,
                 attendance_record=None, source_tier=FaceLiveDetectionEvent.SourceTier.TIER_B):
    return FaceLiveDetectionEvent.objects.create(
        school=school,
        source_tier=source_tier,
        embedding_version='dlib_v1',
        client_timestamp=when,
        matched_student=matched_student,
        confidence=90.0 if matched_student else 0.0,
        match_status=FaceLiveDetectionEvent.MatchStatus.AUTO_MATCHED if matched_student else FaceLiveDetectionEvent.MatchStatus.IGNORED,
        resulted_in_attendance=resulted_in_attendance,
        attendance_record=attendance_record,
    )


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestLiveDetectionEventPurge:
    def test_events_older_than_retention_window_are_purged(self, seed_data):
        old = _make_event(
            seed_data['school_a'],
            when=timezone_now() - timedelta(hours=RETENTION_HOURS + 1),
        )
        result = cleanup_old_live_detection_events()
        assert result['deleted'] == 1
        assert not FaceLiveDetectionEvent.objects.filter(pk=old.pk).exists()

    def test_events_within_retention_window_survive(self, seed_data):
        recent = _make_event(
            seed_data['school_a'],
            when=timezone_now() - timedelta(hours=RETENTION_HOURS - 1),
        )
        result = cleanup_old_live_detection_events()
        assert result['deleted'] == 0
        assert FaceLiveDetectionEvent.objects.filter(pk=recent.pk).exists()

    def test_resulted_in_attendance_events_purged_same_as_others_once_past_window(self, seed_data):
        """The purge is unconditional past the window — resulted_in_attendance doesn't matter —
        but AttendanceRecord (a separate, permanent table) must be untouched."""
        student = seed_data['students'][0]
        ay = seed_data['academic_year']
        record, _ = upsert_attendance_record(
            student=student, date=date.today(), school=seed_data['school_a'],
            academic_year=ay, attendance_status=AttendanceRecord.AttendanceStatus.PRESENT,
        )

        old_marked = _make_event(
            seed_data['school_a'],
            when=timezone_now() - timedelta(hours=RETENTION_HOURS + 1),
            resulted_in_attendance=True, matched_student=student, attendance_record=record,
        )
        old_unmarked = _make_event(
            seed_data['school_a'],
            when=timezone_now() - timedelta(hours=RETENTION_HOURS + 2),
            resulted_in_attendance=False,
        )

        result = cleanup_old_live_detection_events()
        assert result['deleted'] == 2
        assert not FaceLiveDetectionEvent.objects.filter(pk=old_marked.pk).exists()
        assert not FaceLiveDetectionEvent.objects.filter(pk=old_unmarked.pk).exists()

        # The attendance outcome itself is untouched — separate table, already permanent.
        record.refresh_from_db()
        assert record.status == AttendanceRecord.AttendanceStatus.PRESENT
        assert AttendanceRecord.objects.filter(student=student, date=date.today()).exists()

    def test_applies_uniformly_to_tier_a_and_tier_b_events(self, seed_data):
        old_a = _make_event(
            seed_data['school_a'], when=timezone_now() - timedelta(hours=RETENTION_HOURS + 1),
            source_tier=FaceLiveDetectionEvent.SourceTier.TIER_A,
        )
        old_b = _make_event(
            seed_data['school_a'], when=timezone_now() - timedelta(hours=RETENTION_HOURS + 1),
            source_tier=FaceLiveDetectionEvent.SourceTier.TIER_B,
        )
        result = cleanup_old_live_detection_events()
        assert result['deleted'] == 2
        assert not FaceLiveDetectionEvent.objects.filter(pk__in=[old_a.pk, old_b.pk]).exists()

    def test_custom_hours_kwarg_overrides_the_settings_default(self, seed_data):
        event = _make_event(seed_data['school_a'], when=timezone_now() - timedelta(hours=2))
        # Default retention (48h) would keep this; an explicit shorter window purges it.
        result = cleanup_old_live_detection_events(hours=1)
        assert result['deleted'] == 1
        assert not FaceLiveDetectionEvent.objects.filter(pk=event.pk).exists()


@pytest.mark.django_db
class TestCleanupTasksScheduled:
    def test_cleanup_old_face_sessions_is_scheduled(self):
        entry = settings.CELERY_BEAT_SCHEDULE.get('cleanup-old-face-sessions')
        assert entry is not None
        assert entry.get('task') == 'face_attendance.tasks.cleanup_old_face_sessions'

    def test_cleanup_old_live_detection_events_is_scheduled(self):
        entry = settings.CELERY_BEAT_SCHEDULE.get('cleanup-old-live-detection-events')
        assert entry is not None
        assert entry.get('task') == 'face_attendance.tasks.cleanup_old_live_detection_events'
