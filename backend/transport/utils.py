"""
Transport utility functions: Haversine distance, auto-distance, geofence checking.
"""

import math
import logging

logger = logging.getLogger(__name__)

EARTH_RADIUS_KM = 6371.0
GEOFENCE_RADIUS_METERS = 100


def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two GPS points.
    Returns distance in meters.
    """
    lat1, lon1, lat2, lon2 = (
        math.radians(float(v)) for v in (lat1, lon1, lat2, lon2)
    )
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c * 1000  # meters


def auto_calculate_route_distance(route):
    """
    Calculate total route distance in km by summing haversine distances:
    start -> stop1 -> stop2 -> ... -> end.
    Returns distance in km rounded to 2 decimal places, or None if not enough coords.
    """
    points = []

    if route.start_latitude and route.start_longitude:
        points.append((float(route.start_latitude), float(route.start_longitude)))

    stops = route.stops.filter(
        latitude__isnull=False, longitude__isnull=False,
    ).order_by('stop_order')
    for stop in stops:
        points.append((float(stop.latitude), float(stop.longitude)))

    if route.end_latitude and route.end_longitude:
        points.append((float(route.end_latitude), float(route.end_longitude)))

    if len(points) < 2:
        return None

    total_meters = sum(
        haversine_distance(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1])
        for i in range(len(points) - 1)
    )
    return round(total_meters / 1000, 2)


def check_geofence(route_journey, lat, lng):
    """
    Check if the current position is within GEOFENCE_RADIUS_METERS of any stop
    on the journey's route that hasn't been notified yet.
    Triggers push notifications for matching stops.

    Returns list of stop IDs that were newly triggered.
    """
    from .models import TransportStop

    lat, lng = float(lat), float(lng)
    already_notified = set(route_journey.notified_stops or [])

    stops = TransportStop.objects.filter(
        route=route_journey.route,
        latitude__isnull=False,
        longitude__isnull=False,
    )

    newly_triggered = []
    for stop in stops:
        if stop.id in already_notified:
            continue

        distance = haversine_distance(lat, lng, float(stop.latitude), float(stop.longitude))
        if distance <= GEOFENCE_RADIUS_METERS:
            newly_triggered.append(stop)

    if newly_triggered:
        # Update notified_stops on the journey
        new_ids = [s.id for s in newly_triggered]
        route_journey.notified_stops = list(already_notified | set(new_ids))
        route_journey.save(update_fields=['notified_stops'])

        # Fire notifications
        try:
            from .triggers import trigger_bus_arriving_stop
            for stop in newly_triggered:
                trigger_bus_arriving_stop(route_journey, stop)
        except Exception:
            logger.exception("Failed to send geofence notification")

    return [s.id for s in newly_triggered]


def resolve_school_id(request):
    """
    Resolve school_id from: X-School-ID header -> params -> user.school_id -> fallback.
    """
    from core.mixins import ensure_tenant_school_id

    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid

    # If X-School-ID header was sent but rejected, don't fall back
    if request.headers.get('X-School-ID'):
        return None

    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)

    if request.user.school_id:
        return request.user.school_id

    if request.user.is_super_admin:
        from schools.models import School
        schools = list(School.objects.filter(is_active=True).values_list('id', flat=True)[:2])
        if len(schools) == 1:
            return schools[0]

    return None


def annotate_route_counts(queryset):
    """Stop/vehicle/student counts and seat capacity per route.

    The three counts join different tables, so each needs distinct=True and
    capacity is a subquery: summing over the joined rows multiplied every
    figure by the other tables' row counts.
    """
    from django.db.models import Count, IntegerField, OuterRef, Q, Subquery, Sum
    from django.db.models.functions import Coalesce

    from .models import TransportVehicle

    capacity = (
        TransportVehicle.objects.filter(assigned_route=OuterRef('pk'), is_active=True)
        .order_by().values('assigned_route').annotate(total=Sum('capacity')).values('total')
    )
    return queryset.annotate(
        stops_count=Count('stops', distinct=True),
        vehicles_count=Count('vehicles', filter=Q(vehicles__is_active=True), distinct=True),
        students_count=Count(
            'transport_assignments', filter=Q(transport_assignments__is_active=True), distinct=True,
        ),
        total_capacity=Coalesce(Subquery(capacity, output_field=IntegerField()), 0),
    ).order_by('name')
