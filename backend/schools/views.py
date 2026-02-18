"""
School views for tenant management.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.apps import apps
from django.utils import timezone
from django.db.models import Count, Q
from datetime import timedelta

from core.permissions import IsSuperAdmin, HasSchoolAccess
from core.mixins import TenantQuerySetMixin
from .models import School, Organization, UserSchoolMembership
from .serializers import (
    SchoolSerializer,
    SchoolCreateSerializer,
    SchoolStatsSerializer,
    MarkMappingsSerializer,
    RegisterConfigSerializer,
    OrganizationSerializer,
    OrganizationCreateSerializer,
    MembershipSerializer,
    MembershipCreateSerializer,
)


class SuperAdminSchoolViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Super Admin to manage all schools.

    Provides:
    - List all schools
    - Create new schools
    - Update school settings
    - Activate/deactivate schools
    - View school statistics
    """
    queryset = School.objects.all()
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get_serializer_class(self):
        if self.action == 'create':
            return SchoolCreateSerializer
        return SchoolSerializer

    def get_queryset(self):
        queryset = School.objects.annotate(
            user_count=Count('users'),
            student_count=Count('students', filter=Q(students__is_active=True))
        )

        # Filter by status if provided
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset.order_by('name')

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Activate a school."""
        school = self.get_object()
        school.is_active = True
        school.save()
        return Response({'message': f'{school.name} has been activated.'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        """Deactivate a school."""
        school = self.get_object()
        school.is_active = False
        school.save()
        return Response({'message': f'{school.name} has been deactivated.'})

    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        """Get detailed statistics for a school."""
        school = self.get_object()

        # Get current month
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        stats = {
            'total_students': school.students.filter(is_active=True).count(),
            'total_classes': school.classes.filter(is_active=True).count(),
            'total_users': school.users.filter(is_active=True).count(),
            'total_uploads': school.attendance_uploads.count(),
            'uploads_this_month': school.attendance_uploads.filter(
                created_at__gte=month_start
            ).count(),
            'confirmed_uploads': school.attendance_uploads.filter(
                status='CONFIRMED'
            ).count(),
            'failed_uploads': school.attendance_uploads.filter(
                status='FAILED'
            ).count(),
            'pending_reviews': school.attendance_uploads.filter(
                status='REVIEW_REQUIRED'
            ).count(),
        }

        serializer = SchoolStatsSerializer(stats)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def platform_stats(self, request):
        """Platform-wide aggregate statistics for the SuperAdmin overview."""
        from students.models import Student
        from users.models import User
        from attendance.models import AttendanceUpload

        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        thirty_days_ago = now - timedelta(days=30)

        total_schools = School.objects.count()
        active_schools = School.objects.filter(is_active=True).count()
        total_students = Student.objects.filter(is_active=True).count()
        total_users = User.objects.filter(is_active=True).count()

        # Attendance
        uploads_this_month = AttendanceUpload.objects.filter(
            created_at__gte=month_start).count()

        # Recent activity
        recent_schools = School.objects.filter(
            created_at__gte=thirty_days_ago).count()
        recent_users = User.objects.filter(
            created_at__gte=thirty_days_ago).count()

        # Per-school breakdown (distinct=True to avoid cross-join inflation)
        school_breakdown = list(
            School.objects.filter(is_active=True).annotate(
                student_count=Count('students', filter=Q(students__is_active=True), distinct=True),
                user_count=Count('users', filter=Q(users__is_active=True), distinct=True),
            ).values('id', 'name', 'student_count', 'user_count', 'created_at')
            .order_by('name')
        )

        return Response({
            'total_schools': total_schools,
            'active_schools': active_schools,
            'total_students': total_students,
            'total_users': total_users,
            'uploads_this_month': uploads_this_month,
            'recent_schools': recent_schools,
            'recent_users': recent_users,
            'school_breakdown': school_breakdown,
        })


class SuperAdminOrganizationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Super Admin to manage organizations.
    """
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return OrganizationCreateSerializer
        return OrganizationSerializer

    def get_queryset(self):
        return Organization.objects.annotate(
            school_count=Count('schools')
        ).order_by('name')

    def perform_update(self, serializer):
        org = serializer.save()
        # Cascade: disable modules on schools that the org no longer allows
        org.cascade_disabled_modules()


class SuperAdminMembershipViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Super Admin to manage user-school memberships.
    """
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return MembershipCreateSerializer
        return MembershipSerializer

    def get_queryset(self):
        qs = UserSchoolMembership.objects.select_related('user', 'school').order_by('-created_at')
        user_id = self.request.query_params.get('user_id')
        school_id = self.request.query_params.get('school_id')
        if user_id:
            qs = qs.filter(user_id=user_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        return qs


class ModuleRegistryView(APIView):
    """
    Returns the list of all available modules with metadata.
    Used by the admin panel to render module toggle controls.
    """
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        from core.module_registry import MODULE_REGISTRY
        modules = list(MODULE_REGISTRY.values())
        return Response(modules)


class SchoolViewSet(TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for School Admins to view their school.

    Only provides read access - school settings are managed by Super Admin.
    """
    queryset = School.objects.all()
    serializer_class = SchoolSerializer
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_queryset(self):
        """Filter to only show schools the user has access to."""
        if self.request.user.is_super_admin:
            return School.objects.all()

        school_ids = self.request.user.get_accessible_school_ids()
        if school_ids:
            return School.objects.filter(id__in=school_ids)

        return School.objects.none()

    @action(detail=False, methods=['get'])
    def current(self, request):
        """Get the current user's active school."""
        school = getattr(request, 'tenant_school', None) or request.user.school
        if school:
            serializer = self.get_serializer(school)
            return Response(serializer.data)
        return Response(
            {'error': 'No school associated with this user.'},
            status=status.HTTP_404_NOT_FOUND
        )

    @action(detail=False, methods=['get', 'put'])
    def mark_mappings(self, request):
        """
        Get or update mark mappings for the current school.
        """
        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        if request.method == 'GET':
            return Response({
                'mark_mappings': school.mark_mappings,
                'school_name': school.name
            })

        # PUT - Update mark mappings
        serializer = MarkMappingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school.mark_mappings = serializer.validated_data
        school.save(update_fields=['mark_mappings', 'updated_at'])

        return Response({
            'success': True,
            'message': 'Mark mappings updated successfully.',
            'mark_mappings': school.mark_mappings
        })

    @action(detail=False, methods=['get', 'put'])
    def register_config(self, request):
        """
        Get or update register configuration for the current school.
        """
        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        if request.method == 'GET':
            return Response({
                'register_config': school.register_config,
                'school_name': school.name
            })

        # PUT - Update register config
        serializer = RegisterConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school.register_config = serializer.validated_data
        school.save(update_fields=['register_config', 'updated_at'])

        return Response({
            'success': True,
            'message': 'Register configuration updated successfully.',
            'register_config': school.register_config
        })

    # Module step definitions: (step_label, app_label, model_name, filter_kwargs, link)
    # filter_kwargs uses 'school_id' by default; override with full lookup for indirect FKs
    MODULE_STEPS = {
        'students': [
            ('Classes created', 'students', 'Class', {}, '/classes'),
            ('Students added', 'students', 'Student', {'is_active': True}, '/students'),
        ],
        'hr': [
            ('Departments created', 'hr', 'StaffDepartment', {'is_active': True}, '/hr/departments'),
            ('Staff members added', 'hr', 'StaffMember', {}, '/hr/staff'),
            ('Salary structures defined', 'hr', 'SalaryStructure', {}, '/hr/salary'),
        ],
        'finance': [
            ('Accounts created', 'finance', 'Account', {'is_active': True}, '/finance/fees'),
            ('Fee structures defined', 'finance', 'FeeStructure', {}, '/finance/fees'),
        ],
        'academics': [
            ('Subjects created', 'academics', 'Subject', {'is_active': True}, '/academics/subjects'),
            ('Class-subject assignments', 'academics', 'ClassSubject', {'is_active': True}, '/academics/subjects'),
            ('Timetable configured', 'academics', 'TimetableEntry', {}, '/academics/timetable'),
        ],
        'examinations': [
            ('Exam types defined', 'examinations', 'ExamType', {'is_active': True}, '/academics/exam-types'),
            ('Grade scales defined', 'examinations', 'GradeScale', {'is_active': True}, '/academics/grade-scale'),
            ('Exams created', 'examinations', 'Exam', {'is_active': True}, '/academics/exams'),
        ],
        'attendance': [
            ('Attendance uploads made', 'attendance', 'AttendanceUpload', {}, '/attendance'),
        ],
        'admissions': [
            ('Enquiries recorded', 'admissions', 'AdmissionEnquiry', {}, '/admissions'),
        ],
        'transport': [
            ('Routes created', 'transport', 'TransportRoute', {'is_active': True}, '/transport/routes'),
            ('Vehicles added', 'transport', 'TransportVehicle', {'is_active': True}, '/transport/vehicles'),
            ('Student assignments made', 'transport', 'TransportAssignment', {}, '/transport/assignments'),
        ],
        'library': [
            ('Categories created', 'library', 'BookCategory', {}, '/library/catalog'),
            ('Books added', 'library', 'Book', {'is_active': True}, '/library/catalog'),
        ],
        'hostel': [
            ('Hostels created', 'hostel', 'Hostel', {'is_active': True}, '/hostel'),
            ('Rooms defined', 'hostel', 'Room', {}, '/hostel/rooms'),
            ('Student allocations made', 'hostel', 'HostelAllocation', {'is_active': True}, '/hostel/allocations'),
        ],
        'inventory': [
            ('Categories created', 'inventory', 'InventoryCategory', {'is_active': True}, '/inventory'),
            ('Items added', 'inventory', 'InventoryItem', {'is_active': True}, '/inventory/items'),
        ],
        'lms': [
            ('Lesson plans created', 'lms', 'LessonPlan', {'is_active': True}, '/academics/lesson-plans'),
            ('Assignments created', 'lms', 'Assignment', {}, '/academics/assignments'),
        ],
        'notifications': [
            ('Templates created', 'notifications', 'NotificationTemplate', {'is_active': True}, '/notifications'),
            ('Notification config set up', 'notifications', 'SchoolNotificationConfig', {}, '/notifications'),
        ],
    }

    # Models where school FK is indirect (not school_id directly)
    INDIRECT_SCHOOL_FK = {
        ('hostel', 'Room'): 'hostel__school_id',
    }

    @action(detail=False, methods=['get'])
    def completion(self, request):
        """Get setup completion data for all enabled modules of the current school."""
        from core.module_registry import MODULE_REGISTRY

        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        effective_modules = school.get_effective_modules()
        modules_data = []
        total_steps = 0
        total_completed = 0

        for module_key, steps_config in self.MODULE_STEPS.items():
            if not effective_modules.get(module_key, False):
                continue

            module_meta = MODULE_REGISTRY.get(module_key, {})
            steps_result = []

            for step_label, app_label, model_name, extra_filters, link in steps_config:
                Model = apps.get_model(app_label, model_name)

                # Use indirect FK lookup if defined, otherwise default to school_id
                school_field = self.INDIRECT_SCHOOL_FK.get(
                    (app_label, model_name), 'school_id'
                )
                filters = {school_field: school.id}
                filters.update(extra_filters)

                count = Model.objects.filter(**filters).count()

                steps_result.append({
                    'name': step_label,
                    'completed': count > 0,
                    'count': count,
                    'link': link,
                })
                total_steps += 1
                if count > 0:
                    total_completed += 1

            completed_count = sum(1 for s in steps_result if s['completed'])
            percentage = round((completed_count / len(steps_result)) * 100) if steps_result else 0

            modules_data.append({
                'key': module_key,
                'label': module_meta.get('label', module_key),
                'percentage': percentage,
                'steps': steps_result,
            })

        overall_percentage = round((total_completed / total_steps) * 100) if total_steps > 0 else 0

        return Response({
            'overall_percentage': overall_percentage,
            'total_steps': total_steps,
            'completed_steps': total_completed,
            'modules': modules_data,
        })
