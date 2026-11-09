from django.urls import path

from .views import (
    ActionApproveView, CapabilitiesView, MessageStreamView, SpokenVersionView, TranscribeView, ActionDetailView, ActionEditView, ActionListView, ActionRejectView,
    ConversationDetailView, FeedbackView, InsightsGroupView, InsightsView, ConversationListView, MessageListView,
)

urlpatterns = [
    path('conversations/', ConversationListView.as_view(), name='assistant-conversations'),
    path('conversations/<int:pk>/', ConversationDetailView.as_view(), name='assistant-conversation'),
    path('conversations/<int:pk>/messages/', MessageListView.as_view(), name='assistant-messages'),
    path('capabilities/', CapabilitiesView.as_view(), name='assistant-capabilities'),
    path('conversations/<int:pk>/stream/', MessageStreamView.as_view(), name='assistant-stream'),
    path('voice/transcribe/', TranscribeView.as_view(), name='assistant-transcribe'),
    path('voice/spoken/', SpokenVersionView.as_view(), name='assistant-spoken'),
    path('feedback/', FeedbackView.as_view(), name='assistant-feedback'),
    path('insights/', InsightsView.as_view(), name='assistant-insights'),
    path('insights/groups/<int:pk>/', InsightsGroupView.as_view(), name='assistant-insights-group'),
    path('actions/', ActionListView.as_view(), name='assistant-actions'),
    path('actions/<int:pk>/', ActionDetailView.as_view(), name='assistant-action'),
    path('actions/<int:pk>/approve/', ActionApproveView.as_view(), name='assistant-action-approve'),
    path('actions/<int:pk>/edit/', ActionEditView.as_view(), name='assistant-action-edit'),
    path('actions/<int:pk>/reject/', ActionRejectView.as_view(), name='assistant-action-reject'),
]
