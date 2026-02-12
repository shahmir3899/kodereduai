"""
Mixins for multi-tenancy support in views and querysets.
"""

from rest_framework.exceptions import PermissionDenied


def ensure_tenant_schools(request):
    """
    Ensure tenant_schools is populated for the authenticated user.
    This is needed because JWT authentication runs after middleware.
    """
    tenant_schools = getattr(request, 'tenant_schools', None)

    # If already populated, return it
    if tenant_schools:
        return tenant_schools

    user = request.user
    if not user.is_authenticated:
        return []

    if user.is_super_admin:
        from schools.models import School
        request.tenant_schools = list(
            School.objects.filter(is_active=True).values_list('id', flat=True)
        )
    else:
        # Use membership-based school list
        request.tenant_schools = user.get_accessible_school_ids()

    return request.tenant_schools


def ensure_tenant_school_id(request):
    """
    Ensure tenant_school_id is resolved from X-School-ID header.
    This is needed because JWT authentication runs after middleware,
    so process_view can't read the header (user isn't authenticated yet).
    """
    tenant_sid = getattr(request, 'tenant_school_id', None)
    if tenant_sid:
        return tenant_sid

    # Read X-School-ID header directly (JWT auth timing workaround)
    header_school = request.headers.get('X-School-ID')
    if header_school:
        try:
            sid = int(header_school)
            tenant_schools = ensure_tenant_schools(request)
            if sid in tenant_schools:
                request.tenant_school_id = sid
                return sid
        except (ValueError, TypeError):
            pass

    return None


class TenantQuerySetMixin:
    """
    Mixin for ViewSets that automatically filters querysets by tenant (school).

    Usage:
        class StudentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
            queryset = Student.objects.all()
            tenant_field = 'school_id'  # Default, can be customized

    The mixin will:
    1. Filter queryset by active school (X-School-ID header) for all users
    2. Fall back to all accessible schools if no active school is set
    3. Prevent access to records from other schools
    """

    tenant_field = 'school_id'

    def get_queryset(self):
        """Filter queryset by active school (or all accessible schools as fallback)."""
        queryset = super().get_queryset()
        user = self.request.user

        # Always try to filter by active school first (including super admin)
        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            filter_kwargs = {self.tenant_field: active_school_id}
            return queryset.filter(**filter_kwargs)

        # Fallback: filter by all accessible schools
        if user.is_super_admin:
            return queryset

        tenant_schools = ensure_tenant_schools(self.request)

        if not tenant_schools:
            return queryset.none()

        filter_kwargs = {f'{self.tenant_field}__in': tenant_schools}
        return queryset.filter(**filter_kwargs)

    def perform_create(self, serializer):
        """Automatically set school_id when creating records."""
        user = self.request.user

        # Get the school to assign
        school_id = self.request.data.get('school_id') or self.request.data.get('school')

        if not school_id:
            # Prefer active school from header, fall back to user.school
            tenant_sid = ensure_tenant_school_id(self.request)
            if tenant_sid:
                school_id = tenant_sid
            elif user.school_id:
                school_id = user.school_id

        if school_id:
            # Verify user can access this school
            tenant_schools = ensure_tenant_schools(self.request)
            if not user.is_super_admin and int(school_id) not in tenant_schools:
                raise PermissionDenied("You don't have access to this school.")

            serializer.save(school_id=school_id)
        else:
            serializer.save()


class TenantSerializerMixin:
    """
    Mixin for serializers to handle tenant-aware validation.

    Usage:
        class StudentSerializer(TenantSerializerMixin, serializers.ModelSerializer):
            class Meta:
                model = Student
                fields = '__all__'
    """

    def validate_school(self, value):
        """Validate that user can access the specified school."""
        request = self.context.get('request')
        if not request:
            return value

        user = request.user
        if user.is_super_admin:
            return value

        tenant_schools = ensure_tenant_schools(request)
        if value.id not in tenant_schools:
            raise PermissionDenied("You don't have access to this school.")

        return value
