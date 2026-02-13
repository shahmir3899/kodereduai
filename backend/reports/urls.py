from django.urls import path
from .views import GenerateReportView, ReportListView

urlpatterns = [
    path('generate/', GenerateReportView.as_view(), name='generate-report'),
    path('list/', ReportListView.as_view(), name='report-list'),
]
