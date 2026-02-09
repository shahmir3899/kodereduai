"""
User views for authentication and user management.
"""

from rest_framework import generics, status, viewsets
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView
from django.contrib.auth import get_user_model

from core.permissions import IsSuperAdmin, IsSchoolAdmin, HasSchoolAccess
from core.mixins import TenantQuerySetMixin
from .serializers import (
    CustomTokenObtainPairSerializer,
    UserSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    ChangePasswordSerializer,
    CurrentUserSerializer,
)

User = get_user_model()


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Custom JWT login view that returns user information along with tokens.
    """
    serializer_class = CustomTokenObtainPairSerializer


class CurrentUserView(APIView):
    """
    Get the currently authenticated user's information.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = CurrentUserSerializer(request.user)
        return Response(serializer.data)


class ChangePasswordView(APIView):
    """
    Change the current user's password.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)

        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save()

        return Response({'message': 'Password changed successfully.'})


class UserViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for managing users within a school.

    - Super Admin: Can manage all users
    - School Admin: Can manage users in their school
    """
    queryset = User.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserSerializer

    def get_queryset(self):
        """Filter users by school for non-super-admins."""
        queryset = User.objects.select_related('school')

        if self.request.user.is_super_admin:
            return queryset

        # School admins can only see users in their school
        if self.request.user.school_id:
            return queryset.filter(school_id=self.request.user.school_id)

        return queryset.none()

    def perform_create(self, serializer):
        """Set school_id when creating users."""
        user = self.request.user

        # Get school from request or use user's school
        school_id = (
            self.request.data.get('school') or
            self.request.data.get('school_id')
        )

        if not school_id and not user.is_super_admin:
            school_id = user.school_id

        if school_id:
            serializer.save(school_id=school_id)
        else:
            serializer.save()


class SuperAdminUserCreateView(generics.CreateAPIView):
    """
    Create users with any role (Super Admin only).
    """
    serializer_class = UserCreateSerializer
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def perform_create(self, serializer):
        serializer.save()
