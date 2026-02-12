from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ExamTypeViewSet, ExamViewSet, ExamSubjectViewSet,
    StudentMarkViewSet, GradeScaleViewSet, ReportCardView,
)

router = DefaultRouter()
router.register(r'exam-types', ExamTypeViewSet, basename='exam-type')
router.register(r'exams', ExamViewSet, basename='exam')
router.register(r'exam-subjects', ExamSubjectViewSet, basename='exam-subject')
router.register(r'marks', StudentMarkViewSet, basename='student-mark')
router.register(r'grade-scales', GradeScaleViewSet, basename='grade-scale')

urlpatterns = [
    path('', include(router.urls)),
    path('report-card/', ReportCardView.as_view(), name='report-card'),
]
