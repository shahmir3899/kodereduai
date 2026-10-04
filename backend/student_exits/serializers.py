from rest_framework import serializers

from .models import ExitClearanceItem, StudentExit


def _display_name(user):
    if not user:
        return None
    return user.get_full_name() or user.username


class ExitClearanceItemSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    waived_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ExitClearanceItem
        fields = [
            'id', 'kind', 'kind_label', 'state', 'summary', 'detail', 'amount',
            'waiver_reason', 'waived_by_name', 'waived_at',
        ]
        read_only_fields = fields

    def get_waived_by_name(self, obj):
        return _display_name(obj.waived_by)


class StudentExitSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    exit_type_label = serializers.CharField(source='get_exit_type_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    destination_school_name = serializers.CharField(source='destination_school.name', read_only=True, default=None)
    requested_by_name = serializers.SerializerMethodField()
    finalized_by_name = serializers.SerializerMethodField()
    items = ExitClearanceItemSerializer(many=True, read_only=True)
    open_item_count = serializers.SerializerMethodField()

    class Meta:
        model = StudentExit
        fields = [
            'id', 'school', 'student', 'student_name',
            'exit_type', 'exit_type_label', 'status', 'status_label',
            'leaving_date', 'reason', 'destination_school', 'destination_school_name',
            'remove_records_after_leaving',
            'requested_by_name', 'requested_at', 'finalized_by_name', 'finalized_at',
            'cancelled_at', 'cancel_reason', 'snapshot', 'items', 'open_item_count',
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        return _display_name(obj.requested_by)

    def get_finalized_by_name(self, obj):
        return _display_name(obj.finalized_by)

    def get_open_item_count(self, obj):
        return sum(1 for item in obj.items.all() if item.state == ExitClearanceItem.State.OPEN)


class StartExitSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    exit_type = serializers.ChoiceField(choices=StudentExit.ExitType.choices)
    leaving_date = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default='')
    destination_school = serializers.IntegerField(required=False, allow_null=True, default=None)
    remove_records_after_leaving = serializers.BooleanField(required=False, default=False)


class UpdateExitSerializer(serializers.Serializer):
    leaving_date = serializers.DateField(required=False)
    reason = serializers.CharField(required=False, allow_blank=True)
    destination_school = serializers.IntegerField(required=False, allow_null=True)
    remove_records_after_leaving = serializers.BooleanField(required=False)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default='')
