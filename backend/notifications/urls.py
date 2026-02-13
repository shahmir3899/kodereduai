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
    NotificationAnalyticsView,
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
    path('analytics/', NotificationAnalyticsView.as_view(), name='notification-analytics'),
    path('ai-chat/', CommunicationAgentView.as_view(), name='communication-agent'),
]
