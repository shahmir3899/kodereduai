"""
Academics module views: Subjects, Class Assignments, Timetable, AI features.
"""

import logging
from datetime import datetime

from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.permissions import HasSchoolAccess, IsSchoolAdminOrReadOnly, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import Subject, ClassSubject, TimetableSlot, TimetableEntry
from .serializers import (
    SubjectSerializer, SubjectCreateSerializer,
    ClassSubjectSerializer, ClassSubjectCreateSerializer,
    TimetableSlotSerializer, TimetableSlotCreateSerializer,
    TimetableEntrySerializer, TimetableEntryCreateSerializer,
    AutoGenerateRequestSerializer, SubstituteRequestSerializer,
    AcademicsAIChatMessageSerializer, AcademicsAIChatInputSerializer,
)

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    """Resolve school_id from header -> params -> user fallback.

    If X-School-ID header is explicitly set but the user doesn't have access
    to that school, return None (don't fall back to user's default school).
    This prevents data leakage from fallback schools.
    """
    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid

    # If X-School-ID header was explicitly sent but didn't resolve
    # (user lacks access), don't fall back — return None for isolation.
    if request.headers.get('X-School-ID'):
        return None

    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)
    if request.user.school_id:
        return request.user.school_id
    return None


def _is_school_header_rejected(request):
    """Return True if X-School-ID was sent but user lacks access to it."""
    header = request.headers.get('X-School-ID')
    if not header:
        return False
    return ensure_tenant_school_id(request) is None


# ── Subject ViewSet ──────────────────────────────────────────────────────────

class SubjectViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for subjects."""
    required_module = 'academics'
    queryset = Subject.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return SubjectCreateSerializer
        return SubjectSerializer

    def get_queryset(self):
        queryset = Subject.objects.select_related('school')
        if _is_school_header_rejected(self.request):
            return queryset.none()
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Default to active only
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        else:
            queryset = queryset.filter(is_active=True)

        is_elective = self.request.query_params.get('is_elective')
        if is_elective is not None:
            queryset = queryset.filter(is_elective=is_elective.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(code__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['get'])
    def gap_analysis(self, request):
        """AI: Analyze curriculum gaps across all classes."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)
        from .ai_engine import CurriculumGapAnalyzer
        analyzer = CurriculumGapAnalyzer(school_id)
        return Response(analyzer.analyze())


# ── ClassSubject ViewSet ─────────────────────────────────────────────────────

class ClassSubjectViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for class-subject-teacher assignments."""
    required_module = 'academics'
    queryset = ClassSubject.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ClassSubjectCreateSerializer
        return ClassSubjectSerializer

    def get_queryset(self):
        queryset = ClassSubject.objects.select_related(
            'school', 'class_obj', 'subject', 'teacher', 'academic_year',
        )
        if _is_school_header_rejected(self.request):
            return queryset.none()
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Default to active only
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        else:
            queryset = queryset.filter(is_active=True)

        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            queryset = queryset.filter(class_obj_id=class_obj)

        subject = self.request.query_params.get('subject')
        if subject:
            queryset = queryset.filter(subject_id=subject)

        teacher = self.request.query_params.get('teacher')
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})

        # Auto-resolve academic year if not provided
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            sid = ensure_tenant_school_id(self.request) or self.request.user.school_id
            academic_year = AcademicYear.objects.filter(
                school_id=sid, is_current=True, is_active=True,
            ).first()

        serializer.save(school_id=school_id, academic_year=academic_year)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        """Get all subjects assigned to a specific class."""
        class_id = request.query_params.get('class_id')
        if not class_id:
            return Response({'detail': 'class_id query param required.'}, status=400)
        qs = self.get_queryset().filter(class_obj_id=class_id)
        serializer = ClassSubjectSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def workload_analysis(self, request):
        """AI: Analyze teacher workload distribution."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)
        from .ai_engine import WorkloadAnalyzer
        analyzer = WorkloadAnalyzer(school_id)
        return Response(analyzer.analyze())


# ── TimetableSlot ViewSet ────────────────────────────────────────────────────

class TimetableSlotViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for timetable time slots (school-wide period structure)."""
    required_module = 'academics'
    queryset = TimetableSlot.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TimetableSlotCreateSerializer
        return TimetableSlotSerializer

    def get_queryset(self):
        queryset = TimetableSlot.objects.select_related('school')
        if _is_school_header_rejected(self.request):
            return queryset.none()
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        else:
            queryset = queryset.filter(is_active=True)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


# ── TimetableEntry ViewSet ───────────────────────────────────────────────────

class TimetableEntryViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for timetable entries with grid view, bulk save, and AI features."""
    required_module = 'academics'
    queryset = TimetableEntry.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['school_id'] = _resolve_school_id(self.request)
        return context

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TimetableEntryCreateSerializer
        return TimetableEntrySerializer

    def get_queryset(self):
        queryset = TimetableEntry.objects.select_related(
            'school', 'class_obj', 'slot', 'subject', 'teacher',
            'academic_year',
        )
        if _is_school_header_rejected(self.request):
            return queryset.none()
        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            queryset = queryset.filter(class_obj_id=class_obj)

        day = self.request.query_params.get('day')
        if day:
            queryset = queryset.filter(day=day.upper())

        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            queryset = queryset.filter(academic_year_id=academic_year)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})

        # Auto-resolve academic year if not provided
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            sid = ensure_tenant_school_id(self.request) or self.request.user.school_id
            academic_year = AcademicYear.objects.filter(
                school_id=sid, is_current=True, is_active=True,
            ).first()

        serializer.save(school_id=school_id, academic_year=academic_year)

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        """Get full timetable grid for a class."""
        class_id = request.query_params.get('class_id')
        if not class_id:
            return Response({'detail': 'class_id query param required.'}, status=400)
        entries = self.get_queryset().filter(class_obj_id=class_id)
        serializer = TimetableEntrySerializer(entries, many=True)

        grid = {}
        for entry in serializer.data:
            day = entry['day']
            if day not in grid:
                grid[day] = []
            grid[day].append(entry)

        return Response({
            'class_id': int(class_id),
            'grid': grid,
            'entries': serializer.data,
        })

    @action(detail=False, methods=['post'])
    def bulk_save(self, request):
        """
        Bulk save timetable entries for a class + day.
        Expects: { class_obj: id, day: 'MON', entries: [ {slot, subject, teacher, room}, ... ] }
        """
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        class_id = request.data.get('class_obj')
        day = request.data.get('day')
        entries_data = request.data.get('entries', [])

        if not class_id or not day:
            return Response({'detail': 'class_obj and day are required.'}, status=400)

        # Auto-resolve academic year
        academic_year_id = request.data.get('academic_year')
        if not academic_year_id:
            from academic_sessions.models import AcademicYear
            sid = ensure_tenant_school_id(request) or request.user.school_id
            ay = AcademicYear.objects.filter(
                school_id=sid, is_current=True, is_active=True,
            ).first()
            academic_year_id = ay.id if ay else None

        # Validate teacher conflicts
        errors = []
        for idx, entry in enumerate(entries_data):
            teacher_id = entry.get('teacher')
            slot_id = entry.get('slot')
            if teacher_id and slot_id:
                conflict = TimetableEntry.objects.filter(
                    school_id=school_id,
                    teacher_id=teacher_id,
                    day=day.upper(),
                    slot_id=slot_id,
                ).exclude(class_obj_id=class_id)
                if conflict.exists():
                    c = conflict.first()
                    errors.append(
                        f'Row {idx + 1}: Teacher is already assigned to '
                        f'{c.class_obj.name} at {c.slot.name}.'
                    )

        if errors:
            return Response({'detail': errors}, status=400)

        # Delete existing entries for this class+day, then create new
        TimetableEntry.objects.filter(
            school_id=school_id,
            class_obj_id=class_id,
            day=day.upper(),
        ).delete()

        created = 0
        for entry in entries_data:
            slot_id = entry.get('slot')
            subject_id = entry.get('subject') or None
            teacher_id = entry.get('teacher') or None
            room = entry.get('room', '')
            if slot_id:
                TimetableEntry.objects.create(
                    school_id=school_id,
                    class_obj_id=class_id,
                    academic_year_id=academic_year_id,
                    day=day.upper(),
                    slot_id=slot_id,
                    subject_id=subject_id,
                    teacher_id=teacher_id,
                    room=room,
                )
                created += 1

        return Response({
            'created': created,
            'message': f'{created} timetable entries saved for {day}.',
        })

    @action(detail=False, methods=['get'])
    def teacher_conflicts(self, request):
        """Check if a teacher has conflicts at a given day+slot."""
        school_id = _resolve_school_id(request)
        teacher_id = request.query_params.get('teacher')
        day = request.query_params.get('day')
        slot_id = request.query_params.get('slot')
        exclude_class = request.query_params.get('exclude_class')

        if not all([school_id, teacher_id, day, slot_id]):
            return Response({'detail': 'teacher, day, and slot params required.'}, status=400)

        conflicts = TimetableEntry.objects.filter(
            school_id=school_id,
            teacher_id=teacher_id,
            day=day.upper(),
            slot_id=slot_id,
        ).select_related('class_obj', 'subject')

        if exclude_class:
            conflicts = conflicts.exclude(class_obj_id=exclude_class)

        return Response({
            'has_conflict': conflicts.exists(),
            'conflicts': TimetableEntrySerializer(conflicts, many=True).data,
        })

    # ── AI Actions ───────────────────────────────────────────────────────────

    @action(detail=False, methods=['post'])
    def auto_generate(self, request):
        """AI: Auto-generate a timetable for a class using CSP algorithm."""
        serializer = AutoGenerateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        class_id = serializer.validated_data['class_id']

        from .ai_engine import TimetableGenerator
        generator = TimetableGenerator(school_id, class_id)
        result = generator.generate()

        if not result.success:
            return Response({'detail': result.error}, status=400)

        return Response({
            'grid': result.grid,
            'score': result.score,
            'warnings': result.warnings,
        })

    @action(detail=False, methods=['get'])
    def suggest_resolution(self, request):
        """AI: Suggest conflict resolution alternatives."""
        school_id = _resolve_school_id(request)
        teacher_id = request.query_params.get('teacher')
        day = request.query_params.get('day')
        slot_id = request.query_params.get('slot')
        class_id = request.query_params.get('class_id')
        subject_id = request.query_params.get('subject')

        if not all([school_id, teacher_id, day, slot_id, class_id]):
            return Response(
                {'detail': 'teacher, day, slot, and class_id params required.'},
                status=400
            )

        from .ai_engine import ConflictResolver
        resolver = ConflictResolver(school_id)
        resolution = resolver.suggest_resolution(
            int(teacher_id), day.upper(), int(slot_id), int(class_id),
            int(subject_id) if subject_id else None
        )

        return Response({
            'alternative_teachers': resolution.alternative_teachers,
            'alternative_slots': resolution.alternative_slots,
            'swap_suggestions': resolution.swap_suggestions,
        })

    @action(detail=False, methods=['get'])
    def quality_score(self, request):
        """AI: Get quality score for current timetable of a class."""
        school_id = _resolve_school_id(request)
        class_id = request.query_params.get('class_id')
        if not school_id or not class_id:
            return Response({'detail': 'class_id required.'}, status=400)

        from .ai_engine import TimetableQualityScorer
        scorer = TimetableQualityScorer(school_id, int(class_id))
        result = scorer.score()

        return Response({
            'overall_score': result.overall_score,
            'teacher_idle_gaps': result.teacher_idle_gaps,
            'subject_distribution': result.subject_distribution,
            'break_placement': result.break_placement,
            'workload_balance': result.workload_balance,
            'constraint_satisfaction': result.constraint_satisfaction,
            'details': result.details,
        })

    @action(detail=False, methods=['get'])
    def suggest_substitute(self, request):
        """AI: Suggest substitute teachers for an absent teacher."""
        school_id = _resolve_school_id(request)
        teacher_id = request.query_params.get('teacher')
        date_str = request.query_params.get('date')

        if not all([school_id, teacher_id, date_str]):
            return Response(
                {'detail': 'teacher and date params required.'},
                status=400
            )

        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'detail': 'Invalid date format. Use YYYY-MM-DD.'},
                status=400
            )

        from .ai_engine import SubstituteTeacherFinder
        finder = SubstituteTeacherFinder(school_id)
        return Response(finder.suggest(int(teacher_id), date_obj))


# ── AI Chat View ─────────────────────────────────────────────────────────────

class AcademicsAIChatView(ModuleAccessMixin, APIView):
    """AI chat assistant for academic scheduling queries."""
    required_module = 'academics'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        """Get chat history."""
        from .models import AcademicsAIChatMessage
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        messages = AcademicsAIChatMessage.objects.filter(
            school_id=school_id, user=request.user
        ).order_by('created_at')[:100]

        serializer = AcademicsAIChatMessageSerializer(messages, many=True)
        return Response(serializer.data)

    def post(self, request):
        """Send a message and get AI response."""
        from .models import AcademicsAIChatMessage
        serializer = AcademicsAIChatInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_message = serializer.validated_data['message']
        school_id = _resolve_school_id(request)

        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        # Save user message
        AcademicsAIChatMessage.objects.create(
            school_id=school_id,
            user=request.user,
            role='user',
            content=user_message,
        )

        # Get AI response
        try:
            from .ai_engine import AcademicsAIAgent
            agent = AcademicsAIAgent(school_id=school_id)
            response_text = agent.process_query(user_message)
        except Exception as e:
            logger.error(f"Academics AI agent error: {e}")
            response_text = "I'm sorry, I encountered an error processing your question. Please try again."

        # Save assistant message
        assistant_msg = AcademicsAIChatMessage.objects.create(
            school_id=school_id,
            user=request.user,
            role='assistant',
            content=response_text,
        )

        return Response({
            'response': response_text,
            'message': AcademicsAIChatMessageSerializer(assistant_msg).data,
        })

    def delete(self, request):
        """Clear chat history for the current user."""
        from .models import AcademicsAIChatMessage
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        AcademicsAIChatMessage.objects.filter(
            school_id=school_id, user=request.user
        ).delete()

        return Response({'detail': 'Chat history cleared.'})


# ── Analytics View ───────────────────────────────────────────────────────────

class AcademicsAnalyticsView(ModuleAccessMixin, APIView):
    """Predictive analytics for academics."""
    required_module = 'academics'
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        report_type = request.query_params.get('type', 'overview')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        from .analytics import AcademicsAnalytics
        analytics = AcademicsAnalytics(school_id)

        if report_type == 'subject_attendance':
            return Response(analytics.subject_attendance_by_slot(date_from, date_to))
        elif report_type == 'teacher_effectiveness':
            return Response(analytics.teacher_effectiveness(date_from, date_to))
        elif report_type == 'slot_recommendations':
            return Response(analytics.optimal_slot_recommendations())
        elif report_type == 'trends':
            months = int(request.query_params.get('months', 6))
            return Response(analytics.attendance_trends(months))
        else:
            return Response({
                'subject_attendance': analytics.subject_attendance_by_slot(date_from, date_to),
                'teacher_effectiveness': analytics.teacher_effectiveness(date_from, date_to),
                'slot_recommendations': analytics.optimal_slot_recommendations(),
                'trends': analytics.attendance_trends(),
            })
