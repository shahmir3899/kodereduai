"""
Transport Route Journey Tests (pytest)
=======================================
Covers: RouteJourney CRUD, driver role permissions, admin manual mode,
        route duplication, total_capacity annotation, transport_type filter,
        haversine calculation, geofence check.

Run:
    cd backend
    pytest tests/test_transport_route_journey.py -v
"""

import pytest
from decimal import Decimal

P = "PTRJ_"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _create_route(api, seed_data, name_suffix="Route A", **overrides):
    payload = {
        "name": f"{P}{name_suffix}",
        "start_location": "School Gate",
        "end_location": "North Colony",
        "start_latitude": "31.520400",
        "start_longitude": "74.358700",
        "end_latitude": "31.540000",
        "end_longitude": "74.370000",
        "distance_km": 12.5,
        "estimated_duration_minutes": 45,
    }
    payload.update(overrides)
    resp = api.post(
        "/api/transport/routes/", payload,
        seed_data["tokens"]["admin"], seed_data["SID_A"],
    )
    assert resp.status_code == 201, f"create route failed: {resp.content[:200]}"
    return resp.json()["id"]


def _create_stop(api, seed_data, route_id, name="Stop 1", order=1,
                 lat="31.525000", lng="74.360000"):
    resp = api.post(
        "/api/transport/stops/",
        {
            "route": route_id,
            "name": f"{P}{name}",
            "address": "Test Address",
            "stop_order": order,
            "pickup_time": "07:30:00",
            "drop_time": "14:30:00",
            "latitude": lat,
            "longitude": lng,
        },
        seed_data["tokens"]["admin"], seed_data["SID_A"],
    )
    assert resp.status_code == 201, f"create stop failed: {resp.content[:200]}"
    return resp.json()["id"]


def _create_vehicle(api, seed_data, route_id, number="BUS-001", capacity=40, driver_user=None):
    payload = {
        "vehicle_number": f"{P}{number}",
        "vehicle_type": "BUS",
        "capacity": capacity,
        "assigned_route": route_id,
    }
    if driver_user:
        payload["driver_user"] = driver_user
    resp = api.post(
        "/api/transport/vehicles/", payload,
        seed_data["tokens"]["admin"], seed_data["SID_A"],
    )
    assert resp.status_code == 201, f"create vehicle failed: {resp.content[:200]}"
    return resp.json()["id"]


def _create_driver_user(seed_data, api_client):
    """Create a driver user with membership and return (user, token)."""
    from users.models import User
    from schools.models import UserSchoolMembership
    from conftest import APIHelper, PASSWORD

    u = User.objects.create_user(
        username=f"{P}driver1",
        email=f"{P}driver1@test.com",
        password=PASSWORD,
        role="DRIVER",
        school=seed_data["school_a"],
        organization=seed_data["org"],
    )
    UserSchoolMembership.objects.create(
        user=u, school=seed_data["school_a"], role="DRIVER", is_default=True,
    )
    helper = APIHelper(api_client)
    token = helper.login(f"{P}driver1")
    return u, token


# ── Cleanup ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _cleanup(seed_data):
    from transport.models import (
        TransportRoute, TransportVehicle, TransportStop,
        RouteJourney, RouteLocationUpdate,
    )
    school = seed_data["school_a"]
    RouteLocationUpdate.objects.filter(journey__school=school, journey__route__name__startswith=P).delete()
    RouteJourney.objects.filter(school=school, route__name__startswith=P).delete()
    TransportStop.objects.filter(route__school=school, name__startswith=P).delete()
    TransportVehicle.objects.filter(school=school, vehicle_number__startswith=P).delete()
    TransportRoute.objects.filter(school=school, name__startswith=P).delete()
    yield


# ==========================================================================
# HAVERSINE UTILITY
# ==========================================================================

@pytest.mark.django_db
class TestHaversine:

    def test_haversine_distance_same_point(self):
        from transport.utils import haversine_distance
        d = haversine_distance(31.52, 74.36, 31.52, 74.36)
        assert d == 0

    def test_haversine_distance_known_pair(self):
        """Lahore to Islamabad ~ 380 km."""
        from transport.utils import haversine_distance
        d = haversine_distance(31.5204, 74.3587, 33.6844, 73.0479)
        assert 270_000 < d < 290_000  # ~280 km in meters

    def test_auto_calculate_route_distance(self, seed_data, api):
        from transport.utils import auto_calculate_route_distance
        from transport.models import TransportRoute

        route_id = _create_route(api, seed_data)
        _create_stop(api, seed_data, route_id, "Mid Stop", 1, "31.530000", "74.364000")
        route = TransportRoute.objects.get(id=route_id)
        dist_km = auto_calculate_route_distance(route)
        assert dist_km > 0
        assert dist_km < 50  # reasonable for short urban route


# ==========================================================================
# ROUTE DUPLICATE
# ==========================================================================

@pytest.mark.django_db
class TestRouteDuplicate:

    def test_duplicate_route(self, seed_data, api):
        route_id = _create_route(api, seed_data, "Original")
        _create_stop(api, seed_data, route_id, "Stop A", 1)
        _create_stop(api, seed_data, route_id, "Stop B", 2)

        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post(f"/api/transport/routes/{route_id}/duplicate/", {}, token, sid)
        assert resp.status_code == 201
        data = resp.json()
        assert "(Copy)" in data["name"]
        assert data["id"] != route_id

        # Verify stops were also duplicated
        from transport.models import TransportStop
        orig_stops = TransportStop.objects.filter(route_id=route_id).count()
        new_stops = TransportStop.objects.filter(route_id=data["id"]).count()
        assert new_stops == orig_stops


# ==========================================================================
# TOTAL CAPACITY ANNOTATION
# ==========================================================================

@pytest.mark.django_db
class TestCapacityAnnotation:

    def test_total_capacity_on_route_list(self, seed_data, api):
        route_id = _create_route(api, seed_data, "Cap Route")
        _create_vehicle(api, seed_data, route_id, "BUS-A", capacity=40)
        _create_vehicle(api, seed_data, route_id, "BUS-B", capacity=30)

        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.get("/api/transport/routes/", token, sid)
        assert resp.status_code == 200
        data = resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        our_route = [r for r in results if r["id"] == route_id]
        assert len(our_route) == 1
        assert our_route[0]["total_capacity"] == 70


# ==========================================================================
# ROUTE JOURNEY — DRIVER ROLE
# ==========================================================================

@pytest.mark.django_db
class TestRouteJourneyDriver:

    def test_driver_can_start_journey(self, seed_data, api, api_client):
        route_id = _create_route(api, seed_data, "Driver Route")
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        _create_vehicle(api, seed_data, route_id, "DRV-BUS", 40, driver_user=driver_user.id)

        sid = seed_data["SID_A"]
        resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "latitude": 31.52,
            "longitude": 74.36,
        }, driver_token, sid)
        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "ACTIVE"
        assert data["tracking_mode"] == "DRIVER_APP"
        return data["id"]

    def test_driver_can_end_journey(self, seed_data, api, api_client):
        route_id = _create_route(api, seed_data, "End Route")
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        _create_vehicle(api, seed_data, route_id, "END-BUS", 40, driver_user=driver_user.id)

        sid = seed_data["SID_A"]
        start_resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "latitude": 31.52,
            "longitude": 74.36,
        }, driver_token, sid)
        journey_id = start_resp.json()["id"]

        end_resp = api.post("/api/transport/route-journey/end/", {
            "journey_id": journey_id,
        }, driver_token, sid)
        assert end_resp.status_code == 200
        assert end_resp.json()["status"] == "COMPLETED"

    def test_cannot_start_duplicate_active_journey(self, seed_data, api, api_client):
        route_id = _create_route(api, seed_data, "Dup Route")
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        _create_vehicle(api, seed_data, route_id, "DUP-BUS", 40, driver_user=driver_user.id)

        sid = seed_data["SID_A"]
        api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "latitude": 31.52, "longitude": 74.36,
        }, driver_token, sid)

        # Second start should fail
        resp2 = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "latitude": 31.52, "longitude": 74.36,
        }, driver_token, sid)
        assert resp2.status_code == 400


# ==========================================================================
# ROUTE JOURNEY — ADMIN MANUAL MODE
# ==========================================================================

@pytest.mark.django_db
class TestRouteJourneyAdmin:

    def test_admin_manual_journey(self, seed_data, api):
        route_id = _create_route(api, seed_data, "Manual Route")
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "FROM_SCHOOL",
            "route_id": route_id,
        }, token, sid)
        assert resp.status_code == 201
        data = resp.json()
        assert data["tracking_mode"] == "MANUAL"
        assert data["journey_type"] == "FROM_SCHOOL"

    def test_active_journeys_list(self, seed_data, api):
        route_id = _create_route(api, seed_data, "Active Route")
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "route_id": route_id,
        }, token, sid)

        resp = api.get("/api/transport/route-journey/active/", token, sid)
        assert resp.status_code == 200
        data = resp.json()
        results = data if isinstance(data, list) else data.get("results", [])
        assert len(results) >= 1

    def test_journey_history(self, seed_data, api):
        route_id = _create_route(api, seed_data, "History Route")
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Start and end a journey
        start_resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL", "route_id": route_id,
        }, token, sid)
        journey_id = start_resp.json()["id"]

        api.post("/api/transport/route-journey/end/", {
            "journey_id": journey_id,
        }, token, sid)

        resp = api.get(f"/api/transport/route-journey/history/?route_id={route_id}", token, sid)
        assert resp.status_code == 200


# ==========================================================================
# LOCATION UPDATE + GEOFENCE
# ==========================================================================

@pytest.mark.django_db
class TestLocationUpdate:

    def test_update_location(self, seed_data, api, api_client):
        route_id = _create_route(api, seed_data, "Loc Route")
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        _create_vehicle(api, seed_data, route_id, "LOC-BUS", 40, driver_user=driver_user.id)

        sid = seed_data["SID_A"]
        start_resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL",
            "latitude": 31.52, "longitude": 74.36,
        }, driver_token, sid)
        journey_id = start_resp.json()["id"]

        update_resp = api.post("/api/transport/route-journey/update/", {
            "journey_id": journey_id,
            "latitude": 31.525,
            "longitude": 74.362,
            "accuracy": 5.0,
            "speed": 25.0,
        }, driver_token, sid)
        assert update_resp.status_code == 200

        from transport.models import RouteLocationUpdate
        updates = RouteLocationUpdate.objects.filter(journey_id=journey_id)
        assert updates.count() == 1

    def test_geofence_check(self, seed_data, api):
        """Test that check_geofence detects a stop within 100m."""
        from transport.utils import check_geofence
        from transport.models import RouteJourney, TransportRoute

        route_id = _create_route(api, seed_data, "Geo Route")
        # Stop at exactly (31.525000, 74.360000)
        _create_stop(api, seed_data, route_id, "Geo Stop", 1, "31.525000", "74.360000")

        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        start_resp = api.post("/api/transport/route-journey/start/", {
            "journey_type": "TO_SCHOOL", "route_id": route_id,
        }, token, sid)
        journey_id = start_resp.json()["id"]

        journey = RouteJourney.objects.get(id=journey_id)
        # Simulate being very close to the stop (within 50m)
        check_geofence(journey, 31.52504, 74.36004)
        journey.refresh_from_db()
        # The stop should now be in notified_stops
        assert len(journey.notified_stops) > 0


# ==========================================================================
# MY VEHICLE ENDPOINT
# ==========================================================================

@pytest.mark.django_db
class TestMyVehicle:

    def test_driver_gets_assigned_vehicle(self, seed_data, api, api_client):
        route_id = _create_route(api, seed_data, "My Vehicle Route")
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        _create_vehicle(api, seed_data, route_id, "MY-BUS", 30, driver_user=driver_user.id)

        sid = seed_data["SID_A"]
        resp = api.get("/api/transport/vehicles/my/", driver_token, sid)
        assert resp.status_code == 200
        data = resp.json()
        assert f"{P}MY-BUS" in data["vehicle_number"]

    def test_no_vehicle_returns_404(self, seed_data, api, api_client):
        driver_user, driver_token = _create_driver_user(seed_data, api_client)
        sid = seed_data["SID_A"]
        resp = api.get("/api/transport/vehicles/my/", driver_token, sid)
        assert resp.status_code == 404


# ==========================================================================
# TRANSPORT TYPE FILTER
# ==========================================================================

@pytest.mark.django_db
class TestTransportTypeFilter:

    def test_filter_assignments_by_transport_type(self, seed_data, api):
        route_id = _create_route(api, seed_data, "Filter Route")
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        student = seed_data["students"][0]

        # Create assignment with PICKUP type
        api.post("/api/transport/assignments/", {
            "student": student.id,
            "route": route_id,
            "transport_type": "PICKUP",
        }, token, sid)

        # Filter by PICKUP
        resp = api.get("/api/transport/assignments/?transport_type=PICKUP", token, sid)
        assert resp.status_code == 200
        data = resp.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        for a in results:
            assert a["transport_type"] == "PICKUP"

        # Filter by DROP should not include our assignment
        resp2 = api.get("/api/transport/assignments/?transport_type=DROP", token, sid)
        data2 = resp2.json()
        results2 = data2.get("results", data2) if isinstance(data2, dict) else data2
        our = [a for a in results2 if a.get("route") == route_id]
        assert len(our) == 0
