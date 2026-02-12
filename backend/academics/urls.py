from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SubjectViewSet, ClassSubjectViewSet,
    TimetableSlotViewSet, TimetableEntryViewSet,
    AcademicsAIChatView, AcademicsAnalyticsView,
)

router = DefaultRouter()
router.register(r'subjects', SubjectViewSet, basename='subject')
router.register(r'class-subjects', ClassSubjectViewSet, basename='class-subject')
router.register(r'timetable-slots', TimetableSlotViewSet, basename='timetable-slot')
router.register(r'timetable-entries', TimetableEntryViewSet, basename='timetable-entry')

urlpatterns = [
    path('ai-chat/', AcademicsAIChatView.as_view(), name='academics-ai-chat'),
    path('analytics/', AcademicsAnalyticsView.as_view(), name='academics-analytics'),
    path('', include(router.urls)),
]
