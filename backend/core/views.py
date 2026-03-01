from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import exception_handler

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess

from .models import BackgroundTask
from .serializers import BackgroundTaskSerializer


class BackgroundTaskViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """List and retrieve background tasks for the authenticated user."""

    serializer_class = BackgroundTaskSerializer
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    lookup_field = 'celery_task_id'

    def get_queryset(self):
        school_id = ensure_tenant_school_id(self.request)
        qs = BackgroundTask.objects.filter(triggered_by=self.request.user)
        if school_id:
            qs = qs.filter(school_id=school_id)
        cutoff = timezone.now() - timedelta(hours=24)
        return qs.filter(created_at__gte=cutoff)

    @action(detail=True, methods=['post'])
    def cancel(self, request, celery_task_id=None):
        """Cancel a pending/in-progress task. Revokes Celery task and marks as FAILED."""
        task = self.get_object()
        if task.status in (BackgroundTask.Status.SUCCESS, BackgroundTask.Status.FAILED):
            return Response({'detail': 'Task already finished.'}, status=400)

        # Try to revoke the Celery task
        try:
            from config.celery import app as celery_app
            celery_app.control.revoke(task.celery_task_id, terminate=True)
        except Exception:
            pass  # Celery may not be reachable; still mark as failed

        task.status = BackgroundTask.Status.FAILED
        task.error_message = 'Cancelled by user'
        task.completed_at = timezone.now()
        task.save(update_fields=['status', 'error_message', 'completed_at', 'updated_at'])
        return Response({'detail': 'Task cancelled.'})


def custom_exception_handler(exc, context):
    """
    Convert Django model ValidationError into a DRF-style 400 response
    so that model-level safeguards (period locks, field validation) return
    clean JSON errors instead of 500s.
    """
    if isinstance(exc, DjangoValidationError):
        if hasattr(exc, 'message_dict'):
            detail = exc.message_dict
        elif hasattr(exc, 'messages'):
            detail = exc.messages
        else:
            detail = [str(exc)]
        return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)

    return exception_handler(exc, context)
