"""Celery tasks for LMS TOC import jobs and content embeddings."""

import logging
from celery import shared_task
from django.utils import timezone

from core.embeddings import generate_text_embedding

from .models import ContentBlock, TOCImportJob

logger = logging.getLogger(__name__)


@shared_task
def embed_content_block(block_id: int):
    try:
        block = ContentBlock.objects.get(id=block_id)
    except ContentBlock.DoesNotExist:
        logger.warning('ContentBlock %s not found for embedding', block_id)
        return {'success': False, 'error': 'ContentBlock not found'}

    content_parts = [block.content_text or '']
    if block.content_rich:
        content_parts.append(str(block.content_rich))

    block.embedding = generate_text_embedding('\n'.join(part for part in content_parts if part))
    block.save(update_fields=['embedding', 'updated_at'])
    return {'success': True, 'block_id': block_id}


@shared_task
def embed_all_content_blocks(chunk_size: int = 50):
    pending_ids = list(
        ContentBlock.objects.filter(embedding__isnull=True, is_active=True)
        .order_by('id')
        .values_list('id', flat=True)
    )

    processed = 0
    for start in range(0, len(pending_ids), chunk_size):
        chunk_ids = pending_ids[start:start + chunk_size]
        for block_id in chunk_ids:
            embed_content_block(block_id)
            processed += 1
        logger.info('Embedded %s/%s content blocks', processed, len(pending_ids))

    return {'success': True, 'processed': processed}


@shared_task(bind=True, max_retries=2, default_retry_delay=20)
def process_toc_import_job(self, job_id: str):
    from .toc_job_payload_cache import purge_job_blob_cache, read_job_image_bytes
    from .toc_ocr import extract_toc_payload

    try:
        job = TOCImportJob.objects.select_related('book').get(id=job_id)
    except TOCImportJob.DoesNotExist:
        logger.error("TOC job %s not found", job_id)
        return {'success': False, 'error': 'TOC job not found'}

    if job.status in (TOCImportJob.Status.SUCCEEDED, TOCImportJob.Status.FAILED, TOCImportJob.Status.TIMED_OUT):
        return {'success': True, 'job_id': str(job.id), 'status': job.status}

    job.status = TOCImportJob.Status.PROCESSING
    job.started_at = job.started_at or timezone.now()
    job.attempt_count = (job.attempt_count or 0) + 1
    job.save(update_fields=['status', 'started_at', 'attempt_count', 'updated_at'])

    try:
        image_bytes = read_job_image_bytes(job)
        if not image_bytes:
            raise ValueError('Job image payload is empty.')

        payload, error = extract_toc_payload(image_bytes, language=job.book.language)
        if error:
            raise ValueError(error)

        job.status = TOCImportJob.Status.SUCCEEDED
        job.result_payload = {
            'text': payload.get('text', '') if payload else '',
            'lines': payload.get('lines', []) if payload else [],
            'language': job.book.language,
        }
        job.error_message = ''
        job.image_payload_b64 = ''
        job.completed_at = timezone.now()
        job.save(update_fields=[
            'status', 'result_payload', 'error_message', 'image_payload_b64',
            'completed_at', 'updated_at',
        ])
        purge_job_blob_cache(job.id)
        return {'success': True, 'job_id': str(job.id), 'status': job.status}
    except Exception as exc:
        logger.exception("TOC job %s failed", job_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)

        job.status = TOCImportJob.Status.FAILED
        job.error_message = str(exc)
        job.completed_at = timezone.now()
        job.save(update_fields=['status', 'error_message', 'completed_at', 'updated_at'])
        purge_job_blob_cache(job.id)
        return {'success': False, 'job_id': str(job.id), 'status': job.status, 'error': str(exc)}


@shared_task(bind=True, max_retries=1, time_limit=120)
def generate_exam_questions_task(self, school_id, book_id, content_kind, page_start, page_end):
    """Generate exam questions from exercise topics via Groq, asynchronously."""
    import json
    from django.conf import settings
    from core.task_utils import mark_task_success, mark_task_failed, update_task_progress
    from .content_retrieval import retrieve_topics_for_ai, build_prompt
    from .models import Book

    task_id = self.request.id

    try:
        book = Book.objects.select_related('school', 'class_obj', 'subject').get(
            id=book_id, school_id=school_id,
        )
    except Book.DoesNotExist:
        mark_task_failed(task_id, 'Book not found.')
        return {'success': False, 'error': 'Book not found.'}

    update_task_progress(task_id, current=0, total=2)

    topic_dicts = retrieve_topics_for_ai(
        book, content_kind=content_kind, page_start=page_start, page_end=page_end,
    )
    if not topic_dicts:
        mark_task_failed(task_id, 'No matching topics found for the given filters.')
        return {'success': False, 'error': 'No matching topics found for the given filters.'}

    language_instruction = ''
    if book.language in Book.RTL_LANGUAGES:
        lang_name = book.get_language_display()
        language_instruction = (
            f'IMPORTANT: Generate all questions and answers in {lang_name}.'
        )

    prompt = build_prompt(
        mode='exam',
        school=book.school,
        class_obj=book.class_obj,
        subject=book.subject,
        book=book,
        topic_dicts=topic_dicts,
        language_instruction=language_instruction,
    )

    if not getattr(settings, 'GROQ_API_KEY', None):
        mark_task_failed(task_id, 'AI generation is not configured. GROQ_API_KEY is missing.')
        return {'success': False, 'error': 'AI generation is not configured. GROQ_API_KEY is missing.'}

    update_task_progress(task_id, current=1)

    try:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)
        model_name = getattr(settings, 'GROQ_MODEL', 'llama-3.3-70b-versatile')
        response = client.chat.completions.create(
            model=model_name,
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.3,
            max_tokens=3000,
        )
        result_text = response.choices[0].message.content
        if '```json' in result_text:
            result_text = result_text.split('```json')[1].split('```')[0]
        elif '```' in result_text:
            result_text = result_text.split('```')[1].split('```')[0]
        result = json.loads(result_text.strip())
    except json.JSONDecodeError as exc:
        logger.error('Failed to parse exam AI response: %s', exc)
        mark_task_failed(task_id, 'Failed to parse AI response. Please try again.')
        return {'success': False, 'error': 'Failed to parse AI response. Please try again.'}
    except Exception as exc:
        logger.error('Exam AI generation failed: %s', exc)
        mark_task_failed(task_id, str(exc))
        return {'success': False, 'error': str(exc)}

    result_data = {'success': True, **result}
    mark_task_success(task_id, result_data=result_data)
    return result_data


@shared_task
def mark_stale_toc_jobs_timed_out(max_age_minutes: int = 5):
    cutoff = timezone.now() - timezone.timedelta(minutes=max_age_minutes)
    updated = TOCImportJob.objects.filter(
        status__in=[TOCImportJob.Status.QUEUED, TOCImportJob.Status.PROCESSING],
        created_at__lt=cutoff,
    ).update(
        status=TOCImportJob.Status.TIMED_OUT,
        error_message='TOC processing timed out. Please retry.',
        completed_at=timezone.now(),
    )
    return {'updated': updated}
