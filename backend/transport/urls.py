"""
URL configuration for transport app.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    TransportDashboardView,
    TransportRouteViewSet,
    TransportStopViewSet,
    TransportVehicleViewSet,
    TransportAssignmentViewSet,
    TransportAttendanceViewSet,
    # Student journey endpoints (legacy, for student self-tracking)
    JourneyStartView,
    JourneyEndView,
    JourneyUpdateView,
    JourneyTrackView,
    JourneyHistoryView,
    ActiveJourneysView,
    # Route journey endpoints (driver/vehicle-centric tracking)
    RouteJourneyStartView,
    RouteJourneyEndView,
    RouteJourneyUpdateView,
    RouteJourneyTrackView,
    ActiveRouteJourneysView,
    RouteJourneyHistoryView,
)

router = DefaultRouter()
router.register(r'routes', TransportRouteViewSet, basename='transport-route')
router.register(r'stops', TransportStopViewSet, basename='transport-stop')
router.register(r'vehicles', TransportVehicleViewSet, basename='transport-vehicle')
router.register(r'assignments', TransportAssignmentViewSet, basename='transport-assignment')
router.register(r'attendance', TransportAttendanceViewSet, basename='transport-attendance')

urlpatterns = [
    # Dashboard
    path('dashboard/', TransportDashboardView.as_view(), name='transport-dashboard'),

    # Student journey endpoints (legacy, kept for student self-tracking)
    path('journey/start/', JourneyStartView.as_view(), name='journey-start'),
    path('journey/end/', JourneyEndView.as_view(), name='journey-end'),
    path('journey/update/', JourneyUpdateView.as_view(), name='journey-update'),
    path('journey/track/<int:student_id>/', JourneyTrackView.as_view(), name='journey-track'),
    path('journey/history/<int:student_id>/', JourneyHistoryView.as_view(), name='journey-history'),
    path('journey/active/', ActiveJourneysView.as_view(), name='journey-active'),

    # Route journey endpoints (driver/vehicle-centric tracking)
    path('route-journey/start/', RouteJourneyStartView.as_view(), name='route-journey-start'),
    path('route-journey/end/', RouteJourneyEndView.as_view(), name='route-journey-end'),
    path('route-journey/update/', RouteJourneyUpdateView.as_view(), name='route-journey-update'),
    path('route-journey/track/<int:student_id>/', RouteJourneyTrackView.as_view(), name='route-journey-track'),
    path('route-journey/active/', ActiveRouteJourneysView.as_view(), name='route-journey-active'),
    path('route-journey/history/', RouteJourneyHistoryView.as_view(), name='route-journey-history'),

    path('', include(router.urls)),
]
