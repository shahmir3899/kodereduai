"""
School views for tenant management.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
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
        queryset = School.objects.select_related('organization').annotate(
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
        base_qs = School.objects.select_related('organization')
        if self.request.user.is_super_admin:
            return base_qs.all()

        school_ids = self.request.user.get_accessible_school_ids()
        if school_ids:
            return base_qs.filter(id__in=school_ids)

        return base_qs.none()

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

    @action(detail=False, methods=['get'], permission_classes=[], url_path='by-subdomain')
    def by_subdomain(self, request):
        """
        Public endpoint to fetch school by subdomain.
        GET /api/schools/by-subdomain/?subdomain=focus
        
        No authentication required - used by frontend to detect school on load.
        Returns basic school info: id, name, logo, subdomain.
        """
        subdomain = request.query_params.get('subdomain')
        if not subdomain:
            return Response(
                {'detail': 'Missing subdomain query parameter.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            school = School.objects.get(subdomain=subdomain, is_active=True)
            serializer = self.get_serializer(school)
            return Response(serializer.data)
        except School.DoesNotExist:
            return Response(
                {'detail': f'School with subdomain "{subdomain}" not found.'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get', 'put'])
    def exam_config(self, request):
        """Get or update examination configuration for the current school."""
        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        if request.method == 'GET':
            return Response({
                'exam_config': school.exam_config,
                'school_name': school.name
            })

        # PUT - Update exam config
        from core.permissions import get_effective_role, ADMIN_ROLES
        role = get_effective_role(request)
        if role not in ADMIN_ROLES:
            return Response(
                {'error': 'Only school admins can update exam configuration.'},
                status=status.HTTP_403_FORBIDDEN
            )

        exam_config = school.exam_config or {}
        new_data = request.data
        if 'weighted_average_enabled' in new_data:
            exam_config['weighted_average_enabled'] = bool(new_data['weighted_average_enabled'])

        school.exam_config = exam_config
        school.save(update_fields=['exam_config', 'updated_at'])

        return Response({
            'success': True,
            'message': 'Exam configuration updated successfully.',
            'exam_config': school.exam_config
        })

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_asset(self, request):
        """
        Upload a school logo or letterhead image.
        POST /api/schools/upload_asset/
        """
        from core.storage import storage_service
        from core.permissions import get_effective_role, ADMIN_ROLES

        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        role = get_effective_role(request)
        if role not in ADMIN_ROLES:
            return Response(
                {'error': 'Only school admins can upload assets.'},
                status=status.HTTP_403_FORBIDDEN
            )

        asset_type = request.data.get('asset_type')
        if asset_type not in ('logo', 'letterhead'):
            return Response(
                {'error': 'asset_type must be "logo" or "letterhead".'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if 'file' not in request.FILES:
            return Response(
                {'error': 'No file provided.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        file = request.FILES['file']

        allowed_types = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
        if file.content_type not in allowed_types:
            return Response(
                {'error': f'Invalid file type. Allowed: {", ".join(allowed_types)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        max_size = 5 * 1024 * 1024
        if file.size > max_size:
            return Response(
                {'error': 'File too large. Maximum size is 5MB.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            old_url = school.logo if asset_type == 'logo' else school.letterhead_url
            if old_url:
                old_path = storage_service._extract_storage_path(old_url)
                if old_path:
                    storage_service.delete_file(old_path)

            url = storage_service.upload_school_asset(file, school.id, asset_type)

            if asset_type == 'logo':
                school.logo = url
                school.save(update_fields=['logo', 'updated_at'])
            else:
                school.letterhead_url = url
                school.save(update_fields=['letterhead_url', 'updated_at'])

            return Response({
                'url': url,
                'asset_type': asset_type,
                'message': f'{asset_type.capitalize()} uploaded successfully.'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['delete'])
    def delete_asset(self, request):
        """
        Delete a school logo or letterhead.
        DELETE /api/schools/delete_asset/?asset_type=logo
        """
        from core.storage import storage_service
        from core.permissions import get_effective_role, ADMIN_ROLES

        school = getattr(request, 'tenant_school', None) or request.user.school
        if not school:
            return Response(
                {'error': 'No school associated with this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        role = get_effective_role(request)
        if role not in ADMIN_ROLES:
            return Response(
                {'error': 'Only school admins can delete assets.'},
                status=status.HTTP_403_FORBIDDEN
            )

        asset_type = request.query_params.get('asset_type')
        if asset_type not in ('logo', 'letterhead'):
            return Response(
                {'error': 'asset_type must be "logo" or "letterhead".'},
                status=status.HTTP_400_BAD_REQUEST
            )

        old_url = school.logo if asset_type == 'logo' else school.letterhead_url
        if old_url:
            old_path = storage_service._extract_storage_path(old_url)
            if old_path:
                storage_service.delete_file(old_path)

        if asset_type == 'logo':
            school.logo = None
            school.save(update_fields=['logo', 'updated_at'])
        else:
            school.letterhead_url = None
            school.save(update_fields=['letterhead_url', 'updated_at'])

        return Response({
            'message': f'{asset_type.capitalize()} deleted successfully.'
        })

    # Module step definitions: (step_label, app_label, model_name, filter_kwargs, link)
    # filter_kwargs uses 'school_id' by default; override with full lookup for indirect FKs
    # Each step: (label, app_label, model_name, extra_filters, link, min_count)
    # min_count = minimum records needed to mark step complete (default 1)
    MODULE_STEPS = {
        'students': [
            ('Academic year set up', 'academic_sessions', 'AcademicYear', {'is_current': True}, '/academic-years', 1),
            ('Classes created', 'students', 'Class', {}, '/classes', 3),
            ('Students added', 'students', 'Student', {'is_active': True}, '/students', 10),
            ('Students enrolled in classes', 'academic_sessions', 'StudentEnrollment', {'status': 'ACTIVE'}, '/academic-years', 10),
            ('Student documents uploaded', 'students', 'StudentDocument', {}, '/students', 5),
        ],
        'hr': [
            ('Departments created', 'hr', 'StaffDepartment', {'is_active': True}, '/hr/departments', 2),
            ('Designations defined', 'hr', 'StaffDesignation', {}, '/hr/departments', 3),
            ('Staff members added', 'hr', 'StaffMember', {}, '/hr/staff', 3),
            ('Salary structures defined', 'hr', 'SalaryStructure', {}, '/hr/salary', 1),
            ('Leave policies configured', 'hr', 'LeavePolicy', {}, '/hr/leave', 1),
        ],
        'finance': [
            ('Accounts created', 'finance', 'Account', {'is_active': True}, '/finance/accounts', 2),
            ('Expense categories defined', 'finance', 'ExpenseCategory', {'is_active': True}, '/finance/expenses', 3),
            ('Fee structures defined', 'finance', 'FeeStructure', {}, '/finance/fees', 1),
            ('Payment gateway configured', 'finance', 'PaymentGatewayConfig', {}, '/finance/settings', 1),
        ],
        'academics': [
            ('Subjects created', 'academics', 'Subject', {'is_active': True}, '/academics/subjects', 3),
            ('Subjects assigned to classes', 'academics', 'ClassSubject', {'is_active': True}, '/academics/subjects', 5),
            ('Teachers assigned to subjects', 'academics', 'ClassSubject', {'is_active': True, 'teacher__isnull': False}, '/academics/subjects', 3),
            ('Timetable slots defined', 'academics', 'TimetableSlot', {}, '/academics/timetable', 5),
            ('Timetable entries configured', 'academics', 'TimetableEntry', {}, '/academics/timetable', 10),
        ],
        'examinations': [
            ('Exam types defined', 'examinations', 'ExamType', {'is_active': True}, '/academics/exam-types', 2),
            ('Grade scales defined', 'examinations', 'GradeScale', {'is_active': True}, '/academics/grade-scale', 5),
            ('Exams created', 'examinations', 'Exam', {'is_active': True}, '/academics/exams', 1),
            ('Exam subjects configured', 'examinations', 'ExamSubject', {}, '/academics/exams', 5),
            ('Marks entry started', 'examinations', 'StudentMark', {}, '/academics/exams', 10),
        ],
        'attendance': [
            ('Attendance uploads made', 'attendance', 'AttendanceUpload', {}, '/attendance', 3),
            ('Attendance records confirmed', 'attendance', 'AttendanceRecord', {}, '/attendance', 10),
        ],
        'admissions': [
            ('Enquiries recorded', 'admissions', 'AdmissionEnquiry', {}, '/admissions', 3),
            ('Follow-up notes added', 'admissions', 'AdmissionNote', {}, '/admissions', 3),
        ],
        'transport': [
            ('Routes created', 'transport', 'TransportRoute', {'is_active': True}, '/transport/routes', 1),
            ('Stops added to routes', 'transport', 'TransportStop', {}, '/transport/routes', 3),
            ('Vehicles added', 'transport', 'TransportVehicle', {'is_active': True}, '/transport/vehicles', 1),
            ('Students assigned to routes', 'transport', 'TransportAssignment', {}, '/transport/assignments', 5),
        ],
        'library': [
            ('Book categories created', 'library', 'BookCategory', {}, '/library/catalog', 3),
            ('Books added', 'library', 'Book', {'is_active': True}, '/library/catalog', 10),
            ('Library policy configured', 'library', 'LibraryConfiguration', {}, '/library/settings', 1),
            ('Books issued to readers', 'library', 'BookIssue', {}, '/library/circulation', 1),
        ],
        'hostel': [
            ('Hostels created', 'hostel', 'Hostel', {'is_active': True}, '/hostel', 1),
            ('Rooms defined', 'hostel', 'Room', {}, '/hostel/rooms', 5),
            ('Student allocations made', 'hostel', 'HostelAllocation', {'is_active': True}, '/hostel/allocations', 5),
        ],
        'inventory': [
            ('Categories created', 'inventory', 'InventoryCategory', {'is_active': True}, '/inventory', 3),
            ('Vendors registered', 'inventory', 'Vendor', {'is_active': True}, '/inventory/vendors', 2),
            ('Items added', 'inventory', 'InventoryItem', {'is_active': True}, '/inventory/items', 5),
            ('Stock transactions recorded', 'inventory', 'StockTransaction', {}, '/inventory/items', 5),
        ],
        'lms': [
            ('Textbooks added', 'lms', 'Book', {}, '/academics/books', 3),
            ('Chapters defined', 'lms', 'Chapter', {}, '/academics/books', 5),
            ('Lesson plans created', 'lms', 'LessonPlan', {'is_active': True}, '/academics/lesson-plans', 3),
            ('Assignments created', 'lms', 'Assignment', {}, '/academics/assignments', 3),
        ],
        'notifications': [
            ('Templates created', 'notifications', 'NotificationTemplate', {'is_active': True}, '/notifications', 2),
            ('Notification config set up', 'notifications', 'SchoolNotificationConfig', {}, '/notifications', 1),
            ('Notification preferences set', 'notifications', 'NotificationPreference', {}, '/notifications', 5),
        ],
    }

    # Models where school FK is indirect (not school_id directly)
    INDIRECT_SCHOOL_FK = {
        ('hostel', 'Room'): 'hostel__school_id',
        ('transport', 'TransportStop'): 'route__school_id',
        ('admissions', 'AdmissionNote'): 'enquiry__school_id',
        ('lms', 'Chapter'): 'book__school_id',
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

            for step_label, app_label, model_name, extra_filters, link, min_count in steps_config:
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
                    'completed': count >= min_count,
                    'count': count,
                    'target': min_count,
                    'link': link,
                })
                total_steps += 1
                if count >= min_count:
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
