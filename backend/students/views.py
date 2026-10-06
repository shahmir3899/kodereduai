"""
Student and Class views.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count, Q

from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db.models import Sum, Avg
from django.db.models import OuterRef, Subquery, CharField
from django.db.models.functions import Coalesce

from core.permissions import (
    IsSchoolAdmin, CanViewStudentRecords, HasSchoolAccess, ModuleAccessMixin,
    IsStudent, IsStudentOrAdmin, CanManageStudentPhoto, CanEditStudentRecord,
    CanCreateStudentAccount, get_effective_role, ADMIN_ROLES, ROLE_HIERARCHY,
    get_teacher_combined_scope, get_teacher_master_only_class_scope, get_teacher_session_class_scope,
    _get_session_class_student_ids,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from .models import Class, Student, StudentDocument, StudentProfile, StudentInvite
from .serializers import (
    ClassSerializer,
    ClassCreateSerializer,
    StudentSerializer,
    StudentCreateSerializer,
    StudentUpdateSerializer,
    StudentTeacherUpdateSerializer,
    StudentBulkCreateSerializer,
    ReclassifyStudentSerializer,
    StudentDocumentSerializer,
)

User = get_user_model()


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


class ClassViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'students'
    queryset = Class.objects.all()
    permission_classes = [IsAuthenticated, CanViewStudentRecords, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return ClassCreateSerializer
        return ClassSerializer

    def get_queryset(self):
        from academic_sessions.roster import class_student_count_expr

        queryset = Class.objects.select_related('school').annotate(
            annotated_student_count=class_student_count_expr()
        )

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        grade_level = self.request.query_params.get('grade_level')
        if grade_level:
            queryset = queryset.filter(grade_level=grade_level)

        section = self.request.query_params.get('section')
        if section:
            queryset = queryset.filter(section=section)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        role = get_effective_role(self.request)
        if role == 'TEACHER':
            scope = get_teacher_combined_scope(self.request, school_id=active_school_id)
            session_ids = scope.get('full_session_class_ids', set())
            if session_ids:
                # Section-scoped: only classes whose session classes match teacher's assignments
                queryset = queryset.filter(id__in=scope['all_class_ids'])
            else:
                queryset = queryset.filter(id__in=scope['all_class_ids'])

        return queryset.order_by('grade_level', 'section', 'name')

    def perform_create(self, serializer):
        school_id = self.request.data.get('school')
        if not school_id:
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()


from django.db import models as db_models


from .status_groups import ALUMNI_STATUSES, DEPARTED_STATUSES


def _has_later_year(school_id, year_id):
    """True once the school has an academic year starting after this one. Until then
    a graduating student is still on this year's roll (promotion only stamps the
    enrollment), so they read as Current rather than as an alumnus."""
    from academic_sessions.models import AcademicYear

    year = AcademicYear.objects.filter(pk=year_id, school_id=school_id).first()
    return bool(year and AcademicYear.objects.filter(
        school_id=school_id, start_date__gt=year.start_date,
    ).exists())


class StudentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'students'
    queryset = Student.objects.all()
    permission_classes = [IsAuthenticated, CanViewStudentRecords, HasSchoolAccess]

    def get_permissions(self):
        if self.action in ('upload_photo', 'remove_photo'):
            return [IsAuthenticated(), CanManageStudentPhoto(), HasSchoolAccess()]
        if self.action in ('create_user_account', 'bulk_create_accounts'):
            return [IsAuthenticated(), CanCreateStudentAccount(), HasSchoolAccess()]
        if self.action in ('update', 'partial_update'):
            return [IsAuthenticated(), CanEditStudentRecord(), HasSchoolAccess()]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'create':
            return StudentCreateSerializer
        if self.action in ('update', 'partial_update'):
            if get_effective_role(self.request) == 'TEACHER':
                return StudentTeacherUpdateSerializer
            return StudentUpdateSerializer
        if self.action == 'bulk_create':
            return StudentBulkCreateSerializer
        return StudentSerializer

    def get_queryset(self):
        queryset = Student.objects.select_related(
            'school', 'class_obj',
        ).prefetch_related('user_profile__user', 'enrollment_breaks__exit', 'transferred_to__school')

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        role = get_effective_role(self.request)
        if role == 'TEACHER':
            scope = get_teacher_combined_scope(self.request, school_id=active_school_id)
            session_ids = scope.get('full_session_class_ids', set())
            if session_ids:
                # Section-scoped: filter students by those enrolled in teacher's assigned sessions
                enrolled_student_ids = _get_session_class_student_ids(session_ids)
                # Master-class fallback only for assignments without a section;
                # full_class_ids also holds the masters of section assignments,
                # which re-opened every section of those classes.
                legacy_class_ids = get_teacher_master_only_class_scope(self.request, school_id=active_school_id)
                queryset = queryset.filter(
                    Q(id__in=enrolled_student_ids) |
                    Q(class_obj_id__in=legacy_class_ids)
                )
            else:
                # No session assignments: use master class scope
                queryset = queryset.filter(class_obj_id__in=scope['full_class_ids'])

        class_id = self.request.query_params.get('class_id')
        session_class_id = self.request.query_params.get('session_class_id')
        # Tracks whether the session_class_id branch below already scoped the
        # roster with month-precision, so the later academic_year block (which
        # re-filters by a bare enrollments__is_active) doesn't cancel it out by
        # re-demanding a still-active enrollment for the whole year.
        session_roster_month_scoped = False
        if session_class_id:
            from academic_sessions.models import SessionClass
            session_class = SessionClass.objects.filter(
                id=session_class_id,
                school_id=active_school_id or school_id,
            ).first()
            if not session_class or not session_class.class_obj_id:
                return queryset.none()
            # as_of_year/as_of_month (optional): callers with a specific month in view
            # (the attendance register, so far) opt into enrollment_covers_month's
            # month-precision instead of a bare is_active check, so a withdrawn/
            # transferred student still appears for their departure month and
            # earlier. Omit them to keep the plain whole-year snapshot every other
            # caller of this endpoint (the Students page, etc.) already relies on.
            as_of_year = self.request.query_params.get('as_of_year')
            as_of_month = self.request.query_params.get('as_of_month')
            if as_of_year and as_of_month:
                from academic_sessions.utils import enrollment_covers_month
                roster_filter = Q(
                    enrollments__academic_year_id=session_class.academic_year_id,
                    enrollments__session_class_id=session_class.id,
                ) & enrollment_covers_month(int(as_of_year), int(as_of_month), prefix='enrollments')
                session_roster_month_scoped = True
            else:
                roster_filter = Q(
                    enrollments__academic_year_id=session_class.academic_year_id,
                    enrollments__session_class_id=session_class.id,
                    enrollments__is_active=True,
                )
            queryset = queryset.filter(roster_filter).distinct()
        elif class_id:
            # The class in the requested (or current) year, through one
            # enrollment subquery. Filtering the Student snapshot class and,
            # separately, "enrolled in the year" matched each condition on a
            # different row: last year's list for a class showed whoever is
            # in that class now.
            from academic_sessions.roster import enrollments_in_scope

            class_enrollments = enrollments_in_scope(
                active_school_id or school_id,
                academic_year_id=self.request.query_params.get('academic_year') or None,
                class_obj_id=class_id,
                include_inactive=True,
            ) if (active_school_id or school_id) else None
            if class_enrollments is None:
                queryset = queryset.filter(class_obj_id=class_id)
            else:
                queryset = queryset.filter(id__in=class_enrollments.values('student_id'))

        academic_year = self.request.query_params.get('academic_year')
        enrollment_active_filter = True

        # status_scope (list only): 'current' (default, enrolled now), 'left' (withdrawn or
        # transferred in the year), 'graduated' (only once a later year exists, see
        # _has_later_year), 'repeat' (still enrolled) or 'all'. Left students have an
        # inactive enrollment, so the default "enrolled and active" join never returns them.
        status_scope = (self.request.query_params.get('status_scope') or '').lower()
        left_only = False
        left_statuses = DEPARTED_STATUSES
        if self.action == 'list' and status_scope in ('current', 'left', 'graduated', 'repeat', 'all'):
            scope_school_id = active_school_id or school_id
            if not academic_year and scope_school_id:
                from academic_sessions.utils import resolve_current_academic_year_id
                academic_year = resolve_current_academic_year_id(scope_school_id)
            later_year = bool(
                academic_year and scope_school_id and _has_later_year(scope_school_id, academic_year)
            )
            if status_scope == 'repeat':
                # Still enrolled, so the normal current listing, narrowed by status. REPEAT
                # also lives on the enrollment, so either place counts.
                condition = db_models.Q(status='REPEAT')
                if academic_year:
                    condition |= db_models.Q(
                        enrollments__academic_year_id=academic_year, enrollments__status='REPEAT',
                    )
                queryset = queryset.filter(condition)
            elif status_scope in ('left', 'graduated'):
                left_statuses = DEPARTED_STATUSES if status_scope == 'left' else ALUMNI_STATUSES
                if not academic_year:
                    queryset = queryset.filter(status__in=left_statuses)
                elif status_scope == 'graduated' and not later_year:
                    return queryset.none()
                else:
                    # Departed enrollments are closed (inactive); graduating ones are not,
                    # promotion only stamps their status.
                    enrollment_active_filter = False if status_scope == 'left' else None
                    left_only = True
            elif status_scope == 'all':
                if academic_year:
                    enrollment_active_filter = None
            elif later_year:
                # Current in a past year: graduates belong to the Graduated view there.
                queryset = queryset.exclude(
                    enrollments__academic_year_id=academic_year,
                    enrollments__status__in=ALUMNI_STATUSES,
                )

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            is_active_bool = is_active.lower() == 'true'
            if academic_year:
                enrollment_active_filter = is_active_bool
                queryset = queryset.filter(
                    enrollments__academic_year_id=academic_year,
                    enrollments__is_active=is_active_bool,
                )
            else:
                queryset = queryset.filter(is_active=is_active_bool)

        search = self.request.query_params.get('search')
        if search:
            search_q = db_models.Q(name__icontains=search) | db_models.Q(roll_number__icontains=search)
            # Roll numbers live on the enrollment per year; the Student snapshot
            # holds only the latest one.
            from academic_sessions.utils import resolve_current_academic_year_id

            search_school = active_school_id or school_id
            search_year = academic_year or (
                resolve_current_academic_year_id(search_school) if search_school else None
            )
            if search_year:
                from academic_sessions.models import StudentEnrollment
                search_q |= db_models.Q(id__in=StudentEnrollment.objects.filter(
                    academic_year_id=search_year, roll_number__icontains=search,
                ).values('student_id'))
            queryset = queryset.filter(search_q)

        if academic_year:
            # Only exclude non-enrolled students on the list action — a single-student
            # detail fetch (retrieve) must still resolve even if the student has no
            # active enrollment for the requested year (e.g. withdrawn/transferred),
            # it just won't get historical enrollment-scoped fields overridden.
            if self.action == 'list' and not session_roster_month_scoped:
                # Use a JOIN to filter enrolled students (much faster than IN subquery).
                # Skipped when session_class_id already scoped the roster with
                # month-precision above -- re-applying a bare is_active check here
                # would cancel that out for a withdrawn/transferred student.
                # One filter() call so every condition is checked on the same enrollment row.
                enrollment_conditions = {'enrollments__academic_year_id': academic_year}
                if enrollment_active_filter is not None:
                    enrollment_conditions['enrollments__is_active'] = enrollment_active_filter
                if left_only:
                    enrollment_conditions['enrollments__status__in'] = left_statuses
                queryset = queryset.filter(**enrollment_conditions).distinct()
            # Annotate with enrollment-scoped roll number, class ID, and class name
            # so the serializer can return historical class info for previous sessions.
            from academic_sessions.models import StudentEnrollment
            enr_qs = StudentEnrollment.objects.filter(
                student_id=OuterRef('pk'),
                academic_year_id=academic_year,
            ).order_by('-is_active', '-updated_at', '-id')
            queryset = queryset.annotate(
                _enrollment_roll_number=Subquery(enr_qs.values('roll_number')[:1]),
                _enrollment_class_obj_id=Subquery(enr_qs.values('class_obj_id')[:1]),
                _enrollment_session_class_id=Subquery(enr_qs.values('session_class_id')[:1]),
                _enrollment_class_name=Coalesce(
                    Subquery(enr_qs.values('session_class__display_name')[:1]),
                    Subquery(enr_qs.values('class_obj__name')[:1]),
                    output_field=CharField(),
                ),
                _enrollment_class_grade=Subquery(enr_qs.values('class_obj__grade_level')[:1]),
                _enrollment_status=Subquery(enr_qs.values('status')[:1]),
                _enrollment_left_date=Subquery(enr_qs.values('left_date')[:1]),
            )
            if self.action == 'list':
                return queryset.order_by(
                    '_enrollment_class_grade', '_enrollment_class_name',
                    '_enrollment_roll_number', 'name',
                )
            return queryset

        return queryset.order_by('class_obj__grade_level', 'class_obj__name', 'roll_number')

    def perform_create(self, serializer):
        school_id = self.request.data.get('school')
        if not school_id:
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
        if school_id:
            student = serializer.save(school_id=school_id)
        else:
            student = serializer.save()

        # Auto-create enrollment for the current academic year
        from academic_sessions.models import AcademicYear, StudentEnrollment
        from academic_sessions.enrollment_service import resolve_session_class
        current_year = AcademicYear.objects.filter(
            school_id=student.school_id, is_current=True,
        ).first()
        if current_year:
            session_class = resolve_session_class(
                school_id=student.school_id,
                academic_year_id=current_year.id,
                class_obj_id=student.class_obj_id,
            )
            StudentEnrollment.objects.get_or_create(
                school_id=student.school_id,
                student=student,
                academic_year=current_year,
                defaults={
                    'class_obj': student.class_obj,
                    'session_class': session_class,
                    'roll_number': student.roll_number,
                    'status': 'ACTIVE',
                },
            )

    def destroy(self, request, *args, **kwargs):
        """A student who is part of a branch transfer cannot be deleted: either record
        is the other one's history (attendance, exams and fees are read through the
        link), so deleting one would silently cut that history off."""
        student = self.get_object()
        if student.transferred_from_id or student.transferred_to.exists():
            return Response(
                {
                    'code': 'transfer_linked',
                    'detail': (
                        f'{student.name} was transferred between branches, so this record is part of '
                        'their history and cannot be deleted. Mark them as withdrawn instead.'
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        # Same as UpdateModelMixin.update, except a leaving date that would
        # strand attendance/marks answers with the full conflict summary (counts,
        # dates, exams, suggested date) for the Update Status dialog, instead of
        # DRF's flattened field errors.
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            conflict = getattr(serializer, 'leaving_conflict', None)
            if conflict is not None:
                return Response(conflict, status=status.HTTP_400_BAD_REQUEST)
            serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

    def perform_update(self, serializer):
        # Only move the enrollment when the request actually changed class or
        # roll: a partial update (say a phone number) used to push the Student
        # snapshot -- next year's class right after promotion -- into this
        # year's enrollment.
        sent = set(serializer.validated_data)
        student = serializer.save()

        # Sync enrollment for the current academic year
        from academic_sessions.models import AcademicYear, StudentEnrollment
        from academic_sessions.enrollment_service import (
            move_student, resolve_session_class, sync_student_snapshot,
        )
        current_year = AcademicYear.objects.filter(
            school_id=student.school_id, is_current=True,
        ).first()
        if current_year:
            enrollment = StudentEnrollment.objects.filter(
                school_id=student.school_id,
                student=student,
                academic_year=current_year,
            ).first()
            if enrollment:
                if sent & {'class_obj', 'roll_number'}:
                    move_student(
                        enrollment,
                        class_obj=student.class_obj if 'class_obj' in sent else None,
                        roll_number=student.roll_number if 'roll_number' in sent else None,
                        sync_student=False,
                    )
            else:
                StudentEnrollment.objects.create(
                    school_id=student.school_id,
                    student=student,
                    academic_year=current_year,
                    class_obj=student.class_obj,
                    session_class=resolve_session_class(
                        school_id=student.school_id,
                        academic_year_id=current_year.id,
                        class_obj_id=student.class_obj_id,
                    ),
                    roll_number=student.roll_number,
                    status='ACTIVE',
                )

        # The form wrote the current year's class/roll onto the snapshot; it
        # means the latest placement, which may be next year's enrollment.
        sync_student_snapshot(student)

    @action(detail=True, methods=['post'], url_path='reclassify')
    def reclassify(self, request, pk=None):
        """Reclassify a student within a selected academic year with audit logging."""
        student = self.get_object()
        school_id = _resolve_school_id(request)

        serializer = ReclassifyStudentSerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        from academic_sessions.models import StudentEnrollment, PromotionOperation, PromotionEvent
        from academic_sessions.roll_allocator_service import RollAllocatorService
        from academic_sessions.enrollment_service import move_student, resolve_session_class

        academic_year = payload['academic_year_obj']
        target_class = payload['target_class_obj']
        target_session_class = payload.get('target_session_class_obj')

        enrollment = StudentEnrollment.objects.filter(
            school_id=school_id,
            student=student,
            academic_year=academic_year,
            is_active=True,
        ).first()
        if not enrollment:
            return Response(
                {'detail': 'Student enrollment not found for the selected academic year.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if target_session_class is None:
            # Caller sent only a master class; resolve the section up front so
            # roll allocation and the audit event see the same placement.
            target_session_class = resolve_session_class(
                school_id=school_id,
                academic_year_id=academic_year.id,
                class_obj_id=target_class.id,
                prefer_id=enrollment.session_class_id,
            )

        allocator = RollAllocatorService(
            school_id=school_id,
            academic_year_id=academic_year.id,
            class_obj_id=target_class.id,
            session_class_id=(target_session_class.id if target_session_class else None),
        )
        preferred_roll = (payload.get('new_roll_number') or enrollment.roll_number or '').strip() or None
        resolved_roll = allocator.resolve_roll(
            preferred_roll=preferred_roll,
            exclude_student_id=student.id,
        )

        old_class_id = enrollment.class_obj_id
        old_roll = enrollment.roll_number

        move_student(
            enrollment,
            session_class=target_session_class,
            class_obj=target_class,
            roll_number=resolved_roll,
        )

        operation = PromotionOperation.objects.create(
            school_id=school_id,
            source_academic_year=academic_year,
            target_academic_year=academic_year,
            source_class_id=old_class_id,
            source_session_class_id=(enrollment.session_class_id if old_class_id == target_class.id else None),
            operation_type=PromotionOperation.OperationType.SINGLE_CORRECTION,
            total_students=1,
            processed_count=1,
            skipped_count=0,
            error_count=0,
            status=PromotionOperation.OperationStatus.SUCCESS,
            reason=payload['reason'],
            initiated_by=request.user,
            metadata={'source': 'students.reclassify'},
        )

        PromotionEvent.objects.create(
            operation=operation,
            school_id=school_id,
            student=student,
            source_enrollment=enrollment,
            target_enrollment=enrollment,
            source_academic_year=academic_year,
            target_academic_year=academic_year,
            source_class_id=old_class_id,
            target_class=target_class,
            source_session_class_id=None,
            target_session_class=target_session_class,
            event_type=(
                PromotionEvent.EventType.REPEATED
                if old_class_id == target_class.id
                else PromotionEvent.EventType.PROMOTED
            ),
            old_status=enrollment.status,
            new_status=enrollment.status,
            old_roll_number=old_roll or '',
            new_roll_number=resolved_roll or '',
            reason=payload['reason'],
            details={
                'source': 'students.reclassify',
                'academic_year_id': academic_year.id,
                'old_class_id': old_class_id,
                'new_class_id': target_class.id,
                'old_roll_number': old_roll,
                'new_roll_number': resolved_roll,
            },
            created_by=request.user,
        )

        return Response({
            'message': 'Student reclassified successfully.',
            'student_id': student.id,
            'academic_year_id': academic_year.id,
            'target_class_id': target_class.id,
            'target_session_class_id': (target_session_class.id if target_session_class else None),
            'new_roll_number': resolved_roll,
        })

    @action(detail=True, methods=['post'], url_path='create-user-account')
    def create_user_account(self, request, pk=None):
        """Create a User account + StudentProfile + Membership for an existing student."""
        student = self.get_object()

        # Check if student already has a user account
        if hasattr(student, 'user_profile') and student.user_profile is not None:
            return Response(
                {'error': 'This student already has a linked user account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        username = request.data.get('username')
        email = request.data.get('email', '')
        password = request.data.get('password')
        confirm_password = request.data.get('confirm_password')

        if not username or not password:
            return Response(
                {'error': 'username and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if password != confirm_password:
            return Response(
                {'error': "Passwords don't match."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 8:
            return Response(
                {'error': 'Password must be at least 8 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if User.objects.filter(username=username).exists():
            return Response(
                {'error': 'This username is already taken.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create user
        user = User(
            username=username,
            email=email,
            first_name=student.name.split()[0] if student.name else '',
            last_name=' '.join(student.name.split()[1:]) if student.name and len(student.name.split()) > 1 else '',
            role='STAFF',  # base role; school-level role is STUDENT via membership
            school_id=student.school_id,
        )
        user.set_password(password)
        user.save()

        # Create StudentProfile link
        StudentProfile.objects.create(
            user=user,
            student=student,
            school_id=student.school_id,
        )

        # Create school membership with STUDENT role
        from schools.models import UserSchoolMembership
        UserSchoolMembership.objects.get_or_create(
            user=user,
            school_id=student.school_id,
            defaults={'role': 'STUDENT', 'is_default': True, 'is_active': True},
        )

        return Response({
            'message': 'User account created successfully.',
            'user_id': user.id,
            'username': user.username,
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='bulk-create-accounts')
    def bulk_create_accounts(self, request):
        """Bulk create user accounts for multiple existing students."""
        import re

        student_ids = request.data.get('student_ids', [])
        default_password = request.data.get('default_password', '')

        if not student_ids:
            return Response({'error': 'student_ids is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not default_password or len(default_password) < 8:
            return Response({'error': 'default_password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'error': 'No school associated.'}, status=status.HTTP_400_BAD_REQUEST)

        # Scoped through get_queryset() (not a raw Student.objects lookup) so a
        # TEACHER can only bulk-create accounts for students within their
        # assigned classes, matching the single-student create_user_account path.
        students = self.get_queryset().filter(
            id__in=student_ids, school_id=school_id,
        ).prefetch_related('user_profile')

        created = []
        skipped = []
        errors = []

        for student in students:
            if hasattr(student, 'user_profile') and student.user_profile is not None:
                skipped.append({'student_id': student.id, 'name': student.name, 'reason': 'Already has account'})
                continue

            # Auto-generate username from name
            base = re.sub(r'[^a-z0-9_]', '', student.name.lower().replace(' ', '_'))
            if not base:
                base = 'student'
            username = base
            if User.objects.filter(username=username).exists():
                username = f'{base}_{student.roll_number}' if student.roll_number else f'{base}_{student.id}'
                username = re.sub(r'[^a-z0-9_]', '', username.lower())
            if User.objects.filter(username=username).exists():
                username = f'{base}_{student.roll_number}_{school_id}'
                username = re.sub(r'[^a-z0-9_]', '', username.lower())
            if User.objects.filter(username=username).exists():
                errors.append({'student_id': student.id, 'name': student.name, 'error': 'Could not generate unique username'})
                continue

            try:
                name_parts = student.name.split() if student.name else ['']
                first_name = name_parts[0]
                last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''

                user = User(
                    username=username,
                    email=student.guardian_email or '',
                    first_name=first_name,
                    last_name=last_name,
                    role='STAFF',  # base role; school-level role is STUDENT via membership
                    school_id=school_id,
                )
                user.set_password(default_password)
                user.save()

                StudentProfile.objects.create(
                    user=user,
                    student=student,
                    school_id=school_id,
                )

                from schools.models import UserSchoolMembership
                UserSchoolMembership.objects.get_or_create(
                    user=user,
                    school_id=school_id,
                    defaults={'role': 'STUDENT', 'is_default': True, 'is_active': True},
                )

                created.append({
                    'student_id': student.id,
                    'username': username,
                    'student_name': student.name,
                })
            except Exception as e:
                errors.append({'student_id': student.id, 'name': student.name, 'error': str(e)})

        return Response({
            'created_count': len(created),
            'skipped_count': len(skipped),
            'error_count': len(errors),
            'created': created,
            'skipped': skipped,
            'errors': errors,
        })

    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
        serializer = StudentBulkCreateSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        result = serializer.save()

        all_students = result['created'] + result.get('updated', [])
        return Response({
            'created_count': len(result['created']),
            'updated_count': len(result.get('updated', [])),
            'errors': result['errors'],
            'students': StudentSerializer(all_students, many=True).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id

        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        classes = Class.objects.filter(
            school_id=school_id,
            is_active=True
        ).prefetch_related(
            db_models.Prefetch(
                'students',
                queryset=Student.objects.filter(is_active=True).order_by('roll_number')
            )
        ).order_by('grade_level', 'name')

        # Group by this year's enrollment; the Student snapshot is the latest
        # placement, which after promotion is next year's class.
        from academic_sessions.roster import current_students_by_class

        by_enrollment = current_students_by_class(school_id)
        result = []
        for cls in classes:
            members = by_enrollment.get(cls.id, []) if by_enrollment is not None else cls.students.all()
            result.append({
                'class': ClassSerializer(cls).data,
                'students': StudentSerializer(members, many=True).data
            })

        return Response(result)

    @action(detail=True, methods=['get'])
    def profile_summary(self, request, pk=None):
        """Aggregated student profile stats: attendance, fees, academics."""
        student = self.get_object()
        from django.db.models import Sum, Avg
        from decimal import Decimal

        # Attendance stats: every branch the student has been at (students.timeline), each
        # limited to its own dates. Leave days count as present, the same rule as the risk
        # assessment, so the Attendance card and the Attendance Risk card never disagree.
        from . import history, timeline
        segments = timeline.student_timeline(student)
        timeline.audit_cross_branch_read(request, student, 'profile')
        attendance = history.attendance_totals(student, segments)
        total_days, present_with_leave = attendance['total_days'], attendance['present_days']
        total_absent, total_leave = attendance['absent'], attendance['leave']
        attendance_rate = attendance['rate']

        # Fee stats: one shared calculation (see finance.student_balance), so the
        # header chip, the Overview cards and the exit checklist always agree.
        from finance.student_balance import student_fee_summary
        fees = student_fee_summary(student, segments)
        fee_total_due, fee_total_paid, pending_fee = fees['total_due'], fees['total_paid'], fees['pending']

        # Exam average: the last exam's percentage this year, the same figure the
        # AI assessment's Academic Risk uses (raw marks of different totals and years
        # used to be averaged together, which is not a percentage).
        from academic_sessions.utils import resolve_current_academic_year_id
        from examinations.academic_risk_service import AcademicRiskService
        exam_average, exam_average_label = None, None
        year_id = resolve_current_academic_year_id(student.school_id)
        if year_id:
            entry = next(iter(AcademicRiskService(student.school_id, year_id).get_at_risk_students(
                only_student_ids=[student.id], include_unflagged=True,
                timelines={student.id: segments},
            )['students']), None)
            if entry and entry.get('current_average') is not None:
                exam_average = entry['current_average']
                exam_average_label = entry.get('current_exam_name')

        # Enrollment status
        enrollment_status = None
        try:
            from academic_sessions.models import StudentEnrollment
            latest = StudentEnrollment.objects.filter(
                student=student
            ).order_by('-academic_year__start_date').first()
            if latest:
                enrollment_status = latest.status
        except Exception:
            pass

        latest_exit = None
        if get_effective_role(request) in ADMIN_ROLES:
            from student_exits.models import StudentExit
            from student_exits.serializers import StudentExitSerializer

            exit_case = (
                StudentExit.objects.filter(student=student)
                .exclude(status=StudentExit.Status.CANCELLED)
                .select_related('student', 'destination_school', 'requested_by', 'finalized_by')
                .prefetch_related('items__waived_by')
                .first()
            )
            latest_exit = StudentExitSerializer(exit_case).data if exit_case else None

        return Response({
            'student': StudentSerializer(student).data,
            'attendance_rate': attendance_rate,
            'present_days': present_with_leave,
            'total_absent': total_absent,
            'total_leave': total_leave,
            'total_days': total_days,
            'total_due': float(fee_total_due),
            'total_paid': float(fee_total_paid),
            'outstanding': float(pending_fee),
            'pending_fee': float(pending_fee),
            'latest_exit': latest_exit,
            'exam_average': exam_average,
            'exam_average_label': exam_average_label,
            'enrollment_status': enrollment_status,
            'has_earlier_branch_data': len(segments) > 1,
            'earlier_branches': [s.school_name for s in segments if not s.is_current],
        })

    @action(detail=True, methods=['get'])
    def attendance_history(self, request, pk=None):
        """Monthly attendance breakdown for a student."""
        student = self.get_object()
        from . import history

        # Every branch the student has been at; a month that spans a transfer has one
        # row per branch, the earlier branch's tagged and read-only.
        return Response({'months': history.attendance_months(student)})

    @action(detail=True, methods=['get'])
    def fee_ledger(self, request, pk=None):
        """All fee payments for a student."""
        student = self.get_object()
        from . import history

        # Both branches' ledgers, each row tagged; what is still owed is only the
        # current branch's (a carried balance was handed over).
        return Response(history.fee_rows(student))

    @action(detail=True, methods=['get'])
    def exam_results(self, request, pk=None):
        """All exam marks grouped by exam."""
        student = self.get_object()
        from . import history

        # Exams of every branch the student has been at, each from its own branch's rows
        # and grade scale; earlier branches' exams are tagged and read-only.
        return Response(history.exam_groups(student))

    @action(detail=True, methods=['get'], url_path='earlier_assessments')
    def earlier_assessments(self, request, pk=None):
        """Skills/behaviour ratings and remarks from earlier branches, read-only."""
        student = self.get_object()
        from . import history

        return Response(history.earlier_assessments(student))

    @action(detail=True, methods=['get'])
    def away_periods(self, request, pk=None):
        """The student's recorded absences (withdrawn, then re-admitted), oldest first."""
        student = self.get_object()
        from student_exits.serializers import EnrollmentBreakSerializer

        breaks = student.enrollment_breaks.select_related('readmitted_by', 'exit').order_by('start_date', 'id')
        return Response(EnrollmentBreakSerializer(breaks, many=True).data)

    @action(detail=True, methods=['get'])
    def enrollment_history(self, request, pk=None):
        """Enrollment records across academic years."""
        student = self.get_object()
        from . import history

        # Enrollments at every branch the student has been at (earlier ones tagged).
        return Response(history.enrollment_rows(student))

    @action(detail=True, methods=['get', 'post'], url_path='documents')
    def documents(self, request, pk=None):
        """List or upload student documents."""
        student = self.get_object()

        if request.method == 'GET':
            from . import history

            # Earlier branches' documents are shown too (tagged); uploading and deleting
            # only ever touch this record.
            return Response(history.document_rows(student))

        # POST
        serializer = StudentDocumentSerializer(data={
            **request.data,
            'school': student.school_id,
            'student': student.id,
        })
        serializer.is_valid(raise_exception=True)
        serializer.save(uploaded_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path='documents/(?P<doc_id>[0-9]+)')
    def delete_document(self, request, pk=None, doc_id=None):
        """Delete a student document."""
        student = self.get_object()
        try:
            doc = StudentDocument.objects.get(id=doc_id, student=student)
            doc.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except StudentDocument.DoesNotExist:
            return Response({'error': 'Document not found'}, status=404)

    @action(detail=True, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_photo(self, request, pk=None):
        """Upload (or replace) a student's profile photo."""
        from PIL import UnidentifiedImageError
        from core.storage import storage_service, validate_photo_upload

        student = self.get_object()

        if 'file' not in request.FILES:
            return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

        file = request.FILES['file']

        try:
            validate_photo_upload(file)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            if student.photo_url:
                old_path = storage_service._extract_storage_path(student.photo_url)
                if old_path:
                    storage_service.delete_file(old_path)

            url = storage_service.upload_student_photo(file, student.school_id, student.id)
            student.photo_url = url
            student.save(update_fields=['photo_url', 'updated_at'])

            return Response({'photo_url': url, 'message': 'Photo uploaded successfully.'})
        except UnidentifiedImageError:
            return Response(
                {'error': 'Could not process image file. It may be corrupted or in an unsupported format.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='remove_photo')
    def remove_photo(self, request, pk=None):
        """Remove a student's profile photo."""
        from core.storage import storage_service

        student = self.get_object()
        if student.photo_url:
            old_path = storage_service._extract_storage_path(student.photo_url)
            if old_path:
                storage_service.delete_file(old_path)
            student.photo_url = ''
            student.save(update_fields=['photo_url', 'updated_at'])

        return Response({'message': 'Photo removed.'})

    @action(detail=True, methods=['get'], url_path='ai-profile')
    def ai_profile(self, request, pk=None):
        """AI-generated 360 student risk profile."""
        student = self.get_object()
        from .ai_service import Student360Service, can_see_fees
        service = Student360Service(student.school_id, student.id)
        # Teachers and other non-finance roles get the profile without any fee detail.
        profile = service.generate_profile(include_fees=can_see_fees(get_effective_role(request)))
        return Response(profile)


# ── Student Portal Views ────────────────────────────────────────


def _get_student_for_request(request):
    """Get the Student record linked to the authenticated student user."""
    try:
        return request.user.student_profile.student
    except (StudentProfile.DoesNotExist, AttributeError):
        return None


class StudentRegistrationView(APIView):
    """Register a student account using an invite code."""
    permission_classes = []

    def post(self, request):
        invite_code = request.data.get('invite_code', '').strip()
        email = request.data.get('email', '').strip()
        password = request.data.get('password', '')
        full_name = request.data.get('full_name', '').strip()

        if not all([invite_code, email, password]):
            return Response(
                {'error': 'invite_code, email, and password are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            invite = StudentInvite.objects.select_related('student', 'school').get(
                invite_code=invite_code,
            )
        except StudentInvite.DoesNotExist:
            return Response({'error': 'Invalid invite code.'}, status=status.HTTP_400_BAD_REQUEST)

        if not invite.is_valid:
            return Response({'error': 'Invite code has expired or already been used.'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email=email).exists():
            return Response({'error': 'A user with this email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

        if hasattr(invite.student, 'user_profile'):
            return Response({'error': 'This student already has a portal account.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create user + profile + membership
        user = User.objects.create_user(
            email=email,
            password=password,
            first_name=full_name.split()[0] if full_name else '',
            last_name=' '.join(full_name.split()[1:]) if full_name and len(full_name.split()) > 1 else '',
        )

        StudentProfile.objects.create(
            user=user,
            student=invite.student,
            school=invite.school,
        )

        from schools.models import UserSchoolMembership
        UserSchoolMembership.objects.create(
            user=user,
            school=invite.school,
            role=UserSchoolMembership.Role.STUDENT,
            is_default=True,
        )

        invite.is_used = True
        invite.save(update_fields=['is_used'])

        return Response({
            'message': 'Student account created successfully.',
            'student_name': invite.student.name,
            'school_name': invite.school.name,
        }, status=status.HTTP_201_CREATED)


class StudentProfileView(APIView):
    """The logged-in student's own profile -- personal, academic, and
    guardian info. Reuses the admin-facing StudentSerializer (same shape
    StudentDashboardView already nests under 'student') rather than a
    second serializer, since a student's own record needs no field
    reduction beyond what's already scoped by _get_student_for_request."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        return Response({'student': StudentSerializer(student).data})


class StudentDashboardView(APIView):
    """Dashboard data for a logged-in student."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from finance.student_balance import student_fee_summary
        from . import history, timeline

        # Attendance and fees cover every branch the student has been at (students.timeline);
        # the fee summary is the shared one, so staff, parents and the student agree.
        segments = timeline.student_timeline(student)
        att = history.attendance_totals(student, segments)
        total_days, absent, leave = att['total_days'], att['absent'], att['leave']
        present = att['present_days'] - leave
        fees = student_fee_summary(student, segments)

        from academic_sessions.roster import current_year_q, own_section_q, placement_scope
        class_obj_id, year_id = placement_scope(student)

        # Upcoming assignments
        upcoming_assignments = []
        try:
            from lms.models import Assignment
            assignments = Assignment.objects.filter(
                class_obj_id=class_obj_id,
                school=student.school,
                status='PUBLISHED',
                due_date__gte=timezone.now(),
            ).filter(current_year_q(year_id)).filter(own_section_q(student)).select_related('subject').order_by('due_date')[:5]
            upcoming_assignments = [
                {
                    'id': a.id,
                    'title': a.title,
                    'subject': a.subject.name,
                    'due_date': a.due_date.isoformat(),
                    'type': a.assignment_type,
                }
                for a in assignments
            ]
        except Exception:
            pass

        # Today's timetable
        today_timetable = []
        try:
            from academics.timetable_scope import student_timetable
            day_map = {0: 'MON', 1: 'TUE', 2: 'WED', 3: 'THU', 4: 'FRI', 5: 'SAT', 6: 'SUN'}
            today = day_map.get(timezone.now().weekday(), 'MON')
            entries = student_timetable(student).filter(
                day=today,
            ).select_related('slot', 'subject', 'teacher').order_by('slot__order')
            today_timetable = [
                {
                    'slot': e.slot.name,
                    'start_time': str(e.slot.start_time),
                    'end_time': str(e.slot.end_time),
                    'subject': e.subject.name if e.subject else None,
                    'teacher': e.teacher.user.get_full_name() if e.teacher else None,
                    'room': e.room,
                }
                for e in entries
            ]
        except Exception:
            pass

        return Response({
            'student': StudentSerializer(student).data,
            'attendance': {
                'total_days': total_days,
                'present': present,
                'absent': absent,
                'leave': leave,
                'rate': att['rate'],
            },
            'fees': {
                'total_due': str(fees['total_due']),
                'total_paid': str(fees['total_paid']),
                'outstanding': str(fees['pending']),
            },
            'upcoming_assignments': upcoming_assignments,
            'today_timetable': today_timetable,
        })


class StudentAttendanceView(APIView):
    """Student's own attendance records."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from django.db.models import Count, Q
        from . import history, timeline

        # Every branch the student has been at; earlier branches' records are tagged.
        segments = timeline.student_timeline(student)
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        month_year = {'month': month, 'year': year} if month and year else {}
        records = [
            {k: v for k, v in row.items() if k not in ('id', 'created_at')}
            for row in history.attendance_rows(student, segments, limit=200, **month_year)
        ]
        qs = history.attendance_records(student, segments)
        if month_year:
            qs = qs.filter(date__month=int(month), date__year=int(year))
        counts = qs.aggregate(
            total=Count('id'), present=Count('id', filter=Q(status='PRESENT')),
            absent=Count('id', filter=Q(status='ABSENT')), late=Count('id', filter=Q(status='LATE')),
            leave=Count('id', filter=Q(status='LEAVE')),
        )
        total = counts['total']

        return Response({
            'records': records,
            'summary': {
                'total_days': total,
                'present': counts['present'],
                'absent': counts['absent'],
                'late': counts['late'],
                'leave': counts['leave'],
                # Leave counts as present, the same rule as the profile and the risk assessment.
                'rate': round((counts['present'] + counts['leave']) / total * 100, 1) if total > 0 else 0,
            },
        })


class StudentFeesView(APIView):
    """Student's own fee records."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from . import history
        return Response(history.fee_rows(student))


class StudentTimetableView(APIView):
    """Student's class timetable."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from academics.models import TimetableSlot
        from academics.timetable_scope import student_timetable
        slots = TimetableSlot.objects.filter(school=student.school).order_by('order')
        # The student's section timetable: its overrides over the class's shared entries.
        entries = student_timetable(student).select_related('slot', 'subject', 'teacher')

        slot_data = [
            {'id': s.id, 'name': s.name, 'start_time': str(s.start_time), 'end_time': str(s.end_time), 'slot_type': s.slot_type, 'order': s.order, 'applicable_days': s.applicable_days}
            for s in slots
        ]
        entry_data = [
            {
                'day': e.day,
                'slot_id': e.slot_id,
                'subject': e.subject.name if e.subject else None,
                'teacher': e.teacher.user.get_full_name() if e.teacher else None,
                'room': e.room,
            }
            for e in entries
        ]

        return Response({'slots': slot_data, 'entries': entry_data})


class StudentLibraryView(APIView):
    """Student's own book issue history (current + past)."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from library.models import BookIssue

        issues = BookIssue.objects.filter(
            student=student, borrower_type='STUDENT',
        ).select_related('book').order_by('-issue_date')

        result = []
        for issue in issues:
            result.append({
                'id': issue.id,
                'book_title': issue.book.title,
                'book_author': issue.book.author,
                'issue_date': issue.issue_date,
                'due_date': issue.due_date,
                'return_date': issue.return_date,
                'status': issue.status,
                'fine_amount': str(issue.fine_amount),
            })

        return Response(result)


class StudentTransportView(APIView):
    """Student's own transport (bus route/stop/vehicle) assignment."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from transport.models import TransportAssignment

        assignment = TransportAssignment.objects.filter(
            student=student, is_active=True,
        ).select_related('route', 'stop', 'vehicle').first()

        if not assignment:
            return Response(None)

        route = assignment.route
        stop = assignment.stop
        vehicle = assignment.vehicle

        return Response({
            'transport_type': assignment.transport_type,
            'route': {
                'name': route.name,
                'start_location': route.start_location,
                'end_location': route.end_location,
                'distance_km': str(route.distance_km) if route.distance_km is not None else None,
                'estimated_duration_minutes': route.estimated_duration_minutes,
            },
            'stop': {
                'name': stop.name,
                'address': stop.address,
                'stop_order': stop.stop_order,
                'pickup_time': str(stop.pickup_time),
                'drop_time': str(stop.drop_time),
            },
            'vehicle': {
                'vehicle_number': vehicle.vehicle_number,
                'vehicle_type': vehicle.vehicle_type,
                'driver_name': vehicle.driver_name,
                'driver_phone': vehicle.driver_phone,
            } if vehicle else None,
        })


class StudentExamScheduleView(APIView):
    """Student's own class exam schedule (date sheet) -- only exams whose
    schedule has been published for this class, per Exam.schedule_published_at.
    Deliberately separate from results/marks visibility (see StudentResultsView),
    which gates on Exam.status=PUBLISHED instead."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from examinations.models import Exam
        from academic_sessions.roster import current_year_q, own_section_q, placement_scope
        class_obj_id, year_id = placement_scope(student)
        exams = Exam.objects.filter(
            school=student.school,
            class_obj_id=class_obj_id,
            is_active=True,
            schedule_published_at__isnull=False,
        ).filter(current_year_q(year_id)).filter(own_section_q(student)).select_related('exam_type', 'exam_group').order_by('start_date').prefetch_related(
            'exam_subjects__subject',
        )

        result = []
        for exam in exams:
            subjects = [
                {
                    'subject_name': es.subject.name,
                    'subject_code': es.subject.code,
                    'exam_date': str(es.exam_date) if es.exam_date else None,
                    'start_time': str(es.start_time) if es.start_time else None,
                    'end_time': str(es.end_time) if es.end_time else None,
                }
                for es in exam.exam_subjects.filter(is_active=True).order_by('exam_date')
            ]
            result.append({
                'exam_id': exam.id,
                'exam_name': exam.name,
                'exam_type': exam.exam_type.name if exam.exam_type else None,
                'exam_group_name': exam.exam_group.name if exam.exam_group else None,
                'start_date': str(exam.start_date) if exam.start_date else None,
                'end_date': str(exam.end_date) if exam.end_date else None,
                'subjects': subjects,
            })

        return Response(result)


class StudentResultsView(APIView):
    """Student's own exam results."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        from . import history

        # Published results at every branch the student has been at (earlier ones tagged).
        return Response(history.portal_exam_results(student))


class StudentAssignmentsView(APIView):
    """Student's assignments and submission status."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        try:
            from lms.models import Assignment, AssignmentSubmission
            from academic_sessions.roster import current_year_q, own_section_q, placement_scope
            class_obj_id, year_id = placement_scope(student)
            assignments = Assignment.objects.filter(
                class_obj_id=class_obj_id,
                school=student.school,
                status__in=['PUBLISHED', 'CLOSED'],
                is_active=True,
            ).filter(current_year_q(year_id)).filter(own_section_q(student)).select_related('subject', 'teacher').order_by('-due_date')

            data = []
            for a in assignments:
                submission = AssignmentSubmission.objects.filter(
                    assignment=a, student=student,
                ).first()
                data.append({
                    'id': a.id,
                    'title': a.title,
                    'description': a.description,
                    'subject': a.subject.name,
                    'teacher': a.teacher.user.get_full_name() if a.teacher else None,
                    'assignment_type': a.assignment_type,
                    'requires_submission': a.requires_submission,
                    'due_date': a.due_date.isoformat() if a.due_date else None,
                    'total_marks': float(a.total_marks) if a.total_marks else None,
                    'status': a.status,
                    'submission': {
                        'id': submission.id,
                        'status': submission.status,
                        'submitted_at': submission.submitted_at.isoformat(),
                        'marks_obtained': float(submission.marks_obtained) if submission.marks_obtained else None,
                        'feedback': submission.feedback,
                    } if submission else None,
                })
            return Response(data)
        except Exception:
            return Response([])

    def post(self, request):
        """Submit an assignment."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)

        assignment_id = request.data.get('assignment_id')
        if not assignment_id:
            return Response({'error': 'assignment_id is required.'}, status=400)

        try:
            from lms.models import Assignment, AssignmentSubmission
            from academic_sessions.roster import current_year_q, own_section_q, placement_scope
            class_obj_id, year_id = placement_scope(student)
            assignment = Assignment.objects.filter(current_year_q(year_id)).filter(own_section_q(student)).get(
                id=assignment_id,
                class_obj_id=class_obj_id,
                school=student.school,
                status='PUBLISHED',
            )
        except Exception:
            return Response({'error': 'Assignment not found or not available.'}, status=404)

        if not assignment.requires_submission:
            return Response(
                {'error': 'This assignment does not accept submissions.'},
                status=400,
            )

        if AssignmentSubmission.objects.filter(assignment=assignment, student=student).exists():
            return Response({'error': 'You have already submitted this assignment.'}, status=400)

        sub_status = 'SUBMITTED'
        if assignment.due_date and timezone.now() > assignment.due_date:
            sub_status = 'LATE'

        submission = AssignmentSubmission.objects.create(
            assignment=assignment,
            student=student,
            school=student.school,
            submission_text=request.data.get('submission_text', ''),
            file_url=request.data.get('file_url', ''),
            file_name=request.data.get('file_name', ''),
            status=sub_status,
        )

        return Response({
            'id': submission.id,
            'status': submission.status,
            'submitted_at': submission.submitted_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class AdminStudentInviteView(APIView):
    """Admin endpoint to generate student portal invite codes."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def post(self, request):
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required.'}, status=400)

        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({'error': 'Student not found.'}, status=404)

        if hasattr(student, 'user_profile'):
            return Response({'error': 'This student already has a portal account.'}, status=400)

        invite = StudentInvite.objects.create(
            school=student.school,
            student=student,
            created_by=request.user,
        )

        return Response({
            'invite_code': invite.invite_code,
            'student_name': student.name,
            'expires_at': invite.expires_at.isoformat(),
        }, status=status.HTTP_201_CREATED)


class StudyHelperView(APIView):
    """AI Study Helper chat for students."""
    permission_classes = [IsAuthenticated, IsStudent]

    def get(self, request):
        """Get chat history (last 50 messages)."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        from .models import StudyHelperMessage
        messages = StudyHelperMessage.objects.filter(student=student).order_by('-created_at')[:50]
        data = [
            {
                'id': m.id,
                'role': m.role,
                'content': m.content,
                'created_at': m.created_at,
            }
            for m in reversed(messages)
        ]
        return Response(data)

    def post(self, request):
        """Send a message and get AI response."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        message = request.data.get('message', '').strip()
        if not message:
            return Response({'error': 'Message is required.'}, status=400)
        if len(message) > 2000:
            return Response({'error': 'Message too long (max 2000 characters).'}, status=400)

        from .study_helper_service import StudyHelperService
        service = StudyHelperService(student, student.school)

        if not service.check_rate_limit():
            return Response(
                {'error': 'Daily limit reached (30 messages/day). Try again tomorrow.'},
                status=429,
            )

        is_safe, reason = service.check_content_safety(message)
        if not is_safe:
            return Response({'error': reason}, status=400)

        try:
            response_text = service.chat(message)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Study helper error: {e}")
            response_text = "I'm sorry, I encountered an error. Please try again."

        return Response({'response': response_text})

    def delete(self, request):
        """Clear chat history."""
        student = _get_student_for_request(request)
        if not student:
            return Response({'error': 'No student profile linked.'}, status=404)
        from .models import StudyHelperMessage
        count, _ = StudyHelperMessage.objects.filter(student=student).delete()
        return Response({'deleted': count})
