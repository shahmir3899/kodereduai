"""
User views for authentication and user management.
"""

from rest_framework import generics, status, viewsets
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView
from django.contrib.auth import get_user_model

from core.permissions import IsSuperAdmin, IsSchoolAdmin, HasSchoolAccess, ROLE_HIERARCHY, get_effective_role
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from .serializers import (
    CustomTokenObtainPairSerializer,
    UserSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    ChangePasswordSerializer,
    ProfileUpdateSerializer,
    CurrentUserSerializer,
    DevicePushTokenSerializer,
)

User = get_user_model()


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Custom JWT login view that returns user information along with tokens.
    """
    serializer_class = CustomTokenObtainPairSerializer


class CurrentUserView(APIView):
    """
    Get or update the currently authenticated user's information.
    GET  - returns full profile via CurrentUserSerializer
    PATCH - updates safe self-editable fields via ProfileUpdateSerializer
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = CurrentUserSerializer(request.user)
        return Response(serializer.data)

    def patch(self, request):
        serializer = ProfileUpdateSerializer(
            request.user,
            data=request.data,
            partial=True,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(CurrentUserSerializer(request.user).data)


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


# =============================
# Password Reset APIViews
# =============================
from rest_framework.permissions import AllowAny
from .serializers import (
    PasswordResetRequestSerializer,
    PasswordResetTokenValidateSerializer,
    PasswordResetConfirmSerializer,
)
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.conf import settings
from django.contrib.auth import get_user_model
User = get_user_model()

class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        # Always return success, never reveal if user exists
        users = User.objects.filter(email__iexact=email, is_active=True)
        for user in users:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')}/reset-password?uid={uid}&token={token}"
            # Send email (or WhatsApp/SMS if desired)
            from django.core.mail import send_mail
            send_mail(
                subject="Password Reset Request",
                message=f"Click the link to reset your password: {reset_url}",
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@example.com'),
                recipient_list=[user.email],
                fail_silently=True,
            )
        return Response({'message': 'If an account exists for this email, a reset link has been sent.'})


class PasswordResetTokenValidateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetTokenValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({'valid': True})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.set_password(serializer.validated_data['new_password'])
        user.save()
        return Response({'message': 'Password has been reset successfully.'})


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

        # Show users who share any of the same schools via memberships
        school_ids = self.request.user.get_accessible_school_ids()
        if school_ids:
            from schools.models import UserSchoolMembership
            user_ids = UserSchoolMembership.objects.filter(
                school_id__in=school_ids, is_active=True,
            ).values_list('user_id', flat=True).distinct()
            return queryset.filter(id__in=user_ids)

        return queryset.none()

    def perform_create(self, serializer):
        """Create user and auto-create UserSchoolMembership."""
        from rest_framework.exceptions import ValidationError

        user = self.request.user

        school_id = (
            self.request.data.get('school') or
            self.request.data.get('school_id')
        )

        if not school_id and not user.is_super_admin:
            school_id = ensure_tenant_school_id(self.request) or user.school_id

        role = self.request.data.get('role', 'STAFF')

        # Enforce role hierarchy
        creator_role = get_effective_role(self.request)
        allowed_roles = ROLE_HIERARCHY.get(creator_role, [])
        if role not in allowed_roles:
            raise ValidationError({'role': f'You cannot create users with the {role} role.'})

        if school_id:
            new_user = serializer.save(school_id=school_id)
        else:
            new_user = serializer.save()

        # Auto-create membership for the school
        if school_id:
            from schools.models import UserSchoolMembership
            UserSchoolMembership.objects.get_or_create(
                user=new_user,
                school_id=school_id,
                defaults={'role': role, 'is_default': True, 'is_active': True},
            )


class SwitchSchoolView(APIView):
    """
    POST /api/auth/switch-school/  {school_id: 2}
    Validates the user has access to the school and returns updated info.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        school_id = request.data.get('school_id')
        if not school_id:
            return Response({'error': 'school_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            school_id = int(school_id)
        except (ValueError, TypeError):
            return Response({'error': 'Invalid school_id'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not user.can_access_school(school_id):
            return Response({'error': 'No access to this school'}, status=status.HTTP_403_FORBIDDEN)

        from schools.models import School
        try:
            school = School.objects.get(id=school_id, is_active=True)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=status.HTTP_404_NOT_FOUND)

        role = user.get_role_for_school(school_id)

        return Response({
            'school_id': school.id,
            'school_name': school.name,
            'role': role,
        })


class SuperAdminUserCreateView(generics.CreateAPIView):
    """
    Create users with any role (Super Admin only).
    """
    serializer_class = UserCreateSerializer
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def perform_create(self, serializer):
        serializer.save()


class RegisterPushTokenView(APIView):
    """
    POST /api/auth/register-push-token/
    Register an Expo push token for the current user.
    Body: { token: "ExponentPushToken[...]", device_type: "IOS"|"ANDROID" }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DevicePushTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from .models import DevicePushToken
        DevicePushToken.objects.update_or_create(
            user=request.user,
            token=serializer.validated_data['token'],
            defaults={
                'device_type': serializer.validated_data['device_type'],
                'is_active': True,
            },
        )
        return Response({'message': 'Push token registered.'}, status=status.HTTP_200_OK)


class UnregisterPushTokenView(APIView):
    """
    DELETE /api/auth/unregister-push-token/
    Deactivate a push token for the current user.
    Body: { token: "ExponentPushToken[...]" }
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'error': 'token is required'}, status=status.HTTP_400_BAD_REQUEST)

        from .models import DevicePushToken
        updated = DevicePushToken.objects.filter(
            user=request.user, token=token,
        ).update(is_active=False)

        if updated:
            return Response({'message': 'Push token unregistered.'})
        return Response({'error': 'Token not found.'}, status=status.HTTP_404_NOT_FOUND)
