"""
URL configuration for hostel management app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    HostelViewSet, RoomViewSet, HostelAllocationViewSet,
    GatePassViewSet, HostelDashboardView,
)

router = DefaultRouter()
router.register(r'hostels', HostelViewSet, basename='hostel')
router.register(r'rooms', RoomViewSet, basename='room')
router.register(r'allocations', HostelAllocationViewSet, basename='hostel-allocation')
router.register(r'gate-passes', GatePassViewSet, basename='gate-pass')

urlpatterns = [
    path('dashboard/', HostelDashboardView.as_view(), name='hostel-dashboard'),
    path('', include(router.urls)),
]
