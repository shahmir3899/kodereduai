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
)

router = DefaultRouter()
router.register(r'sessions', FaceAttendanceSessionViewSet, basename='face-session')
router.register(r'enrollments', FaceEnrollmentViewSet, basename='face-enrollment')

urlpatterns = [
    path('upload-image/', FaceImageUploadView.as_view(), name='face-upload-image'),
    path('enroll/', FaceEnrollmentViewSet.as_view({'post': 'enroll'}), name='face-enroll'),
    path('status/', FaceAttendanceStatusView.as_view(), name='face-status'),
    path('', include(router.urls)),
]
