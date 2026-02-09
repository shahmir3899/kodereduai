"""
Celery tasks for attendance processing.
"""

import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_attendance_upload(self, upload_id: int):
    """
    Process an attendance upload through the AI pipeline.

    New Pipeline (Image → OCR → Structured Table → LLM Reasoning):
    1. OCR with Tesseract - extract text with confidence scores
    2. Table Extraction - build structured table from OCR output
    3. LLM Reasoning - validate and reason on structured data
    4. Student Matching - match to enrolled students
    5. Update upload with results for human review

    Args:
        upload_id: ID of the AttendanceUpload to process
    """
    from .models import AttendanceUpload
    from .attendance_processor import AttendanceProcessor

    try:
        upload = AttendanceUpload.objects.get(id=upload_id)
    except AttendanceUpload.DoesNotExist:
        logger.error(f"AttendanceUpload {upload_id} not found")
        return {'success': False, 'error': 'Upload not found'}

    logger.info(f"Processing attendance upload {upload_id} for {upload.class_obj.name}")

    try:
        processor = AttendanceProcessor(upload)
        result = processor.process()

        if result.success:
            # Update upload with results
            upload.ai_output_json = result.to_ai_output_json()
            upload.confidence_score = result.confidence
            upload.status = AttendanceUpload.Status.REVIEW_REQUIRED
            upload.save()

            logger.info(
                f"Upload {upload_id} processed successfully. "
                f"Matched: {result.matched_count}, "
                f"Unmatched: {result.unmatched_count}, "
                f"Uncertain: {len(result.uncertain)}"
            )

            return {
                'success': True,
                'upload_id': upload_id,
                'matched_count': result.matched_count,
                'unmatched_count': result.unmatched_count,
                'uncertain_count': len(result.uncertain),
                'confidence': result.confidence,
                'pipeline_stages': result.pipeline_stages
            }
        else:
            # Processing failed
            upload.status = AttendanceUpload.Status.FAILED
            upload.error_message = f"[{result.error_stage}] {result.error}"
            upload.save()

            logger.error(f"Upload {upload_id} processing failed: {upload.error_message}")

            return {
                'success': False,
                'upload_id': upload_id,
                'error': upload.error_message,
                'error_stage': result.error_stage
            }

    except Exception as e:
        logger.exception(f"Error processing upload {upload_id}")

        # Update upload status on error
        try:
            upload.status = AttendanceUpload.Status.FAILED
            upload.error_message = str(e)
            upload.save()
        except Exception:
            pass

        # Retry the task
        raise self.retry(exc=e)


@shared_task
def send_whatsapp_notifications(upload_id: int):
    """
    Send WhatsApp notifications to parents of absent students.

    This task runs ONLY after attendance is confirmed.

    Args:
        upload_id: ID of the confirmed AttendanceUpload
    """
    from .models import AttendanceUpload, AttendanceRecord
    from .services import WhatsAppService

    try:
        upload = AttendanceUpload.objects.get(
            id=upload_id,
            status=AttendanceUpload.Status.CONFIRMED
        )
    except AttendanceUpload.DoesNotExist:
        logger.error(f"Confirmed AttendanceUpload {upload_id} not found")
        return {'success': False, 'error': 'Upload not found or not confirmed'}

    # Get absent records that haven't been notified yet
    absent_records = AttendanceRecord.objects.filter(
        upload=upload,
        status=AttendanceRecord.AttendanceStatus.ABSENT,
        notification_sent=False
    ).select_related('student', 'student__class_obj')

    if not absent_records.exists():
        logger.info(f"No notifications to send for upload {upload_id}")
        return {'success': True, 'sent': 0, 'failed': 0}

    # Send notifications
    whatsapp_service = WhatsAppService(upload.school)

    if not whatsapp_service.is_configured():
        logger.warning(f"WhatsApp not configured for school {upload.school.name}")
        return {'success': False, 'error': 'WhatsApp not configured'}

    result = whatsapp_service.send_bulk_notifications(list(absent_records))

    logger.info(
        f"WhatsApp notifications for upload {upload_id}: "
        f"Sent: {result['sent']}, Failed: {result['failed']}"
    )

    return {
        'success': True,
        'upload_id': upload_id,
        'sent': result['sent'],
        'failed': result['failed']
    }


@shared_task
def cleanup_old_uploads(days: int = 90):
    """
    Clean up old failed uploads to save storage.

    Args:
        days: Delete failed uploads older than this many days
    """
    from .models import AttendanceUpload

    cutoff_date = timezone.now() - timezone.timedelta(days=days)

    deleted_count, _ = AttendanceUpload.objects.filter(
        status=AttendanceUpload.Status.FAILED,
        created_at__lt=cutoff_date
    ).delete()

    logger.info(f"Cleaned up {deleted_count} old failed uploads")

    return {'deleted_count': deleted_count}


@shared_task
def retry_failed_uploads(hours: int = 24):
    """
    Retry failed uploads that failed within the last N hours.

    Args:
        hours: Retry uploads that failed within this many hours
    """
    from .models import AttendanceUpload

    cutoff_time = timezone.now() - timezone.timedelta(hours=hours)

    failed_uploads = AttendanceUpload.objects.filter(
        status=AttendanceUpload.Status.FAILED,
        updated_at__gte=cutoff_time
    )

    retried = 0
    for upload in failed_uploads:
        upload.status = AttendanceUpload.Status.PROCESSING
        upload.error_message = ''
        upload.save()

        process_attendance_upload.delay(upload.id)
        retried += 1

    logger.info(f"Retried {retried} failed uploads")

    return {'retried_count': retried}
