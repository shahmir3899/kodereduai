"""
Notification views and ViewSets.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone

from core.permissions import IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from .models import (
    NotificationTemplate,
    NotificationLog,
    NotificationPreference,
    SchoolNotificationConfig,
)
from .serializers import (
    NotificationTemplateSerializer,
    NotificationLogSerializer,
    NotificationPreferenceSerializer,
    SchoolNotificationConfigSerializer,
    SendNotificationSerializer,
)
from .engine import NotificationEngine


class NotificationTemplateViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'notifications'
    queryset = NotificationTemplate.objects.all()
    serializer_class = NotificationTemplateSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]


    def get_queryset(self):
        qs = super().get_queryset().select_related('school')
        # Also include system-wide templates (school=null)
        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            from django.db.models import Q
            qs = NotificationTemplate.objects.filter(
                Q(school_id=school_id) | Q(school__isnull=True),
                is_active=True,
            ).select_related('school')
        return qs


class NotificationLogViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    required_module = 'notifications'
    queryset = NotificationLog.objects.all()
    serializer_class = NotificationLogSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get_queryset(self):
        qs = super().get_queryset().select_related('school', 'template', 'student', 'recipient_user')

        channel = self.request.query_params.get('channel')
        if channel:
            qs = qs.filter(channel=channel)

        event_type = self.request.query_params.get('event_type')
        if event_type:
            qs = qs.filter(event_type=event_type)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        student_id = self.request.query_params.get('student_id')
        if student_id:
            qs = qs.filter(student_id=student_id)

        return qs


class NotificationPreferenceViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'notifications'
    queryset = NotificationPreference.objects.all()
    serializer_class = NotificationPreferenceSerializer
    permission_classes = [IsAuthenticated, HasSchoolAccess]



class SchoolNotificationConfigView(ModuleAccessMixin, APIView):
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        config, _ = SchoolNotificationConfig.objects.get_or_create(school_id=school_id)
        return Response(SchoolNotificationConfigSerializer(config).data)

    def put(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        config, _ = SchoolNotificationConfig.objects.get_or_create(school_id=school_id)
        serializer = SchoolNotificationConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class MyNotificationsView(APIView):
    """Get notifications for the current user (in-app notifications)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = NotificationLog.objects.filter(
            recipient_user=request.user,
            channel='IN_APP',
        ).select_related('student').order_by('-created_at')[:50]

        return Response(NotificationLogSerializer(qs, many=True).data)


class UnreadCountView(APIView):
    """Get unread notification count for the bell badge."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = NotificationLog.objects.filter(
            recipient_user=request.user,
            channel='IN_APP',
            read_at__isnull=True,
        ).exclude(status='FAILED').count()

        return Response({'unread_count': count})


class MarkReadView(APIView):
    """Mark a notification as read."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            log = NotificationLog.objects.get(
                pk=pk,
                recipient_user=request.user,
            )
        except NotificationLog.DoesNotExist:
            return Response({'error': 'Not found'}, status=404)

        log.read_at = timezone.now()
        log.status = 'READ'
        log.save(update_fields=['read_at', 'status'])
        return Response({'status': 'read'})


class MarkAllReadView(APIView):
    """Mark all in-app notifications as read for current user."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated = NotificationLog.objects.filter(
            recipient_user=request.user,
            channel='IN_APP',
            read_at__isnull=True,
        ).update(read_at=timezone.now(), status='READ')

        return Response({'marked_read': updated})


class SendNotificationView(ModuleAccessMixin, APIView):
    """Manually send a notification (admin action)."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        serializer = SendNotificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)

        student = None
        if data.get('student_id'):
            from students.models import Student
            student = Student.objects.filter(
                id=data['student_id'], school=school
            ).first()

        engine = NotificationEngine(school)
        log = engine.send(
            event_type=data['event_type'],
            channel=data['channel'],
            context=data.get('context', {}),
            recipient_identifier=data['recipient_identifier'],
            recipient_type=data.get('recipient_type', 'PARENT'),
            student=student,
            title=data.get('title', ''),
            body=data.get('body', ''),
        )

        if log:
            return Response(NotificationLogSerializer(log).data, status=201)
        return Response({'detail': 'Notification skipped (disabled or opted out)'}, status=200)


class NotificationAnalyticsView(ModuleAccessMixin, APIView):
    """Notification delivery analytics and optimization."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from .ai_service import NotificationOptimizerService
        service = NotificationOptimizerService(school_id)

        analytics = service.get_delivery_analytics()
        optimal_time = service.get_optimal_send_time()

        return Response({
            **analytics,
            'optimal_send_time': optimal_time,
        })


class CommunicationAgentView(ModuleAccessMixin, APIView):
    """AI-powered parent communication assistant."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        message = request.data.get('message', '')
        history = request.data.get('history', [])

        if not message:
            return Response({'error': 'message is required'}, status=400)

        from .ai_agent import ParentCommunicationAgent
        agent = ParentCommunicationAgent(school_id)
        response_text = agent.chat(message, history)

        return Response({'response': response_text})
