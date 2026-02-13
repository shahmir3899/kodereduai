"""
URL configuration for the LMS app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import LessonPlanViewSet, AssignmentViewSet, AssignmentSubmissionViewSet

router = DefaultRouter()
router.register(r'lesson-plans', LessonPlanViewSet, basename='lesson-plan')
router.register(r'assignments', AssignmentViewSet, basename='assignment')
router.register(r'submissions', AssignmentSubmissionViewSet, basename='submission')

urlpatterns = [
    # Nested route: submissions scoped under a specific assignment
    path(
        'assignments/<int:assignment_id>/submissions/',
        AssignmentSubmissionViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='assignment-submissions',
    ),
    path('', include(router.urls)),
]
