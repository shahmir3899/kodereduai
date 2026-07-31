"""
URL configuration for face_attendance app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    FaceAttendanceSessionViewSet,
    FaceEnrollmentViewSet,
    FaceImageUploadView,
    FaceAttendanceStatusView,
    LiveMatchView,
    LiveMatchFeedbackView,
    FaceCaptureDeviceViewSet,
    FaceLiveDetectionEventListView,
)

router = DefaultRouter()
router.register(r'sessions', FaceAttendanceSessionViewSet, basename='face-session')
router.register(r'enrollments', FaceEnrollmentViewSet, basename='face-enrollment')
router.register(r'devices', FaceCaptureDeviceViewSet, basename='face-device')

urlpatterns = [
    path('upload-image/', FaceImageUploadView.as_view(), name='face-upload-image'),
    path('enroll/', FaceEnrollmentViewSet.as_view({'post': 'enroll'}), name='face-enroll'),
    path('status/', FaceAttendanceStatusView.as_view(), name='face-status'),
    path('live/match/', LiveMatchView.as_view(), name='face-live-match'),
    path('live/events/', FaceLiveDetectionEventListView.as_view(), name='face-live-events'),
    path('live/events/<uuid:event_id>/feedback/', LiveMatchFeedbackView.as_view(), name='face-live-match-feedback'),
    path('', include(router.urls)),
]
