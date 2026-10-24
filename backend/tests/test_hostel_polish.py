"""
Hostel polish pass: school-scoped ids, admin-only access, re-allocation after a
vacate, delete guards, list filters and dashboard maths.

Run:
    cd backend
    pytest tests/test_hostel_polish.py -v
"""

import pytest

from tests.test_phase11_hostel import (  # noqa: F401  (autouse cleanup fixture comes along)
    _cleanup_p11_data, _create_hostel, _create_room, _create_allocation, _create_gate_pass,
)


@pytest.fixture(autouse=True)
def _clear_api_cache():
    # The hostel dashboard is cached per user and school; the test database rolls back without
    # firing the signals that would invalidate it, so a stale entry would leak into other tests.
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


def _admin(seed_data):
    return seed_data["tokens"]["admin"], seed_data["SID_A"]


@pytest.mark.django_db
class TestHostelPolish:

    def test_allocation_rejects_other_schools_ids(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id)
        # School B's admin names school A's student, room and year.
        resp = api.post(
            "/api/hostel/allocations/",
            {"student": seed_data["students"][0].id, "room": room_id,
             "academic_year": seed_data["academic_year"].id},
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 400
        assert {"student", "room", "academic_year"} <= set(resp.json())

    def test_gate_pass_rejects_other_schools_ids(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id)
        student = seed_data["students"][0]
        alloc_id = _create_allocation(api, seed_data, student, room_id)
        resp = api.post(
            "/api/hostel/gate-passes/",
            {"student": student.id, "allocation": alloc_id,
             "pass_type": "DAY", "reason": "x", "going_to": "y",
             "departure_date": "2025-06-15T08:00:00Z",
             "expected_return": "2025-06-15T18:00:00Z"},
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 400

    def test_room_rejects_other_schools_hostel(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        resp = api.post(
            "/api/hostel/rooms/",
            {"hostel": hostel_id, "room_number": "Z-1", "floor": 1,
             "room_type": "DOUBLE", "capacity": 2},
            seed_data["tokens"]["admin_b"], seed_data["SID_B"],
        )
        assert resp.status_code == 400

    def test_re_allocating_a_vacated_student_reuses_the_row(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_a = _create_room(api, seed_data, hostel_id, "A-101")
        room_b = _create_room(api, seed_data, hostel_id, "A-102")
        student = seed_data["students"][0]
        alloc_id = _create_allocation(api, seed_data, student, room_a)
        token, sid = _admin(seed_data)
        assert api.patch(f"/api/hostel/allocations/{alloc_id}/vacate/", {}, token, sid).status_code == 200

        resp = api.post(
            "/api/hostel/allocations/",
            {"student": student.id, "room": room_b, "academic_year": seed_data["academic_year"].id},
            token, sid,
        )
        assert resp.status_code == 201, resp.content[:200]
        assert resp.json()["id"] == alloc_id
        detail = api.get(f"/api/hostel/allocations/{alloc_id}/", token, sid).json()
        assert detail["is_active"] is True
        assert detail["vacated_date"] is None
        assert detail["room"] == room_b

    def test_active_duplicate_is_still_a_clean_400(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=4)
        student = seed_data["students"][0]
        _create_allocation(api, seed_data, student, room_id)
        resp = api.post(
            "/api/hostel/allocations/",
            {"student": student.id, "room": room_id, "academic_year": seed_data["academic_year"].id},
            *_admin(seed_data),
        )
        assert resp.status_code == 400
        assert "already has an active" in str(resp.json())

    def test_hostel_with_allocations_cannot_be_deleted(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id)
        _create_allocation(api, seed_data, seed_data["students"][0], room_id)
        token, sid = _admin(seed_data)

        assert api.delete(f"/api/hostel/rooms/{room_id}/", token, sid).status_code == 400
        resp = api.delete(f"/api/hostel/hostels/{hostel_id}/", token, sid)
        assert resp.status_code == 400
        assert "Inactive" in str(resp.json())

    def test_empty_hostel_and_room_can_be_deleted(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id)
        token, sid = _admin(seed_data)
        assert api.delete(f"/api/hostel/rooms/{room_id}/", token, sid).status_code == 204
        assert api.delete(f"/api/hostel/hostels/{hostel_id}/", token, sid).status_code == 204

    def test_room_capacity_cannot_drop_below_occupancy(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=2)
        _create_allocation(api, seed_data, seed_data["students"][0], room_id)
        _create_allocation(api, seed_data, seed_data["students"][1], room_id)
        token, sid = _admin(seed_data)
        assert api.patch(f"/api/hostel/rooms/{room_id}/", {"capacity": 1}, token, sid).status_code == 400
        assert api.patch(f"/api/hostel/rooms/{room_id}/", {"capacity": 3}, token, sid).status_code == 200

    def test_list_counts_come_from_annotations(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=1)
        _create_allocation(api, seed_data, seed_data["students"][0], room_id)
        token, sid = _admin(seed_data)

        hostel = api.get("/api/hostel/hostels/", token, sid).json()["results"][0]
        assert hostel["current_occupancy"] == 1
        assert hostel["rooms_count"] == 1
        room = api.get(f"/api/hostel/rooms/?hostel_id={hostel_id}", token, sid).json()["results"][0]
        assert room["current_occupancy"] == 1
        assert room["is_full"] is True

    def test_allocation_filters_is_active_and_search(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=4)
        first, second = seed_data["students"][0], seed_data["students"][1]
        _create_allocation(api, seed_data, first, room_id)
        gone = _create_allocation(api, seed_data, second, room_id)
        token, sid = _admin(seed_data)
        api.patch(f"/api/hostel/allocations/{gone}/vacate/", {}, token, sid)

        active = api.get("/api/hostel/allocations/?is_active=true", token, sid).json()["results"]
        vacated = api.get("/api/hostel/allocations/?is_active=false", token, sid).json()["results"]
        assert [a["student"] for a in active] == [first.id]
        assert [a["student"] for a in vacated] == [second.id]
        found = api.get(f"/api/hostel/allocations/?search={first.name[:4]}", token, sid).json()["results"]
        assert first.id in [a["student"] for a in found]

    def test_gate_pass_search_by_student_name(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=4)
        student = seed_data["students"][0]
        alloc_id = _create_allocation(api, seed_data, student, room_id)
        _create_gate_pass(api, seed_data, student, alloc_id)
        token, sid = _admin(seed_data)
        hit = api.get(f"/api/hostel/gate-passes/?search={student.name[:4]}", token, sid).json()["results"]
        miss = api.get("/api/hostel/gate-passes/?search=zzzzqq", token, sid).json()["results"]
        assert len(hit) == 1 and miss == []

    def test_dashboard_available_beds_never_negative(self, seed_data, api):
        hostel_id = _create_hostel(api, seed_data)
        room_id = _create_room(api, seed_data, hostel_id, capacity=2)
        _create_allocation(api, seed_data, seed_data["students"][0], room_id)
        token, sid = _admin(seed_data)
        stats = api.get("/api/hostel/dashboard/", token, sid).json()
        assert stats["current_occupancy"] == 1
        assert stats["available_beds"] == 1
        # An unavailable room drops out of both capacity and occupancy.
        api.patch(f"/api/hostel/rooms/{room_id}/", {"is_available": False}, token, sid)
        stats = api.get("/api/hostel/dashboard/", token, sid).json()
        assert stats["available_beds"] == 0
        assert stats["current_occupancy"] == 0

    @pytest.mark.parametrize("role", ["teacher", "staff", "accountant"])
    def test_non_admin_roles_are_refused(self, seed_data, api, role):
        for path in ("hostels/", "rooms/", "allocations/", "gate-passes/", "dashboard/"):
            resp = api.get(f"/api/hostel/{path}", seed_data["tokens"][role], seed_data["SID_A"])
            assert resp.status_code == 403, f"{role} {path}: {resp.status_code}"
