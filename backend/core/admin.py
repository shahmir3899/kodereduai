from django.contrib import admin

from .models import AdminActionLog, AIJob, BackgroundTask


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


@admin.register(AdminActionLog)
class AdminActionLogAdmin(admin.ModelAdmin):
	list_display = ('action', 'target_type', 'target_repr', 'actor', 'created_at')
	list_filter = ('action', 'target_type')
	search_fields = ('target_repr', 'actor__username')
	readonly_fields = ('actor', 'action', 'target_type', 'target_id', 'target_repr', 'metadata', 'created_at')
