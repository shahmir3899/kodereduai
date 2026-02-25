from django.urls import path
from .views import (
    GenerateReportView, ReportListView, ReportDownloadView,
    CustomLetterListCreateView, CustomLetterDetailView,
    LetterTemplatesView, LetterPrefillView, GenerateLetterPDFView,
    LetterAIDraftView,
)

urlpatterns = [
    path('generate/', GenerateReportView.as_view(), name='generate-report'),
    path('list/', ReportListView.as_view(), name='report-list'),
    path('<int:report_id>/download/', ReportDownloadView.as_view(), name='report-download'),

    # Custom Letters — static paths before <int:pk> to avoid conflicts
    path('custom-letters/', CustomLetterListCreateView.as_view(), name='custom-letter-list'),
    path('custom-letters/templates/', LetterTemplatesView.as_view(), name='letter-templates'),
    path('custom-letters/prefill/', LetterPrefillView.as_view(), name='letter-prefill'),
    path('custom-letters/generate-pdf/', GenerateLetterPDFView.as_view(), name='letter-generate-pdf'),
    path('custom-letters/ai-draft/', LetterAIDraftView.as_view(), name='letter-ai-draft'),
    path('custom-letters/<int:pk>/', CustomLetterDetailView.as_view(), name='custom-letter-detail'),
]
