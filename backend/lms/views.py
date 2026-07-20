"""
LMS views for lesson plans, assignments, submissions, and curriculum management.
"""

import logging
import hashlib
import json
import base64
import uuid
import time
from django.conf import settings
from datetime import timedelta
from django.utils import timezone
from django.db import transaction
from django.db.models import Count, Q
from django.core.cache import cache
from pgvector.django import CosineDistance
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes as perm_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle

from core.permissions import (
    IsSchoolAdminOrReadOnly, CanEditCurriculum, HasSchoolAccess, ModuleAccessMixin,
    get_effective_role, ADMIN_ROLES, STAFF_LEVEL_ROLES,
    get_teacher_combined_scope,
)
from core.ai_jobs import complete_ai_job, create_ai_job, fail_ai_job
from core.embeddings import generate_text_embedding
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id, ensure_tenant_schools
from core.class_scope import resolve_class_scope
from academic_sessions.calendar_rules import is_off_day_for_date
from .models import (
    Book, Chapter, Topic, SubTopic, ContentBlock, Tag, ContentBlockTag, QuestionTag, LessonPlan, LearningObjective, LessonPlanObjective, CurriculumStandard, StandardObjective, TopicStandardAlignment, Assignment,
    AssignmentSubmission, TOCImportJob,
)
from .content_retrieval import retrieve_topics_for_ai, build_prompt, extract_text_from_blocks
from .serializers import (
    BookReadSerializer, BookCreateSerializer,
    BookChapterOnlyReadSerializer,
    BookLessonPlanReadSerializer,
    TopicExamExercisesSerializer,
    ChapterReadSerializer, ChapterCreateSerializer,
    TopicLessonPlanSerializer,
    TopicSerializer,
    SubTopicSerializer,
    ContentBlockSerializer,
    ContentRevisionSerializer,
    TagSerializer,
    LearningObjectiveSerializer,
    StandardObjectiveSerializer,
    LessonPlanReadSerializer, LessonPlanCreateSerializer, LessonPlanBulkCreateSerializer,
    AssignmentReadSerializer, AssignmentCreateSerializer,
    AssignmentSubmissionReadSerializer, AssignmentSubmissionCreateSerializer,
    TOCImportJobSerializer,
)
from .toc_job_payload_cache import (
    purge_job_blob_cache,
    read_job_image_bytes,
    try_put_job_blob,
)

logger = logging.getLogger(__name__)

TOC_APPLY_IDEMPOTENCY_TTL_SECONDS = 60 * 60
TOC_APPLY_IDEMPOTENCY_FALLBACK = {}

# Phase 5: Rate limiting for OCR/AI endpoints
class OCRRateThrottle(UserRateThrottle):
    """Rate limit OCR TOC extraction to prevent abuse and manage costs."""
    scope = 'ocr_toc'
    THROTTLE_RATES = {'ocr_toc': '20/hour'}  # 20 OCR requests per hour per user

class AIRateThrottle(UserRateThrottle):
    """Rate limit AI TOC suggestions to prevent abuse and manage costs."""
    scope = 'suggest_toc'
    THROTTLE_RATES = {'suggest_toc': '30/hour'}  # 30 AI suggestion requests per hour per user

# Phase 5: Safeguards for large text processing
MAX_TOC_TEXT_SIZE = 500 * 1024  # 500KB max
CHUNK_SIZE = 50 * 1024  # 50KB per chunk for streaming parse
MAX_OCR_SYNC_WAIT_SECONDS = 60


def _apply_teacher_dual_scope(queryset, request, class_field='class_obj_id', subject_field='subject_id', school_id=None):
    """Apply union of class-teacher full scope and subject-teacher scoped visibility.
    Uses section-class scope for true isolation when teacher has session assignments."""
    role = get_effective_role(request)
    if role != 'TEACHER':
        return queryset

    school_id = school_id or ensure_tenant_school_id(request) or request.user.school_id
    scope = get_teacher_combined_scope(request, school_id=school_id)
    full_class_ids = scope['full_class_ids']
    session_ids = scope.get('full_session_class_ids', set())
    class_subject_map = scope['class_subject_map']

    predicates = Q()

    if session_ids:
        # Section-level: only items belonging to teacher's assigned session classes
        # Session class here resolves to master class for LMS (lesson plans don't store session_class)
        # So we match on master class IDs that correspond to assigned session classes
        if full_class_ids:
            predicates |= Q(**{f'{class_field}__in': full_class_ids})
    elif full_class_ids:
        predicates |= Q(**{f'{class_field}__in': full_class_ids})

    for class_id, subject_ids in class_subject_map.items():
        if subject_ids:
            predicates |= Q(**{class_field: class_id, f'{subject_field}__in': list(subject_ids)})

    if not predicates:
        return queryset.none()

    return queryset.filter(predicates)


# ---------------------------------------------------------------------------
# Curriculum: Books, Chapters, Topics
# ---------------------------------------------------------------------------

def _process_toc_job_in_background(job_id: str) -> None:
    """
    Spawn a daemon thread to run a TOC import job synchronously (no Celery needed).
    The thread calls Google Vision, updates the TOCImportJob record, and closes the DB
    connection cleanly when done. Used as a fallback when ENABLE_CELERY is false.
    """
    import threading
    from django.utils import timezone
    from django.db import connection as _db_conn

    def _worker():
        try:
            job = TOCImportJob.objects.select_related('book').get(id=job_id)
        except TOCImportJob.DoesNotExist:
            logger.error('[TOC-OCR-THREAD] Job %s not found', job_id)
            return

        if job.status in (
            TOCImportJob.Status.SUCCEEDED,
            TOCImportJob.Status.FAILED,
            TOCImportJob.Status.TIMED_OUT,
        ):
            return

        job.status = TOCImportJob.Status.PROCESSING
        job.started_at = job.started_at or timezone.now()
        job.attempt_count = (job.attempt_count or 0) + 1
        job.save(update_fields=['status', 'started_at', 'attempt_count', 'updated_at'])

        try:
            image_bytes = read_job_image_bytes(job)
            if not image_bytes:
                raise ValueError('Job image payload is empty.')

            from .toc_ocr import extract_toc_payload
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
                'status', 'result_payload', 'error_message',
                'image_payload_b64', 'completed_at', 'updated_at',
            ])
            logger.info('[TOC-OCR-THREAD] Job %s succeeded', job_id)
            purge_job_blob_cache(job.id)
        except Exception as exc:
            logger.exception('[TOC-OCR-THREAD] Job %s failed: %s', job_id, exc)
            try:
                job.status = TOCImportJob.Status.FAILED
                job.error_message = str(exc)
                job.completed_at = timezone.now()
                job.save(update_fields=['status', 'error_message', 'completed_at', 'updated_at'])
            except Exception:
                pass
            purge_job_blob_cache(job.id)
        finally:
            try:
                _db_conn.close()
            except Exception:
                pass

    thread = threading.Thread(
        target=_worker,
        daemon=True,
        name=f'toc-ocr-{str(job_id)[:8]}',
    )
    thread.start()


class BookViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for curriculum books.
    Admins can create/edit, teachers have read-only access.

    Query params:
        class_id   - filter by class
        subject_id - filter by subject
        language   - filter by language
    """
    required_module = 'lms'
    queryset = Book.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return BookCreateSerializer
        view_profile = self.request.query_params.get('view')
        if view_profile == 'chapter_only':
            return BookChapterOnlyReadSerializer
        if view_profile == 'lesson_plan':
            return BookLessonPlanReadSerializer
        return BookReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'class_obj', 'subject',
        ).prefetch_related('chapters__topics__subtopics')

        queryset = _apply_teacher_dual_scope(queryset, self.request)

        scope = resolve_class_scope(self.request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return queryset.none()

        class_id = scope['class_obj_id']
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        language = self.request.query_params.get('language')
        if language:
            queryset = queryset.filter(language=language)

        return queryset

    @action(detail=True, methods=['get'])
    def tree(self, request, pk=None):
        """
        Full curriculum tree for a book: chapters with nested topics.
        GET /api/lms/books/{id}/tree/
        """
        book = self.get_object()
        view_profile = request.query_params.get('view')
        if view_profile == 'chapter_only':
            serializer_class = BookChapterOnlyReadSerializer
        elif view_profile == 'lesson_plan':
            serializer_class = BookLessonPlanReadSerializer
        else:
            serializer_class = BookReadSerializer
        serializer = serializer_class(book)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def bulk_toc(self, request, pk=None):
        """
        Bulk create chapters and topics from pasted table of contents.
        POST /api/lms/books/{id}/bulk_toc/
        Body: { "toc_text": "1. Chapter title\\n  1.1 Topic..." }
        """
        book = self.get_object()
        toc_text = request.data.get('toc_text', '')
        if not toc_text.strip():
            return Response(
                {'error': 'toc_text is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .toc_parser import parse_toc_text
        results = parse_toc_text(toc_text, book)
        return Response(results, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='parse_toc')
    def parse_toc(self, request, pk=None):
        """
        Parse TOC text and return a structured preview without DB writes.
        POST /api/lms/books/{id}/parse_toc/
        Body: { "toc_text": "1. Chapter\n  1.1 Topic" }
        """
        book = self.get_object()
        toc_text = request.data.get('toc_text', '')
        if not toc_text.strip():
            return Response(
                {'error': 'toc_text is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .toc_parser import parse_toc_preview
        preview = parse_toc_preview(toc_text)

        return Response({
            'book_id': book.id,
            'chapters': preview['chapters'],
            'warnings': preview['warnings'],
            'chapter_count': len(preview['chapters']),
            'topic_count': sum(len(ch.get('topics', [])) for ch in preview['chapters']),
        })

    @action(detail=True, methods=['post'], url_path='apply_toc')
    def apply_toc(self, request, pk=None):
        """
        Apply reviewed chapter/topic payload and create DB rows.
        POST /api/lms/books/{id}/apply_toc/
        Body: {
          "chapters": [{
            "title": "...",
            "page_start": optional int, "page_end": optional int,
            "topics": [{
              "title": "...",
              "page_start": optional int, "page_end": optional int,
              "content_kind": "general" | "exercise" (optional),
            }]
          }]
        }
        """
        book = self.get_object()
        chapters = request.data.get('chapters', [])
        idempotency_key = (
            request.headers.get('X-Idempotency-Key')
            or request.data.get('idempotency_key')
            or ''
        ).strip()

        logger.info(f'[apply_toc] Received request for book {book.id}, chapters={len(chapters)}, idempotency_key={idempotency_key}')

        if not isinstance(chapters, list) or not chapters:
            logger.warning(f'[apply_toc] Invalid chapters input: {chapters}')
            return Response(
                {'error': 'chapters must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload_hash = hashlib.sha256(
            json.dumps(chapters, sort_keys=True, ensure_ascii=False).encode('utf-8')
        ).hexdigest()

        if idempotency_key:
            cache_key = f'lms:apply_toc:{book.id}:{idempotency_key}'
            existing = cache.get(cache_key)
            if not existing:
                existing = TOC_APPLY_IDEMPOTENCY_FALLBACK.get(cache_key)
            if existing and existing.get('payload_hash') == payload_hash:
                logger.info(f'[apply_toc] Idempotency cache hit for key {cache_key}')
                return Response(existing.get('result', {}), status=status.HTTP_200_OK)

        from .toc_parser import apply_toc_structure
        logger.info(f'[apply_toc] Calling apply_toc_structure for book {book.id}')
        try:
            with transaction.atomic():
                result = apply_toc_structure(book, chapters)
            logger.info(f'[apply_toc] Result: {result}')
        except Exception as e:
            logger.error(f'[apply_toc] Exception during apply_toc_structure: {str(e)}', exc_info=True)
            return Response(
                {'error': f'Failed to apply TOC: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if idempotency_key:
            record = {
                'payload_hash': payload_hash,
                'result': result,
            }
            cache.set(cache_key, record, TOC_APPLY_IDEMPOTENCY_TTL_SECONDS)
            TOC_APPLY_IDEMPOTENCY_FALLBACK[cache_key] = record

        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='suggest_toc', throttle_classes=[AIRateThrottle])
    def suggest_toc(self, request, pk=None):
        """
        Suggest TOC structure using AI with rule-based fallback.
        POST /api/lms/books/{id}/suggest_toc/
        Body: { "raw_text": "..." }
        Rate limited to 30 requests per hour per user.
        """
        book = self.get_object()
        raw_text = request.data.get('raw_text') or request.data.get('toc_text') or ''

        if not str(raw_text).strip():
            return Response(
                {'error': 'raw_text is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Phase 5: Validate text size to prevent excessive AI processing
        if len(raw_text) > MAX_TOC_TEXT_SIZE:
            return Response(
                {'error': f'Text too large. Maximum size is {MAX_TOC_TEXT_SIZE // 1024}KB. Consider breaking into smaller sections or using parse_toc_stream for chunked processing.'},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        from .toc_ai_suggester import suggest_toc_structure
        try:
            result = suggest_toc_structure(str(raw_text), language=book.language)
            return Response(result)
        except TimeoutError:
            return Response(
                {'error': 'AI suggestion timed out. Please retry with shorter text or use parser preview.'},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except Exception as exc:
            logger.exception('suggest_toc failed: %s', exc)
            return Response(
                {'error': 'Unable to generate TOC suggestion right now. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    @action(detail=True, methods=['post'], url_path='ocr_toc',
            parser_classes=[MultiPartParser, FormParser], throttle_classes=[OCRRateThrottle])
    def ocr_toc(self, request, pk=None):
        """
        OCR a Table of Contents image and return extracted text for review.
        POST /api/lms/books/{id}/ocr_toc/
        Body (multipart/form-data): image file in 'image' field
        Returns: { "text": "...", "language": "ur" }
        """
        book = self.get_object()

        if 'image' not in request.FILES:
            return Response(
                {'error': 'No image file provided. Send an image in the "image" field.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image = request.FILES['image']

        allowed_types = ['image/jpeg', 'image/png', 'image/webp']
        if image.content_type not in allowed_types:
            return Response(
                {'error': f'Invalid file type "{image.content_type}". Allowed: JPEG, PNG, WebP.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_size = 10 * 1024 * 1024  # 10MB
        if image.size > max_size:
            return Response(
                {'error': 'Image too large. Maximum size is 10MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image_bytes = image.read()
        async_requested = str(request.query_params.get('async', '')).lower() in ('1', 'true', 'yes')
        force_sync = getattr(settings, 'LMS_TOC_OCR_FORCE_SYNC', False)
        request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())

        if async_requested and not force_sync:
            # TOC OCR always runs in a daemon thread inside the gunicorn worker:
            #   - Independent of Celery worker health. On small instances the Celery worker can
            #     OOM/restart and leave Celery-queued jobs stuck in QUEUED forever, while the
            #     thread runs in-process and finishes in the same web dyno.
            #   - Avoids competing with notification beat tasks for the single Celery worker slot.
            #   - Still asynchronous from the client's perspective: returns 202 + poll URL so
            #     mobile browsers don't hold an idle TCP connection through slow Google Vision.
            _accept_t0 = time.perf_counter()
            job_uid = uuid.uuid4()
            store_blob_in_redis = try_put_job_blob(job_uid, image_bytes)
            # Persist base64 on the job row as a fallback for the daemon thread when the Redis
            # cache is unavailable (e.g. ignore_exceptions swallowed a transient read).
            encoded_payload = base64.b64encode(image_bytes).decode('utf-8')
            job = TOCImportJob.objects.create(
                id=job_uid,
                school=book.school,
                book=book,
                requested_by=request.user if request.user.is_authenticated else None,
                status=TOCImportJob.Status.QUEUED,
                image_file_name=image.name or '',
                image_content_type=image.content_type or '',
                image_size_bytes=image.size or 0,
                image_payload_b64=encoded_payload,
            )
            logger.info('[TOC-OCR] spawned thread job=%s request_id=%s book_id=%s', job.id, request_id, book.id)
            _process_toc_job_in_background(str(job.id))
            _accept_ms = (time.perf_counter() - _accept_t0) * 1000
            logger.info(
                '[TOC-OCR] async_accept_done job=%s book=%s image_bytes=%s redis_blob=%s elapsed_ms=%.1f',
                job.id,
                book.id,
                len(image_bytes),
                store_blob_in_redis,
                _accept_ms,
            )
            return Response(
                {
                    'job_id': str(job.id),
                    'status': job.status,
                    'poll_url': f'/api/lms/toc-jobs/{job.id}/',
                    'request_id': request_id,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        from .toc_ocr import extract_toc_payload
        try:
            extracted_payload, error = extract_toc_payload(image_bytes, language=book.language)
        except TimeoutError:
            return Response(
                {'error': f'OCR timed out after {MAX_OCR_SYNC_WAIT_SECONDS}s. Please retry.'},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except Exception as exc:
            logger.exception('ocr_toc failed: %s', exc)
            return Response(
                {'error': 'OCR service unavailable. Please retry shortly.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if error:
            return Response(
                {'error': error},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            'text': extracted_payload.get('text', '') if extracted_payload else '',
            'lines': extracted_payload.get('lines', []) if extracted_payload else [],
            'language': book.language,
            'request_id': request_id,
        })

    @action(detail=True, methods=['post'], url_path='parse_toc_stream')
    def parse_toc_stream(self, request, pk=None):
        """
        Parse large TOC text in chunks to prevent timeout.
        POST /api/lms/books/{id}/parse_toc_stream/
        Body: { "toc_text": "...", "chunk_size": 50000 (optional) }
        Returns structured preview with chapter/topic hierarchies per chunk.
        Recommended for text > 50KB.
        """
        book = self.get_object()
        toc_text = request.data.get('toc_text', '')
        chunk_size = request.data.get('chunk_size', CHUNK_SIZE)

        if not toc_text.strip():
            return Response(
                {'error': 'toc_text is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(toc_text) > MAX_TOC_TEXT_SIZE:
            return Response(
                {'error': f'Text too large. Maximum size is {MAX_TOC_TEXT_SIZE // 1024}KB.'},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        try:
            chunk_size = int(chunk_size)
        except (TypeError, ValueError):
            return Response(
                {'error': 'chunk_size must be a valid integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if chunk_size < 1024 or chunk_size > CHUNK_SIZE:
            return Response(
                {'error': f'chunk_size must be between 1024 and {CHUNK_SIZE} bytes.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .toc_parser import parse_toc_preview
        
        # Split text into chunks and parse each
        chunks = []
        for i in range(0, len(toc_text), chunk_size):
            chunk = toc_text[i:i + chunk_size]
            if chunk.strip():
                chunks.append(chunk)

        all_chapters = []
        all_warnings = []
        total_topic_count = 0

        for idx, chunk in enumerate(chunks):
            try:
                preview = parse_toc_preview(chunk)
                all_chapters.extend(preview.get('chapters', []))
                all_warnings.extend([f'Chunk {idx + 1}: {w}' for w in preview.get('warnings', [])])
                total_topic_count += sum(len(ch.get('topics', [])) for ch in preview.get('chapters', []))
            except Exception as e:
                all_warnings.append(f'Chunk {idx + 1} parse error: {str(e)}')

        return Response({
            'book_id': book.id,
            'chapters': all_chapters,
            'warnings': all_warnings,
            'chapter_count': len(all_chapters),
            'topic_count': total_topic_count,
            'chunk_count': len(chunks),
            'chunk_size': chunk_size,
        })


    @action(detail=False, methods=['get'])
    def for_class_subject(self, request):
        """
        Get all books for a class+subject combination with full tree.
        GET /api/lms/books/for_class_subject/?class_id=5&subject_id=3
        """
        scope = resolve_class_scope(request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return Response(
                {'error': scope['error']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        class_id = scope['class_obj_id']
        subject_id = request.query_params.get('subject_id')
        if not class_id or not subject_id:
            return Response(
                {'error': 'class_id and subject_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        books = self.get_queryset().filter(
            class_obj_id=class_id, subject_id=subject_id, is_active=True,
        )
        view_profile = request.query_params.get('view')
        if view_profile == 'chapter_only':
            serializer_class = BookChapterOnlyReadSerializer
        elif view_profile == 'lesson_plan':
            serializer_class = BookLessonPlanReadSerializer
        else:
            serializer_class = BookReadSerializer
        serializer = serializer_class(books, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def syllabus_progress(self, request):
        """
        Syllabus coverage progress for a class+subject.
        Returns per-topic coverage based on published lesson plans.
        GET /api/lms/books/syllabus_progress/?class_id=5&subject_id=3
        """
        scope = resolve_class_scope(request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return Response(
                {'error': scope['error']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        class_id = scope['class_obj_id']
        subject_id = request.query_params.get('subject_id')
        if not class_id or not subject_id:
            return Response(
                {'error': 'class_id and subject_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        books = self.get_queryset().filter(
            class_obj_id=class_id, subject_id=subject_id, is_active=True,
        )

        total_topics = 0
        covered_topics = 0
        book_progress = []

        for book in books:
            topics = Topic.objects.filter(chapter__book=book, is_active=True)
            book_total = topics.count()
            book_covered = topics.filter(
                lesson_plans__status='PUBLISHED',
            ).distinct().count()
            total_topics += book_total
            covered_topics += book_covered
            book_progress.append({
                'book_id': book.id,
                'book_title': book.title,
                'total_topics': book_total,
                'covered_topics': book_covered,
                'percentage': (
                    round(book_covered / book_total * 100) if book_total else 0
                ),
            })

        return Response({
            'total_topics': total_topics,
            'covered_topics': covered_topics,
            'percentage': (
                round(covered_topics / total_topics * 100) if total_topics else 0
            ),
            'books': book_progress,
        })

    @action(detail=True, methods=['get'])
    def retrieve_for_ai(self, request, pk=None):
        """
        Phase 6 — return structured topic data suitable for AI prompts.

        GET /api/lms/books/{id}/retrieve_for_ai/
        Query params:
          - content_kind   (optional) e.g. 'exercise' or 'general'
          - page_start     (optional) integer
          - page_end       (optional) integer
          - mode           (optional) 'lesson_plan' (default) or 'exam'

        Returns:
          { book_id, book_title, topic_count, mode, topics: [...], prompt_preview }
        """
        book = self.get_object()

        content_kind = request.query_params.get('content_kind') or None
        mode = request.query_params.get('mode', 'lesson_plan')

        try:
            page_start = int(request.query_params['page_start']) if 'page_start' in request.query_params else None
            page_end   = int(request.query_params['page_end'])   if 'page_end'   in request.query_params else None
        except (ValueError, TypeError):
            return Response(
                {'error': 'page_start and page_end must be integers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if page_start is not None and page_end is not None and page_end < page_start:
            return Response(
                {'error': 'page_end must be >= page_start.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        topic_dicts = retrieve_topics_for_ai(
            book,
            content_kind=content_kind,
            page_start=page_start,
            page_end=page_end,
        )

        # Build a prompt preview so the caller can inspect what will be sent to the LLM
        prompt_preview = build_prompt(
            mode=mode,
            school=book.school,
            class_obj=book.class_obj,
            subject=book.subject,
            book=book,
            topic_dicts=topic_dicts,
        )

        return Response({
            'book_id': book.id,
            'book_title': book.title,
            'topic_count': len(topic_dicts),
            'mode': mode,
            'topics': topic_dicts,
            'prompt_preview': prompt_preview,
        })


class TOCImportJobStatusView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def retrieve(self, request, job_id=None):
        school_id = ensure_tenant_school_id(request) or request.user.school_id
        try:
            job = TOCImportJob.objects.get(id=job_id, school_id=school_id)
        except TOCImportJob.DoesNotExist:
            return Response({'error': 'TOC job not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TOCImportJobSerializer(job)
        data = serializer.data
        data['result'] = data.pop('result_payload', {})
        return Response(data)


class ChapterViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for chapters within books."""
    required_module = 'lms'
    queryset = Chapter.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]
    tenant_field = 'book__school_id'

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ChapterCreateSerializer
        return ChapterReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('book').prefetch_related('topics__subtopics')

        book_id = self.request.query_params.get('book_id')
        if book_id:
            queryset = queryset.filter(book_id=book_id)

        return queryset

    def perform_create(self, serializer):
        """Chapter has no school FK — skip tenant injection."""
        serializer.save()


class TopicViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for topics within chapters."""
    required_module = 'lms'
    queryset = Topic.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]
    tenant_field = 'chapter__book__school_id'

    def get_serializer_class(self):
        # Use detailed serializer for list and retrieve actions
        if self.action in ('list', 'retrieve') and self.request.query_params.get('view') == 'lesson_plan':
            return TopicLessonPlanSerializer
        if self.action in ('list', 'retrieve') and self.request.query_params.get('view') == 'exam_exercises':
            return TopicExamExercisesSerializer
        if self.action in ('list', 'retrieve'):
            from .serializers import TopicDetailedSerializer
            return TopicDetailedSerializer
        return TopicSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'chapter', 'chapter__book'
        ).prefetch_related('lesson_plans', 'test_questions', 'subtopics')

        queryset = _apply_teacher_dual_scope(
            queryset,
            self.request,
            class_field='chapter__book__class_obj_id',
            subject_field='chapter__book__subject_id',
        )

        chapter_id = self.request.query_params.get('chapter_id')
        if chapter_id:
            queryset = queryset.filter(chapter_id=chapter_id)

        book_id = self.request.query_params.get('book_id')
        if book_id:
            queryset = queryset.filter(chapter__book_id=book_id)
        
        # Filter by class
        scope = resolve_class_scope(self.request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return queryset.none()

        class_id = scope['class_obj_id']
        if class_id:
            queryset = queryset.filter(chapter__book__class_obj_id=class_id)
        
        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(chapter__book__subject_id=subject_id)
        
        # Filter by coverage status
        coverage = self.request.query_params.get('coverage')
        if coverage == 'taught_only':
            # Topics with lesson plans
            queryset = queryset.filter(lesson_plans__is_active=True).distinct()
        elif coverage == 'tested_only':
            # Topics with questions
            queryset = queryset.filter(test_questions__is_active=True).distinct()
        elif coverage == 'both':
            # Topics with both lesson plans and questions
            queryset = queryset.filter(
                lesson_plans__is_active=True,
                test_questions__is_active=True
            ).distinct()
        elif coverage == 'uncovered':
            # Topics with neither lesson plans nor questions
            queryset = queryset.exclude(
                Q(lesson_plans__is_active=True) | Q(test_questions__is_active=True)
            ).distinct()

        # Controlled profile for exam-focused topic selection.
        if self.request.query_params.get('view') == 'exam_exercises':
            queryset = queryset.filter(
                Q(content_kind='exercise') | Q(test_questions__is_active=True)
            ).annotate(
                active_test_question_count=Count('test_questions', filter=Q(test_questions__is_active=True), distinct=True)
            ).distinct().order_by('chapter__chapter_number', 'topic_number', 'id')

        return queryset

    def perform_create(self, serializer):
        """Topic has no school FK — skip tenant injection."""
        serializer.save()

    @action(detail=True, methods=['get'], url_path='objectives')
    def objectives(self, request, pk=None):
        topic = self.get_object()
        queryset = topic.objectives.filter(is_active=True)
        serializer = LearningObjectiveSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'], url_path='standards')
    def standards(self, request, pk=None):
        topic = self.get_object()
        objectives = StandardObjective.objects.filter(
            topic_alignments__topic=topic,
        ).select_related('standard', 'subject', 'grade').distinct()
        serializer = StandardObjectiveSerializer(objectives, many=True)
        return Response(serializer.data)


class SubTopicViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for sub-topics under curriculum topics."""

    required_module = 'lms'
    queryset = SubTopic.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]
    tenant_field = 'topic__chapter__book__school_id'
    serializer_class = SubTopicSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'topic', 'topic__chapter', 'topic__chapter__book',
        )
        topic_id = self.request.query_params.get('topic_id')
        if topic_id:
            queryset = queryset.filter(topic_id=topic_id)
        book_id = self.request.query_params.get('book_id')
        if book_id:
            queryset = queryset.filter(topic__chapter__book_id=book_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save()


class ContentBlockViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    """CRUD for relational content blocks under chapters, topics, or subtopics."""

    required_module = 'lms'
    queryset = ContentBlock.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]
    serializer_class = ContentBlockSerializer

    def get_queryset(self):
        queryset = self.queryset.select_related(
            'chapter', 'chapter__book',
            'topic', 'topic__chapter', 'topic__chapter__book',
            'subtopic', 'subtopic__topic', 'subtopic__topic__chapter', 'subtopic__topic__chapter__book',
        )

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(
                Q(chapter__book__school_id=active_school_id)
                | Q(topic__chapter__book__school_id=active_school_id)
                | Q(subtopic__topic__chapter__book__school_id=active_school_id)
            )
        elif self.request.headers.get('X-School-ID'):
            return queryset.none()
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if not tenant_schools:
                return queryset.none()
            queryset = queryset.filter(
                Q(chapter__book__school_id__in=tenant_schools)
                | Q(topic__chapter__book__school_id__in=tenant_schools)
                | Q(subtopic__topic__chapter__book__school_id__in=tenant_schools)
            )

        chapter_id = self.request.query_params.get('chapter_id')
        if chapter_id:
            queryset = queryset.filter(chapter_id=chapter_id)

        topic_id = self.request.query_params.get('topic_id')
        if topic_id:
            queryset = queryset.filter(topic_id=topic_id)

        subtopic_id = self.request.query_params.get('subtopic_id')
        if subtopic_id:
            queryset = queryset.filter(subtopic_id=subtopic_id)

        block_type = self.request.query_params.get('block_type')
        if block_type:
            queryset = queryset.filter(block_type=block_type)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        else:
            queryset = queryset.filter(is_active=True)

        return queryset.order_by('sequence_order', 'id')

    def perform_create(self, serializer):
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])

    @action(detail=True, methods=['get'], url_path='revisions')
    def revisions(self, request, pk=None):
        block = self.get_object()
        serializer = ContentRevisionSerializer(block.revisions.all(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        block = self.get_object()
        revision_id = request.query_params.get('revision_id') or request.data.get('revision_id')
        if not revision_id:
            return Response({'detail': 'revision_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            revision = block.revisions.get(id=revision_id)
        except block.revisions.model.DoesNotExist:
            return Response({'detail': 'Revision not found.'}, status=status.HTTP_404_NOT_FOUND)

        block._revision_changed_by = request.user if request.user.is_authenticated else None
        block._revision_note = f'Restored from revision {revision.id}'
        block.content_text = revision.content_text
        block.content_rich = revision.content_rich
        block.save(update_fields=['content_text', 'content_rich', 'updated_at'])

        serializer = self.get_serializer(block)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add_tag')
    def add_tag(self, request, pk=None):
        block = self.get_object()
        tag_id = request.data.get('tag_id')
        if not tag_id:
            return Response({'detail': 'tag_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tag = Tag.objects.get(id=tag_id)
        except Tag.DoesNotExist:
            return Response({'detail': 'Tag not found.'}, status=status.HTTP_404_NOT_FOUND)

        block_school_id = (
            getattr(getattr(block.chapter, 'book', None), 'school_id', None)
            or getattr(getattr(getattr(block.topic, 'chapter', None), 'book', None), 'school_id', None)
            or getattr(getattr(getattr(getattr(block.subtopic, 'topic', None), 'chapter', None), 'book', None), 'school_id', None)
        )
        if tag.school_id and tag.school_id != block_school_id:
            return Response({'detail': 'Tag does not belong to the same school.'}, status=status.HTTP_400_BAD_REQUEST)

        if request.data.get('remove'):
            deleted, _ = ContentBlockTag.objects.filter(content_block=block, tag=tag).delete()
            return Response({'removed': bool(deleted)})

        relation, created = ContentBlockTag.objects.get_or_create(content_block=block, tag=tag)
        return Response({'created': created, 'id': relation.id}, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='semantic_search')
    def semantic_search(self, request):
        query = (request.query_params.get('q') or '').strip()
        if not query:
            return Response([])

        try:
            limit = max(1, min(int(request.query_params.get('limit', 10)), 50))
        except (TypeError, ValueError):
            limit = 10

        queryset = self.get_queryset().filter(embedding__isnull=False)
        if not queryset.exists():
            return Response([])

        query_embedding = generate_text_embedding(query)
        matches = list(
            queryset.annotate(similarity_distance=CosineDistance('embedding', query_embedding))
            .order_by('similarity_distance')[:limit]
        )

        results = []
        for block in matches:
            topic = block.topic or getattr(block.subtopic, 'topic', None)
            chapter = block.chapter or getattr(topic, 'chapter', None)
            book = getattr(chapter, 'book', None)
            results.append({
                'id': block.id,
                'block_type': block.block_type,
                'content_text': block.content_text,
                'sequence_order': block.sequence_order,
                'similarity_score': max(0.0, 1.0 - float(block.similarity_distance)),
                'chapter_title': chapter.title if chapter else '',
                'topic_title': topic.title if topic else '',
                'book_title': book.title if book else '',
                'hierarchy_path': ' > '.join(part for part in [
                    book.title if book else '',
                    chapter.title if chapter else '',
                    topic.title if topic else '',
                    getattr(block.subtopic, 'title', '') if block.subtopic_id else '',
                ] if part),
            })

        return Response(results)


class TagViewSet(ModuleAccessMixin, viewsets.ModelViewSet):
    required_module = 'lms'
    queryset = Tag.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]
    serializer_class = TagSerializer

    def get_queryset(self):
        queryset = self.queryset.select_related('subject', 'school')
        active_school_id = ensure_tenant_school_id(self.request)

        if active_school_id:
            queryset = queryset.filter(Q(school__isnull=True) | Q(school_id=active_school_id))
        elif self.request.headers.get('X-School-ID'):
            return queryset.none()
        elif not self.request.user.is_superuser:
            tenant_schools = ensure_tenant_schools(self.request)
            if not tenant_schools:
                return queryset.filter(school__isnull=True)
            queryset = queryset.filter(Q(school__isnull=True) | Q(school_id__in=tenant_schools))

        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        tag_type = self.request.query_params.get('tag_type')
        if tag_type:
            queryset = queryset.filter(tag_type=tag_type)

        return queryset

    def perform_create(self, serializer):
        school_id = self.request.data.get('school') or self.request.data.get('school_id')
        if school_id:
            serializer.save(school_id=school_id)
            return

        active_school_id = ensure_tenant_school_id(self.request)
        serializer.save(school_id=active_school_id)


# ---------------------------------------------------------------------------
# AI Lesson Plan Generation
# ---------------------------------------------------------------------------

@api_view(['POST'])
@perm_classes([IsAuthenticated])
def generate_lesson_plan_ai(request):
    """
    Generate lesson plan content from selected topics using AI.

    POST /api/lms/generate-lesson-plan/
    Body: {
        "chapter_ids": [7, 8],
        "topic_ids": [1, 2, 3],
        "subtopic_ids": [10, 11],
        "lesson_date": "2026-03-15",
        "duration_minutes": 45
    }
    """
    from .ai_generator import generate_lesson_plan

    chapter_ids = list(request.data.get('chapter_ids') or [])
    topic_ids = list(request.data.get('topic_ids') or [])
    subtopic_ids = list(request.data.get('subtopic_ids') or [])
    lesson_date = request.data.get('lesson_date', '')
    duration_minutes = request.data.get('duration_minutes', 45)

    if not chapter_ids and not topic_ids and not subtopic_ids:
        return Response(
            {'error': 'Provide chapter_ids and/or topic_ids and/or subtopic_ids.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    chapter_qs = Chapter.objects.filter(id__in=[int(x) for x in chapter_ids if x is not None]).select_related(
        'book', 'book__class_obj', 'book__subject', 'book__school',
    ) if chapter_ids else Chapter.objects.none()

    st_qs = SubTopic.objects.filter(id__in=subtopic_ids).select_related(
        'topic', 'topic__chapter', 'topic__chapter__book', 'topic__chapter__book__class_obj',
        'topic__chapter__book__subject', 'topic__chapter__book__school',
    )
    topic_id_set = {int(x) for x in topic_ids if x is not None}
    if chapter_ids:
        chapter_topic_ids = Topic.objects.filter(
            chapter_id__in=[int(x) for x in chapter_ids if x is not None]
        ).values_list('id', flat=True)
        topic_id_set.update(int(tid) for tid in chapter_topic_ids)
    for st in st_qs:
        topic_id_set.add(st.topic_id)

    topics = Topic.objects.filter(id__in=list(topic_id_set)).select_related(
        'chapter', 'chapter__book', 'chapter__book__class_obj',
        'chapter__book__subject', 'chapter__book__school',
    )
    chapter_titles = [ch.title for ch in chapter_qs]

    if topics.exists():
        first_topic = topics.first()
        book = first_topic.chapter.book
    elif chapter_qs.exists():
        first_chapter = chapter_qs.first()
        book = first_chapter.book
    else:
        return Response(
            {'error': 'No valid curriculum found from selected chapter/topic/sub-topic IDs.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    ai_job = create_ai_job(
        job_type='generate_lesson',
        triggered_by=request.user,
        school=book.school,
        input_data={
            'chapter_ids': chapter_ids,
            'topic_ids': topic_ids,
            'subtopic_ids': subtopic_ids,
            'lesson_date': lesson_date,
            'duration_minutes': duration_minutes,
        },
        model_used=getattr(settings, 'GROQ_MODEL', 'unknown'),
    )

    try:
        result = generate_lesson_plan(
            school=book.school,
            class_obj=book.class_obj,
            subject=book.subject,
            book=book,
            topics=topics,
            lesson_date=lesson_date,
            duration_minutes=duration_minutes,
            subtopics=st_qs if subtopic_ids else None,
            chapter_titles=chapter_titles,
        )
        complete_ai_job(ai_job, output_data=result)
        result['ai_job_id'] = ai_job.id
        return Response(result)
    except Exception as exc:
        fail_ai_job(ai_job, error_message=exc)
        return Response({'error': str(exc), 'ai_job_id': ai_job.id}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@perm_classes([IsAuthenticated])
def generate_exam_questions_ai(request):
    """
    Phase 6 — Generate exam questions from exercise topics using AI.

    POST /api/lms/generate-exam-questions/
    Body: {
        "book_id": 5,
        "content_kind": "exercise",   # default
        "page_start": 1,              # optional
        "page_end": 50                # optional
    }
    """
    book_id = request.data.get('book_id')
    if not book_id:
        return Response({'error': 'book_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        book = Book.objects.select_related('school', 'class_obj', 'subject').get(
            id=book_id, school_id=request.META.get('HTTP_X_SCHOOL_ID'),
        )
    except Book.DoesNotExist:
        return Response({'error': 'Book not found.'}, status=status.HTTP_404_NOT_FOUND)

    content_kind = request.data.get('content_kind', 'exercise')
    page_start = request.data.get('page_start')
    page_end   = request.data.get('page_end')

    topic_dicts = retrieve_topics_for_ai(
        book,
        content_kind=content_kind,
        page_start=page_start,
        page_end=page_end,
    )

    if not topic_dicts:
        return Response(
            {'error': 'No matching topics found for the given filters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Language instruction for RTL books
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
        return Response(
            {'error': 'AI generation is not configured. GROQ_API_KEY is missing.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

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
        # Strip markdown fences
        if '```json' in result_text:
            result_text = result_text.split('```json')[1].split('```')[0]
        elif '```' in result_text:
            result_text = result_text.split('```')[1].split('```')[0]
        result = json.loads(result_text.strip())
        return Response({'success': True, **result})
    except json.JSONDecodeError as exc:
        logger.error('Failed to parse exam AI response: %s', exc)
        return Response(
            {'error': 'Failed to parse AI response. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    except Exception as exc:
        logger.error('Exam AI generation failed: %s', exc)
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# Lesson Plans
# ---------------------------------------------------------------------------

class LessonPlanViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing lesson plans.

    - Admins/Principals have full CRUD access.
    - Teachers can create and edit their own lesson plans.
    - Other authenticated users have read-only access.

    Query params:
        class_id   - filter by class
        subject_id - filter by subject
        teacher_id - filter by teacher
        status     - filter by status (DRAFT, PUBLISHED)
    """
    required_module = 'lms'
    queryset = LessonPlan.objects.all()
    permission_classes = [IsAuthenticated, CanEditCurriculum, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return LessonPlanCreateSerializer
        return LessonPlanReadSerializer

    def get_queryset(self):
        from academic_sessions.utils import annotate_session_class_display

        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments', 'planned_topics', 'planned_subtopics')
        queryset = annotate_session_class_display(queryset)

        queryset = _apply_teacher_dual_scope(queryset, self.request)

        # Filter by class
        scope = resolve_class_scope(self.request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return queryset.none()

        class_id = scope['class_obj_id']
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        # Filter by teacher
        teacher_id = self.request.query_params.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)

        # Filter by status
        plan_status = self.request.query_params.get('status')
        if plan_status:
            queryset = queryset.filter(status=plan_status)

        # Filter by academic year
        academic_year_id = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        return queryset

    def perform_create(self, serializer):
        """
        Auto-resolve academic year if not provided.
        Teachers creating their own plans: the teacher FK must match
        their StaffMember profile (enforced at serializer/frontend level).
        """
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            school_id = (
                ensure_tenant_school_id(self.request)
                or self.request.user.school_id
            )
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        super().perform_create(serializer)

        # If academic year was resolved, update the saved instance
        if academic_year and not serializer.validated_data.get('academic_year'):
            instance = serializer.instance
            instance.academic_year = academic_year
            instance.save(update_fields=['academic_year'])

    @action(detail=False, methods=['get'], url_path='my_classes')
    def my_classes(self, request):
        """
        Classes available for lesson planning (role-aware).

        Unlike attendance/records/my_classes (class-teacher only), this includes
        classes where the teacher is either the class teacher OR teaches a subject
        there — teachers plan lessons for every class/subject they teach, not just
        the class they're the class teacher of.

        GET /api/lms/lesson-plans/my_classes/
        """
        from students.models import Class
        from academic_sessions.utils import get_session_class_label_map, resolve_current_academic_year_id

        school_id = ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'detail': 'No school context.'}, status=status.HTTP_400_BAD_REQUEST)

        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            classes = Class.objects.filter(school_id=school_id, is_active=True)
        elif role == 'TEACHER':
            scope = get_teacher_combined_scope(request, school_id=school_id)
            classes = Class.objects.filter(id__in=scope['all_class_ids'], is_active=True)
        else:
            classes = Class.objects.none()

        classes = list(classes.order_by('grade_level', 'section', 'name'))
        academic_year_id = request.query_params.get('academic_year') or resolve_current_academic_year_id(school_id)
        label_map = get_session_class_label_map(school_id, academic_year_id, [c.id for c in classes])

        data = []
        for c in classes:
            session_label = label_map.get(c.id)
            data.append({
                'id': c.id,
                'name': session_label['name'] if session_label else c.name,
                'section': session_label['section'] if session_label else c.section,
                'grade_level': c.grade_level,
            })
        return Response(data)

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        """
        Get lesson plans filtered by class_id query param.

        GET /api/lms/lesson-plans/by_class/?class_id=5
        """
        scope = resolve_class_scope(request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return Response(
                {'error': scope['error']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        class_id = scope['class_obj_id']
        if not class_id:
            return Response(
                {'error': 'class_id query parameter is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = self.get_queryset().filter(class_obj_id=class_id)
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='bulk_create')
    def bulk_create(self, request):
        """
        Create many lesson plans for teaching days in [date_from, date_to].

        Excludes school OFF days (academic calendar + Sundays) via
        academic_sessions.calendar_rules.is_off_day_for_date.
        Optionally excludes Saturdays when skip_saturday is true.

        POST /api/lms/lesson-plans/bulk_create/
        """
        bulk_serializer = LessonPlanBulkCreateSerializer(
            data=request.data,
            context={'request': request},
        )
        bulk_serializer.is_valid(raise_exception=True)
        vd = bulk_serializer.validated_data

        school_id = vd['school']
        class_obj_id = vd['class_obj']
        subject_id = vd['subject']

        teaching_dates = []
        skipped_off_days = []
        cursor = vd['date_from']
        end_d = vd['date_to']
        while cursor <= end_d:
            if is_off_day_for_date(school_id, cursor, class_id=class_obj_id):
                skipped_off_days.append({
                    'date': cursor.isoformat(),
                    'reason': 'off_day',
                })
                cursor += timedelta(days=1)
                continue
            if vd['skip_saturday'] and cursor.weekday() == 5:
                skipped_off_days.append({
                    'date': cursor.isoformat(),
                    'reason': 'saturday',
                })
                cursor += timedelta(days=1)
                continue
            teaching_dates.append(cursor)
            cursor += timedelta(days=1)

        if vd['on_conflict'] == 'error' and teaching_dates:
            conflicts = LessonPlan.objects.filter(
                school_id=school_id,
                class_obj_id=class_obj_id,
                subject_id=subject_id,
                lesson_date__in=teaching_dates,
                is_active=True,
            ).values_list('lesson_date', flat=True)
            if conflicts:
                conflict_list = sorted({d.isoformat() for d in conflicts})
                return Response(
                    {
                        'error': (
                            'One or more dates already have a lesson plan for '
                            'this class and subject.'
                        ),
                        'conflict_dates': conflict_list,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        title_template = (vd.get('title_template') or '').strip()
        planned_topic_ids = vd.get('planned_topic_ids') or []
        planned_subtopic_ids = vd.get('planned_subtopic_ids') or []
        skipped_dates = []
        created_ids = []

        with transaction.atomic():
            for d in teaching_dates:
                if vd['on_conflict'] == 'skip':
                    exists = LessonPlan.objects.filter(
                        school_id=school_id,
                        class_obj_id=class_obj_id,
                        subject_id=subject_id,
                        lesson_date=d,
                        is_active=True,
                    ).exists()
                    if exists:
                        skipped_dates.append(d.isoformat())
                        continue

                if title_template:
                    title = title_template.replace('{{date}}', d.isoformat())
                else:
                    title = f'Lesson – {d.isoformat()}'
                title = title[:200]

                payload = {
                    'school': school_id,
                    'academic_year': vd.get('academic_year'),
                    'class_obj': class_obj_id,
                    'subject': subject_id,
                    'teacher': vd['teacher'],
                    'title': title,
                    'description': vd.get('description', ''),
                    'objectives': vd.get('objectives', ''),
                    'lesson_date': d.isoformat(),
                    'duration_minutes': vd['duration_minutes'],
                    'materials_needed': vd.get('materials_needed', ''),
                    'teaching_methods': vd.get('teaching_methods', ''),
                    'content_mode': vd['content_mode'],
                    'ai_generated': vd['ai_generated'],
                    'planned_topic_ids': planned_topic_ids,
                    'planned_subtopic_ids': planned_subtopic_ids,
                    'status': 'DRAFT',
                    'is_active': True,
                }
                create_serializer = LessonPlanCreateSerializer(
                    data=payload,
                    context={'request': request},
                )
                create_serializer.is_valid(raise_exception=True)
                self.perform_create(create_serializer)
                created_ids.append(create_serializer.instance.pk)

        created_qs = (
            LessonPlan.objects.filter(id__in=created_ids)
            .select_related(
                'school', 'academic_year', 'class_obj', 'subject', 'teacher',
            )
            .prefetch_related('attachments', 'planned_topics', 'planned_subtopics')
            .order_by('lesson_date')
        )
        out = LessonPlanReadSerializer(created_qs, many=True)
        http_status = (
            status.HTTP_201_CREATED if created_ids else status.HTTP_200_OK
        )
        return Response(
            {
                'created': out.data,
                'created_count': len(created_ids),
                'skipped_dates': skipped_dates,
                'skipped_off_days': skipped_off_days,
            },
            status=http_status,
        )

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """
        Publish a draft lesson plan.
        POST /api/lms/lesson-plans/{id}/publish/
        """
        plan = self.get_object()

        if plan.status == LessonPlan.Status.PUBLISHED:
            return Response(
                {'error': 'Lesson plan is already published.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        plan.status = LessonPlan.Status.PUBLISHED
        plan.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Lesson plan {plan.id} '{plan.title}' published by "
            f"{request.user.email}"
        )

        # Notify students in-app
        try:
            from notifications.triggers import trigger_lesson_plan_published
            trigger_lesson_plan_published(plan)
        except Exception as e:
            logger.warning(f"Could not send lesson plan notification: {e}")

        serializer = LessonPlanReadSerializer(plan)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        """
        Delete many lesson plans in a single request (avoids one HTTP
        round-trip per plan, which is what made bulk deletes slow before).

        POST /api/lms/lesson-plans/bulk_delete/
        Body: {"ids": [1, 2, 3]}
        """
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {'error': 'ids must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queryset = self.get_queryset().filter(id__in=ids)
        # queryset.delete()'s own count includes cascaded rows (attachments, M2M
        # through-rows, etc.), so count matching plans up front instead.
        deleted_count = queryset.count()
        queryset.delete()

        logger.info(
            f"Bulk deleted {deleted_count} lesson plan(s) (requested {len(ids)}) "
            f"by {request.user.email}"
        )

        return Response({'requested_count': len(ids), 'deleted_count': deleted_count})

    @action(detail=False, methods=['post'], url_path='bulk_publish')
    def bulk_publish(self, request):
        """
        Publish many draft lesson plans in a single request. Plans that are
        already published (or outside the caller's scope) are silently
        skipped rather than treated as failures.

        POST /api/lms/lesson-plans/bulk_publish/
        Body: {"ids": [1, 2, 3]}
        """
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {'error': 'ids must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        plans = list(self.get_queryset().filter(id__in=ids, status=LessonPlan.Status.DRAFT))
        published_ids = [plan.id for plan in plans]

        LessonPlan.objects.filter(id__in=published_ids).update(status=LessonPlan.Status.PUBLISHED)

        logger.info(
            f"Bulk published {len(published_ids)} lesson plan(s) (requested {len(ids)}) "
            f"by {request.user.email}"
        )

        from notifications.triggers import trigger_lesson_plan_published
        for plan in plans:
            plan.status = LessonPlan.Status.PUBLISHED
            try:
                trigger_lesson_plan_published(plan)
            except Exception as e:
                logger.warning(f"Could not send lesson plan notification for {plan.id}: {e}")

        return Response({'requested_count': len(ids), 'published_count': len(published_ids)})

    @action(detail=True, methods=['post'], url_path='link_objectives')
    def link_objectives(self, request, pk=None):
        plan = self.get_object()
        objective_ids = request.data.get('objective_ids') or []
        if not isinstance(objective_ids, list) or not objective_ids:
            return Response({'error': 'objective_ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)

        objectives = list(LearningObjective.objects.filter(id__in=objective_ids, is_active=True).select_related('topic'))
        if len(objectives) != len(set(int(objective_id) for objective_id in objective_ids)):
            return Response({'error': 'One or more objectives were not found.'}, status=status.HTTP_400_BAD_REQUEST)

        planned_topic_ids = set(plan.planned_topics.values_list('id', flat=True))
        invalid_ids = [objective.id for objective in objectives if objective.topic_id not in planned_topic_ids]
        if invalid_ids:
            return Response(
                {'error': 'Objectives must belong to the lesson plan topics.', 'invalid_objective_ids': invalid_ids},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created = 0
        for objective in objectives:
            _, was_created = LessonPlanObjective.objects.get_or_create(lesson_plan=plan, objective=objective)
            if was_created:
                created += 1

        serializer = LessonPlanReadSerializer(plan)
        return Response({'linked_count': created, 'lesson_plan': serializer.data})


class AssignmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing assignments.

    - Admins/Principals have full CRUD access.
    - Teachers can create and edit their own assignments.
    - Other authenticated users have read-only access.
    - `publish` action changes status to PUBLISHED.
    - `close` action changes status to CLOSED.

    Query params:
        class_id   - filter by class
        subject_id - filter by subject
        teacher_id - filter by teacher
        status     - filter by status (DRAFT, PUBLISHED, CLOSED)
    """
    required_module = 'lms'
    queryset = Assignment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AssignmentCreateSerializer
        return AssignmentReadSerializer

    def get_queryset(self):
        from academic_sessions.utils import annotate_session_class_display

        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments').annotate(
            submission_count=Count('submissions'),
        ).order_by('-due_date', '-id')
        queryset = annotate_session_class_display(queryset)

        queryset = _apply_teacher_dual_scope(queryset, self.request)

        # Filter by class
        scope = resolve_class_scope(self.request, class_param_names=('class_id', 'class_obj'))
        if scope['invalid']:
            return queryset.none()

        class_id = scope['class_obj_id']
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)

        # Filter by teacher
        teacher_id = self.request.query_params.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)

        # Filter by status
        assignment_status = self.request.query_params.get('status')
        if assignment_status:
            queryset = queryset.filter(status=assignment_status)

        # Filter by academic year
        academic_year_id = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        return queryset

    def perform_create(self, serializer):
        """Auto-resolve academic year if not provided."""
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            school_id = (
                ensure_tenant_school_id(self.request)
                or self.request.user.school_id
            )
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        super().perform_create(serializer)

        if academic_year and not serializer.validated_data.get('academic_year'):
            instance = serializer.instance
            instance.academic_year = academic_year
            instance.save(update_fields=['academic_year'])

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """
        Publish a draft assignment so students can see and submit to it.

        POST /api/lms/assignments/{id}/publish/
        """
        assignment = self.get_object()

        if assignment.status == Assignment.Status.PUBLISHED:
            return Response(
                {'error': 'Assignment is already published.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if assignment.status == Assignment.Status.CLOSED:
            return Response(
                {'error': 'Cannot publish a closed assignment.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.status = Assignment.Status.PUBLISHED
        assignment.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Assignment {assignment.id} '{assignment.title}' published by "
            f"{request.user.email}"
        )

        serializer = AssignmentReadSerializer(assignment)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """
        Close an assignment so no more submissions are accepted.

        POST /api/lms/assignments/{id}/close/
        """
        assignment = self.get_object()

        if assignment.status == Assignment.Status.CLOSED:
            return Response(
                {'error': 'Assignment is already closed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if assignment.status == Assignment.Status.DRAFT:
            return Response(
                {'error': 'Cannot close a draft assignment. Publish it first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignment.status = Assignment.Status.CLOSED
        assignment.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Assignment {assignment.id} '{assignment.title}' closed by "
            f"{request.user.email}"
        )

        serializer = AssignmentReadSerializer(assignment)
        return Response(serializer.data)


class AssignmentSubmissionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for assignment submissions.

    - Students can create submissions for published assignments in their class.
    - Teachers/admins can list, view, and grade submissions.
    - `grade` action sets marks, feedback, and changes status to GRADED.

    Supports nested access:
        GET  /api/lms/assignments/{assignment_id}/submissions/
        POST /api/lms/assignments/{assignment_id}/submissions/

    And flat access:
        GET  /api/lms/submissions/
        GET  /api/lms/submissions/{id}/
    """
    required_module = 'lms'
    queryset = AssignmentSubmission.objects.all()
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create',):
            return AssignmentSubmissionCreateSerializer
        return AssignmentSubmissionReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'assignment', 'student', 'school', 'graded_by',
        )

        queryset = _apply_teacher_dual_scope(
            queryset,
            self.request,
            class_field='assignment__class_obj_id',
            subject_field='assignment__subject_id',
        )

        # Nested route: filter by assignment_id from URL
        assignment_id = self.kwargs.get('assignment_id')
        if assignment_id:
            queryset = queryset.filter(assignment_id=assignment_id)

        # Filter by assignment via query param
        assignment_param = self.request.query_params.get('assignment_id')
        if assignment_param:
            queryset = queryset.filter(assignment_id=assignment_param)

        # Filter by student
        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        # Filter by status
        submission_status = self.request.query_params.get('status')
        if submission_status:
            queryset = queryset.filter(status=submission_status)

        return queryset

    def perform_create(self, serializer):
        """
        When creating via the nested route, auto-populate the assignment FK.
        Also set the school from the assignment if not explicitly provided.
        """
        assignment_id = self.kwargs.get('assignment_id')
        extra_kwargs = {}

        if assignment_id and not serializer.validated_data.get('assignment'):
            from .models import Assignment
            try:
                assignment = Assignment.objects.get(id=assignment_id)
                extra_kwargs['assignment'] = assignment
                if not serializer.validated_data.get('school'):
                    extra_kwargs['school_id'] = assignment.school_id
            except Assignment.DoesNotExist:
                pass

        # Determine if submission is late
        assignment = serializer.validated_data.get('assignment') or extra_kwargs.get('assignment')
        if assignment and timezone.now() > assignment.due_date:
            extra_kwargs['status'] = AssignmentSubmission.Status.LATE

        if extra_kwargs:
            serializer.save(**extra_kwargs)
        else:
            super().perform_create(serializer)

    @action(detail=True, methods=['patch'])
    def grade(self, request, pk=None):
        """
        Grade a submission: set marks_obtained, feedback, graded_by, graded_at.

        PATCH /api/lms/submissions/{id}/grade/
        Body: { "marks_obtained": 85.5, "feedback": "Great work!" }
        """
        submission = self.get_object()

        marks_obtained = request.data.get('marks_obtained')
        feedback = request.data.get('feedback', '')

        if marks_obtained is None:
            return Response(
                {'error': 'marks_obtained is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate marks against assignment total
        if submission.assignment.total_marks is not None:
            try:
                marks_val = float(marks_obtained)
                if marks_val < 0:
                    return Response(
                        {'error': 'marks_obtained cannot be negative.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if marks_val > float(submission.assignment.total_marks):
                    return Response(
                        {'error': f'marks_obtained cannot exceed total marks ({submission.assignment.total_marks}).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            except (ValueError, TypeError):
                return Response(
                    {'error': 'marks_obtained must be a valid number.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Resolve graded_by from the request user's staff profile
        graded_by = None
        if hasattr(request.user, 'staff_profile'):
            graded_by = request.user.staff_profile

        submission.marks_obtained = marks_obtained
        submission.feedback = feedback
        submission.graded_by = graded_by
        submission.graded_at = timezone.now()
        submission.status = AssignmentSubmission.Status.GRADED
        submission.save(update_fields=[
            'marks_obtained', 'feedback', 'graded_by',
            'graded_at', 'status',
        ])

        logger.info(
            f"Submission {submission.id} graded: {marks_obtained} marks by "
            f"{request.user.email}"
        )

        serializer = AssignmentSubmissionReadSerializer(submission)
        return Response(serializer.data)
