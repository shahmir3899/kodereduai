from django.urls import path
from .bootstrap_views import AdminDashboardBootstrapView

urlpatterns = [
    path('admin-dashboard/', AdminDashboardBootstrapView.as_view(), name='bootstrap-admin-dashboard'),
]
