from calendar import monthrange
from datetime import date, timedelta

from django.db.models import Count, Q, F
from django.db import transaction
from django.utils.dateparse import parse_date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import IsSchoolAdminOrReadOnly, HasSchoolAccess

from .models import (
    AcademicYear,
    Term,
    StudentEnrollment,
    SessionClass,
    SchoolCalendarEntry,
    PromotionOperation,
    PromotionEvent,
)
from .serializers import (
    AcademicYearSerializer,
    AcademicYearCreateSerializer,
    TermSerializer,
    TermCreateSerializer,
    TermImportSerializer,
    SchoolCalendarEntrySerializer,
    SchoolCalendarEntryCreateSerializer,
    SessionClassSerializer,
    SessionClassCreateSerializer,
    SessionClassInitializeSerializer,
    StudentEnrollmentSerializer,
    StudentEnrollmentCreateSerializer,
    BulkPromoteSerializer,
    BulkReversePromotionSerializer,
    PromotionTargetApplySerializer,
    PromotionTargetPreviewSerializer,
    PromotionEventSerializer,
    PromotionHistoryQuerySerializer,
    PromotionSingleCorrectionSerializer,
    PromotionBulkCorrectionSerializer,
)
from .term_import_service import TermImportService


def _resolve_school_id(request):
    school_id = ensure_tenant_school_id(request)
    if school_id:
        return school_id
    sid = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if sid:
        return int(sid)
    if request.user.school_id:
        return request.user.school_id
    return None


class AcademicYearViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = AcademicYear.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AcademicYearCreateSerializer
        return AcademicYearSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school').annotate(
            terms_count=Count('terms', distinct=True),
            enrollment_count=Count('enrollments', distinct=True),
        ).order_by('-start_date')
        return qs

    @action(detail=True, methods=['post'])
    def set_current(self, request, pk=None):
        year = self.get_object()
        # Unset any other current year for this school first
        AcademicYear.objects.filter(
            school_id=year.school_id, is_current=True,
        ).exclude(pk=year.pk).update(is_current=False)
        year.is_current = True
        year.save()
        return Response(AcademicYearSerializer(year).data)

    @action(detail=False, methods=['get'])
    def current(self, request):
        """Return the current academic year for the active school."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        year = AcademicYear.objects.filter(
            school_id=school_id, is_current=True,
        ).select_related('school').first()
        if not year:
            return Response(
                {'detail': 'No current academic year set for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        data = AcademicYearSerializer(year).data
        # Include terms for the current year
        terms = Term.objects.filter(
            academic_year=year,
        ).order_by('order')
        from .serializers import TermSerializer
        data['terms'] = TermSerializer(terms, many=True).data
        # Find current term based on today's date
        from datetime import date
        today = date.today()
        current_term = terms.filter(
            start_date__lte=today, end_date__gte=today,
        ).first()
        data['current_term'] = TermSerializer(current_term).data if current_term else None
        return Response(data)

    @action(detail=True, methods=['get'])
    def summary(self, request, pk=None):
        year = self.get_object()
        return Response({
            'id': year.id,
            'name': year.name,
            'terms_count': year.terms.count(),
            'enrollment_count': year.enrollments.count(),
            'classes_count': year.enrollments.values('class_obj').distinct().count(),
        })


class TermViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = Term.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TermCreateSerializer
        return TermSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school', 'academic_year')
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        return qs

    @action(detail=False, methods=['post'], url_path='import-preview')
    def import_preview(self, request):
        serializer = TermImportSerializer(
            data=request.data,
            context={'school_id': _resolve_school_id(request)},
        )
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        conflict_mode = serializer.validated_data['conflict_mode']
        include_inactive = serializer.validated_data['include_inactive']

        service = TermImportService(school_id=school_id)
        preview = service.build_preview(
            source_academic_year=source_year,
            target_academic_year=target_year,
            conflict_mode=conflict_mode,
            include_inactive=include_inactive,
        )
        preview['message'] = 'Preview generated successfully.'
        return Response(preview)

    @action(detail=False, methods=['post'], url_path='import-apply')
    def import_apply(self, request):
        serializer = TermImportSerializer(
            data=request.data,
            context={'school_id': _resolve_school_id(request)},
        )
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        conflict_mode = serializer.validated_data['conflict_mode']
        include_inactive = serializer.validated_data['include_inactive']

        service = TermImportService(school_id=school_id)
        preview = service.build_preview(
            source_academic_year=source_year,
            target_academic_year=target_year,
            conflict_mode=conflict_mode,
            include_inactive=include_inactive,
        )
        if preview.get('counts', {}).get('conflict', 0) > 0:
            return Response(
                {
                    **preview,
                    'detail': 'Import preview contains conflicts. Resolve them before applying.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = service.apply_from_preview(preview)

        return Response({
            **preview,
            'applied': result,
            'message': (
                f"Terms import completed: {result['created']} created, "
                f"{result['updated']} updated, {result['skipped']} skipped."
            ),
        })


class SchoolCalendarEntryViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = SchoolCalendarEntry.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return SchoolCalendarEntryCreateSerializer
        return SchoolCalendarEntrySerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'academic_year', 'created_by', 'updated_by',
        ).prefetch_related('classes')
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)

        entry_kind = self.request.query_params.get('entry_kind')
        if entry_kind:
            qs = qs.filter(entry_kind=entry_kind)

        scope = self.request.query_params.get('scope')
        if scope:
            qs = qs.filter(scope=scope)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            bool_map = {
                '1': True,
                'true': True,
                'yes': True,
                '0': False,
                'false': False,
                'no': False,
            }
            parsed = bool_map.get(str(is_active).strip().lower())
            if parsed is not None:
                qs = qs.filter(is_active=parsed)

        class_id = self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(
                Q(scope=SchoolCalendarEntry.Scope.SCHOOL)
                | Q(scope=SchoolCalendarEntry.Scope.CLASS, classes__id=class_id)
            )

        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            qs = qs.filter(end_date__gte=date_from)
        if date_to:
            qs = qs.filter(start_date__lte=date_to)

        return qs.distinct()

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(
            school_id=school_id,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @staticmethod
    def _build_day_map(start_dt, end_dt, entries):
        by_date = {}

        normalized_entries = []
        for entry in entries:
            class_ids = [cls.id for cls in entry.classes.all()]
            normalized_entries.append({
                'id': entry.id,
                'name': entry.name,
                'description': entry.description,
                'entry_kind': entry.entry_kind,
                'off_day_type': entry.off_day_type,
                'scope': entry.scope,
                'class_ids': class_ids,
                'start_date': entry.start_date,
                'end_date': entry.end_date,
                'color': entry.color,
            })

        for entry in normalized_entries:
            current = max(entry['start_date'], start_dt)
            cutoff = min(entry['end_date'], end_dt)
            while current <= cutoff:
                by_date.setdefault(current, []).append(entry)
                current += timedelta(days=1)

        days = []
        cursor = start_dt
        while cursor <= end_dt:
            day_entries = by_date.get(cursor, [])
            off_entries = [it for it in day_entries if it['entry_kind'] == SchoolCalendarEntry.EntryKind.OFF_DAY]
            event_entries = [it for it in day_entries if it['entry_kind'] == SchoolCalendarEntry.EntryKind.EVENT]
            is_sunday = cursor.weekday() == 6

            off_types = []
            if is_sunday:
                off_types.append('SUNDAY')
            off_types.extend([
                it['off_day_type'] for it in off_entries if it['off_day_type']
            ])

            days.append({
                'date': cursor.isoformat(),
                'day': cursor.day,
                'is_sunday': is_sunday,
                'is_off_day': is_sunday or bool(off_entries),
                'off_day_types': sorted(set(off_types)),
                'events': event_entries,
                'entries': day_entries,
            })
            cursor += timedelta(days=1)

        return days

    @action(detail=False, methods=['get'], url_path='month-view')
    def month_view(self, request):
        year_raw = request.query_params.get('year')
        month_raw = request.query_params.get('month')
        if not year_raw or not month_raw:
            return Response(
                {'detail': 'year and month are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year_raw)
            month = int(month_raw)
            start_dt = date(year, month, 1)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Invalid year or month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _, days_count = monthrange(year, month)
        end_dt = date(year, month, days_count)

        entries = self.filter_queryset(
            self.get_queryset().filter(
                is_active=True,
                start_date__lte=end_dt,
                end_date__gte=start_dt,
            )
        )
        day_map = self._build_day_map(start_dt, end_dt, entries)

        return Response({
            'year': year,
            'month': month,
            'start_date': start_dt.isoformat(),
            'end_date': end_dt.isoformat(),
            'days': day_map,
        })

    @action(detail=False, methods=['get'], url_path='day-status')
    def day_status(self, request):
        date_from_raw = request.query_params.get('date_from')
        date_to_raw = request.query_params.get('date_to')
        date_from = parse_date(date_from_raw) if date_from_raw else None
        date_to = parse_date(date_to_raw) if date_to_raw else None

        if not date_from or not date_to:
            return Response(
                {'detail': 'date_from and date_to are required (YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if date_from > date_to:
            return Response(
                {'detail': 'date_from cannot be after date_to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entries = self.filter_queryset(
            self.get_queryset().filter(
                is_active=True,
                start_date__lte=date_to,
                end_date__gte=date_from,
            )
        )
        day_map = self._build_day_map(date_from, date_to, entries)
        compact = {}
        for item in day_map:
            compact[item['date']] = {
                'is_off_day': item['is_off_day'],
                'is_sunday': item['is_sunday'],
                'off_day_types': item['off_day_types'],
                'events_count': len(item['events']),
            }

        return Response({
            'date_from': date_from.isoformat(),
            'date_to': date_to.isoformat(),
            'days': compact,
        })


class SessionClassViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = SessionClass.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return SessionClassCreateSerializer
        return SessionClassSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school', 'academic_year', 'class_obj').annotate(
            # Count only enrollments directly linked to this session class
            enrollment_count=Count(
                'enrollments',
                filter=Q(
                    enrollments__academic_year_id=F('academic_year_id'),
                    enrollments__school_id=F('school_id'),
                    enrollments__is_active=True,
                ),
                distinct=True,
            ),
            # Count enrollments that belong to the master class but have no session_class assigned
            # (orphan rows from promotions done before session_class tracking was added)
            unassigned_count=Count(
                'class_obj__enrollments',
                filter=Q(
                    class_obj__enrollments__academic_year_id=F('academic_year_id'),
                    class_obj__enrollments__school_id=F('school_id'),
                    class_obj__enrollments__is_active=True,
                    class_obj__enrollments__session_class__isnull=True,
                ),
                distinct=True,
            ),
        )
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            qs = qs.filter(class_obj_id=class_obj)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            bool_map = {'1': True, 'true': True, 'yes': True, '0': False, 'false': False, 'no': False}
            parsed = bool_map.get(str(is_active).strip().lower())
            if parsed is not None:
                qs = qs.filter(is_active=parsed)
        return qs

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        serializer.save(school_id=school_id)

    @action(detail=True, methods=['post'], url_path='assign-unassigned')
    def assign_unassigned(self, request, pk=None):
        target = self.get_object()
        if not target.class_obj_id:
            return Response(
                {'detail': 'Session class is not linked to a master class.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            qs = StudentEnrollment.objects.filter(
                school_id=target.school_id,
                academic_year_id=target.academic_year_id,
                class_obj_id=target.class_obj_id,
                is_active=True,
                session_class__isnull=True,
            )
            updated_count = qs.update(session_class=target)

        return Response({
            'updated_count': updated_count,
            'session_class': {
                'id': target.id,
                'label': target.label,
                'academic_year_id': target.academic_year_id,
                'class_obj_id': target.class_obj_id,
            },
        })

    @action(detail=False, methods=['post'], url_path='initialize')
    def initialize(self, request):
        serializer = SessionClassInitializeSerializer(
            data=request.data,
            context={'school_id': _resolve_school_id(request)},
        )
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        target_year = serializer.validated_data['academic_year']
        source_year = serializer.validated_data.get('source_academic_year')
        include_inactive = serializer.validated_data['include_inactive_master_classes']

        from students.models import Class

        if source_year:
            source_classes = Class.objects.filter(
                school_id=school_id,
                enrollments__academic_year=source_year,
                enrollments__school_id=school_id,
            ).distinct()
        else:
            source_classes = Class.objects.filter(school_id=school_id)

        if not include_inactive:
            source_classes = source_classes.filter(is_active=True)

        source_classes = source_classes.order_by('grade_level', 'section', 'name', 'id')

        created = 0
        reactivated = 0
        unchanged = 0

        with transaction.atomic():
            for cls in source_classes:
                obj, was_created = SessionClass.objects.get_or_create(
                    school_id=school_id,
                    academic_year=target_year,
                    class_obj=cls,
                    defaults={
                        'display_name': cls.name,
                        'section': cls.section or '',
                        'grade_level': cls.grade_level,
                        'is_active': True,
                    },
                )
                if was_created:
                    created += 1
                    continue

                updates = []
                if obj.display_name != cls.name:
                    obj.display_name = cls.name
                    updates.append('display_name')
                if obj.section != (cls.section or ''):
                    obj.section = cls.section or ''
                    updates.append('section')
                if obj.grade_level != cls.grade_level:
                    obj.grade_level = cls.grade_level
                    updates.append('grade_level')
                if not obj.is_active:
                    obj.is_active = True
                    updates.append('is_active')

                if updates:
                    updates.append('updated_at')
                    obj.save(update_fields=updates)
                    if 'is_active' in updates:
                        reactivated += 1
                else:
                    unchanged += 1

        total = created + reactivated + unchanged
        return Response({
            'academic_year': {'id': target_year.id, 'name': target_year.name},
            'source_academic_year': ({'id': source_year.id, 'name': source_year.name} if source_year else None),
            'created': created,
            'reactivated': reactivated,
            'unchanged': unchanged,
            'total_processed': total,
            'message': f'Initialized {total} session classes ({created} created, {reactivated} reactivated, {unchanged} unchanged).',
        })


class StudentEnrollmentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = StudentEnrollment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StudentEnrollmentCreateSerializer
        return StudentEnrollmentSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'student', 'academic_year', 'session_class', 'class_obj',
        )
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        session_class_id = self.request.query_params.get('session_class_id')
        if session_class_id:
            session_class = SessionClass.objects.filter(
                id=session_class_id,
                school_id=_resolve_school_id(self.request),
            ).first()
            if not session_class or not session_class.class_obj_id:
                return qs.none()
            qs = qs.filter(
                academic_year_id=session_class.academic_year_id,
            ).filter(
                Q(session_class_id=session_class.id) |
                Q(session_class__isnull=True, class_obj_id=session_class.class_obj_id)
            )
        class_id = self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(class_obj_id=class_id)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @staticmethod
    def _derive_next_class_name(source_name):
        import re

        match = re.match(r'^(.*?)(\d+)([^\d]*)$', source_name or '')
        if not match:
            return ''

        prefix, num, suffix = match.group(1), match.group(2), match.group(3)
        return f"{prefix}{int(num) + 1}{suffix}".strip()

    @staticmethod
    def _class_label(class_obj):
        if class_obj.section:
            return f"{class_obj.name} - {class_obj.section}"
        return class_obj.name

    @staticmethod
    def _session_class_label(session_class):
        return session_class.label

    @staticmethod
    def _serialize_session_class(session_class):
        return {
            'id': session_class.id,
            'class_obj': session_class.class_obj_id,
            'name': session_class.display_name,
            'section': session_class.section,
            'grade_level': session_class.grade_level,
            'label': session_class.label,
            'is_active': session_class.is_active,
        }

    @staticmethod
    def _log_promotion_event(*, operation, school_id, created_by, student_id, event_type,
                             source_enrollment=None, target_enrollment=None,
                             source_year_id=None, target_year_id=None,
                             source_class_id=None, target_class_id=None,
                             source_session_class_id=None, target_session_class_id=None,
                             old_status='', new_status='', old_roll='', new_roll='',
                             reason='', details=None):
        PromotionEvent.objects.create(
            operation=operation,
            school_id=school_id,
            student_id=student_id,
            source_enrollment=source_enrollment,
            target_enrollment=target_enrollment,
            source_academic_year_id=source_year_id,
            target_academic_year_id=target_year_id,
            source_class_id=source_class_id,
            target_class_id=target_class_id,
            source_session_class_id=source_session_class_id,
            target_session_class_id=target_session_class_id,
            event_type=event_type,
            old_status=old_status or '',
            new_status=new_status or '',
            old_roll_number=old_roll or '',
            new_roll_number=new_roll or '',
            reason=reason or '',
            details=details or {},
            created_by=created_by,
        )

    @staticmethod
    def _update_operation_status(operation, *, processed_count, skipped_count, error_count):
        if error_count > 0 and processed_count > 0:
            status_value = PromotionOperation.OperationStatus.PARTIAL
        elif error_count > 0 and processed_count == 0:
            status_value = PromotionOperation.OperationStatus.FAILED
        else:
            status_value = PromotionOperation.OperationStatus.SUCCESS

        operation.processed_count = processed_count
        operation.skipped_count = skipped_count
        operation.error_count = error_count
        operation.status = status_value
        operation.save(update_fields=['processed_count', 'skipped_count', 'error_count', 'status', 'updated_at'])

    def _run_single_correction(self, *, school_id, source_year, target_year, correction, operation, request_user, dry_run=False):
        from students.models import Student, Class
        from academic_sessions.roll_allocator_service import RollAllocatorService

        student_id = correction['student_id']
        action = correction['action']
        target_class_id = correction.get('target_class_id')
        target_session_class_id = correction.get('target_session_class_id')
        reason = correction.get('reason', '')

        source_enrollment = StudentEnrollment.objects.filter(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=source_year.id,
        ).first()
        if not source_enrollment:
            return {
                'ok': False,
                'student_id': student_id,
                'reason': 'Source enrollment not found.',
            }

        target_enrollment = StudentEnrollment.objects.filter(
            school_id=school_id,
            student_id=student_id,
            academic_year_id=target_year.id,
        ).first()
        allow_reopen_from_graduated = (
            source_enrollment.status == StudentEnrollment.Status.GRADUATED
            and not target_enrollment
            and action in ('PROMOTE', 'REPEAT')
        )
        allow_terminal_graduate = (not target_enrollment and action == 'GRADUATE')

        if not target_enrollment and not allow_reopen_from_graduated and not allow_terminal_graduate:
            return {
                'ok': False,
                'student_id': student_id,
                'reason': 'Target enrollment not found. Nothing to correct.',
            }

        resolved_roll = (
            correction.get('new_roll_number')
            or (target_enrollment.roll_number if target_enrollment else '')
            or source_enrollment.roll_number
        )

        resolved_target_class_id = target_class_id or (target_enrollment.class_obj_id if target_enrollment else None)
        resolved_target_session_class_id = target_session_class_id or (target_enrollment.session_class_id if target_enrollment else None)

        if resolved_target_session_class_id:
            resolved_session_class = SessionClass.objects.filter(
                id=resolved_target_session_class_id,
                school_id=school_id,
                academic_year_id=target_year.id,
            ).only('id', 'class_obj_id').first()
            if resolved_session_class and resolved_session_class.class_obj_id:
                resolved_target_class_id = resolved_session_class.class_obj_id

        if action == 'REPEAT':
            source_class_id = source_enrollment.class_obj_id
            source_class_grade = Class.objects.filter(
                id=source_class_id,
                school_id=school_id,
            ).values_list('grade_level', flat=True).first()
            target_class_grade = None
            if resolved_target_class_id:
                target_class_grade = Class.objects.filter(
                    id=resolved_target_class_id,
                    school_id=school_id,
                ).values_list('grade_level', flat=True).first()

            # REPEAT must remain in the same class level; avoid reusing stale promoted targets.
            if (
                not resolved_target_class_id
                or source_class_grade is None
                or target_class_grade is None
                or target_class_grade != source_class_grade
            ):
                resolved_target_class_id = source_class_id

            resolved_repeat_session_class = self._resolve_repeat_target_session_class(
                school_id=school_id,
                target_year=target_year,
                source_enrollment=source_enrollment,
                target_class_id=resolved_target_class_id,
            )
            if resolved_repeat_session_class:
                resolved_target_session_class_id = resolved_repeat_session_class.id
                if resolved_repeat_session_class.class_obj_id:
                    resolved_target_class_id = resolved_repeat_session_class.class_obj_id
            elif not target_session_class_id:
                resolved_target_session_class_id = self._resolve_repeat_target_session_class_id(
                    school_id=school_id,
                    target_year=target_year,
                    source_enrollment=source_enrollment,
                    target_class_id=resolved_target_class_id,
                )

        if action != 'GRADUATE' and not resolved_target_class_id:
            return {
                'ok': False,
                'student_id': student_id,
                'reason': 'Target class is required for Promote/Repeat correction.',
            }

        if dry_run:
            return {
                'ok': True,
                'student_id': student_id,
                'preview': {
                    'action': action,
                    'target_class_id': resolved_target_class_id,
                    'target_session_class_id': resolved_target_session_class_id,
                    'new_roll_number': resolved_roll,
                    'reopen_from_graduated': bool(allow_reopen_from_graduated),
                },
            }

        with transaction.atomic():
            if target_enrollment:
                # Reverse existing promotion state first.
                old_target_snapshot = {
                    'target_class_id': target_enrollment.class_obj_id,
                    'target_session_class_id': target_enrollment.session_class_id,
                    'target_roll': target_enrollment.roll_number,
                    'target_status': target_enrollment.status,
                }

                target_enrollment.delete()
                source_enrollment.status = StudentEnrollment.Status.ACTIVE
                source_enrollment.save(update_fields=['status', 'updated_at'])
                Student.objects.filter(pk=student_id, school_id=school_id).update(
                    class_obj_id=source_enrollment.class_obj_id,
                    roll_number=source_enrollment.roll_number,
                    status=Student.Status.ACTIVE,
                )

                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request_user,
                    student_id=student_id,
                    event_type=PromotionEvent.EventType.REVERSED,
                    source_enrollment=source_enrollment,
                    source_year_id=source_year.id,
                    target_year_id=target_year.id,
                    source_class_id=source_enrollment.class_obj_id,
                    source_session_class_id=source_enrollment.session_class_id,
                    old_status=old_target_snapshot['target_status'],
                    new_status=StudentEnrollment.Status.ACTIVE,
                    old_roll=old_target_snapshot['target_roll'],
                    new_roll=source_enrollment.roll_number,
                    reason=reason,
                    details={
                        'phase': 'reverse',
                        **old_target_snapshot,
                    },
                )
            elif action == 'GRADUATE':
                # No target enrollment exists; allow terminal graduation state to be confirmed/updated.
                previous_status = source_enrollment.status
                source_enrollment.status = StudentEnrollment.Status.GRADUATED
                source_enrollment.save(update_fields=['status', 'updated_at'])
                Student.objects.filter(pk=student_id, school_id=school_id).update(status=Student.Status.GRADUATED)

                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request_user,
                    student_id=student_id,
                    event_type=PromotionEvent.EventType.GRADUATED,
                    source_enrollment=source_enrollment,
                    source_year_id=source_year.id,
                    target_year_id=target_year.id,
                    source_class_id=source_enrollment.class_obj_id,
                    source_session_class_id=source_enrollment.session_class_id,
                    old_status=previous_status,
                    new_status=StudentEnrollment.Status.GRADUATED,
                    old_roll=source_enrollment.roll_number,
                    new_roll=source_enrollment.roll_number,
                    reason=reason,
                    details={'phase': 'reapply_no_target', 'action': action},
                )
                return {'ok': True, 'student_id': student_id, 'action': action}
            else:
                # Re-open a terminal GRADUATED source row and create a new target enrollment.
                previous_status = source_enrollment.status
                source_enrollment.status = StudentEnrollment.Status.ACTIVE
                source_enrollment.save(update_fields=['status', 'updated_at'])
                Student.objects.filter(pk=student_id, school_id=school_id).update(
                    class_obj_id=source_enrollment.class_obj_id,
                    roll_number=source_enrollment.roll_number,
                    status=Student.Status.ACTIVE,
                )

                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request_user,
                    student_id=student_id,
                    event_type=PromotionEvent.EventType.REVERSED,
                    source_enrollment=source_enrollment,
                    source_year_id=source_year.id,
                    target_year_id=target_year.id,
                    source_class_id=source_enrollment.class_obj_id,
                    source_session_class_id=source_enrollment.session_class_id,
                    old_status=previous_status,
                    new_status=StudentEnrollment.Status.ACTIVE,
                    old_roll=source_enrollment.roll_number,
                    new_roll=source_enrollment.roll_number,
                    reason=reason,
                    details={'phase': 'reopen_without_target', 'action': action},
                )

            if action == 'GRADUATE':
                source_enrollment.status = StudentEnrollment.Status.GRADUATED
                source_enrollment.save(update_fields=['status', 'updated_at'])
                Student.objects.filter(pk=student_id, school_id=school_id).update(status=Student.Status.GRADUATED)

                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request_user,
                    student_id=student_id,
                    event_type=PromotionEvent.EventType.GRADUATED,
                    source_enrollment=source_enrollment,
                    source_year_id=source_year.id,
                    target_year_id=target_year.id,
                    source_class_id=source_enrollment.class_obj_id,
                    source_session_class_id=source_enrollment.session_class_id,
                    old_status=StudentEnrollment.Status.ACTIVE,
                    new_status=StudentEnrollment.Status.GRADUATED,
                    old_roll=source_enrollment.roll_number,
                    new_roll=source_enrollment.roll_number,
                    reason=reason,
                    details={'phase': 'reapply', 'action': action},
                )
                return {'ok': True, 'student_id': student_id, 'action': action}

            allocator = RollAllocatorService(
                school_id=school_id,
                academic_year_id=target_year.id,
                class_obj_id=resolved_target_class_id,
            )
            final_roll = allocator.resolve_roll(
                preferred_roll=resolved_roll,
                exclude_student_id=student_id,
            )

            new_target_enrollment = StudentEnrollment.objects.create(
                school_id=school_id,
                student_id=student_id,
                academic_year_id=target_year.id,
                class_obj_id=resolved_target_class_id,
                session_class_id=resolved_target_session_class_id,
                roll_number=final_roll,
                status=StudentEnrollment.Status.ACTIVE,
            )

            source_enrollment.status = (
                StudentEnrollment.Status.REPEAT
                if action == 'REPEAT'
                else StudentEnrollment.Status.PROMOTED
            )
            source_enrollment.save(update_fields=['status', 'updated_at'])

            Student.objects.filter(pk=student_id, school_id=school_id).update(
                class_obj_id=resolved_target_class_id,
                roll_number=final_roll,
                status=Student.Status.ACTIVE,
            )

            self._log_promotion_event(
                operation=operation,
                school_id=school_id,
                created_by=request_user,
                student_id=student_id,
                event_type=(
                    PromotionEvent.EventType.REPEATED
                    if action == 'REPEAT'
                    else PromotionEvent.EventType.PROMOTED
                ),
                source_enrollment=source_enrollment,
                target_enrollment=new_target_enrollment,
                source_year_id=source_year.id,
                target_year_id=target_year.id,
                source_class_id=source_enrollment.class_obj_id,
                target_class_id=resolved_target_class_id,
                source_session_class_id=source_enrollment.session_class_id,
                target_session_class_id=resolved_target_session_class_id,
                old_status=StudentEnrollment.Status.ACTIVE,
                new_status=source_enrollment.status,
                old_roll=source_enrollment.roll_number,
                new_roll=final_roll,
                reason=reason,
                details={'phase': 'reapply', 'action': action},
            )

        return {
            'ok': True,
            'student_id': student_id,
            'action': action,
            'target_class_id': resolved_target_class_id,
            'target_session_class_id': resolved_target_session_class_id,
            'new_roll_number': final_roll,
        }

    def _resolve_repeat_target_session_class_id(self, *, school_id, target_year, source_enrollment, target_class_id):
        resolved = self._resolve_repeat_target_session_class(
            school_id=school_id,
            target_year=target_year,
            source_enrollment=source_enrollment,
            target_class_id=target_class_id,
        )
        return resolved.id if resolved else None

    def _resolve_repeat_target_session_class(self, *, school_id, target_year, source_enrollment, target_class_id):
        if not source_enrollment.session_class_id:
            return None

        source_session_class = SessionClass.objects.filter(
            id=source_enrollment.session_class_id,
            school_id=school_id,
        ).only('display_name', 'section', 'grade_level').first()

        if not source_session_class:
            return None

        section = source_session_class.section or ''
        display_name = source_session_class.display_name or ''

        base_qs = SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=target_year.id,
            class_obj_id=target_class_id,
        )

        exact_match = base_qs.filter(
            display_name=display_name,
            section=section,
        ).order_by('id').first()
        if exact_match:
            return exact_match

        section_match = base_qs.filter(section=section).order_by('id').first()
        if section_match:
            return section_match

        any_match = base_qs.order_by('id').first()
        if any_match:
            return any_match

        # Fallback: if class ids drifted across years, match by session-class identity.
        target_year_qs = SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=target_year.id,
        )

        by_name_and_section = target_year_qs.filter(
            display_name=display_name,
            section=section,
        ).order_by('id').first()
        if by_name_and_section:
            return by_name_and_section

        by_name = target_year_qs.filter(
            display_name=display_name,
        ).order_by('id').first()
        if by_name:
            return by_name

        if source_session_class.grade_level is not None:
            by_grade = target_year_qs.filter(
                grade_level=source_session_class.grade_level,
            ).order_by('id').first()
            if by_grade:
                return by_grade

        return None

    def _resolve_target_master_class(self, school_id, target_year, source_class_like, suggested_name, next_grade_level, create_if_missing=False):
        from students.models import Class

        if getattr(source_class_like, 'class_obj_id', None):
            current_master = source_class_like.class_obj
        else:
            current_master = source_class_like

        existing = Class.objects.filter(
            school_id=school_id,
            name=suggested_name,
            section='',
        ).order_by('id').first()
        if existing:
            if not existing.is_active and create_if_missing:
                existing.is_active = True
                existing.save(update_fields=['is_active', 'updated_at'])
            return existing

        if not create_if_missing:
            return None

        return Class.objects.create(
            school_id=school_id,
            name=suggested_name,
            section='',
            grade_level=next_grade_level,
            is_active=True,
        )

    def _compute_promotion_target_plan(self, school_id, source_year, target_year, source_class=None, source_session_class=None):
        from students.models import Class

        if source_session_class:
            next_grade_level = source_session_class.grade_level + 1
            next_grade_classes = list(SessionClass.objects.filter(
                school_id=school_id,
                academic_year_id=target_year.id,
                grade_level=next_grade_level,
            ).order_by('section', 'display_name', 'id'))
            source_name = source_session_class.display_name
            source_section = (source_session_class.section or '').strip().lower()
            suggested_section = source_session_class.section or ''
        else:
            next_grade_level = source_class.grade_level + 1
            next_grade_classes = list(Class.objects.filter(
                school_id=school_id,
                grade_level=next_grade_level,
            ).order_by('section', 'name', 'id'))
            source_name = source_class.name
            source_section = (source_class.section or '').strip().lower()
            suggested_section = source_class.section or ''

        status = 'missing'
        reason = 'No matching target class found.'
        suggested_name = ''
        existing_class = None

        if source_section:
            same_section_matches = [
                c for c in next_grade_classes
                if (c.section or '').strip().lower() == source_section
            ]
            if len(same_section_matches) == 1:
                existing_class = same_section_matches[0]
                if existing_class.is_active:
                    status = 'exists_active'
                    reason = 'Matching same-section target exists and is active.'
                else:
                    status = 'exists_inactive'
                    reason = 'Matching same-section target exists but is inactive and should be reactivated.'
            elif len(same_section_matches) > 1:
                status = 'ambiguous'
                reason = 'Multiple same-section target classes found. Manual selection required.'
            else:
                suggested_name = self._derive_next_class_name(source_name)
                if suggested_name:
                    reason = 'Missing same-section target class; safe to create.'
                else:
                    status = 'ambiguous'
                    reason = 'Unable to derive next class name automatically. Manual class setup required.'
        else:
            if len(next_grade_classes) == 1:
                existing_class = next_grade_classes[0]
                if existing_class.is_active:
                    status = 'exists_active'
                    reason = 'Single next-grade target exists and is active.'
                else:
                    status = 'exists_inactive'
                    reason = 'Single next-grade target exists but is inactive and should be reactivated.'
            elif len(next_grade_classes) > 1:
                status = 'ambiguous'
                reason = 'Multiple next-grade targets exist for a no-section source class. Manual selection required.'
            else:
                suggested_name = self._derive_next_class_name(source_name)
                if suggested_name:
                    reason = 'Missing next-grade target class; safe to create.'
                else:
                    status = 'ambiguous'
                    reason = 'Unable to derive next class name automatically. Manual class setup required.'

        return {
            'status': status,
            'reason': reason,
            'next_grade_level': next_grade_level,
            'suggested_name': suggested_name,
            'suggested_section': suggested_section,
            'existing_class': existing_class,
            'candidates': next_grade_classes,
        }

    @action(detail=False, methods=['post'], url_path='promotion-targets-preview')
    def promotion_targets_preview(self, request):
        """Preview safe target-class mapping for promotion (exists/create/reactivate/ambiguous)."""
        school_id = _resolve_school_id(request)
        serializer = PromotionTargetPreviewSerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)

        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        source_class = serializer.validated_data.get('source_class')
        source_session_class = serializer.validated_data.get('source_session_class')

        plan = self._compute_promotion_target_plan(
            school_id,
            source_year,
            target_year,
            source_class=source_class,
            source_session_class=source_session_class,
        )
        status_value = plan['status']
        reason = plan['reason']
        next_grade_level = plan['next_grade_level']
        suggested_name = plan['suggested_name']
        suggested_section = plan['suggested_section']
        existing_class = plan['existing_class']
        next_grade_classes = plan['candidates']

        can_auto_create = status_value == 'missing' and bool(suggested_name)
        can_reactivate = status_value == 'exists_inactive'

        response_data = {
            'source_academic_year': {'id': source_year.id, 'name': source_year.name},
            'target_academic_year': {'id': target_year.id, 'name': target_year.name},
            'source_class': {
                'id': (source_session_class.id if source_session_class else source_class.id),
                'class_obj': source_class.id if source_class else None,
                'name': (source_session_class.display_name if source_session_class else source_class.name),
                'section': (source_session_class.section if source_session_class else source_class.section),
                'grade_level': (source_session_class.grade_level if source_session_class else source_class.grade_level),
                'label': (self._session_class_label(source_session_class) if source_session_class else self._class_label(source_class)),
                'is_session_class': bool(source_session_class),
            },
            'target_plan': {
                'status': status_value,
                'reason': reason,
                'next_grade_level': next_grade_level,
                'existing_class': (
                    (self._serialize_session_class(existing_class) if source_session_class else {
                        'id': existing_class.id,
                        'class_obj': existing_class.id,
                        'name': existing_class.name,
                        'section': existing_class.section,
                        'grade_level': existing_class.grade_level,
                        'label': self._class_label(existing_class),
                        'is_active': existing_class.is_active,
                    })
                    if existing_class else None
                ),
                'proposed_class': (
                    {
                        'class_obj': None,
                        'name': suggested_name,
                        'section': suggested_section,
                        'grade_level': next_grade_level,
                        'label': f"{suggested_name}{f' - {suggested_section}' if suggested_section else ''}",
                    }
                    if can_auto_create else None
                ),
                'can_auto_create': can_auto_create,
                'can_reactivate': can_reactivate,
                'candidates': [
                    (self._serialize_session_class(c) if source_session_class else {
                        'id': c.id,
                        'class_obj': c.id,
                        'name': c.name,
                        'section': c.section,
                        'grade_level': c.grade_level,
                        'label': self._class_label(c),
                        'is_active': c.is_active,
                    })
                    for c in next_grade_classes
                ],
            },
        }

        return Response(response_data)

    @action(detail=False, methods=['post'], url_path='promotion-targets-apply')
    def promotion_targets_apply(self, request):
        """Apply safe target-class plan (create/reactivate) and return resolved target class."""
        school_id = _resolve_school_id(request)
        serializer = PromotionTargetApplySerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)

        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        source_class = serializer.validated_data.get('source_class')
        source_session_class = serializer.validated_data.get('source_session_class')
        create_if_missing = serializer.validated_data['create_if_missing']
        reactivate_if_inactive = serializer.validated_data['reactivate_if_inactive']

        plan = self._compute_promotion_target_plan(
            school_id,
            source_year,
            target_year,
            source_class=source_class,
            source_session_class=source_session_class,
        )
        status_value = plan['status']
        target_class = plan['existing_class']
        action_taken = 'none'

        if status_value == 'ambiguous':
            return Response({
                'detail': plan['reason'],
                'status': status_value,
                'candidates': [
                    (self._serialize_session_class(c) if source_session_class else {
                        'id': c.id,
                        'class_obj': c.id,
                        'name': c.name,
                        'section': c.section,
                        'grade_level': c.grade_level,
                        'label': self._class_label(c),
                        'is_active': c.is_active,
                    })
                    for c in plan['candidates']
                ],
            }, status=status.HTTP_400_BAD_REQUEST)

        if status_value == 'exists_inactive':
            if not reactivate_if_inactive:
                return Response(
                    {'detail': 'Target class exists but is inactive and reactivation is disabled.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            target_class.is_active = True
            target_class.save(update_fields=['is_active', 'updated_at'])
            action_taken = 'reactivated'

        if status_value == 'missing':
            if not create_if_missing:
                return Response(
                    {'detail': 'Target class is missing and creation is disabled.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not plan['suggested_name']:
                return Response(
                    {'detail': 'Unable to derive target class name for auto-create.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if source_session_class:
                target_master_class = self._resolve_target_master_class(
                    school_id,
                    target_year,
                    source_session_class,
                    plan['suggested_name'],
                    plan['next_grade_level'],
                    create_if_missing=True,
                )
                target_class, created = SessionClass.objects.get_or_create(
                    school_id=school_id,
                    academic_year_id=target_year.id,
                    display_name=plan['suggested_name'],
                    section=plan['suggested_section'],
                    defaults={
                        'grade_level': plan['next_grade_level'],
                        'class_obj': target_master_class,
                        'is_active': True,
                    },
                )
                updates = []
                if target_class.class_obj_id != target_master_class.id:
                    target_class.class_obj = target_master_class
                    updates.append('class_obj')
                if not target_class.is_active:
                    target_class.is_active = True
                    updates.append('is_active')
                if updates:
                    updates.append('updated_at')
                    target_class.save(update_fields=updates)
                action_taken = 'created' if created else ('reactivated' if 'is_active' in updates else 'reused')
            else:
                from students.models import Class

                target_class, created = Class.objects.get_or_create(
                    school_id=school_id,
                    name=plan['suggested_name'],
                    section=plan['suggested_section'],
                    defaults={'grade_level': plan['next_grade_level'], 'is_active': True},
                )
                if not created and not target_class.is_active:
                    target_class.is_active = True
                    target_class.save(update_fields=['is_active', 'updated_at'])
                    action_taken = 'reactivated'
                else:
                    action_taken = 'created' if created else 'reused'

        if source_session_class and target_class and not target_class.class_obj_id:
            target_master_class = self._resolve_target_master_class(
                school_id,
                target_year,
                source_session_class,
                target_class.display_name,
                target_class.grade_level,
                create_if_missing=True,
            )
            target_class.class_obj = target_master_class
            target_class.save(update_fields=['class_obj', 'updated_at'])

        if target_class is None:
            return Response(
                {'detail': 'Target class could not be resolved.', 'status': status_value},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            'source_academic_year': {'id': source_year.id, 'name': source_year.name},
            'target_academic_year': {'id': target_year.id, 'name': target_year.name},
            'source_class': {
                'id': (source_session_class.id if source_session_class else source_class.id),
                'class_obj': source_class.id if source_class else None,
                'name': (source_session_class.display_name if source_session_class else source_class.name),
                'section': (source_session_class.section if source_session_class else source_class.section),
                'grade_level': (source_session_class.grade_level if source_session_class else source_class.grade_level),
                'label': (self._session_class_label(source_session_class) if source_session_class else self._class_label(source_class)),
                'is_session_class': bool(source_session_class),
            },
            'target_class': {
                **(self._serialize_session_class(target_class) if source_session_class else {
                    'id': target_class.id,
                    'class_obj': target_class.id,
                    'name': target_class.name,
                    'section': target_class.section,
                    'grade_level': target_class.grade_level,
                    'label': self._class_label(target_class),
                    'is_active': target_class.is_active,
                }),
            },
            'status': status_value,
            'action_taken': action_taken,
        })

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        class_id = request.query_params.get('class_id')
        session_class_id = request.query_params.get('session_class_id')
        academic_year_id = request.query_params.get('academic_year_id')
        if (not class_id and not session_class_id) or not academic_year_id:
            return Response(
                {'detail': 'class_id or session_class_id and academic_year_id params required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = self.get_queryset().filter(academic_year_id=academic_year_id)
        if class_id:
            qs = qs.filter(class_obj_id=class_id)
        serializer = StudentEnrollmentSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def bulk_promote(self, request):
        """Promote students in bulk (background task)."""
        serializer = BulkPromoteSerializer(
            data=request.data,
            context={'school_id': _resolve_school_id(request)},
        )
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        promotions = serializer.validated_data['promotions']

        from core.models import BackgroundTask
        from .tasks import bulk_promote_task

        operation = PromotionOperation.objects.create(
            school_id=school_id,
            source_academic_year=source_year,
            target_academic_year=target_year,
            operation_type=PromotionOperation.OperationType.BULK_PROMOTE,
            total_students=len(promotions),
            initiated_by=request.user,
            metadata={'source': 'enrollments.bulk_promote'},
        )

        task_kwargs = {
            'school_id': school_id,
            'source_year_id': source_year.id,
            'target_year_id': target_year.id,
            'promotions': promotions,
            'operation_id': operation.id,
            'actor_id': request.user.id,
        }
        title = f"Promoting {len(promotions)} students"

        if len(promotions) < 50:
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    bulk_promote_task, BackgroundTask.TaskType.BULK_PROMOTION,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=len(promotions),
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', 'Promotion complete.') if bg_task.result_data else 'Promotion complete.',
                'result': bg_task.result_data,
                'operation_id': operation.id,
            })
        else:
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=bulk_promote_task,
                task_type=BackgroundTask.TaskType.BULK_PROMOTION,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=len(promotions),
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': 'Bulk promotion started.',
                'operation_id': operation.id,
            }, status=202)

    @action(detail=False, methods=['post'])
    def bulk_reverse_promote(self, request):
        """Reverse mistaken promotions for selected students.

        Behavior:
        - Deletes the target-year enrollment for each selected student.
        - Restores source-year enrollment status back to ACTIVE when found.
        - Restores student class/roll snapshot from source-year enrollment.
        """
        serializer = BulkReversePromotionSerializer(
            data=request.data,
            context={'school_id': _resolve_school_id(request)},
        )
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        student_ids = serializer.validated_data['student_ids']

        operation = PromotionOperation.objects.create(
            school_id=school_id,
            source_academic_year=source_year,
            target_academic_year=target_year,
            operation_type=PromotionOperation.OperationType.BULK_REVERSE,
            total_students=len(student_ids),
            initiated_by=request.user,
            metadata={'source': 'enrollments.bulk_reverse_promote'},
        )

        from students.models import Student

        reverted = 0
        skipped = []
        errors = []

        for student_id in student_ids:
            try:
                with transaction.atomic():
                    target_enrollment = StudentEnrollment.objects.filter(
                        school_id=school_id,
                        student_id=student_id,
                        academic_year_id=target_year.id,
                    ).first()

                    if not target_enrollment:
                        skipped.append({
                            'student_id': student_id,
                            'reason': 'No target-year enrollment found to reverse.',
                        })
                        self._log_promotion_event(
                            operation=operation,
                            school_id=school_id,
                            created_by=request.user,
                            student_id=student_id,
                            event_type=PromotionEvent.EventType.SKIPPED,
                            source_year_id=source_year.id,
                            target_year_id=target_year.id,
                            reason='No target-year enrollment found to reverse.',
                        )
                        continue

                    source_enrollment = StudentEnrollment.objects.filter(
                        school_id=school_id,
                        student_id=student_id,
                        academic_year_id=source_year.id,
                    ).first()

                    target_enrollment.delete()

                    if source_enrollment:
                        source_enrollment.status = StudentEnrollment.Status.ACTIVE
                        source_enrollment.save(update_fields=['status'])

                        Student.objects.filter(
                            pk=student_id,
                            school_id=school_id,
                        ).update(
                            class_obj_id=source_enrollment.class_obj_id,
                            roll_number=source_enrollment.roll_number,
                            status=Student.Status.ACTIVE,
                        )
                    else:
                        Student.objects.filter(
                            pk=student_id,
                            school_id=school_id,
                        ).update(status=Student.Status.ACTIVE)

                    reverted += 1

                    self._log_promotion_event(
                        operation=operation,
                        school_id=school_id,
                        created_by=request.user,
                        student_id=student_id,
                        event_type=PromotionEvent.EventType.REVERSED,
                        source_enrollment=source_enrollment,
                        source_year_id=source_year.id,
                        target_year_id=target_year.id,
                        source_class_id=(source_enrollment.class_obj_id if source_enrollment else None),
                        source_session_class_id=(source_enrollment.session_class_id if source_enrollment else None),
                        old_status=(target_enrollment.status or ''),
                        new_status=StudentEnrollment.Status.ACTIVE,
                        old_roll=(target_enrollment.roll_number or ''),
                        new_roll=(source_enrollment.roll_number if source_enrollment else ''),
                        reason='Bulk reverse action',
                        details={'source': 'bulk_reverse_promote'},
                    )
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})
                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request.user,
                    student_id=student_id,
                    event_type=PromotionEvent.EventType.FAILED,
                    source_year_id=source_year.id,
                    target_year_id=target_year.id,
                    reason=str(e),
                )

        self._update_operation_status(
            operation,
            processed_count=reverted,
            skipped_count=len(skipped),
            error_count=len(errors),
        )

        return Response({
            'reverted': reverted,
            'skipped': skipped,
            'errors': errors,
            'message': f'{reverted} students reversed successfully. {len(skipped)} skipped, {len(errors)} failed.',
            'operation_id': operation.id,
        })

    @action(detail=False, methods=['get'], url_path='promotion-history')
    def promotion_history(self, request):
        school_id = _resolve_school_id(request)
        serializer = PromotionHistoryQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)

        filters = serializer.validated_data
        events = PromotionEvent.objects.filter(school_id=school_id).select_related(
            'operation',
            'student',
            'source_academic_year',
            'target_academic_year',
            'source_class',
            'target_class',
            'source_session_class',
            'target_session_class',
            'created_by',
        )

        academic_year = filters.get('academic_year')
        if academic_year:
            events = events.filter(
                Q(source_academic_year_id=academic_year) | Q(target_academic_year_id=academic_year)
            )
        if filters.get('source_academic_year'):
            events = events.filter(source_academic_year_id=filters['source_academic_year'])
        if filters.get('target_academic_year'):
            events = events.filter(target_academic_year_id=filters['target_academic_year'])
        if filters.get('source_class'):
            events = events.filter(source_class_id=filters['source_class'])
        if filters.get('source_session_class'):
            events = events.filter(source_session_class_id=filters['source_session_class'])
        if filters.get('student_id'):
            events = events.filter(student_id=filters['student_id'])
        if filters.get('event_type'):
            events = events.filter(event_type=filters['event_type'])

        page = self.paginate_queryset(events.order_by('-created_at', '-id'))
        if page is not None:
            return self.get_paginated_response(PromotionEventSerializer(page, many=True).data)

        return Response(PromotionEventSerializer(events, many=True).data)

    @action(detail=False, methods=['post'], url_path='correct-single')
    def correct_single(self, request):
        school_id = _resolve_school_id(request)
        serializer = PromotionSingleCorrectionSerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        operation = PromotionOperation.objects.create(
            school_id=school_id,
            source_academic_year=payload['source_academic_year'],
            target_academic_year=payload['target_academic_year'],
            operation_type=PromotionOperation.OperationType.SINGLE_CORRECTION,
            total_students=1,
            reason=payload.get('reason', ''),
            initiated_by=request.user,
            metadata={'source': 'enrollments.correct_single', 'dry_run': payload['dry_run']},
        )

        result = self._run_single_correction(
            school_id=school_id,
            source_year=payload['source_academic_year'],
            target_year=payload['target_academic_year'],
            correction={
                'student_id': payload['student_id'],
                'action': payload['action'],
                'target_class_id': payload.get('target_class_id'),
                'target_session_class_id': payload.get('target_session_class_id'),
                'new_roll_number': payload.get('new_roll_number', ''),
                'reason': payload.get('reason', ''),
            },
            operation=operation,
            request_user=request.user,
            dry_run=payload['dry_run'],
        )

        self._update_operation_status(
            operation,
            processed_count=(1 if result.get('ok') and not payload['dry_run'] else 0),
            skipped_count=(0 if result.get('ok') else 1),
            error_count=0,
        )

        response_status = status.HTTP_200_OK if result.get('ok') else status.HTTP_400_BAD_REQUEST
        return Response({
            'operation_id': operation.id,
            'result': result,
        }, status=response_status)

    @action(detail=False, methods=['post'], url_path='correct-bulk')
    def correct_bulk(self, request):
        school_id = _resolve_school_id(request)
        serializer = PromotionBulkCorrectionSerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        operation = PromotionOperation.objects.create(
            school_id=school_id,
            source_academic_year=payload['source_academic_year'],
            target_academic_year=payload['target_academic_year'],
            operation_type=PromotionOperation.OperationType.BULK_CORRECTION,
            total_students=len(payload['corrections']),
            initiated_by=request.user,
            metadata={'source': 'enrollments.correct_bulk', 'dry_run': payload['dry_run']},
        )

        corrected = 0
        skipped = []
        errors = []
        previews = []

        for correction in payload['corrections']:
            try:
                row_result = self._run_single_correction(
                    school_id=school_id,
                    source_year=payload['source_academic_year'],
                    target_year=payload['target_academic_year'],
                    correction=correction,
                    operation=operation,
                    request_user=request.user,
                    dry_run=payload['dry_run'],
                )
                if row_result.get('ok'):
                    if payload['dry_run']:
                        previews.append(row_result)
                    else:
                        corrected += 1
                else:
                    skipped.append(row_result)
            except Exception as exc:
                errors.append({'student_id': correction.get('student_id'), 'error': str(exc)})
                self._log_promotion_event(
                    operation=operation,
                    school_id=school_id,
                    created_by=request.user,
                    student_id=correction.get('student_id'),
                    event_type=PromotionEvent.EventType.FAILED,
                    source_year_id=payload['source_academic_year'].id,
                    target_year_id=payload['target_academic_year'].id,
                    reason=str(exc),
                    details={'source': 'correct_bulk'},
                )

        self._update_operation_status(
            operation,
            processed_count=corrected,
            skipped_count=len(skipped),
            error_count=len(errors),
        )

        return Response({
            'operation_id': operation.id,
            'dry_run': payload['dry_run'],
            'corrected': corrected,
            'skipped': skipped,
            'errors': errors,
            'previews': previews,
            'message': (
                f'{corrected} corrections applied. {len(skipped)} skipped, {len(errors)} failed.'
                if not payload['dry_run']
                else f'{len(previews)} corrections previewed. {len(skipped)} skipped, {len(errors)} failed.'
            ),
        })


class PromotionAdvisorView(APIView):
    """AI Smart Promotion Advisor (background task)."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        academic_year = request.data.get('academic_year')
        class_id = request.data.get('class_id')

        if not academic_year or not class_id:
            return Response(
                {'detail': 'academic_year and class_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from core.models import BackgroundTask
        from .tasks import promotion_advisor_task

        task_kwargs = {
            'school_id': school_id,
            'academic_year_id': int(academic_year),
            'class_id': int(class_id),
        }
        title = "Running promotion analysis"

        enrollment_count = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=int(academic_year),
            class_obj_id=int(class_id),
            is_active=True,
        ).count()

        if enrollment_count < 30:
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    promotion_advisor_task, BackgroundTask.TaskType.PROMOTION_ADVISOR,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=100,
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', 'Analysis complete.') if bg_task.result_data else 'Analysis complete.',
                'result': bg_task.result_data,
            })
        else:
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=promotion_advisor_task,
                task_type=BackgroundTask.TaskType.PROMOTION_ADVISOR,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=100,
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': 'Promotion analysis started.',
            }, status=202)


class SessionHealthView(APIView):
    """AI Session Health Dashboard endpoint."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .session_health_service import SessionHealthService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.query_params.get('academic_year')

        if not academic_year_id:
            # Default to the current academic year
            current = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if not current:
                return Response(
                    {'detail': 'No current academic year set for this school.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            academic_year_id = current.id

        service = SessionHealthService(school_id, int(academic_year_id))
        report = service.generate_health_report()

        if not report.get('success'):
            return Response(report, status=status.HTTP_404_NOT_FOUND)

        return Response(report)


class SessionSetupView(APIView):
    """AI Auto-Session Setup Wizard endpoints."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        """
        Generate setup preview or apply setup.

        POST with action='preview': Generate a preview of what will be created.
        POST with action='apply': Apply a reviewed preview to create everything.
        """
        from .session_setup_service import SessionSetupService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action = request.data.get('action', 'preview')
        service = SessionSetupService(school_id)

        if action == 'preview':
            source_year_id = request.data.get('source_year_id')
            new_year_name = request.data.get('new_year_name')
            new_start_date = request.data.get('new_start_date')
            new_end_date = request.data.get('new_end_date')

            if not all([source_year_id, new_year_name, new_start_date, new_end_date]):
                return Response(
                    {'detail': 'source_year_id, new_year_name, new_start_date, new_end_date are required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            from datetime import date as parse_date

            preview = service.generate_setup_preview(
                source_year_id=int(source_year_id),
                new_year_name=new_year_name,
                new_start_date=parse_date.fromisoformat(new_start_date),
                new_end_date=parse_date.fromisoformat(new_end_date),
            )
            return Response(preview)

        elif action == 'apply':
            preview_data = request.data.get('preview_data')
            if not preview_data:
                return Response(
                    {'detail': 'preview_data is required for apply action.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            result = service.apply_setup(preview_data, created_by=request.user)
            if not result['success']:
                http_status = status.HTTP_400_BAD_REQUEST
            elif result.get('sync_mode'):
                http_status = status.HTTP_200_OK
            else:
                http_status = status.HTTP_201_CREATED
            return Response(result, status=http_status)

        return Response(
            {'detail': f'Unknown action: {action}. Use "preview" or "apply".'},
            status=status.HTTP_400_BAD_REQUEST,
        )


class SectionAllocatorView(APIView):
    """AI Smart Section Allocator - distributes students across sections with balanced performance."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        """
        POST with action='preview' (default): Returns allocation preview without making changes.
        POST with action='apply': Creates/updates Class records and moves students.
        """
        from .section_allocator_service import SectionAllocatorService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        grade_id = request.data.get('grade_id')
        class_id = request.data.get('class_id')
        academic_year_id = request.data.get('academic_year_id')
        num_sections = request.data.get('num_sections')

        if not num_sections or not (grade_id or class_id):
            return Response(
                {'detail': 'num_sections and either class_id or grade_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            grade_id = int(grade_id) if grade_id else None
            class_id = int(class_id) if class_id else None
            academic_year_id = int(academic_year_id) if academic_year_id else None
            num_sections = int(num_sections)
        except (ValueError, TypeError):
            return Response(
                {'detail': 'IDs and num_sections must be integers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action = request.data.get('action', 'preview')
        service = SectionAllocatorService(school_id)

        if action == 'preview':
            result = service.allocate_students(
                grade_id=grade_id, academic_year_id=academic_year_id,
                num_sections=num_sections, class_id=class_id,
            )
            if not result.get('success'):
                return Response(result, status=status.HTTP_400_BAD_REQUEST)
            return Response(result)

        elif action == 'apply':
            allocation = service.allocate_students(
                grade_id=grade_id, academic_year_id=academic_year_id,
                num_sections=num_sections, class_id=class_id,
            )
            if not allocation.get('success'):
                return Response(allocation, status=status.HTTP_400_BAD_REQUEST)

            result = service.apply_allocation(
                grade_id=grade_id, academic_year_id=academic_year_id,
                allocation_data=allocation, class_id=class_id,
            )
            if not result.get('success'):
                return Response(result, status=status.HTTP_400_BAD_REQUEST)
            return Response(result, status=status.HTTP_200_OK)

        return Response(
            {'detail': f'Unknown action: {action}. Use "preview" or "apply".'},
            status=status.HTTP_400_BAD_REQUEST,
        )


class AttendanceRiskView(APIView):
    """AI Attendance Risk Predictor - identifies students at risk of poor attendance."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .attendance_risk_service import AttendanceRiskService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.query_params.get('academic_year')

        if not academic_year_id:
            # Default to the current academic year
            current = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if not current:
                return Response(
                    {'detail': 'No current academic year set for this school.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            academic_year_id = current.id

        threshold = float(request.query_params.get('threshold', 75))

        service = AttendanceRiskService(school_id, int(academic_year_id))
        result = service.get_at_risk_students(threshold=threshold)

        return Response(result)
