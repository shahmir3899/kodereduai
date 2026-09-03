"""
Notification views and ViewSets.
"""

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Count, Q
from django.db.models.functions import TruncDate

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
    BroadcastNotificationSerializer,
    PreviewRecipientsSerializer,
)
from .engine import NotificationEngine


def filter_my_notifications_by_school(request, queryset):
    """Optional ?school_id= — only notifications for schools the user can access."""
    raw = request.query_params.get('school_id')
    if raw in (None, ''):
        return queryset
    try:
        school_id = int(raw)
    except (TypeError, ValueError):
        return queryset.none()
    if not request.user.can_access_school(school_id):
        return queryset.none()
    return queryset.filter(school_id=school_id)


def _build_filtered_students_qs(school_id, filters):
    from students.models import Student
    students_qs = Student.objects.filter(school_id=school_id, is_active=True)

    class_obj_id = filters.get('class_obj_id')
    if class_obj_id:
        students_qs = students_qs.filter(class_obj_id=class_obj_id)

    academic_year_id = filters.get('academic_year_id')
    session_class_id = filters.get('session_class_id')
    if academic_year_id or session_class_id:
        enrollment_filters = {'enrollments__is_active': True}
        if academic_year_id:
            enrollment_filters['enrollments__academic_year_id'] = academic_year_id
        if session_class_id:
            enrollment_filters['enrollments__session_class_id'] = session_class_id
        students_qs = students_qs.filter(**enrollment_filters).distinct()

    return students_qs


def _resolve_recipients_for_broadcast(school, role, filters):
    from schools.models import UserSchoolMembership
    from notifications.recipients import get_student_user
    from parents.models import ParentChild

    role_map = {
        'PARENT': UserSchoolMembership.Role.PARENT,
        'TEACHER': UserSchoolMembership.Role.TEACHER,
        'STAFF': UserSchoolMembership.Role.STAFF,
        'SCHOOL_ADMIN': UserSchoolMembership.Role.SCHOOL_ADMIN,
        'PRINCIPAL': UserSchoolMembership.Role.PRINCIPAL,
        'HR_MANAGER': UserSchoolMembership.Role.HR_MANAGER,
        'ACCOUNTANT': UserSchoolMembership.Role.ACCOUNTANT,
        'STUDENT': UserSchoolMembership.Role.STUDENT,
    }

    users_by_id = {}

    if role in ('PARENT', 'STUDENT'):
        students_qs = _build_filtered_students_qs(school.id, filters)
        students = list(students_qs)

        if role == 'PARENT':
            links = ParentChild.objects.filter(
                school=school,
                student__in=students,
            ).select_related('parent__user')
            for link in links:
                parent_user = getattr(getattr(link, 'parent', None), 'user', None)
                if parent_user and parent_user.id:
                    users_by_id[parent_user.id] = parent_user
        else:
            for student in students:
                student_user = get_student_user(student)
                if student_user and student_user.id:
                    users_by_id[student_user.id] = student_user
    else:
        membership_role = role_map.get(role)
        memberships = UserSchoolMembership.objects.filter(
            school=school,
            role=membership_role,
            is_active=True,
        ).select_related('user')
        for membership in memberships:
            if membership.user_id:
                users_by_id[membership.user_id] = membership.user

    return list(users_by_id.values())


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


class MyNotificationsView(ListAPIView):
    """Get notifications for the current user (in-app notifications)."""
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationLogSerializer

    def get_queryset(self):
        qs = NotificationLog.objects.filter(
            recipient_user=self.request.user,
            channel='IN_APP',
        ).select_related('student', 'school').order_by('-created_at')

        event_type = self.request.query_params.get('event_type')
        if event_type:
            qs = qs.filter(event_type=event_type)

        qs = filter_my_notifications_by_school(self.request, qs)
        return qs


class UnreadCountView(APIView):
    """Get unread notification count for the bell badge."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """
        Unread count is all in-app rows for the user (all schools) so the bell
        badge does not drop when the UI filters the list to one branch.
        Optional ?school_id= limits the count when a client needs branch-level counts.
        """
        qs = NotificationLog.objects.filter(
            recipient_user=request.user,
            channel='IN_APP',
            read_at__isnull=True,
        ).exclude(status='FAILED')
        if request.query_params.get('school_id') not in (None, ''):
            qs = filter_my_notifications_by_school(request, qs)
        return Response({'unread_count': qs.count()})


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
        qs = NotificationLog.objects.filter(
            recipient_user=request.user,
            channel='IN_APP',
            read_at__isnull=True,
        )
        raw = request.data.get('school_id')
        if raw not in (None, ''):
            try:
                school_id = int(raw)
            except (TypeError, ValueError):
                return Response({'error': 'Invalid school_id'}, status=status.HTTP_400_BAD_REQUEST)
            if not request.user.can_access_school(school_id):
                return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
            qs = qs.filter(school_id=school_id)

        updated = qs.update(read_at=timezone.now(), status='READ')

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
        recipient_identifier = data['recipient_identifier']
        recipient_user = None

        # For in-app/push sends, resolve a concrete user so the notification
        # appears in the user's inbox (`MyNotificationsView` filters by recipient_user).
        if data['channel'] in ('IN_APP', 'PUSH'):
            from schools.models import UserSchoolMembership
            membership_qs = UserSchoolMembership.objects.filter(
                school_id=school_id,
                is_active=True,
            ).select_related('user')

            if str(recipient_identifier).isdigit():
                membership = membership_qs.filter(user_id=int(recipient_identifier)).first()
            else:
                membership = membership_qs.filter(
                    Q(user__email__iexact=recipient_identifier) | Q(user__username__iexact=recipient_identifier)
                ).first()

            if membership and membership.user_id:
                recipient_user = membership.user
            else:
                # Fallback for "send test to me": allow current authenticated user
                # even when membership rows are incomplete in seed/legacy data.
                current_user = request.user
                raw_identifier = str(recipient_identifier).strip().lower()
                if (
                    raw_identifier == str(current_user.id).lower()
                    or raw_identifier == (current_user.email or '').strip().lower()
                    or raw_identifier == (current_user.username or '').strip().lower()
                ):
                    recipient_user = current_user
                else:
                    return Response(
                        {'detail': 'In-app recipient must be a valid active school user (id, username, or email).'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            recipient_identifier = str(recipient_user.id)

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
            recipient_identifier=recipient_identifier,
            recipient_type=data.get('recipient_type', 'PARENT'),
            recipient_user=recipient_user,
            student=student,
            title=data.get('title', ''),
            body=data.get('body', ''),
        )

        if log:
            return Response(NotificationLogSerializer(log).data, status=201)
        return Response({'detail': 'Notification skipped (disabled or opted out)'}, status=200)


class BroadcastNotificationView(ModuleAccessMixin, APIView):
    """Broadcast a notification to all users of a specific role in the school."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    # Map membership roles to NotificationLog recipient_type
    LOG_RECIPIENT_MAP = {
        'PARENT': 'PARENT',
        'TEACHER': 'STAFF',
        'STAFF': 'STAFF',
        'SCHOOL_ADMIN': 'ADMIN',
        'PRINCIPAL': 'ADMIN',
        'HR_MANAGER': 'STAFF',
        'ACCOUNTANT': 'STAFF',
        'STUDENT': 'STAFF',
    }

    def post(self, request):
        serializer = BroadcastNotificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)

        role = data['recipient_type']
        filters = {
            'class_obj_id': data.get('class_obj_id'),
            'session_class_id': data.get('session_class_id'),
            'academic_year_id': data.get('academic_year_id'),
        }
        recipients = _resolve_recipients_for_broadcast(school, role, filters)
        if not recipients:
            return Response(
                {'detail': f'No users found with role {role} in this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        log_recipient_type = self.LOG_RECIPIENT_MAP.get(role, 'STAFF')
        engine = NotificationEngine(school)

        sent = 0
        failed = 0
        skipped = 0
        for user in recipients:
            if data['channel'] == 'IN_APP':
                identifier = str(user.id)
            elif data['channel'] == 'EMAIL':
                identifier = user.email or str(user.id)
            else:
                identifier = str(user.id)

            log = engine.send(
                event_type=data['event_type'],
                channel=data['channel'],
                context=data.get('context', {}),
                recipient_identifier=identifier,
                recipient_type=log_recipient_type,
                recipient_user=user,
                title=data['title'],
                body=data['body'],
            )
            if log is None:
                skipped += 1
            elif log.status in ('SENT', 'SCHEDULED'):
                sent += 1
            else:
                failed += 1

        return Response({
            'sent': sent,
            'failed': failed,
            'skipped': skipped,
            'total_recipients': len(recipients),
        }, status=status.HTTP_201_CREATED)


class PreviewRecipientsView(ModuleAccessMixin, APIView):
    """Preview recipients for manual broadcast with optional filters."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def post(self, request):
        serializer = PreviewRecipientsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)

        recipients = _resolve_recipients_for_broadcast(
            school=school,
            role=data['recipient_type'],
            filters={
                'class_obj_id': data.get('class_obj_id'),
                'session_class_id': data.get('session_class_id'),
                'academic_year_id': data.get('academic_year_id'),
            },
        )

        samples = [
            {
                'id': user.id,
                'name': user.get_full_name() or user.username or user.email or f'User {user.id}',
                'email': user.email,
                'phone': getattr(user, 'phone', ''),
            }
            for user in recipients[:10]
        ]

        return Response({
            'count': len(recipients),
            'samples': samples,
        })


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

        range_map = {'7d': 7, '30d': 30, '90d': 90}
        days = range_map.get(request.query_params.get('range'))
        logs_qs = NotificationLog.objects.filter(school_id=school_id)
        if days:
            logs_qs = logs_qs.filter(created_at__gte=timezone.now() - timezone.timedelta(days=days))

        event_type_analytics = {}
        for row in logs_qs.values('event_type').annotate(total=Count('id')).order_by('event_type'):
            event_type = row['event_type']
            total = row['total']
            sent = logs_qs.filter(event_type=event_type, status__in=['SENT', 'DELIVERED', 'READ']).count()
            failed = logs_qs.filter(event_type=event_type, status='FAILED').count()
            read = logs_qs.filter(event_type=event_type, status='READ').count()
            event_type_analytics[event_type] = {
                'total': total,
                'sent': sent,
                'failed': failed,
                'read': read,
                'delivery_rate': round(sent / total * 100, 1) if total else 0,
                'read_rate': round(read / sent * 100, 1) if sent else 0,
            }

        trend = list(
            logs_qs.annotate(day=TruncDate('created_at'))
            .values('day')
            .annotate(
                total=Count('id'),
                sent=Count('id', filter=Q(status__in=['SENT', 'DELIVERED', 'READ'])),
                failed=Count('id', filter=Q(status='FAILED')),
                read=Count('id', filter=Q(status='READ')),
            )
            .order_by('day')
        )

        top_failure_reasons = list(
            logs_qs.filter(status='FAILED')
            .values('channel', 'metadata__reason_code')
            .annotate(count=Count('id'))
            .order_by('-count')[:10]
        )

        return Response({
            **analytics,
            'optimal_send_time': optimal_time,
            'event_type_analytics': event_type_analytics,
            'trend': trend,
            'top_failure_reasons': [
                {
                    'channel': item['channel'],
                    'reason_code': item['metadata__reason_code'] or 'unknown',
                    'count': item['count'],
                }
                for item in top_failure_reasons
            ],
        })


class NotificationDiagnosticsView(ModuleAccessMixin, APIView):
    """Diagnostics endpoint for notification non-delivery visibility."""
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        now = timezone.now()
        since_days = int(request.query_params.get('days', 7) or 7)
        since = now - timezone.timedelta(days=since_days)

        logs = NotificationLog.objects.filter(
            school_id=school_id,
            created_at__gte=since,
        )

        failed_logs = logs.filter(status='FAILED').order_by('-created_at')
        pending_old_count = logs.filter(
            status='PENDING',
            created_at__lt=now - timezone.timedelta(minutes=1),
        ).count()
        scheduled_due_count = logs.filter(status='SCHEDULED', scheduled_for__lte=now).count()
        scheduled_future_count = logs.filter(status='SCHEDULED', scheduled_for__gt=now).count()

        reason_counts = {}
        for metadata in failed_logs.values_list('metadata', flat=True):
            reason = (metadata or {}).get('reason_code') or 'unknown'
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

        retry_eligible = 0
        for metadata in failed_logs.values_list('metadata', flat=True):
            payload = metadata or {}
            retry_count = int(payload.get('retry_count', 0) or 0)
            if payload.get('retriable') and retry_count < 3:
                retry_eligible += 1

        recent_failures = []
        for log in failed_logs[:20]:
            metadata = log.metadata or {}
            recent_failures.append({
                'id': log.id,
                'event_type': log.event_type,
                'channel': log.channel,
                'recipient_identifier': log.recipient_identifier,
                'created_at': log.created_at,
                'reason_code': metadata.get('reason_code'),
                'error': metadata.get('error') or metadata.get('retry_error'),
                'retriable': bool(metadata.get('retriable')),
                'retry_count': int(metadata.get('retry_count', 0) or 0),
            })

        config = SchoolNotificationConfig.objects.filter(school_id=school_id).first()
        config_blockers = []
        if config:
            if not config.in_app_enabled:
                config_blockers.append('in_app_disabled')
            if not config.whatsapp_enabled:
                config_blockers.append('whatsapp_disabled')
            if not config.email_enabled:
                config_blockers.append('email_disabled')
            if not config.in_app_enabled:
                config_blockers.append('push_disabled')

        return Response({
            'window_days': since_days,
            'queue': {
                'pending_old': pending_old_count,
                'scheduled_due': scheduled_due_count,
                'scheduled_future': scheduled_future_count,
            },
            'failed_total': failed_logs.count(),
            'failed_by_reason_code': reason_counts,
            'retry': {
                'eligible_failed': retry_eligible,
                'max_retry_attempts': 3,
            },
            'config_blockers': config_blockers,
            'recent_failures': recent_failures,
        })


class RunNotificationJobView(ModuleAccessMixin, APIView):
    """
    Admin-triggered replacement for the notification jobs that used to run on
    Celery Beat (fee-pending scan, daily report, attendance-marking reminder).
    Scoped to the current tenant school only — unlike the old scheduled tasks,
    which looped every active school in the database.
    """
    required_module = 'notifications'
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

    JOBS = ('fee_pending', 'daily_report', 'attendance_reminder')

    def post(self, request):
        job = request.data.get('job')
        if job not in self.JOBS:
            return Response(
                {'detail': f"job must be one of {', '.join(self.JOBS)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'error': 'school_id required'}, status=400)

        from schools.models import School
        school = School.objects.get(id=school_id)
        today = timezone.localdate()

        if job == 'fee_pending':
            from .triggers import trigger_fee_pending_in_app
            month = int(request.data.get('month') or today.month)
            year = int(request.data.get('year') or today.year)
            sent = trigger_fee_pending_in_app(school, month, year)
            return Response({'job': job, 'sent': sent, 'month': month, 'year': year})

        if job == 'daily_report':
            from .triggers import trigger_daily_school_report
            sent = trigger_daily_school_report(school, today)
            return Response({'job': job, 'sent': sent, 'date': str(today)})

        from .triggers import trigger_class_teacher_attendance_pending
        sent = trigger_class_teacher_attendance_pending(school, today)
        return Response({'job': job, 'sent': sent, 'date': str(today)})


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
