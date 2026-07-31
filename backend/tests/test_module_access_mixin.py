"""
ModuleAccessMixin — school resolution fix.
====================================================
Covers the bug: TenantMiddleware.process_view() only populates
request.tenant_school when request.user is already authenticated *at
middleware time*, which is only true for session auth. JWT authentication
runs later, inside the view (APIView.initial() -> perform_authentication()),
so for pure-JWT requests -- the only auth path real traffic in this app
uses -- request.tenant_school was always None and the module gate was
silently a no-op for every view using ModuleAccessMixin.

These tests exercise the mixin directly via a throwaway view + DRF's
APIRequestFactory, bypassing the URL router entirely, so the assertions
are about the mixin's own behavior, not any one app's business logic.
force_authenticate() + manually zeroing tenant_school/tenant_school_id
mirrors exactly what a real JWT request looks like when it reaches
initial(): APIRequestFactory never runs Django middleware, so
tenant_school is naturally absent unless a test sets it -- same as
production, where TenantMiddleware.process_view() never got the chance to
set it for this auth path.

Run:
    cd backend
    pytest tests/test_module_access_mixin.py -v
"""

import pytest
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from core.permissions import ModuleAccessMixin


class _HRGatedView(ModuleAccessMixin, APIView):
    """
    Minimal stand-in view -- required_module is the only thing that matters
    here. Echoes back request.tenant_school in the response body: DRF wraps
    the raw WSGIRequest into its own Request object before calling
    initial()/get(), and initial() sets tenant_school on that wrapped
    object, not on the original request a test built with
    APIRequestFactory -- so the only correct way to observe what initial()
    cached is to read it back from inside the view itself, the same way
    real app code (via self.request) does.
    """
    required_module = 'hr'
    permission_classes = [IsAuthenticated]

    def get(self, request):
        school = getattr(request, 'tenant_school', None)
        return Response({'tenant_school_id': school.id if school else None})


def _jwt_style_request(user, school_id, pre_resolved_school=None):
    """
    Build a request that looks exactly like what a real JWT request sees at
    initial()-time: force_authenticate() stands in for JWTAuthentication
    (which runs inside the view, same timing), and tenant_school/
    tenant_school_id are left at whatever TenantMiddleware.process_request()
    would have initialized them to (None) -- unless pre_resolved_school
    simulates a request a session-authenticated path had already resolved.
    """
    factory = APIRequestFactory()
    request = factory.get('/', HTTP_X_SCHOOL_ID=str(school_id))
    force_authenticate(request, user=user)
    request.tenant_school = pre_resolved_school
    request.tenant_school_id = pre_resolved_school.id if pre_resolved_school else None
    request.tenant_schools = []
    return request


@pytest.mark.django_db
class TestModuleAccessMixinSchoolResolution:
    def test_jwt_request_module_enabled_passes_through(self, seed_data):
        request = _jwt_style_request(seed_data['users']['admin'], seed_data['SID_A'])
        response = _HRGatedView.as_view()(request)
        assert response.status_code == 200

    def test_jwt_request_module_disabled_returns_403(self, seed_data):
        school = seed_data['school_a']
        school.enabled_modules['hr'] = False
        school.save(update_fields=['enabled_modules'])

        request = _jwt_style_request(seed_data['users']['admin'], seed_data['SID_A'])
        response = _HRGatedView.as_view()(request)
        assert response.status_code == 403

    def test_super_admin_bypasses_even_when_module_disabled(self, seed_data):
        from users.models import User

        school = seed_data['school_a']
        school.enabled_modules['hr'] = False
        school.save(update_fields=['enabled_modules'])

        super_admin = User.objects.create_user(
            username=f"{seed_data['prefix']}super_admin",
            email=f"{seed_data['prefix']}super_admin@test.com",
            password=seed_data['password'],
            role='SUPER_ADMIN',
            is_staff=True,
        )
        request = _jwt_style_request(super_admin, seed_data['SID_A'])
        response = _HRGatedView.as_view()(request)
        assert response.status_code == 200

    def test_tenant_school_is_resolved_and_cached_on_the_request(self, seed_data):
        """The whole point of the fix: after initial() runs, request.tenant_school
        must reflect the resolved school -- not the stale None middleware left it
        at for a JWT-only request -- so any later code in the same request (the
        view itself, serializers via context['request'], etc.) that reads
        request.tenant_school sees a consistent value instead of None."""
        request = _jwt_style_request(seed_data['users']['admin'], seed_data['SID_A'])

        response = _HRGatedView.as_view()(request)

        assert response.status_code == 200
        assert response.data['tenant_school_id'] == seed_data['SID_A']

    def test_already_resolved_tenant_school_is_reused_not_reresolved(self, seed_data, django_assert_num_queries):
        """If tenant_school/tenant_school_id were already correctly populated (the
        only way that happens today is a session-authenticated request, where
        TenantMiddleware.process_view() runs before request.user is anonymous),
        the mixin must not discard and re-fetch it -- ensure_tenant_school_id()
        short-circuits to the existing tenant_school_id in that case, so this
        already-working path's behavior (and its cost: zero extra queries) is
        unchanged by the fix."""
        pre_resolved_school = seed_data['school_a']
        request = _jwt_style_request(
            seed_data['users']['admin'], seed_data['SID_A'], pre_resolved_school=pre_resolved_school,
        )

        with django_assert_num_queries(0):
            response = _HRGatedView.as_view()(request)

        assert response.status_code == 200
        assert response.data['tenant_school_id'] == seed_data['SID_A']
