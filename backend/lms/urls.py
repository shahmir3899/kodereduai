"""
URL configuration for the LMS app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    BookViewSet, ChapterViewSet, TopicViewSet,
    LessonPlanViewSet, AssignmentViewSet, AssignmentSubmissionViewSet,
    generate_lesson_plan_ai,
)

router = DefaultRouter()
router.register(r'books', BookViewSet, basename='book')
router.register(r'chapters', ChapterViewSet, basename='chapter')
router.register(r'topics', TopicViewSet, basename='topic')
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
    # AI lesson plan generation
    path('generate-lesson-plan/', generate_lesson_plan_ai, name='generate-lesson-plan'),
    path('', include(router.urls)),
]
