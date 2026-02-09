"""
URL configuration for users app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    CustomTokenObtainPairView,
    CurrentUserView,
    ChangePasswordView,
    UserViewSet,
    SuperAdminUserCreateView,
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')

urlpatterns = [
    # JWT Authentication
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Current user
    path('auth/me/', CurrentUserView.as_view(), name='current_user'),
    path('auth/change-password/', ChangePasswordView.as_view(), name='change_password'),

    # Super Admin user creation
    path('admin/users/create/', SuperAdminUserCreateView.as_view(), name='admin_user_create'),

    # User management (via router)
    path('', include(router.urls)),
]
