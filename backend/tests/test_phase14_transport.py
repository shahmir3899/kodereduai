"""
Phase 14 -- Transport Module Tests (pytest format)
====================================================
Covers: Routes CRUD, Stops CRUD, Vehicles CRUD, Assignments + bulk_assign,
        Attendance + bulk_mark, permissions, school isolation.

Run:
    cd backend
    pytest tests/test_phase14_transport.py -v
"""

import pytest
from datetime import date, timedelta


# ---- Local prefix for transport test objects --------------------------------
P14 = "P14TRN_"


# ---- Cleanup fixture -------------------------------------------------------

@pytest.fixture(autouse=True)
def _cleanup_p14_data(seed_data):
    """Remove any leftover P14 data before each test class / function."""
    from transport.models import (
        TransportAttendance, TransportAssignment,
        TransportStop, TransportVehicle, TransportRoute,
    )
    school_a = seed_data["school_a"]
    TransportAttendance.objects.filter(
        school=school_a, route__name__startswith=P14
    ).delete()
    TransportAssignment.objects.filter(
        school=school_a, route__name__startswith=P14
    ).delete()
    TransportStop.objects.filter(
        route__school=school_a, name__startswith=P14
    ).delete()
    TransportVehicle.objects.filter(
        school=school_a, vehicle_number__startswith=P14
    ).delete()
    TransportRoute.objects.filter(
        school=school_a, name__startswith=P14
    ).delete()
    yield


# ---- Helper: create a route and return its id ------------------------------

def _create_route(api, seed_data, name_suffix="Route North", **overrides):
    payload = {
        "name": f"{P14}{name_suffix}",
        "start_location": "School Gate",
        "end_location": "North Colony",
        "distance_km": 12.5,
        "estimated_duration_minutes": 45,
    }
    payload.update(overrides)
    resp = api.post(
        "/api/transport/routes/",
        payload,
        seed_data["tokens"]["admin"],
        seed_data["SID_A"],
    )
    assert resp.status_code == 201, (
        f"Helper _create_route failed: status={resp.status_code} "
        f"body={resp.content[:200]}"
    )
    return resp.json()["id"]


def _create_stop(api, seed_data, route_id, name_suffix="Stop 1", order=1,
                 pickup="07:30:00", drop="14:30:00"):
    resp = api.post(
        "/api/transport/stops/",
        {
            "route": route_id,
            "name": f"{P14}{name_suffix}",
            "address": "123 Main St",
            "stop_order": order,
            "pickup_time": pickup,
            "drop_time": drop,
        },
        seed_data["tokens"]["admin"],
        seed_data["SID_A"],
    )
    assert resp.status_code == 201, (
        f"Helper _create_stop failed: status={resp.status_code} "
        f"body={resp.content[:200]}"
    )
    return resp.json()["id"]


def _create_vehicle(api, seed_data, route_id, number="BUS-001"):
    resp = api.post(
        "/api/transport/vehicles/",
        {
            "vehicle_number": f"{P14}{number}",
            "vehicle_type": "BUS",
            "capacity": 40,
            "make_model": "Hino AK",
            "driver_name": "Ahmad Driver",
            "driver_phone": "03001234567",
            "assigned_route": route_id,
        },
        seed_data["tokens"]["admin"],
        seed_data["SID_A"],
    )
    assert resp.status_code == 201, (
        f"Helper _create_vehicle failed: status={resp.status_code} "
        f"body={resp.content[:200]}"
    )
    return resp.json()["id"]


# ==========================================================================
#  LEVEL A: ROUTES CRUD
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestRoutes:
    """Routes CRUD operations and permission checks."""

    def test_admin_can_create_route(self, seed_data, api):
        """A1 -- Admin creates a route successfully."""
        resp = api.post(
            "/api/transport/routes/",
            {
                "name": f"{P14}Route North",
                "start_location": "School Gate",
                "end_location": "North Colony",
                "distance_km": 12.5,
                "estimated_duration_minutes": 45,
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"A1 Create route (Admin): status={resp.status_code} "
            f"body={resp.content[:200]}"
        )
        assert resp.json().get("id") is not None

    def test_admin_can_create_second_route(self, seed_data, api):
        """A2 -- Admin creates a second route."""
        resp = api.post(
            "/api/transport/routes/",
            {
                "name": f"{P14}Route South",
                "start_location": "School Gate",
                "end_location": "South Town",
                "distance_km": 8.0,
                "estimated_duration_minutes": 30,
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"A2 Create second route: status={resp.status_code}"
        )

    def test_teacher_cannot_create_route(self, seed_data, api):
        """A3 -- Teacher gets 403 when creating a route."""
        resp = api.post(
            "/api/transport/routes/",
            {
                "name": f"{P14}Teacher Route",
                "start_location": "A",
                "end_location": "B",
                "estimated_duration_minutes": 10,
            },
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 403, (
            f"A3 Teacher can't create route -> 403: status={resp.status_code}"
        )

    def test_list_routes(self, seed_data, api):
        """A4 -- Admin can list routes (at least 2 after creating two)."""
        # Create two routes first
        _create_route(api, seed_data, "Route North")
        _create_route(api, seed_data, "Route South",
                      end_location="South Town", distance_km=8.0,
                      estimated_duration_minutes=30)

        resp = api.get(
            "/api/transport/routes/",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"A4 List routes: status={resp.status_code}"
        )
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 2, (
            f"A4 List routes: expected >= 2, got {len(data)}"
        )

    def test_teacher_can_read_routes(self, seed_data, api):
        """A5 -- Teacher CAN read routes."""
        resp = api.get(
            "/api/transport/routes/",
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"A5 Teacher can read routes: status={resp.status_code}"
        )

    def test_update_route(self, seed_data, api):
        """A6 -- Admin updates a route."""
        route_id = _create_route(api, seed_data)
        resp = api.patch(
            f"/api/transport/routes/{route_id}/",
            {"distance_km": 13.0},
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"A6 Update route: status={resp.status_code}"
        )

    def test_school_b_isolation_routes(self, seed_data, api):
        """A7 -- School B admin sees zero School-A routes."""
        # Create a route in school A
        _create_route(api, seed_data)

        resp = api.get(
            "/api/transport/routes/",
            seed_data["tokens"]["admin_b"],
            seed_data["SID_B"],
        )
        assert resp.status_code == 200, (
            f"A7 School B isolation (routes): status={resp.status_code}"
        )
        data_b = resp.json()
        if isinstance(data_b, dict):
            data_b = data_b.get("results", [])
        assert len(data_b) == 0, (
            f"A7 School B isolation (routes): expected 0, got {len(data_b)}"
        )


# ==========================================================================
#  LEVEL B: STOPS CRUD
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestStops:
    """Stops CRUD operations and permission checks."""

    def test_create_stop(self, seed_data, api):
        """B1 -- Admin creates a stop on a route."""
        route_id = _create_route(api, seed_data)
        resp = api.post(
            "/api/transport/stops/",
            {
                "route": route_id,
                "name": f"{P14}Stop 1",
                "address": "123 Main St",
                "stop_order": 1,
                "pickup_time": "07:30:00",
                "drop_time": "14:30:00",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"B1 Create stop: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )
        assert resp.json().get("id") is not None

    def test_create_second_stop(self, seed_data, api):
        """B2 -- Admin creates a second stop on the same route."""
        route_id = _create_route(api, seed_data)
        _create_stop(api, seed_data, route_id, "Stop 1", order=1)

        resp = api.post(
            "/api/transport/stops/",
            {
                "route": route_id,
                "name": f"{P14}Stop 2",
                "address": "456 Oak Ave",
                "stop_order": 2,
                "pickup_time": "07:40:00",
                "drop_time": "14:20:00",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"B2 Create second stop: status={resp.status_code}"
        )

    def test_list_stops_filtered_by_route(self, seed_data, api):
        """B3 -- List stops filtered by route returns >= 2."""
        route_id = _create_route(api, seed_data)
        _create_stop(api, seed_data, route_id, "Stop 1", order=1)
        _create_stop(api, seed_data, route_id, "Stop 2", order=2,
                     pickup="07:40:00", drop="14:20:00")

        resp = api.get(
            f"/api/transport/stops/?route_id={route_id}",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"B3 List stops (filter by route): status={resp.status_code}"
        )
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 2, (
            f"B3 List stops (filter by route): expected >= 2, got {len(data)}"
        )

    def test_teacher_cannot_create_stop(self, seed_data, api):
        """B4 -- Teacher gets 403 when creating a stop."""
        route_id = _create_route(api, seed_data)
        resp = api.post(
            "/api/transport/stops/",
            {
                "route": route_id,
                "name": f"{P14}Teacher Stop",
                "stop_order": 99,
                "pickup_time": "08:00:00",
                "drop_time": "15:00:00",
            },
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 403, (
            f"B4 Teacher can't create stop -> 403: status={resp.status_code}"
        )


# ==========================================================================
#  LEVEL C: VEHICLES CRUD
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestVehicles:
    """Vehicles CRUD operations and permission checks."""

    def test_create_vehicle(self, seed_data, api):
        """C1 -- Admin creates a vehicle."""
        route_id = _create_route(api, seed_data)
        resp = api.post(
            "/api/transport/vehicles/",
            {
                "vehicle_number": f"{P14}BUS-001",
                "vehicle_type": "BUS",
                "capacity": 40,
                "make_model": "Hino AK",
                "driver_name": "Ahmad Driver",
                "driver_phone": "03001234567",
                "assigned_route": route_id,
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"C1 Create vehicle: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )
        assert resp.json().get("id") is not None

    def test_list_vehicles(self, seed_data, api):
        """C2 -- Admin lists vehicles (>= 1)."""
        route_id = _create_route(api, seed_data)
        _create_vehicle(api, seed_data, route_id)

        resp = api.get(
            "/api/transport/vehicles/",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"C2 List vehicles: status={resp.status_code}"
        )
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 1, (
            f"C2 List vehicles: expected >= 1, got {len(data)}"
        )

    def test_teacher_cannot_create_vehicle(self, seed_data, api):
        """C3 -- Teacher gets 403 when creating a vehicle."""
        resp = api.post(
            "/api/transport/vehicles/",
            {
                "vehicle_number": f"{P14}VAN-T",
                "vehicle_type": "VAN",
                "capacity": 15,
                "driver_name": "Test Driver",
                "driver_phone": "00000000000",
            },
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 403, (
            f"C3 Teacher can't create vehicle -> 403: status={resp.status_code}"
        )

    def test_school_b_isolation_vehicles(self, seed_data, api):
        """C4 -- School B admin sees zero School-A vehicles."""
        route_id = _create_route(api, seed_data)
        _create_vehicle(api, seed_data, route_id)

        resp = api.get(
            "/api/transport/vehicles/",
            seed_data["tokens"]["admin_b"],
            seed_data["SID_B"],
        )
        assert resp.status_code == 200, (
            f"C4 School B isolation (vehicles): status={resp.status_code}"
        )
        data_b = resp.json()
        if isinstance(data_b, dict):
            data_b = data_b.get("results", [])
        assert len(data_b) == 0, (
            f"C4 School B isolation (vehicles): expected 0, got {len(data_b)}"
        )


# ==========================================================================
#  LEVEL D: ASSIGNMENTS + BULK ASSIGN
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestAssignments:
    """Transport assignment CRUD, bulk assign, and permission checks."""

    def test_create_assignment(self, seed_data, api):
        """D1 -- Admin creates a transport assignment."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        student_1 = seed_data["students"][0]
        ay = seed_data["academic_year"]

        resp = api.post(
            "/api/transport/assignments/",
            {
                "academic_year": ay.id,
                "student": student_1.id,
                "route": route_id,
                "stop": stop_id,
                "transport_type": "BOTH",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"D1 Create transport assignment: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )
        assert resp.json().get("id") is not None

    def test_list_assignments(self, seed_data, api):
        """D2 -- Admin lists assignments (>= 1)."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        student_1 = seed_data["students"][0]
        ay = seed_data["academic_year"]

        # Create one assignment first
        api.post(
            "/api/transport/assignments/",
            {
                "academic_year": ay.id,
                "student": student_1.id,
                "route": route_id,
                "stop": stop_id,
                "transport_type": "BOTH",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )

        resp = api.get(
            "/api/transport/assignments/",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"D2 List assignments: status={resp.status_code}"
        )
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 1, (
            f"D2 List assignments: expected >= 1, got {len(data)}"
        )

    def test_bulk_assign_students(self, seed_data, api):
        """D3 -- Admin bulk-assigns students to a route/stop."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        student_2 = seed_data["students"][1]
        ay = seed_data["academic_year"]

        resp = api.post(
            "/api/transport/assignments/bulk_assign/",
            {
                "academic_year_id": ay.id,
                "route_id": route_id,
                "stop_id": stop_id,
                "student_ids": [student_2.id],
                "transport_type": "PICKUP",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code in (200, 201), (
            f"D3 Bulk assign students: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )
        r = resp.json()
        assert r.get("created", 0) >= 1, (
            f"D3b Bulk assign counts: created={r.get('created')} "
            f"skipped={r.get('skipped')}"
        )

    def test_teacher_cannot_create_assignment(self, seed_data, api):
        """D4 -- Teacher gets 403 when creating an assignment."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        ay = seed_data["academic_year"]

        resp = api.post(
            "/api/transport/assignments/",
            {
                "academic_year": ay.id,
                "student": seed_data["students"][3].id,
                "route": route_id,
                "stop": stop_id,
            },
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 403, (
            f"D4 Teacher can't create assignment -> 403: "
            f"status={resp.status_code}"
        )

    def test_route_students_list(self, seed_data, api):
        """D5 -- Admin retrieves the students list for a route."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        ay = seed_data["academic_year"]

        # Assign a student so the list is non-empty
        api.post(
            "/api/transport/assignments/",
            {
                "academic_year": ay.id,
                "student": seed_data["students"][0].id,
                "route": route_id,
                "stop": stop_id,
                "transport_type": "BOTH",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )

        resp = api.get(
            f"/api/transport/routes/{route_id}/students/",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"D5 Route students list: status={resp.status_code}"
        )


# ==========================================================================
#  LEVEL E: TRANSPORT ATTENDANCE + BULK MARK
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestAttendance:
    """Transport attendance create, list, and bulk-mark."""

    def test_create_attendance_record(self, seed_data, api):
        """E1 -- Admin creates an attendance record."""
        route_id = _create_route(api, seed_data)
        student_1 = seed_data["students"][0]

        resp = api.post(
            "/api/transport/attendance/",
            {
                "student": student_1.id,
                "route": route_id,
                "date": str(date.today()),
                "boarding_status": "BOARDED",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 201, (
            f"E1 Create attendance record: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )

    def test_list_attendance(self, seed_data, api):
        """E2 -- Admin lists attendance (>= 1)."""
        route_id = _create_route(api, seed_data)
        student_1 = seed_data["students"][0]

        # Create one record first
        api.post(
            "/api/transport/attendance/",
            {
                "student": student_1.id,
                "route": route_id,
                "date": str(date.today()),
                "boarding_status": "BOARDED",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )

        resp = api.get(
            "/api/transport/attendance/",
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"E2 List attendance: status={resp.status_code}"
        )
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 1, (
            f"E2 List attendance: expected >= 1, got {len(data)}"
        )

    def test_bulk_mark_attendance(self, seed_data, api):
        """E3 -- Admin bulk-marks attendance for multiple students."""
        route_id = _create_route(api, seed_data)
        student_1 = seed_data["students"][0]
        student_2 = seed_data["students"][1]

        resp = api.post(
            "/api/transport/attendance/bulk_mark/",
            {
                "route_id": route_id,
                "date": str(date.today() - timedelta(days=1)),
                "records": [
                    {"student_id": student_1.id, "boarding_status": "BOARDED"},
                    {"student_id": student_2.id, "boarding_status": "NOT_BOARDED"},
                ],
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"E3 Bulk mark attendance: status={resp.status_code} "
            f"body={resp.content[:200]}"
        )


# ==========================================================================
#  LEVEL F: PERMISSIONS & CROSS-CUTTING
# ==========================================================================

@pytest.mark.phase14
@pytest.mark.django_db
class TestPermissionsAndIsolation:
    """Authentication, authorization, and school-isolation checks."""

    def test_unauthenticated_returns_401(self, seed_data, api):
        """F1 -- Unauthenticated request -> 401."""
        resp = api.client.get("/api/transport/routes/")
        assert resp.status_code == 401, (
            f"F1 Unauthenticated -> 401: status={resp.status_code}"
        )

    def test_invalid_token_returns_401(self, seed_data, api):
        """F2 -- Invalid bearer token -> 401."""
        resp = api.client.get(
            "/api/transport/routes/",
            HTTP_AUTHORIZATION="Bearer garbage_token",
        )
        assert resp.status_code == 401, (
            f"F2 Invalid token -> 401: status={resp.status_code}"
        )

    def test_teacher_can_read_attendance(self, seed_data, api):
        """F3 -- Teacher CAN read transport attendance."""
        resp = api.get(
            "/api/transport/attendance/",
            seed_data["tokens"]["teacher"],
            seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"F3 Teacher can read attendance: status={resp.status_code}"
        )

    def test_school_b_isolation_assignments(self, seed_data, api):
        """F4 -- School B admin sees zero School-A assignments."""
        # Create a route + stop + assignment in school A
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id)
        ay = seed_data["academic_year"]
        api.post(
            "/api/transport/assignments/",
            {
                "academic_year": ay.id,
                "student": seed_data["students"][0].id,
                "route": route_id,
                "stop": stop_id,
                "transport_type": "BOTH",
            },
            seed_data["tokens"]["admin"],
            seed_data["SID_A"],
        )

        resp = api.get(
            "/api/transport/assignments/",
            seed_data["tokens"]["admin_b"],
            seed_data["SID_B"],
        )
        assert resp.status_code == 200, (
            f"F4 School B isolation (assignments): status={resp.status_code}"
        )
        data_b = resp.json()
        if isinstance(data_b, dict):
            data_b = data_b.get("results", [])
        assert len(data_b) == 0, (
            f"F4 School B isolation (assignments): expected 0, "
            f"got {len(data_b)}"
        )
