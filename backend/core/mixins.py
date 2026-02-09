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
        # Super admin can access all active schools
        from schools.models import School
        request.tenant_schools = list(
            School.objects.filter(is_active=True).values_list('id', flat=True)
        )
    elif user.school_id:
        # Regular users can only access their own school
        request.tenant_schools = [user.school_id]
    else:
        request.tenant_schools = []

    return request.tenant_schools


class TenantQuerySetMixin:
    """
    Mixin for ViewSets that automatically filters querysets by tenant (school).

    Usage:
        class StudentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
            queryset = Student.objects.all()
            tenant_field = 'school_id'  # Default, can be customized

    The mixin will:
    1. Filter queryset to only show records from user's accessible schools
    2. Prevent access to records from other schools
    """

    tenant_field = 'school_id'

    def get_queryset(self):
        """Filter queryset by tenant schools."""
        queryset = super().get_queryset()
        user = self.request.user

        # Super admin sees all
        if user.is_super_admin:
            return queryset

        # Ensure tenant_schools is populated (handles JWT auth timing)
        tenant_schools = ensure_tenant_schools(self.request)

        if not tenant_schools:
            return queryset.none()

        # Filter by tenant field
        filter_kwargs = {f'{self.tenant_field}__in': tenant_schools}
        return queryset.filter(**filter_kwargs)

    def perform_create(self, serializer):
        """Automatically set school_id when creating records."""
        user = self.request.user

        # Get the school to assign
        school_id = self.request.data.get('school_id') or self.request.data.get('school')

        if not school_id:
            # Use user's school if not specified
            if user.school_id:
                school_id = user.school_id
            elif hasattr(self.request, 'tenant_school_id') and self.request.tenant_school_id:
                school_id = self.request.tenant_school_id

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
