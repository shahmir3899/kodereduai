from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import mixins, status, viewsets
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
