from rest_framework import serializers
from .models import MessageThread, ThreadParticipant, Message


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'thread', 'sender', 'sender_name', 'body', 'is_mine', 'created_at']
        read_only_fields = ['id', 'thread', 'sender', 'created_at']

    def get_sender_name(self, obj):
        return obj.sender.get_full_name() or obj.sender.username

    def get_is_mine(self, obj):
        request = self.context.get('request')
        return request and obj.sender_id == request.user.id


class ThreadParticipantSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_role = serializers.CharField(source='user.role', read_only=True)

    class Meta:
        model = ThreadParticipant
        fields = ['user', 'user_name', 'user_role', 'last_read_at', 'joined_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class ThreadListSerializer(serializers.ModelSerializer):
    participants = ThreadParticipantSerializer(many=True, read_only=True)
    latest_message = serializers.SerializerMethodField()
    latest_message_at = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    other_participant_name = serializers.SerializerMethodField()
    other_participant_role = serializers.SerializerMethodField()
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)

    class Meta:
        model = MessageThread
        fields = [
            'id', 'school', 'message_type', 'subject', 'student', 'student_name',
            'participants', 'latest_message', 'latest_message_at',
            'unread_count', 'other_participant_name', 'other_participant_role',
            'is_active', 'created_at', 'updated_at',
        ]

    def _get_latest_msg(self, obj):
        if not hasattr(obj, '_latest_msg_cache'):
            obj._latest_msg_cache = obj.messages.order_by('-created_at').first()
        return obj._latest_msg_cache

    def get_latest_message(self, obj):
        msg = self._get_latest_msg(obj)
        return msg.body[:100] if msg else None

    def get_latest_message_at(self, obj):
        msg = self._get_latest_msg(obj)
        return msg.created_at if msg else obj.created_at

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0
        participation = obj.participants.filter(user=request.user).first()
        if not participation or not participation.last_read_at:
            return obj.messages.exclude(sender=request.user).count()
        return obj.messages.filter(
            created_at__gt=participation.last_read_at
        ).exclude(sender=request.user).count()

    def _get_other_participant(self, obj):
        if not hasattr(obj, '_other_cache'):
            request = self.context.get('request')
            if request:
                obj._other_cache = obj.participants.exclude(user=request.user).select_related('user').first()
            else:
                obj._other_cache = None
        return obj._other_cache

    def get_other_participant_name(self, obj):
        other = self._get_other_participant(obj)
        if other:
            return other.user.get_full_name() or other.user.username
        return None

    def get_other_participant_role(self, obj):
        other = self._get_other_participant(obj)
        return other.user.role if other else None


class ThreadDetailSerializer(serializers.ModelSerializer):
    participants = ThreadParticipantSerializer(many=True, read_only=True)
    messages = MessageSerializer(many=True, read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)

    class Meta:
        model = MessageThread
        fields = [
            'id', 'school', 'message_type', 'subject', 'student', 'student_name',
            'participants', 'messages', 'is_active', 'created_at', 'updated_at',
        ]


class NewThreadSerializer(serializers.Serializer):
    recipient_user_id = serializers.IntegerField()
    message = serializers.CharField()
    student_id = serializers.IntegerField(required=False, allow_null=True)
    subject = serializers.CharField(required=False, allow_blank=True, default='')
    message_type = serializers.ChoiceField(
        choices=MessageThread.MESSAGE_TYPE_CHOICES,
        default='GENERAL',
    )


class ReplySerializer(serializers.Serializer):
    message = serializers.CharField()
