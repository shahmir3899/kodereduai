"""
Celery tasks for examinations app - async question paper processing.
"""

import logging
from celery import shared_task
from django.db.models import Avg, Count, Q
from django.utils import timezone

from core.embeddings import generate_text_embedding

from .models import PaperUpload, Question, QuestionStats, StudentResponse

logger = logging.getLogger(__name__)


@shared_task
def embed_question(question_id: int):
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        logger.warning('Question %s not found for embedding', question_id)
        return {'success': False, 'error': 'Question not found'}

    content_parts = [
        question.question_text or '',
        question.answer_text or '',
        question.correct_answer or '',
    ]
    question.embedding = generate_text_embedding('\n'.join(part for part in content_parts if part))
    question.save(update_fields=['embedding', 'updated_at'])
    return {'success': True, 'question_id': question_id}


@shared_task
def recompute_question_stats(question_id: int):
    if not Question.objects.filter(id=question_id).exists():
        logger.warning('Question %s not found for stats recompute', question_id)
        return {'success': False, 'error': 'Question not found'}

    aggregate = StudentResponse.objects.filter(question_id=question_id).aggregate(
        attempt_count=Count('id'),
        correct_count=Count('id', filter=Q(is_correct=True)),
        avg_time_seconds=Avg('time_taken_seconds'),
    )
    attempt_count = aggregate['attempt_count'] or 0
    correct_count = aggregate['correct_count'] or 0
    real_difficulty = None
    if attempt_count:
        real_difficulty = 1.0 - (correct_count / attempt_count)

    stats, _ = QuestionStats.objects.update_or_create(
        question_id=question_id,
        defaults={
            'attempt_count': attempt_count,
            'correct_count': correct_count,
            'avg_time_seconds': aggregate['avg_time_seconds'],
            'real_difficulty': real_difficulty,
            'last_computed_at': timezone.now(),
        },
    )
    return {
        'success': True,
        'question_id': question_id,
        'attempt_count': stats.attempt_count,
        'correct_count': stats.correct_count,
    }


def start_paper_ocr(upload_id: int) -> None:
    """Run paper OCR once, off the request thread, without needing a Celery worker.

    Same in-process daemon-thread approach as lms TOC OCR: the upload view returns
    201 with status PENDING at once and the web/mobile clients poll the upload until it
    is EXTRACTED or FAILED. Previously this went through call_task, which on this
    deployment (no usable Redis) ran OCR inline and then ran it a second time, doubling
    Google Vision and Groq usage. Under eager mode (local dev, tests) it runs inline.
    """
    import threading
    from django.conf import settings
    from django.db import connection

    def _run():
        try:
            process_paper_upload_ocr(upload_id)
        except Exception:
            # The task already marks the upload FAILED; this only stops a retry
            # request (meaningless outside a worker) from killing the thread noisily.
            logger.exception("Paper OCR thread failed for PaperUpload %s", upload_id)
        finally:
            connection.close()

    if getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', False):
        try:
            process_paper_upload_ocr(upload_id)
        except Exception:
            logger.exception("Paper OCR failed for PaperUpload %s", upload_id)
        return
    threading.Thread(target=_run, name=f"paper-ocr-{upload_id}", daemon=True).start()


def _scan_upload_to_blocks(upload, context):
    """Paper Builder v2: the photo becomes blocks for the block editor (see paper_scan_blocks)."""
    from .paper_scan_blocks import ScanError, scan_page

    try:
        result = scan_page(upload.image_url, context)
    except ScanError as exc:
        upload.status = PaperUpload.Status.FAILED
        upload.error_message = str(exc)
        upload.processed_at = timezone.now()
        upload.save(update_fields=['status', 'error_message', 'processed_at'])
        return {'success': False, 'upload_id': upload.id, 'error': str(exc)}
    upload.ai_extracted_json = result
    upload.extraction_notes = (
        f"{len(result['blocks'])} block(s) read with {result.get('provider')} {result.get('model')}; "
        f"pictures: {result['pictures']['library']} from the library, {result['pictures']['cropped']} cut from the photo"
    )
    upload.status = PaperUpload.Status.EXTRACTED
    upload.processed_at = timezone.now()
    upload.save(update_fields=['ai_extracted_json', 'extraction_notes', 'status', 'processed_at'])
    return {'success': True, 'upload_id': upload.id, 'blocks_count': len(result['blocks'])}


@shared_task(bind=True, max_retries=2)
def process_paper_upload_ocr(self, upload_id: int):
    """Read one uploaded page into blocks for the block editor (Paper Builder v2). The old questions-only
    scan (PaperOCRProcessor) was removed in Phase 7; an upload is always a block scan now."""
    try:
        try:
            upload = PaperUpload.objects.select_related(
                'school', 'context_class', 'context_subject',
            ).get(id=upload_id)
        except PaperUpload.DoesNotExist:
            logger.error(f"PaperUpload {upload_id} not found")
            return {'success': False, 'error': 'Upload not found'}

        upload.status = PaperUpload.Status.PROCESSING
        upload.save(update_fields=['status'])

        # The uploader's optional class/subject hints; the AI still reads the header text itself.
        context = {
            'school_id': upload.school_id,
            'class_id': upload.context_class_id,
            'class_name': upload.context_class.name if upload.context_class_id else None,
            'subject_id': upload.context_subject_id,
            'subject_name': upload.context_subject.name if upload.context_subject_id else None,
            'subject_code': upload.context_subject.code if upload.context_subject_id else None,
        }
        return _scan_upload_to_blocks(upload, context)

    except Exception as e:
        logger.error(f"Unexpected error processing PaperUpload {upload_id}: {str(e)}", exc_info=True)
        try:
            upload = PaperUpload.objects.get(id=upload_id)
            upload.status = PaperUpload.Status.FAILED
            from .paper_ocr_processor import MSG_GENERIC_FAILURE
            upload.error_message = MSG_GENERIC_FAILURE
            upload.processed_at = timezone.now()
            upload.save()
        except Exception:
            pass

        if self.request.retries < self.max_retries:
            logger.info(f"Retrying PaperUpload {upload_id} (attempt {self.request.retries + 1})")
            raise self.retry(exc=e, countdown=60)

        return {'success': False, 'upload_id': upload_id, 'error': str(e)}
