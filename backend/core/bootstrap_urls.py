from django.urls import path
from .bootstrap_views import AdminDashboardBootstrapView
from .leadership_insights_views import LeadershipAcademicInsightsView

urlpatterns = [
    path('admin-dashboard/', AdminDashboardBootstrapView.as_view(), name='bootstrap-admin-dashboard'),
    path('leadership-academic-insights/', LeadershipAcademicInsightsView.as_view(), name='bootstrap-leadership-academic-insights'),
]
