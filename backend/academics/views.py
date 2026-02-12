"""
Academics module views: Subjects, Class Assignments, Timetable.
"""

from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from core.permissions import HasSchoolAccess, IsSchoolAdminOrReadOnly
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import Subject, ClassSubject, TimetableSlot, TimetableEntry
from .serializers import (
    SubjectSerializer, SubjectCreateSerializer,
    ClassSubjectSerializer, ClassSubjectCreateSerializer,
    TimetableSlotSerializer, TimetableSlotCreateSerializer,
    TimetableEntrySerializer, TimetableEntryCreateSerializer,
)


def _resolve_school_id(request):
    """Resolve school_id from header -> params -> user fallback."""
    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid
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


# ── Subject ViewSet ──────────────────────────────────────────────────────────

class SubjectViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for subjects."""
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


# ── ClassSubject ViewSet ─────────────────────────────────────────────────────

class ClassSubjectViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for class-subject-teacher assignments."""
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
            'school', 'class_obj', 'subject', 'teacher',
        )
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
    def by_class(self, request):
        """Get all subjects assigned to a specific class."""
        class_id = request.query_params.get('class_id')
        if not class_id:
            return Response({'detail': 'class_id query param required.'}, status=400)
        qs = self.get_queryset().filter(class_obj_id=class_id)
        serializer = ClassSubjectSerializer(qs, many=True)
        return Response(serializer.data)


# ── TimetableSlot ViewSet ────────────────────────────────────────────────────

class TimetableSlotViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for timetable time slots (school-wide period structure)."""
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

class TimetableEntryViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """CRUD for timetable entries with grid view and bulk save."""
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
        )
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

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

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
