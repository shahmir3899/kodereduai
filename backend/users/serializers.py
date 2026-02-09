"""
User serializers for authentication and user management.
"""

from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import get_user_model

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

        return token

    def validate(self, attrs):
        data = super().validate(attrs)

        # Add user info to response
        data['user'] = {
            'id': self.user.id,
            'username': self.user.username,
            'email': self.user.email,
            'role': self.user.role,
            'role_display': self.user.get_role_display(),
            'school_id': self.user.school_id,
            'school_name': self.user.school.name if self.user.school else None,
            'is_super_admin': self.user.is_super_admin,
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
            'phone', 'profile_photo_url', 'is_active'
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


class CurrentUserSerializer(serializers.ModelSerializer):
    """
    Serializer for the current authenticated user with full details.
    """
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    school_details = serializers.SerializerMethodField()
    school_id = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'school', 'school_id', 'school_details',
            'phone', 'profile_photo_url', 'is_super_admin',
            'is_school_admin', 'is_staff_member',
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
