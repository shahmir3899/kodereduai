"""
URL configuration for attendance app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import AttendanceUploadViewSet, AttendanceRecordViewSet, ImageUploadView, AIStatusView, AttendanceAnomalyViewSet

router = DefaultRouter()
router.register(r'uploads', AttendanceUploadViewSet, basename='attendance-upload')
router.register(r'records', AttendanceRecordViewSet, basename='attendance-record')
router.register(r'anomalies', AttendanceAnomalyViewSet, basename='attendance-anomaly')

urlpatterns = [
    path('upload-image/', ImageUploadView.as_view(), name='upload-image'),
    path('ai-status/', AIStatusView.as_view(), name='ai-status'),
    path('', include(router.urls)),
]
