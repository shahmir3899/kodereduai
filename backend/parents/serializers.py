"""
Parent module serializers for profiles, invites, leave requests, messaging, and child overview.
"""

import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from .models import (
    ParentProfile,
    ParentChild,
    ParentInvite,
    ParentLeaveRequest,
    ParentMessage,
)

User = get_user_model()


# ── ParentProfile ────────────────────────────────────────────

class ParentProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = ParentProfile
        fields = [
            'id', 'user', 'username', 'email', 'first_name', 'last_name',
            'full_name', 'phone', 'alternate_phone', 'address', 'occupation',
            'relation_to_default', 'profile_photo_url',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


# ── ParentRegistration ───────────────────────────────────────

class ParentRegistrationSerializer(serializers.Serializer):
    invite_code = serializers.CharField()
    username = serializers.CharField()
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField()
    relation = serializers.ChoiceField(
        choices=ParentProfile.RELATION_CHOICES,
        required=False,
    )

    def validate_invite_code(self, value):
        try:
            invite = ParentInvite.objects.select_related('school', 'student').get(
                invite_code=value
            )
        except ParentInvite.DoesNotExist:
            raise serializers.ValidationError("Invalid invite code.")

        if invite.is_used:
            raise serializers.ValidationError("This invite code has already been used.")
        if invite.is_expired:
            raise serializers.ValidationError("This invite code has expired.")

        self._invite = invite
        return value

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs.pop('confirm_password'):
            raise serializers.ValidationError({
                'confirm_password': "Passwords don't match."
            })
        return attrs

    def create(self, validated_data):
        from django.db import transaction
        from schools.models import UserSchoolMembership

        invite = self._invite

        with transaction.atomic():
            # 1. Create User
            user = User(
                username=validated_data['username'],
                email=validated_data.get('email', ''),
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', ''),
                phone=validated_data['phone'],
                role='STAFF',  # Legacy role field; real role is in membership
            )
            user.set_password(validated_data['password'])
            user.save()

            # 2. Create ParentProfile
            relation = validated_data.get('relation') or invite.relation
            profile = ParentProfile.objects.create(
                user=user,
                phone=validated_data['phone'],
                relation_to_default=relation,
            )

            # 3. Create ParentChild link
            ParentChild.objects.create(
                parent=profile,
                student=invite.student,
                school=invite.school,
                relation=relation,
                is_primary=True,
            )

            # 4. Create UserSchoolMembership with PARENT role
            UserSchoolMembership.objects.create(
                user=user,
                school=invite.school,
                role='PARENT',
                is_default=True,
            )

            # 5. Mark invite as used
            invite.is_used = True
            invite.used_by = profile
            invite.save(update_fields=['is_used', 'used_by'])

        return {
            'user_id': user.id,
            'username': user.username,
            'parent_profile_id': profile.id,
            'school_id': invite.school_id,
            'student_id': invite.student_id,
        }


# ── ParentChild ──────────────────────────────────────────────

class ParentChildSerializer(serializers.ModelSerializer):
    parent_name = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(source='student.roll_number', read_only=True)
    class_name = serializers.CharField(source='student.class_obj.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = ParentChild
        fields = [
            'id', 'parent', 'parent_name',
            'student', 'student_name', 'student_roll_number', 'class_name',
            'school', 'school_name', 'relation',
            'is_primary', 'can_pickup', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_parent_name(self, obj):
        return obj.parent.user.get_full_name() or obj.parent.user.username


# ── ParentInvite (Admin create) ──────────────────────────────

class ParentInviteSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = ParentInvite
        fields = [
            'id', 'school', 'student', 'student_id',
            'invite_code', 'relation', 'parent_phone',
            'is_used', 'used_by', 'expires_at',
            'created_by', 'created_at',
        ]
        read_only_fields = [
            'id', 'school', 'student', 'invite_code',
            'is_used', 'used_by', 'expires_at',
            'created_by', 'created_at',
        ]

    def validate_student_id(self, value):
        from students.models import Student
        try:
            self._student = Student.objects.get(id=value)
        except Student.DoesNotExist:
            raise serializers.ValidationError("Student not found.")
        return value

    def create(self, validated_data):
        student_id = validated_data.pop('student_id')
        student = self._student
        request = self.context['request']

        invite = ParentInvite.objects.create(
            school=student.school,
            student=student,
            invite_code=secrets.token_urlsafe(10),
            relation=validated_data.get('relation', 'FATHER'),
            parent_phone=validated_data.get('parent_phone', ''),
            expires_at=timezone.now() + timedelta(days=30),
            created_by=request.user,
        )
        return invite


# ── ParentLeaveRequest ───────────────────────────────────────

class ParentLeaveRequestSerializer(serializers.ModelSerializer):
    parent_name = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.name', read_only=True)
    reviewed_by_name = serializers.CharField(
        source='reviewed_by.username', read_only=True, default=None,
    )

    class Meta:
        model = ParentLeaveRequest
        fields = [
            'id', 'school', 'parent', 'parent_name',
            'student', 'student_name',
            'start_date', 'end_date', 'reason', 'document_url',
            'status', 'reviewed_by', 'reviewed_by_name',
            'reviewed_at', 'review_note',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'parent', 'status',
            'reviewed_by', 'reviewed_at', 'review_note',
            'created_at', 'updated_at',
        ]

    def get_parent_name(self, obj):
        return obj.parent.user.get_full_name() or obj.parent.user.username

    def validate(self, attrs):
        if attrs.get('start_date') and attrs.get('end_date'):
            if attrs['start_date'] > attrs['end_date']:
                raise serializers.ValidationError({
                    'end_date': 'End date must be on or after start date.'
                })
        return attrs


class ParentLeaveReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['APPROVED', 'REJECTED'])
    review_note = serializers.CharField(required=False, allow_blank=True, default='')


# ── ParentMessage ────────────────────────────────────────────

class ParentMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    recipient_name = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.name', read_only=True)

    class Meta:
        model = ParentMessage
        fields = [
            'id', 'school', 'thread_id',
            'sender_user', 'sender_name',
            'recipient_user', 'recipient_name',
            'student', 'student_name',
            'message', 'is_read', 'read_at', 'created_at',
        ]
        read_only_fields = [
            'id', 'school', 'thread_id', 'sender_user',
            'is_read', 'read_at', 'created_at',
        ]

    def get_sender_name(self, obj):
        return obj.sender_user.get_full_name() or obj.sender_user.username

    def get_recipient_name(self, obj):
        return obj.recipient_user.get_full_name() or obj.recipient_user.username


# ── ChildOverview (aggregated dashboard) ─────────────────────

class ChildOverviewSerializer(serializers.Serializer):
    """Aggregated child dashboard data for a parent."""
    student_id = serializers.IntegerField()
    student_name = serializers.CharField()
    class_name = serializers.CharField()
    roll_number = serializers.CharField()
    school_name = serializers.CharField()
    attendance_summary = serializers.DictField()
    fee_summary = serializers.DictField()
    latest_exam = serializers.DictField(allow_null=True)
