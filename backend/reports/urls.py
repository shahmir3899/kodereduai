from django.urls import path
from .views import GenerateReportView, ReportListView, ReportDownloadView

urlpatterns = [
    path('generate/', GenerateReportView.as_view(), name='generate-report'),
    path('list/', ReportListView.as_view(), name='report-list'),
    path('<int:report_id>/download/', ReportDownloadView.as_view(), name='report-download'),
]
