"""
Celery tasks for face attendance processing.
Stub file - full implementation in Step 3.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def process_face_session(self, session_id):
    """Main face processing pipeline — detect, embed, match, score."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed
    from .services.pipeline import FaceAttendancePipeline

    task_id = self.request.id
    try:
        pipeline = FaceAttendancePipeline(session_id, task_id)
        result = pipeline.run()
        mark_task_success(task_id, result)
        return result
    except Exception as e:
        logger.exception(f'Face session processing failed: {session_id}')
        mark_task_failed(task_id, str(e)[:500])
        raise


@shared_task(bind=True, max_retries=2, default_retry_delay=15)
def enroll_student_face(self, student_id, image_url, actor_user_id=None, override_duplicate=False):
    """
    Generate and store face embedding for a student.

    A DuplicateFaceError from the pipeline's duplicate-enrollment check
    (see services/matcher.find_duplicate_enrollment) is deliberately not
    special-cased here — it's just another exception, and str(err) is
    already a complete user-facing message (see DuplicateFaceError), so
    the existing mark_task_failed(str(e)) path surfaces it via the normal
    failed-task toast without needing a new structured-error channel.
    """
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed
    from .services.pipeline import FaceEnrollmentPipeline

    task_id = self.request.id
    try:
        pipeline = FaceEnrollmentPipeline(
            student_id, image_url, task_id,
            actor_user_id=actor_user_id, override_duplicate=override_duplicate,
        )
        result = pipeline.run()
        mark_task_success(task_id, result)
        return result
    except Exception as e:
        logger.exception(f'Face enrollment failed: student {student_id}')
        mark_task_failed(task_id, str(e)[:500])
        raise


@shared_task
def cleanup_old_face_sessions(days=90):
    """Delete old failed sessions and orphaned face crops."""
    from django.utils import timezone
    from .models import FaceAttendanceSession

    cutoff = timezone.now() - timezone.timedelta(days=days)
    deleted_count, _ = FaceAttendanceSession.objects.filter(
        status=FaceAttendanceSession.Status.FAILED,
        created_at__lt=cutoff,
    ).delete()

    logger.info(f'Cleaned up {deleted_count} old failed face sessions')
    return {'deleted': deleted_count}


@shared_task
def cleanup_old_live_detection_events(hours=None):
    """
    Purge FaceLiveDetectionEvent rows past their retention window (design
    doc §8/§9.3). A live-detection event's only job is same-day dedup and
    same-day admin troubleshooting (Phase 2.5's live-events log) — once the
    window passes it's deleted unconditionally, Live Mobile and Fixed Camera alike,
    regardless of resulted_in_attendance. The attendance outcome itself is
    untouched: AttendanceRecord is a separate table that already persisted
    the result, so it has no dependency on this row surviving.
    """
    from django.conf import settings
    from django.utils import timezone
    from .models import FaceLiveDetectionEvent

    retention_hours = hours if hours is not None else settings.FACE_RECOGNITION_SETTINGS.get(
        'LIVE_EVENT_RETENTION_HOURS', 48
    )
    cutoff = timezone.now() - timezone.timedelta(hours=retention_hours)
    deleted_count, _ = FaceLiveDetectionEvent.objects.filter(
        client_timestamp__lt=cutoff,
    ).delete()

    logger.info(f'Cleaned up {deleted_count} live detection events older than {retention_hours}h')
    return {'deleted': deleted_count}


@shared_task
def cleanup_old_face_audit_logs(days=None):
    """
    Purge FaceAuditLog rows past AUDIT_LOG_RETENTION_DAYS (Phase 3a design
    doc) — same data-minimization posture as cleanup_old_live_detection_events
    above, since this table (unlike FaceMatchThresholdSample) keeps
    student/actor identity attached.
    """
    from django.conf import settings
    from django.utils import timezone
    from .models import FaceAuditLog

    retention_days = days if days is not None else settings.FACE_RECOGNITION_SETTINGS.get(
        'AUDIT_LOG_RETENTION_DAYS', 365
    )
    cutoff = timezone.now() - timezone.timedelta(days=retention_days)
    deleted_count, _ = FaceAuditLog.objects.filter(created_at__lt=cutoff).delete()

    logger.info(f'Cleaned up {deleted_count} face audit logs older than {retention_days} days')
    return {'deleted': deleted_count}
