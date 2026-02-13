"""
URL configuration for transport app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    TransportRouteViewSet,
    TransportStopViewSet,
    TransportVehicleViewSet,
    TransportAssignmentViewSet,
    TransportAttendanceViewSet,
)

router = DefaultRouter()
router.register(r'routes', TransportRouteViewSet, basename='transport-route')
router.register(r'stops', TransportStopViewSet, basename='transport-stop')
router.register(r'vehicles', TransportVehicleViewSet, basename='transport-vehicle')
router.register(r'assignments', TransportAssignmentViewSet, basename='transport-assignment')
router.register(r'attendance', TransportAttendanceViewSet, basename='transport-attendance')

urlpatterns = [
    path('', include(router.urls)),
]
