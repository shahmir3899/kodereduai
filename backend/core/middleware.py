"""
Multi-tenancy middleware for school data isolation.
"""

from django.utils.deprecation import MiddlewareMixin


class TenantMiddleware(MiddlewareMixin):
    """
    Middleware that injects tenant (school) information into the request.

    This middleware:
    1. Extracts subdomain from the request host
    2. Looks up the corresponding school
    3. Attaches school info to the request for downstream use

    For authenticated users, it also sets the user's accessible schools.
    """

    def process_request(self, request):
        """Process the request and attach tenant information."""
        # Initialize tenant attributes
        request.tenant_school = None
        request.tenant_school_id = None
        request.tenant_schools = []

        # Try to extract subdomain
        host = request.get_host().split(':')[0]  # Remove port
        parts = host.split('.')

        # Check if subdomain exists (not www, api, localhost, or IP)
        subdomain = None
        if len(parts) > 2:
            subdomain = parts[0]
            if subdomain in ['www', 'api', 'localhost']:
                subdomain = None
        elif len(parts) == 1 and parts[0] not in ['localhost', '127']:
            # Single part hostname that's not localhost
            subdomain = None

        # Look up school by subdomain
        if subdomain:
            from schools.models import School
            try:
                school = School.objects.get(subdomain=subdomain, is_active=True)
                request.tenant_school = school
                request.tenant_school_id = school.id
            except School.DoesNotExist:
                pass

        return None

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        After authentication, set tenant_schools based on user role.
        This runs after AuthenticationMiddleware.
        """
        if hasattr(request, 'user') and request.user.is_authenticated:
            from schools.models import School

            user = request.user

            if user.is_super_admin:
                # Super admin can access all active schools
                request.tenant_schools = list(
                    School.objects.filter(is_active=True).values_list('id', flat=True)
                )
            elif user.school_id:
                # Regular users can only access their own school
                request.tenant_schools = [user.school_id]

                # If no subdomain was detected, use user's school
                if not request.tenant_school_id:
                    request.tenant_school_id = user.school_id
                    request.tenant_school = user.school

        return None
