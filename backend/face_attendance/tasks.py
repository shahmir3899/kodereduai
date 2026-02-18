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
def enroll_student_face(self, student_id, image_url):
    """Generate and store face embedding for a student."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed
    from .services.pipeline import FaceEnrollmentPipeline

    task_id = self.request.id
    try:
        pipeline = FaceEnrollmentPipeline(student_id, image_url, task_id)
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
