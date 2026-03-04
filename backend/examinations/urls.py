from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ExamTypeViewSet, ExamGroupViewSet, ExamViewSet, ExamSubjectViewSet,
    StudentMarkViewSet, GradeScaleViewSet, ReportCardView,
    QuestionViewSet, ExamPaperViewSet, PaperUploadViewSet, PaperFeedbackViewSet,
)

router = DefaultRouter()
router.register(r'exam-types', ExamTypeViewSet, basename='exam-type')
router.register(r'exam-groups', ExamGroupViewSet, basename='exam-group')
router.register(r'exams', ExamViewSet, basename='exam')
router.register(r'exam-subjects', ExamSubjectViewSet, basename='exam-subject')
router.register(r'marks', StudentMarkViewSet, basename='student-mark')
router.register(r'grade-scales', GradeScaleViewSet, basename='grade-scale')

# Question Paper Builder routes
router.register(r'questions', QuestionViewSet, basename='question')
router.register(r'exam-papers', ExamPaperViewSet, basename='exam-paper')
router.register(r'paper-uploads', PaperUploadViewSet, basename='paper-upload')
router.register(r'paper-feedback', PaperFeedbackViewSet, basename='paper-feedback')

urlpatterns = [
    path('', include(router.urls)),
    path('report-card/', ReportCardView.as_view(), name='report-card'),
]
