"""
URL configuration for parents app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ParentRegistrationView,
    MyChildrenView,
    ChildOverviewView,
    ChildAttendanceView,
    ChildFeesView,
    ParentPayFeeView,
    ChildTimetableView,
    ChildExamResultsView,
    ParentLeaveRequestViewSet,
    ParentMessageViewSet,
    AdminParentListView,
    AdminLinkChildView,
    AdminUnlinkChildView,
    AdminGenerateInviteView,
    AdminLeaveRequestListView,
    AdminLeaveReviewView,
)

# Router for ViewSets
router = DefaultRouter()
router.register(r'leave-requests', ParentLeaveRequestViewSet, basename='parent-leave-request')

# Message ViewSet instance for wiring
message_viewset = ParentMessageViewSet.as_view({
    'get': 'list_threads',
})

urlpatterns = [
    # ── Parent-facing ────────────────────────────────────────
    path('register/', ParentRegistrationView.as_view(), name='parent-register'),
    path('my-children/', MyChildrenView.as_view(), name='parent-my-children'),

    # Child-specific views
    path('children/<int:student_id>/overview/', ChildOverviewView.as_view(), name='parent-child-overview'),
    path('children/<int:student_id>/attendance/', ChildAttendanceView.as_view(), name='parent-child-attendance'),
    path('children/<int:student_id>/fees/', ChildFeesView.as_view(), name='parent-child-fees'),
    path('children/<int:student_id>/pay-fee/', ParentPayFeeView.as_view(), name='parent-pay-fee'),
    path('children/<int:student_id>/timetable/', ChildTimetableView.as_view(), name='parent-child-timetable'),
    path('children/<int:student_id>/exam-results/', ChildExamResultsView.as_view(), name='parent-child-exam-results'),

    # Leave requests (router)
    path('', include(router.urls)),

    # Messaging
    path('messages/threads/', ParentMessageViewSet.as_view({'get': 'list_threads'}), name='parent-message-threads'),
    path('messages/threads/<uuid:thread_id>/', ParentMessageViewSet.as_view({'get': 'get_thread'}), name='parent-message-thread-detail'),
    path('messages/', ParentMessageViewSet.as_view({'post': 'send_message'}), name='parent-message-send'),
    path('messages/<int:pk>/read/', ParentMessageViewSet.as_view({'patch': 'mark_read'}), name='parent-message-read'),

    # ── Admin-facing ─────────────────────────────────────────
    path('admin/parents/', AdminParentListView.as_view(), name='admin-parent-list'),
    path('admin/link-child/', AdminLinkChildView.as_view(), name='admin-link-child'),
    path('admin/unlink-child/<int:pk>/', AdminUnlinkChildView.as_view(), name='admin-unlink-child'),
    path('admin/generate-invite/', AdminGenerateInviteView.as_view(), name='admin-generate-invite'),
    path('admin/leave-requests/', AdminLeaveRequestListView.as_view(), name='admin-leave-request-list'),
    path('admin/leave-requests/<int:pk>/review/', AdminLeaveReviewView.as_view(), name='admin-leave-review'),
]
