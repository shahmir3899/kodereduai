"""
URL configuration for notifications app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    NotificationTemplateViewSet,
    NotificationLogViewSet,
    NotificationPreferenceViewSet,
    SchoolNotificationConfigView,
    MyNotificationsView,
    UnreadCountView,
    MarkReadView,
    MarkAllReadView,
    SendNotificationView,
    BroadcastNotificationView,
    PreviewRecipientsView,
    NotificationAnalyticsView,
    NotificationDiagnosticsView,
    RunNotificationJobView,
    CommunicationAgentView,
)

router = DefaultRouter()
router.register(r'templates', NotificationTemplateViewSet, basename='notification-template')
router.register(r'logs', NotificationLogViewSet, basename='notification-log')
router.register(r'preferences', NotificationPreferenceViewSet, basename='notification-preference')

urlpatterns = [
    path('', include(router.urls)),
    path('config/', SchoolNotificationConfigView.as_view(), name='notification-config'),
    path('my/', MyNotificationsView.as_view(), name='my-notifications'),
    path('unread-count/', UnreadCountView.as_view(), name='unread-count'),
    path('<int:pk>/mark-read/', MarkReadView.as_view(), name='mark-read'),
    path('mark-all-read/', MarkAllReadView.as_view(), name='mark-all-read'),
    path('send/', SendNotificationView.as_view(), name='send-notification'),
    path('broadcast/', BroadcastNotificationView.as_view(), name='broadcast-notification'),
    path('broadcast/preview/', PreviewRecipientsView.as_view(), name='broadcast-preview'),
    path('analytics/', NotificationAnalyticsView.as_view(), name='notification-analytics'),
    path('diagnostics/', NotificationDiagnosticsView.as_view(), name='notification-diagnostics'),
    path('run/', RunNotificationJobView.as_view(), name='run-notification-job'),
    path('ai-chat/', CommunicationAgentView.as_view(), name='communication-agent'),
]
