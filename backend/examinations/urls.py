from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ExamTypeViewSet, ExamGroupViewSet, ExamViewSet, ExamSubjectViewSet,
    StudentMarkViewSet, StudentResponseViewSet, GradeScaleViewSet, ReportCardView, ReportCardMetaView, ReportCardBulkMetaView,
    QuestionViewSet, ExamPaperViewSet, PaperUploadViewSet, PaperFeedbackViewSet,
    StudentTermAssessmentView, StudentTermAssessmentRosterView, StudentTermAssessmentBulkSaveView,
    StudentTermAssessmentAIRemarkView, AcademicRiskView,
    WorksheetViewSet, WorksheetUploadViewSet,
)

router = DefaultRouter()
router.register(r'exam-types', ExamTypeViewSet, basename='exam-type')
router.register(r'exam-groups', ExamGroupViewSet, basename='exam-group')
router.register(r'exams', ExamViewSet, basename='exam')
router.register(r'exam-subjects', ExamSubjectViewSet, basename='exam-subject')
router.register(r'marks', StudentMarkViewSet, basename='student-mark')
router.register(r'student-responses', StudentResponseViewSet, basename='student-response')
router.register(r'grade-scales', GradeScaleViewSet, basename='grade-scale')

# Question Paper Builder routes
router.register(r'questions', QuestionViewSet, basename='question')
router.register(r'exam-papers', ExamPaperViewSet, basename='exam-paper')
router.register(r'paper-uploads', PaperUploadViewSet, basename='paper-upload')
router.register(r'paper-feedback', PaperFeedbackViewSet, basename='paper-feedback')

# Worksheets
router.register(r'worksheets', WorksheetViewSet, basename='worksheet')
router.register(r'worksheet-uploads', WorksheetUploadViewSet, basename='worksheet-upload')

urlpatterns = [
    path('', include(router.urls)),
    path('report-card/', ReportCardView.as_view(), name='report-card'),
    path('report-card/meta/', ReportCardMetaView.as_view(), name='report-card-meta'),
    path('report-card/meta/bulk/', ReportCardBulkMetaView.as_view(), name='report-card-meta-bulk'),
    path('student-term-assessment/', StudentTermAssessmentView.as_view(), name='student-term-assessment'),
    path('student-term-assessment/roster/', StudentTermAssessmentRosterView.as_view(), name='student-term-assessment-roster'),
    path('student-term-assessment/bulk-save/', StudentTermAssessmentBulkSaveView.as_view(), name='student-term-assessment-bulk-save'),
    path('student-term-assessment/ai-remark/', StudentTermAssessmentAIRemarkView.as_view(), name='student-term-assessment-ai-remark'),
    path('academic-risk/', AcademicRiskView.as_view(), name='academic-risk'),
]
