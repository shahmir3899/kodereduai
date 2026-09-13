"""
Celery tasks for examinations app - async question paper processing.
"""

import logging
from celery import shared_task
from django.db.models import Avg, Count, Q
from django.utils import timezone

from core.embeddings import generate_text_embedding

from .models import PaperUpload, Question, QuestionStats, StudentResponse, WorksheetUpload

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


def _build_continuation_context(upload: PaperUpload) -> dict | None:
    """For page 2+ of a multi-page capture, summarizes what prior pages in the same
    group already extracted so the LLM can decide whether this page continues the
    previous section. Scoped by school_id (not just group_id) so a crafted/colliding
    group_id can never pull another school's extraction data into this prompt --
    mirrors the same school-scoping used for page_number auto-increment in the
    upload-image view. Returns None for page 1 or a standalone (group_id is null)
    upload, matching what _build_extraction_prompt expects to skip the hint block.
    """
    if not upload.group_id or upload.page_number <= 1:
        return None

    prior_pages = list(
        PaperUpload.objects.filter(
            school_id=upload.school_id,
            group_id=upload.group_id,
            page_number__lt=upload.page_number,
        ).order_by('page_number').values_list('ai_extracted_json', flat=True)
    )
    prior_pages = [p for p in prior_pages if p]
    if not prior_pages:
        return None

    header = None
    last_section = None
    questions_so_far = 0
    marks_so_far = 0.0
    for page_json in prior_pages:
        # Header is normally only printed on page 1, but layer forward so a later
        # page's own header fields (if it happens to have any) fill in gaps rather
        # than overwrite what's already known.
        page_header = page_json.get('header') or {}
        if header is None:
            header = dict(page_header)
        else:
            for key, value in page_header.items():
                if value not in (None, '') and not header.get(key):
                    header[key] = value

        sections = page_json.get('sections') or []
        if sections:
            last_section = sections[-1]

        questions_so_far += len(page_json.get('questions') or [])
        marks_so_far += page_json.get('computed_total_marks') or 0

    return {
        'page_number': upload.page_number,
        'header': header,
        'last_section': last_section,
        'questions_so_far': questions_so_far,
        'marks_so_far': marks_so_far,
    }


@shared_task(bind=True, max_retries=2)
def process_paper_upload_ocr(self, upload_id: int):
    """
    Process uploaded paper image with OCR to extract questions.
    
    Args:
        upload_id: ID of the PaperUpload instance
    
    Returns:
        dict: Processing result with success status and data
    """
    from .paper_ocr_processor import PaperOCRProcessor

    try:
        logger.info(f"Starting OCR processing for PaperUpload {upload_id}")
        
        # Fetch the upload
        try:
            upload = PaperUpload.objects.select_related(
                'school', 'context_class', 'context_subject',
            ).get(id=upload_id)
        except PaperUpload.DoesNotExist:
            logger.error(f"PaperUpload {upload_id} not found")
            return {'success': False, 'error': 'Upload not found'}

        # Update status to processing
        upload.status = PaperUpload.Status.PROCESSING
        upload.save(update_fields=['status'])

        # Initialize processor
        processor = PaperOCRProcessor()

        # Prepare context (if available) — the uploader's optional class/subject hints;
        # the AI still detects header text verbatim, this only nudges extraction.
        context = {
            'school_id': upload.school_id,
            'class_name': upload.context_class.name if upload.context_class_id else None,
            'subject_name': upload.context_subject.name if upload.context_subject_id else None,
        }
        
        # Process the image -- continuation_context is None for page 1/standalone
        # uploads (group_id null), or built from prior pages in the same group for
        # page 2+ so the LLM can decide whether this page continues the last section.
        continuation_context = _build_continuation_context(upload)
        result = processor.process_paper_image(upload.image_url, context, continuation_context)
        
        if result.success:
            # Update upload with extracted data
            upload.ai_extracted_json = result.to_json()
            upload.extraction_confidence = result.extraction_confidence
            upload.extraction_notes = result.notes
            upload.status = PaperUpload.Status.EXTRACTED
            upload.processed_at = timezone.now()
            upload.save()
            
            logger.info(
                f"Successfully processed PaperUpload {upload_id}: "
                f"{len(result.questions)} questions extracted"
            )
            
            return {
                'success': True,
                'upload_id': upload_id,
                'questions_count': len(result.questions),
                'confidence': result.extraction_confidence
            }
        else:
            # Update with error
            upload.status = PaperUpload.Status.FAILED
            upload.error_message = result.error or "Unknown processing error"
            upload.processed_at = timezone.now()
            upload.save()
            
            logger.error(f"Failed to process PaperUpload {upload_id}: {result.error}")
            
            return {
                'success': False,
                'upload_id': upload_id,
                'error': result.error
            }
    
    except Exception as e:
        logger.error(
            f"Unexpected error processing PaperUpload {upload_id}: {str(e)}",
            exc_info=True
        )
        
        # Try to update upload status
        try:
            upload = PaperUpload.objects.get(id=upload_id)
            upload.status = PaperUpload.Status.FAILED
            upload.error_message = f"Processing error: {str(e)}"
            upload.processed_at = timezone.now()
            upload.save()
        except Exception:
            pass
        
        # Retry if not exceeded max retries
        if self.request.retries < self.max_retries:
            logger.info(f"Retrying PaperUpload {upload_id} (attempt {self.request.retries + 1})")
            raise self.retry(exc=e, countdown=60)  # Retry after 60 seconds

        return {
            'success': False,
            'upload_id': upload_id,
            'error': str(e)
        }


@shared_task(bind=True, max_retries=2)
def process_worksheet_upload_ocr(self, upload_id: int):
    """Process an uploaded worksheet image with OCR to extract questions.

    Deliberately skips the multi-page continuation-context building that
    process_paper_upload_ocr does for exam papers -- worksheets are almost
    always a single page, so that extra prompt-context plumbing isn't worth
    duplicating here; group_id/page_number are still stored for the rare
    multi-page case, they just don't inform this call's extraction prompt.
    """
    from .paper_ocr_processor import PaperOCRProcessor

    try:
        logger.info(f"Starting OCR processing for WorksheetUpload {upload_id}")

        try:
            upload = WorksheetUpload.objects.select_related(
                'school', 'context_class', 'context_subject',
            ).get(id=upload_id)
        except WorksheetUpload.DoesNotExist:
            logger.error(f"WorksheetUpload {upload_id} not found")
            return {'success': False, 'error': 'Upload not found'}

        upload.status = WorksheetUpload.Status.PROCESSING
        upload.save(update_fields=['status'])

        processor = PaperOCRProcessor()
        context = {
            'school_id': upload.school_id,
            'class_name': upload.context_class.name if upload.context_class_id else None,
            'subject_name': upload.context_subject.name if upload.context_subject_id else None,
        }

        result = processor.process_paper_image(upload.image_url, context, None)

        if result.success:
            upload.ai_extracted_json = result.to_json()
            upload.extraction_confidence = result.extraction_confidence
            upload.extraction_notes = result.notes
            upload.status = WorksheetUpload.Status.EXTRACTED
            upload.processed_at = timezone.now()
            upload.save()

            logger.info(
                f"Successfully processed WorksheetUpload {upload_id}: "
                f"{len(result.questions)} questions extracted"
            )

            return {
                'success': True,
                'upload_id': upload_id,
                'questions_count': len(result.questions),
                'confidence': result.extraction_confidence,
            }
        else:
            upload.status = WorksheetUpload.Status.FAILED
            upload.error_message = result.error or "Unknown processing error"
            upload.processed_at = timezone.now()
            upload.save()

            logger.error(f"Failed to process WorksheetUpload {upload_id}: {result.error}")

            return {
                'success': False,
                'upload_id': upload_id,
                'error': result.error,
            }

    except Exception as e:
        logger.error(
            f"Unexpected error processing WorksheetUpload {upload_id}: {str(e)}",
            exc_info=True
        )

        try:
            upload = WorksheetUpload.objects.get(id=upload_id)
            upload.status = WorksheetUpload.Status.FAILED
            upload.error_message = f"Processing error: {str(e)}"
            upload.processed_at = timezone.now()
            upload.save()
        except Exception:
            pass

        if self.request.retries < self.max_retries:
            logger.info(f"Retrying WorksheetUpload {upload_id} (attempt {self.request.retries + 1})")
            raise self.retry(exc=e, countdown=60)

        return {
            'success': False,
            'upload_id': upload_id,
            'error': str(e)
        }
