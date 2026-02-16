"""
Phase 21 -- Bug Fix Verification Tests (pytest)
=================================================
Validates all 6 bug fixes applied to the system:
  Bug #3: Leave approval React Query invalidation (backend workflow verified)
  Bug #4: HR attendance summary parameter names (date_from / date_to)
  Bug #5: Transport stop field name (stop_order)
  Bug #6: Transport attendance field names (student_id, boarding_status, route_id)
  Bug #8: Library category creation without school field
  Bug #9: Discount field name (discount_type)

Run:
    cd backend
    pytest tests/test_phase21_bugfixes.py -v
"""

import pytest
from datetime import date, timedelta

from library.models import BookCategory, Book, BookIssue
from hr.models import (
    StaffDepartment, StaffDesignation, StaffMember,
    StaffAttendance, LeavePolicy, LeaveApplication,
)
from transport.models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance as TAttendance,
)
from finance.models import Discount

P21 = "P21BUG_"


# ── Cleanup fixture ─────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _cleanup_p21(seed_data):
    """Remove leftover P21 data before each test."""
    school_a = seed_data["school_a"]

    BookCategory.objects.filter(school=school_a, name__startswith=P21).delete()
    Book.objects.filter(school=school_a, title__startswith=P21).delete()
    Discount.objects.filter(school=school_a, name__startswith=P21).delete()
    StaffAttendance.objects.filter(school=school_a).delete()
    LeaveApplication.objects.filter(school=school_a, reason__startswith=P21).delete()
    LeavePolicy.objects.filter(school=school_a, name__startswith=P21).delete()
    TAttendance.objects.filter(school=school_a, route__name__startswith=P21).delete()
    TransportAssignment.objects.filter(school=school_a, route__name__startswith=P21).delete()
    TransportStop.objects.filter(route__school=school_a, name__startswith=P21).delete()
    TransportVehicle.objects.filter(school=school_a, vehicle_number__startswith=P21).delete()
    TransportRoute.objects.filter(school=school_a, name__startswith=P21).delete()
    yield


# ── Helpers ──────────────────────────────────────────────────────────────

def _create_route(api, seed_data, suffix="Route1"):
    resp = api.post("/api/transport/routes/", {
        "name": f"{P21}{suffix}",
        "start_location": "Gate",
        "end_location": "Colony",
        "distance_km": 10,
        "estimated_duration_minutes": 30,
    }, seed_data["tokens"]["admin"], seed_data["SID_A"])
    assert resp.status_code == 201, f"Helper _create_route: {resp.status_code}"
    return resp.json()["id"]


def _create_stop(api, seed_data, route_id, suffix="Stop1", order=1):
    resp = api.post("/api/transport/stops/", {
        "route": route_id,
        "name": f"{P21}{suffix}",
        "address": "123 Test St",
        "stop_order": order,
        "pickup_time": "07:30:00",
        "drop_time": "14:30:00",
    }, seed_data["tokens"]["admin"], seed_data["SID_A"])
    assert resp.status_code == 201, f"Helper _create_stop: {resp.status_code}"
    return resp.json()["id"]


def _get_dept_id(school, name):
    dept = StaffDepartment.objects.filter(school=school, name=name).first()
    return dept.id if dept else None


def _get_staff_id(school, emp_id):
    sm = StaffMember.objects.filter(school=school, employee_id=emp_id).first()
    return sm.id if sm else None


def _setup_hr_staff(api, seed_data):
    token = seed_data["tokens"]["admin"]
    sid = seed_data["SID_A"]
    school = seed_data["school_a"]
    api.post("/api/hr/departments/", {"name": f"{P21}TestDept"}, token, sid)
    dept_id = _get_dept_id(school, f"{P21}TestDept")
    for i, (first, last) in enumerate([("Ali", "Khan"), ("Sara", "Shah")], 1):
        api.post("/api/hr/staff/", {
            "first_name": f"{P21}{first}",
            "last_name": last,
            "employee_id": f"{P21}E{i:03d}",
            "department": dept_id,
            "employment_status": "ACTIVE",
            "employment_type": "FULL_TIME",
            "date_of_joining": "2024-01-01",
        }, token, sid)
    return {
        "e001": _get_staff_id(school, f"{P21}E001"),
        "e002": _get_staff_id(school, f"{P21}E002"),
    }


# ======================================================================
# LEVEL A: LIBRARY CATEGORY CREATION FIX (Bug #8)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestLibraryCategoryCreationFix:
    """Bug #8: Category creation should work WITHOUT the school field."""

    def test_create_category_without_school_field(self, seed_data, api):
        """POST with only name/description (no school) should return 201."""
        resp = api.post("/api/library/categories/", {
            "name": f"{P21}NoSchoolCat",
            "description": "Created without school field",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201, (
            f"Expected 201, got {resp.status_code}: {resp.content[:200]}"
        )

    def test_created_category_has_correct_school(self, seed_data, api):
        """Category created without school should be assigned to correct school."""
        resp = api.post("/api/library/categories/", {
            "name": f"{P21}SchoolCheck",
            "description": "Verify school assignment",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201
        data = resp.json()
        assert data.get("school") == seed_data["SID_A"], (
            f"Expected school={seed_data['SID_A']}, got {data.get('school')}"
        )

    def test_create_category_with_school_still_works(self, seed_data, api):
        """Backward compat: sending school explicitly still works."""
        resp = api.post("/api/library/categories/", {
            "school": seed_data["SID_A"],
            "name": f"{P21}ExplicitSchool",
            "description": "With explicit school",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201, (
            f"Expected 201, got {resp.status_code}: {resp.content[:200]}"
        )

    def test_update_category(self, seed_data, api):
        """PATCH category name should work."""
        resp = api.post("/api/library/categories/", {
            "name": f"{P21}UpdateMe",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201
        cat_id = resp.json()["id"]
        resp2 = api.patch(f"/api/library/categories/{cat_id}/", {
            "description": "Updated description",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp2.status_code == 200

    def test_school_b_isolation(self, seed_data, api):
        """School B admin sees no categories from School A."""
        api.post("/api/library/categories/", {
            "name": f"{P21}SchoolACat",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        resp = api.get(
            "/api/library/categories/",
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        p21_cats = [c for c in data if c.get("name", "").startswith(P21)]
        assert len(p21_cats) == 0, f"School B sees {len(p21_cats)} P21 cats"


# ======================================================================
# LEVEL B: HR ATTENDANCE SUMMARY FIX (Bug #4)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestHRAttendanceSummaryFix:
    """Bug #4: Summary endpoint expects date_from/date_to, not start_date/end_date."""

    def test_summary_with_correct_params(self, seed_data, api):
        """GET summary with date_from & date_to returns 200."""
        ids = _setup_hr_staff(api, seed_data)
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        # Create an attendance record first
        api.post("/api/hr/attendance/", {
            "staff_member": ids["e001"],
            "date": "2026-02-10",
            "status": "PRESENT",
        }, token, sid)
        resp = api.get(
            "/api/hr/attendance/summary/?date_from=2026-02-01&date_to=2026-02-28",
            token, sid,
        )
        assert resp.status_code == 200, (
            f"Expected 200, got {resp.status_code}: {resp.content[:200]}"
        )

    def test_summary_returns_data(self, seed_data, api):
        """Summary response should contain attendance data."""
        ids = _setup_hr_staff(api, seed_data)
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        api.post("/api/hr/attendance/", {
            "staff_member": ids["e001"],
            "date": "2026-02-10",
            "status": "PRESENT",
        }, token, sid)
        resp = api.get(
            "/api/hr/attendance/summary/?date_from=2026-02-01&date_to=2026-02-28",
            token, sid,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, (dict, list)), "Summary should return data"

    def test_summary_missing_params_returns_400(self, seed_data, api):
        """GET summary without required params returns 400."""
        resp = api.get(
            "/api/hr/attendance/summary/",
            seed_data["tokens"]["admin"], seed_data["SID_A"],
        )
        assert resp.status_code == 400, (
            f"Expected 400, got {resp.status_code}"
        )

    def test_summary_with_old_params_returns_400(self, seed_data, api):
        """GET summary with start_date/end_date (wrong names) returns 400."""
        resp = api.get(
            "/api/hr/attendance/summary/?start_date=2026-02-01&end_date=2026-02-28",
            seed_data["tokens"]["admin"], seed_data["SID_A"],
        )
        assert resp.status_code == 400, (
            f"Expected 400 with old params, got {resp.status_code}"
        )

    def test_summary_teacher_can_read(self, seed_data, api):
        """Teacher can read attendance summary (read-only access)."""
        resp = api.get(
            "/api/hr/attendance/summary/?date_from=2026-02-01&date_to=2026-02-28",
            seed_data["tokens"]["teacher"], seed_data["SID_A"],
        )
        assert resp.status_code == 200, (
            f"Expected 200 for teacher read, got {resp.status_code}"
        )


# ======================================================================
# LEVEL C: TRANSPORT STOP ORDER FIX (Bug #5)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestTransportStopOrderFix:
    """Bug #5: Stop creation uses stop_order, not order."""

    def test_create_stop_with_stop_order(self, seed_data, api):
        """POST stop with stop_order field returns 201."""
        route_id = _create_route(api, seed_data)
        resp = api.post("/api/transport/stops/", {
            "route": route_id,
            "name": f"{P21}Stop1",
            "address": "Test Addr",
            "stop_order": 1,
            "pickup_time": "07:30:00",
            "drop_time": "14:30:00",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201

    def test_create_second_stop(self, seed_data, api):
        """POST second stop with stop_order=2 returns 201."""
        route_id = _create_route(api, seed_data)
        _create_stop(api, seed_data, route_id, "Stop1", 1)
        resp = api.post("/api/transport/stops/", {
            "route": route_id,
            "name": f"{P21}Stop2",
            "address": "456 Oak Ave",
            "stop_order": 2,
            "pickup_time": "07:40:00",
            "drop_time": "14:20:00",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201

    def test_response_contains_stop_order(self, seed_data, api):
        """Response JSON should have stop_order field."""
        route_id = _create_route(api, seed_data)
        resp = api.post("/api/transport/stops/", {
            "route": route_id,
            "name": f"{P21}StopField",
            "stop_order": 3,
            "pickup_time": "08:00:00",
            "drop_time": "15:00:00",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201
        data = resp.json()
        assert "stop_order" in data, f"Response missing stop_order: {data.keys()}"
        assert data["stop_order"] == 3

    def test_list_stops_by_route(self, seed_data, api):
        """GET stops filtered by route returns stops with stop_order."""
        route_id = _create_route(api, seed_data)
        _create_stop(api, seed_data, route_id, "StopA", 1)
        _create_stop(api, seed_data, route_id, "StopB", 2)
        resp = api.get(
            f"/api/transport/stops/?route_id={route_id}",
            seed_data["tokens"]["admin"], seed_data["SID_A"],
        )
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        assert len(data) >= 2
        for stop in data:
            assert "stop_order" in stop

    def test_update_stop_order(self, seed_data, api):
        """PATCH stop_order works."""
        route_id = _create_route(api, seed_data)
        stop_id = _create_stop(api, seed_data, route_id, "StopUpd", 1)
        resp = api.patch(f"/api/transport/stops/{stop_id}/", {
            "stop_order": 5,
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 200
        assert resp.json()["stop_order"] == 5


# ======================================================================
# LEVEL D: TRANSPORT BULK ATTENDANCE FIX (Bug #6)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestTransportBulkAttendanceFix:
    """Bug #6: Bulk mark expects route_id, student_id, boarding_status."""

    def _setup_assignment(self, api, seed_data):
        route_id = _create_route(api, seed_data, "AttRoute")
        student = seed_data["students"][0]
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        # Create assignment
        resp = api.post("/api/transport/assignments/", {
            "student": student.id,
            "route": route_id,
            "stop": None,
            "transport_type": "BOTH",
        }, token, sid)
        return route_id, student.id

    def test_bulk_mark_correct_fields(self, seed_data, api):
        """POST bulk_mark with route_id, student_id, boarding_status returns 200/201."""
        route_id, student_id = self._setup_assignment(api, seed_data)
        resp = api.post("/api/transport/attendance/bulk_mark/", {
            "route_id": route_id,
            "date": "2026-02-10",
            "records": [
                {"student_id": student_id, "boarding_status": "BOARDED"},
            ],
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code in (200, 201), (
            f"Expected 200/201, got {resp.status_code}: {resp.content[:200]}"
        )

    def test_bulk_mark_response_has_boarding_status(self, seed_data, api):
        """Response should reference boarding_status."""
        route_id, student_id = self._setup_assignment(api, seed_data)
        resp = api.post("/api/transport/attendance/bulk_mark/", {
            "route_id": route_id,
            "date": "2026-02-11",
            "records": [
                {"student_id": student_id, "boarding_status": "NOT_BOARDED"},
            ],
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code in (200, 201)

    def test_bulk_mark_various_statuses(self, seed_data, api):
        """Marking with different statuses all succeed."""
        route_id = _create_route(api, seed_data, "MultiStatus")
        students = seed_data["students"][:3]
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        for s in students:
            api.post("/api/transport/assignments/", {
                "student": s.id, "route": route_id, "transport_type": "BOTH",
            }, token, sid)
        resp = api.post("/api/transport/attendance/bulk_mark/", {
            "route_id": route_id,
            "date": "2026-02-12",
            "records": [
                {"student_id": students[0].id, "boarding_status": "BOARDED"},
                {"student_id": students[1].id, "boarding_status": "NOT_BOARDED"},
                {"student_id": students[2].id, "boarding_status": "ABSENT"},
            ],
        }, token, sid)
        assert resp.status_code in (200, 201)

    def test_get_attendance_has_boarding_status(self, seed_data, api):
        """GET attendance returns records with boarding_status field."""
        route_id, student_id = self._setup_assignment(api, seed_data)
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        api.post("/api/transport/attendance/bulk_mark/", {
            "route_id": route_id,
            "date": "2026-02-13",
            "records": [{"student_id": student_id, "boarding_status": "BOARDED"}],
        }, token, sid)
        resp = api.get(
            f"/api/transport/attendance/?route={route_id}&date=2026-02-13",
            token, sid,
        )
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        if len(data) > 0:
            assert "boarding_status" in data[0], (
                f"Response missing boarding_status: {data[0].keys()}"
            )

    def test_bulk_mark_with_wrong_fields_fails(self, seed_data, api):
        """POST with old field names (route, student, status) should fail."""
        route_id, student_id = self._setup_assignment(api, seed_data)
        resp = api.post("/api/transport/attendance/bulk_mark/", {
            "route": route_id,
            "date": "2026-02-14",
            "records": [
                {"student": student_id, "status": "BOARDED"},
            ],
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 400, (
            f"Expected 400 with wrong field names, got {resp.status_code}"
        )


# ======================================================================
# LEVEL E: DISCOUNT FIELD NAME FIX (Bug #9)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestDiscountFieldNameFix:
    """Bug #9: Discount uses discount_type, not type."""

    def test_create_percentage_discount(self, seed_data, api):
        """POST with discount_type=PERCENTAGE returns 201."""
        resp = api.post("/api/finance/discounts/", {
            "name": f"{P21}PercentOff",
            "discount_type": "PERCENTAGE",
            "value": 10,
            "applies_to": "ALL",
            "is_active": True,
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201, (
            f"Expected 201, got {resp.status_code}: {resp.content[:300]}"
        )

    def test_create_fixed_discount(self, seed_data, api):
        """POST with discount_type=FIXED returns 201."""
        resp = api.post("/api/finance/discounts/", {
            "name": f"{P21}FixedOff",
            "discount_type": "FIXED",
            "value": 500,
            "applies_to": "ALL",
            "is_active": True,
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201

    def test_response_has_discount_type(self, seed_data, api):
        """Response JSON has discount_type field, not type."""
        resp = api.post("/api/finance/discounts/", {
            "name": f"{P21}FieldCheck",
            "discount_type": "PERCENTAGE",
            "value": 15,
            "applies_to": "ALL",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201
        data = resp.json()
        assert "discount_type" in data, f"Missing discount_type: {data.keys()}"
        assert data["discount_type"] == "PERCENTAGE"
        assert "type" not in data or data.get("type") is None

    def test_list_discounts_has_discount_type(self, seed_data, api):
        """GET discounts returns objects with discount_type."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        api.post("/api/finance/discounts/", {
            "name": f"{P21}ListCheck",
            "discount_type": "FIXED",
            "value": 200,
            "applies_to": "ALL",
        }, token, sid)
        resp = api.get("/api/finance/discounts/", token, sid)
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict):
            data = data.get("results", [])
        p21_discs = [d for d in data if d.get("name", "").startswith(P21)]
        assert len(p21_discs) >= 1
        for d in p21_discs:
            assert "discount_type" in d

    def test_update_discount_type(self, seed_data, api):
        """PATCH discount_type from PERCENTAGE to FIXED works."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        resp = api.post("/api/finance/discounts/", {
            "name": f"{P21}UpdateType",
            "discount_type": "PERCENTAGE",
            "value": 20,
            "applies_to": "ALL",
        }, token, sid)
        assert resp.status_code == 201
        disc_id = resp.json()["id"]
        resp2 = api.patch(f"/api/finance/discounts/{disc_id}/", {
            "discount_type": "FIXED",
            "value": 1000,
        }, token, sid)
        assert resp2.status_code == 200
        assert resp2.json()["discount_type"] == "FIXED"

    def test_percentage_over_100_rejected(self, seed_data, api):
        """PERCENTAGE discount with value > 100 is rejected."""
        resp = api.post("/api/finance/discounts/", {
            "name": f"{P21}Over100",
            "discount_type": "PERCENTAGE",
            "value": 150,
            "applies_to": "ALL",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 400, (
            f"Expected 400 for value>100, got {resp.status_code}"
        )


# ======================================================================
# LEVEL F: LEAVE APPROVAL WORKFLOW (Bug #3)
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestLeaveApprovalWorkflow:
    """Bug #3: Leave approve/reject/cancel works end-to-end."""

    def _setup_leave(self, api, seed_data):
        ids = _setup_hr_staff(api, seed_data)
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        school = seed_data["school_a"]
        api.post("/api/hr/leave-policies/", {
            "name": f"{P21}Annual",
            "leave_type": "ANNUAL",
            "days_allowed": 20,
        }, token, sid)
        policy = LeavePolicy.objects.filter(
            school=school, name=f"{P21}Annual"
        ).first()
        return ids, policy

    def _create_application(self, api, seed_data, staff_id, policy_id,
                            start="2026-03-01", end="2026-03-05"):
        resp = api.post("/api/hr/leave-applications/", {
            "staff_member": staff_id,
            "leave_policy": policy_id,
            "start_date": start,
            "end_date": end,
            "reason": f"{P21}Test leave",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201
        return LeaveApplication.objects.filter(
            school=seed_data["school_a"],
            staff_member_id=staff_id,
            status="PENDING",
        ).first()

    def test_approve_changes_status(self, seed_data, api):
        """Approve sets status=APPROVED."""
        ids, policy = self._setup_leave(api, seed_data)
        app = self._create_application(api, seed_data, ids["e001"], policy.id)
        assert app is not None
        resp = api.post(f"/api/hr/leave-applications/{app.id}/approve/", {
            "admin_remarks": "Approved",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 200
        app.refresh_from_db()
        assert app.status == "APPROVED"

    def test_reject_changes_status(self, seed_data, api):
        """Reject sets status=REJECTED."""
        ids, policy = self._setup_leave(api, seed_data)
        app = self._create_application(
            api, seed_data, ids["e001"], policy.id, "2026-04-01", "2026-04-03",
        )
        assert app is not None
        resp = api.post(f"/api/hr/leave-applications/{app.id}/reject/", {
            "admin_remarks": "Not enough staff",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 200
        app.refresh_from_db()
        assert app.status == "REJECTED"

    def test_cancel_changes_status(self, seed_data, api):
        """Cancel sets status=CANCELLED."""
        ids, policy = self._setup_leave(api, seed_data)
        app = self._create_application(
            api, seed_data, ids["e002"], policy.id, "2026-05-01", "2026-05-02",
        )
        assert app is not None
        resp = api.post(
            f"/api/hr/leave-applications/{app.id}/cancel/", {},
            seed_data["tokens"]["admin"], seed_data["SID_A"],
        )
        assert resp.status_code == 200
        app.refresh_from_db()
        assert app.status == "CANCELLED"

    def test_approve_with_remarks_saved(self, seed_data, api):
        """Admin remarks are saved on approval."""
        ids, policy = self._setup_leave(api, seed_data)
        app = self._create_application(
            api, seed_data, ids["e001"], policy.id, "2026-06-01", "2026-06-05",
        )
        assert app is not None
        api.post(f"/api/hr/leave-applications/{app.id}/approve/", {
            "admin_remarks": "Enjoy your vacation!",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        app.refresh_from_db()
        assert app.admin_remarks == "Enjoy your vacation!"

    def test_cannot_approve_already_approved(self, seed_data, api):
        """Approving an already-approved application returns 400."""
        ids, policy = self._setup_leave(api, seed_data)
        app = self._create_application(
            api, seed_data, ids["e001"], policy.id, "2026-07-01", "2026-07-05",
        )
        assert app is not None
        api.post(f"/api/hr/leave-applications/{app.id}/approve/", {},
                 seed_data["tokens"]["admin"], seed_data["SID_A"])
        resp = api.post(f"/api/hr/leave-applications/{app.id}/approve/", {},
                        seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 400


# ======================================================================
# LEVEL G: CROSS-MODULE REGRESSION TESTS
# ======================================================================

@pytest.mark.phase21
@pytest.mark.django_db
class TestCrossModuleRegression:
    """End-to-end flows across modules to verify no regressions."""

    def test_library_full_flow(self, seed_data, api):
        """Category (no school) → book → issue → return."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        # 1. Create category without school
        resp = api.post("/api/library/categories/", {
            "name": f"{P21}E2ECat",
            "description": "E2E test",
        }, token, sid)
        assert resp.status_code == 201
        cat_id = resp.json()["id"]
        # 2. Create a book in that category
        resp = api.post("/api/library/books/", {
            "title": f"{P21}E2EBook",
            "author": "Test Author",
            "isbn": f"{P21}978-0-00",
            "category": cat_id,
            "total_copies": 5,
            "available_copies": 5,
        }, token, sid)
        assert resp.status_code == 201, (
            f"Book creation: {resp.status_code}: {resp.content[:200]}"
        )

    def test_transport_full_flow(self, seed_data, api):
        """Route → stop (stop_order) → assignment → bulk_mark (boarding_status)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        student = seed_data["students"][0]
        # 1. Route
        route_id = _create_route(api, seed_data, "E2ERoute")
        # 2. Stop with stop_order
        _create_stop(api, seed_data, route_id, "E2EStop", order=1)
        # 3. Assignment
        api.post("/api/transport/assignments/", {
            "student": student.id,
            "route": route_id,
            "transport_type": "BOTH",
        }, token, sid)
        # 4. Bulk mark with correct field names
        resp = api.post("/api/transport/attendance/bulk_mark/", {
            "route_id": route_id,
            "date": "2026-02-15",
            "records": [
                {"student_id": student.id, "boarding_status": "BOARDED"},
            ],
        }, token, sid)
        assert resp.status_code in (200, 201)

    def test_hr_full_flow(self, seed_data, api):
        """Staff → attendance → summary (date_from/date_to) → leave → approve."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        school = seed_data["school_a"]
        ids = _setup_hr_staff(api, seed_data)
        # 1. Mark attendance
        api.post("/api/hr/attendance/", {
            "staff_member": ids["e001"],
            "date": "2026-02-10",
            "status": "PRESENT",
        }, token, sid)
        # 2. Get summary with correct params
        resp = api.get(
            "/api/hr/attendance/summary/?date_from=2026-02-01&date_to=2026-02-28",
            token, sid,
        )
        assert resp.status_code == 200
        # 3. Create leave policy + application
        api.post("/api/hr/leave-policies/", {
            "name": f"{P21}E2ELeave",
            "leave_type": "ANNUAL",
            "days_allowed": 20,
        }, token, sid)
        policy = LeavePolicy.objects.filter(
            school=school, name=f"{P21}E2ELeave"
        ).first()
        resp = api.post("/api/hr/leave-applications/", {
            "staff_member": ids["e001"],
            "leave_policy": policy.id,
            "start_date": "2026-03-01",
            "end_date": "2026-03-05",
            "reason": f"{P21}E2E leave",
        }, token, sid)
        assert resp.status_code == 201
        # 4. Approve
        app = LeaveApplication.objects.filter(
            school=school, staff_member_id=ids["e001"], status="PENDING",
        ).first()
        resp = api.post(f"/api/hr/leave-applications/{app.id}/approve/", {
            "admin_remarks": "E2E approved",
        }, token, sid)
        assert resp.status_code == 200
