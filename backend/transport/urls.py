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
    JourneyStartView,
    JourneyEndView,
    JourneyUpdateView,
    JourneyTrackView,
    JourneyHistoryView,
    ActiveJourneysView,
)

router = DefaultRouter()
router.register(r'routes', TransportRouteViewSet, basename='transport-route')
router.register(r'stops', TransportStopViewSet, basename='transport-stop')
router.register(r'vehicles', TransportVehicleViewSet, basename='transport-vehicle')
router.register(r'assignments', TransportAssignmentViewSet, basename='transport-assignment')
router.register(r'attendance', TransportAttendanceViewSet, basename='transport-attendance')

urlpatterns = [
    # GPS Journey endpoints
    path('journey/start/', JourneyStartView.as_view(), name='journey-start'),
    path('journey/end/', JourneyEndView.as_view(), name='journey-end'),
    path('journey/update/', JourneyUpdateView.as_view(), name='journey-update'),
    path('journey/track/<int:student_id>/', JourneyTrackView.as_view(), name='journey-track'),
    path('journey/history/<int:student_id>/', JourneyHistoryView.as_view(), name='journey-history'),
    path('journey/active/', ActiveJourneysView.as_view(), name='journey-active'),
    path('', include(router.urls)),
]
