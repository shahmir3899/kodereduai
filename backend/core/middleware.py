"""
Multi-tenancy middleware for school data isolation.
Supports multi-school users via UserSchoolMembership + X-School-ID header.
"""

from django.utils.deprecation import MiddlewareMixin


class TenantMiddleware(MiddlewareMixin):
    """
    Middleware that injects tenant (school) information into the request.

    Resolution order for active school:
    1. X-School-ID header (frontend sends this after school switch)
    2. Subdomain from host
    3. User's default membership school
    """

    def process_request(self, request):
        request.tenant_school = None
        request.tenant_school_id = None
        request.tenant_schools = []

        # Try to extract subdomain
        host = request.get_host().split(':')[0]
        parts = host.split('.')

        subdomain = None
        if len(parts) > 2:
            subdomain = parts[0]
            if subdomain in ['www', 'api', 'localhost']:
                subdomain = None
        elif len(parts) == 1 and parts[0] not in ['localhost', '127']:
            subdomain = None

        if subdomain:
            from schools.models import School
            try:
                school = School.objects.get(subdomain=subdomain, is_active=True)
                request.tenant_school = school
                request.tenant_school_id = school.id
            except School.DoesNotExist:
                pass

        return None

    def _activate_school_timezone(self, request):
        """Run the request on the school's clock. JWT auth runs after middleware, so the school is
        read from the header (or subdomain) without checking access: it only picks a time zone,
        and a wrong header only changes how the caller's own times are shown."""
        from django.utils import timezone as dj_timezone
        from zoneinfo import ZoneInfo
        from core.school_time import school_timezone_name

        school_id = request.tenant_school_id
        header = request.headers.get('X-School-ID')
        if not school_id and header:
            try:
                school_id = int(header)
            except (ValueError, TypeError):
                school_id = None
        if school_id:
            dj_timezone.activate(ZoneInfo(school_timezone_name(school_id)))
        else:
            dj_timezone.deactivate()

    def process_response(self, request, response):
        # The active zone is thread-local: never let one request's school leak into the next.
        from django.utils import timezone as dj_timezone
        dj_timezone.deactivate()
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        After authentication, set tenant_schools from memberships
        and resolve active school from X-School-ID header.
        """
        self._activate_school_timezone(request)
        if not hasattr(request, 'user') or not request.user.is_authenticated:
            return None

        from schools.models import School
        user = request.user

        if user.is_super_admin:
            request.tenant_schools = list(
                School.objects.filter(is_active=True).values_list('id', flat=True)
            )
        else:
            # Use membership-based school list
            request.tenant_schools = user.get_accessible_school_ids()

        # Resolve active school: X-School-ID header > subdomain > default membership
        if not request.tenant_school_id:
            header_school = request.headers.get('X-School-ID')
            if header_school:
                try:
                    sid = int(header_school)
                    if sid in request.tenant_schools:
                        request.tenant_school_id = sid
                except (ValueError, TypeError):
                    pass

        if not request.tenant_school_id:
            # Fall back to default membership
            if user.is_super_admin:
                # Super admin: use first school or their school FK
                if user.school_id:
                    request.tenant_school_id = user.school_id
                elif request.tenant_schools:
                    request.tenant_school_id = request.tenant_schools[0]
            else:
                default_mem = user.get_default_membership()
                if default_mem:
                    request.tenant_school_id = default_mem.school_id

        # Load full school object if we have an ID but no object
        if request.tenant_school_id and not request.tenant_school:
            try:
                request.tenant_school = School.objects.get(id=request.tenant_school_id)
            except School.DoesNotExist:
                request.tenant_school_id = None

        return None
