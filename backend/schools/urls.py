"""
URL configuration for schools app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    SuperAdminSchoolViewSet,
    SuperAdminOrganizationViewSet,
    SuperAdminMembershipViewSet,
    SchoolViewSet,
)

# Router for super admin endpoints
admin_router = DefaultRouter()
admin_router.register(r'schools', SuperAdminSchoolViewSet, basename='admin-school')
admin_router.register(r'organizations', SuperAdminOrganizationViewSet, basename='admin-organization')
admin_router.register(r'memberships', SuperAdminMembershipViewSet, basename='admin-membership')

# Router for regular school endpoints
router = DefaultRouter()
router.register(r'schools', SchoolViewSet, basename='school')

urlpatterns = [
    # Super admin school management
    path('admin/', include(admin_router.urls)),

    # Regular school endpoints
    path('', include(router.urls)),
]
