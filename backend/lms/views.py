"""
LMS views for lesson plans, assignments, submissions, and curriculum management.
"""

import logging
import hashlib
import json
from django.conf import settings
from django.utils import timezone
from django.db import transaction
from django.db.models import Count, Q
from django.core.cache import cache
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes as perm_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle

from core.permissions import (
    IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
    get_effective_role, ADMIN_ROLES, STAFF_LEVEL_ROLES,
    get_teacher_combined_scope,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.class_scope import resolve_class_scope
from .models import Book, Chapter, Topic, LessonPlan, Assignment, AssignmentSubmission
from .content_retrieval import retrieve_topics_for_ai, build_prompt, extract_text_from_blocks
from .serializers import (
    BookReadSerializer, BookCreateSerializer,
    BookChapterOnlyReadSerializer,
    BookLessonPlanReadSerializer,
    TopicExamExercisesSerializer,
    ChapterReadSerializer, ChapterCreateSerializer,
    TopicLessonPlanSerializer,
    TopicSerializer,
    LessonPlanReadSerializer, LessonPlanCreateSerializer,
    AssignmentReadSerializer, AssignmentCreateSerializer,
    AssignmentSubmissionReadSerializer, AssignmentSubmissionCreateSerializer,
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
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

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
        ).prefetch_related('chapters__topics')

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
        Body: { "chapters": [{"title": "...", "topics": [{"title": "..."}]}] }
        """
        book = self.get_object()
        chapters = request.data.get('chapters', [])
        idempotency_key = (
            request.headers.get('X-Idempotency-Key')
            or request.data.get('idempotency_key')
            or ''
        ).strip()

        if not isinstance(chapters, list) or not chapters:
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
                return Response(existing.get('result', {}), status=status.HTTP_200_OK)

        from .toc_parser import apply_toc_structure
        with transaction.atomic():
            result = apply_toc_structure(book, chapters)

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
        result = suggest_toc_structure(str(raw_text), language=book.language)
        return Response(result)

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

        from .toc_ocr import extract_toc_payload
        extracted_payload, error = extract_toc_payload(image_bytes, language=book.language)

        if error:
            return Response(
                {'error': error},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            'text': extracted_payload.get('text', '') if extracted_payload else '',
            'lines': extracted_payload.get('lines', []) if extracted_payload else [],
            'language': book.language,
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


class ChapterViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for chapters within books."""
    required_module = 'lms'
    queryset = Chapter.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    tenant_field = 'book__school_id'

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ChapterCreateSerializer
        return ChapterReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('book').prefetch_related('topics')

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
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
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
        ).prefetch_related('lesson_plans', 'test_questions')

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
        "topic_ids": [1, 2, 3],
        "lesson_date": "2026-03-15",
        "duration_minutes": 45
    }
    """
    from .ai_generator import generate_lesson_plan

    topic_ids = request.data.get('topic_ids', [])
    lesson_date = request.data.get('lesson_date', '')
    duration_minutes = request.data.get('duration_minutes', 45)

    if not topic_ids:
        return Response(
            {'error': 'topic_ids is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    topics = Topic.objects.filter(id__in=topic_ids).select_related(
        'chapter', 'chapter__book', 'chapter__book__class_obj',
        'chapter__book__subject', 'chapter__book__school',
    )
    if not topics.exists():
        return Response(
            {'error': 'No valid topics found.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Derive context from the first topic's book
    first_topic = topics.first()
    book = first_topic.chapter.book

    result = generate_lesson_plan(
        school=book.school,
        class_obj=book.class_obj,
        subject=book.subject,
        book=book,
        topics=topics,
        lesson_date=lesson_date,
        duration_minutes=duration_minutes,
    )
    return Response(result)


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
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return LessonPlanCreateSerializer
        return LessonPlanReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments', 'planned_topics')

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
        queryset = super().get_queryset().select_related(
            'school', 'academic_year', 'class_obj', 'subject', 'teacher',
        ).prefetch_related('attachments').annotate(
            submission_count=Count('submissions'),
        ).order_by('-due_date', '-id')

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
