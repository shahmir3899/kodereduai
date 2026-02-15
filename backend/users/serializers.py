"""
User serializers for authentication and user management.
"""

from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model
from schools.models import School

User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT token serializer that includes user information in the response.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Add custom claims to token
        token['username'] = user.username
        token['role'] = user.role
        token['school_id'] = user.school_id
        if user.organization_id:
            token['organization_id'] = user.organization_id

        return token

    def validate(self, attrs):
        data = super().validate(attrs)

        user = self.user
        default_mem = user.get_default_membership()

        # Build schools list
        schools = []
        if user.is_super_admin:
            # Super admin sees all active schools
            for school in School.objects.filter(is_active=True).select_related('organization'):
                schools.append({
                    'id': school.id,
                    'name': school.name,
                    'role': 'SUPER_ADMIN',
                    'is_default': school.id == (user.school_id or 0),
                    'enabled_modules': school.get_effective_modules(),
                })
            # Ensure at least one default
            if schools and not any(s['is_default'] for s in schools):
                schools[0]['is_default'] = True
        else:
            for mem in user.school_memberships.filter(is_active=True).select_related('school', 'school__organization'):
                schools.append({
                    'id': mem.school_id,
                    'name': mem.school.name,
                    'role': mem.role,
                    'is_default': mem.is_default,
                    'enabled_modules': mem.school.get_effective_modules(),
                })
            # Legacy fallback: include user.school if not already in memberships
            if user.school_id and not any(s['id'] == user.school_id for s in schools):
                try:
                    legacy_school = School.objects.select_related('organization').get(id=user.school_id, is_active=True)
                    schools.insert(0, {
                        'id': legacy_school.id,
                        'name': legacy_school.name,
                        'role': user.role or 'STAFF',
                        'is_default': not any(s['is_default'] for s in schools),
                        'enabled_modules': legacy_school.get_effective_modules(),
                    })
                except School.DoesNotExist:
                    pass

        data['user'] = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'role': user.role,
            'role_display': user.get_role_display(),
            'school_id': default_mem.school_id if default_mem else user.school_id,
            'school_name': default_mem.school.name if default_mem else (user.school.name if user.school else None),
            'is_super_admin': user.is_super_admin,
            'organization_id': user.organization_id,
            'organization_name': user.organization.name if user.organization else None,
            'schools': schools,
        }

        return data


class UserSerializer(serializers.ModelSerializer):
    """
    Serializer for User model - used for listing and retrieving users.
    """
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'school', 'school_name',
            'phone', 'profile_photo_url', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating new users.
    """
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            'username', 'email', 'password', 'confirm_password',
            'first_name', 'last_name', 'role', 'school', 'phone'
        ]

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('confirm_password'):
            raise serializers.ValidationError({
                'confirm_password': "Passwords don't match."
            })
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating users (without password).
    """
    class Meta:
        model = User
        fields = [
            'email', 'first_name', 'last_name',
            'role', 'phone', 'profile_photo_url', 'is_active'
        ]


class ChangePasswordSerializer(serializers.Serializer):
    """
    Serializer for changing user password.
    """
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=8)
    confirm_password = serializers.CharField(required=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError({
                'confirm_password': "New passwords don't match."
            })
        return attrs

    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer for self-service profile updates. Excludes role, is_active, school, username."""
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'phone', 'profile_photo_url']

    def validate_email(self, value):
        user = self.context['request'].user
        if value and User.objects.filter(email=value).exclude(pk=user.pk).exists():
            raise serializers.ValidationError("This email is already in use.")
        return value


class CurrentUserSerializer(serializers.ModelSerializer):
    """
    Serializer for the current authenticated user with full details.
    """
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    school_details = serializers.SerializerMethodField()
    school_id = serializers.SerializerMethodField()
    schools = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'school', 'school_id', 'school_details',
            'phone', 'profile_photo_url', 'is_super_admin',
            'is_school_admin', 'is_staff_member',
            'organization', 'organization_name', 'schools',
            'created_at', 'last_login'
        ]

    def get_school_id(self, obj):
        return obj.school_id

    def get_school_details(self, obj):
        if obj.school:
            return {
                'id': obj.school.id,
                'name': obj.school.name,
                'subdomain': obj.school.subdomain,
                'logo': obj.school.logo,
                'enabled_modules': obj.school.enabled_modules,
            }
        return None

    def get_schools(self, obj):
        if obj.is_super_admin:
            schools = []
            for school in School.objects.filter(is_active=True).select_related('organization'):
                schools.append({
                    'id': school.id,
                    'name': school.name,
                    'role': 'SUPER_ADMIN',
                    'is_default': school.id == (obj.school_id or 0),
                    'enabled_modules': school.get_effective_modules(),
                })
            if schools and not any(s['is_default'] for s in schools):
                schools[0]['is_default'] = True
            return schools
        schools = [
            {
                'id': mem.school_id,
                'name': mem.school.name,
                'role': mem.role,
                'is_default': mem.is_default,
                'enabled_modules': mem.school.get_effective_modules(),
            }
            for mem in obj.school_memberships.filter(
                is_active=True
            ).select_related('school', 'school__organization')
        ]
        # Legacy fallback: include user.school if not already in memberships
        if obj.school_id and not any(s['id'] == obj.school_id for s in schools):
            try:
                legacy_school = School.objects.select_related('organization').get(
                    id=obj.school_id, is_active=True
                )
                schools.insert(0, {
                    'id': legacy_school.id,
                    'name': legacy_school.name,
                    'role': obj.role or 'STAFF',
                    'is_default': not any(s['is_default'] for s in schools),
                    'enabled_modules': legacy_school.get_effective_modules(),
                })
            except School.DoesNotExist:
                pass
        return schools

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization else None


class DevicePushTokenSerializer(serializers.Serializer):
    """Serializer for registering/unregistering Expo push tokens."""
    token = serializers.CharField(max_length=200)
    device_type = serializers.ChoiceField(choices=[('IOS', 'iOS'), ('ANDROID', 'Android')])
