from django.contrib import admin

from .models import AIJob, BackgroundTask


@admin.register(BackgroundTask)
class BackgroundTaskAdmin(admin.ModelAdmin):
	list_display = ('title', 'task_type', 'school', 'triggered_by', 'status', 'created_at')
	list_filter = ('task_type', 'status', 'school')
	search_fields = ('title', 'celery_task_id', 'error_message')


@admin.register(AIJob)
class AIJobAdmin(admin.ModelAdmin):
	list_display = ('job_type', 'school', 'triggered_by', 'model_used', 'status', 'accepted', 'created_at')
	list_filter = ('job_type', 'status', 'school')
	search_fields = ('model_used', 'error_message')
