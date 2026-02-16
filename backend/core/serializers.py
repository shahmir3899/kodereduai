from rest_framework import serializers
from .models import BackgroundTask


class BackgroundTaskSerializer(serializers.ModelSerializer):
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = BackgroundTask
        fields = [
            'id', 'celery_task_id', 'task_type', 'title', 'status',
            'progress_current', 'progress_total', 'progress_percent',
            'result_data', 'error_message',
            'created_at', 'updated_at', 'completed_at',
        ]

    def get_progress_percent(self, obj):
        if obj.progress_total > 0:
            return round((obj.progress_current / obj.progress_total) * 100)
        if obj.status == BackgroundTask.Status.SUCCESS:
            return 100
        if obj.status == BackgroundTask.Status.IN_PROGRESS:
            return -1  # Indeterminate
        return 0
