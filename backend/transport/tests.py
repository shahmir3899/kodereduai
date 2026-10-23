"""Transport API: counts, validation and bulk-endpoint checks.

Uses the shared `seed_data` school; no per-test school creation.
"""
import pytest

from .models import TransportAssignment, TransportRoute, TransportVehicle, TransportStop

pytestmark = pytest.mark.django_db


@pytest.fixture
def transport(seed_data):
    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'transport': True}
    school.save()
    route = TransportRoute.objects.create(
        school=school, name='T-Route', start_location='A', end_location='B',
        estimated_duration_minutes=30,
    )
    stops = [
        TransportStop.objects.create(route=route, name=f'S{i}', stop_order=i,
                                     pickup_time='07:00', drop_time='14:00')
        for i in (1, 2, 3)
    ]
    vehicles = [
        TransportVehicle.objects.create(
            school=school, vehicle_number=f'V-{i}', capacity=10, driver_name='D',
            driver_phone='1', assigned_route=route,
        )
        for i in (1, 2)
    ]
    return {'route': route, 'stops': stops, 'vehicles': vehicles}


def _ctx(seed_data):
    return seed_data['tokens']['admin'], seed_data['SID_A']


def test_route_counts_are_not_multiplied_by_joins(api, seed_data, transport):
    year = seed_data['academic_year']
    for student in seed_data['students'][:3]:
        TransportAssignment.objects.create(
            school=seed_data['school_a'], academic_year=year, student=student,
            route=transport['route'], stop=transport['stops'][0],
        )
    token, sid = _ctx(seed_data)
    data = api.get('/api/transport/routes/', token, sid).json()['results']
    row = next(r for r in data if r['id'] == transport['route'].id)
    assert (row['stops_count'], row['vehicles_count'], row['students_count']) == (3, 2, 3)
    assert row['total_capacity'] == 20


def test_duplicate_route_name_is_400(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    body = {'name': 'T-Route', 'start_location': 'A', 'end_location': 'B',
            'estimated_duration_minutes': 10}
    resp = api.post('/api/transport/routes/', body, token, sid)
    assert resp.status_code == 400
    assert 'name' in resp.json()


def test_duplicate_vehicle_number_is_400(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    body = {'vehicle_number': 'V-1', 'capacity': 5, 'driver_name': 'D', 'driver_phone': '1'}
    resp = api.post('/api/transport/vehicles/', body, token, sid)
    assert resp.status_code == 400
    assert 'vehicle_number' in resp.json()


def test_duplicate_assignment_is_400(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    body = {
        'academic_year': seed_data['academic_year'].id,
        'student': seed_data['students'][0].id,
        'route': transport['route'].id,
        'stop': transport['stops'][0].id,
    }
    assert api.post('/api/transport/assignments/', body, token, sid).status_code == 201
    resp = api.post('/api/transport/assignments/', body, token, sid)
    assert resp.status_code == 400
    assert 'student' in resp.json()


def test_stop_on_other_schools_route_is_rejected(api, seed_data, transport):
    other = TransportRoute.objects.create(
        school=seed_data['school_b'], name='Other', start_location='A', end_location='B',
        estimated_duration_minutes=5,
    )
    token, sid = _ctx(seed_data)
    body = {'route': other.id, 'name': 'X', 'stop_order': 1, 'pickup_time': '07:00', 'drop_time': '14:00'}
    assert api.post('/api/transport/stops/', body, token, sid).status_code == 400


def test_bulk_assign_creates_and_skips(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    ids = [s.id for s in seed_data['students'][:2]]
    body = {
        'academic_year_id': seed_data['academic_year'].id,
        'route_id': transport['route'].id,
        'stop_id': transport['stops'][0].id,
        'vehicle_id': transport['vehicles'][0].id,
        'transport_type': 'BOTH',
        'student_ids': ids,
    }
    first = api.post('/api/transport/assignments/bulk_assign/', body, token, sid)
    assert first.status_code == 201 and first.json()['created'] == 2
    again = api.post('/api/transport/assignments/bulk_assign/', body, token, sid)
    assert again.json()['skipped'] == 2


def test_bulk_assign_rejects_bad_transport_type(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    body = {
        'academic_year_id': seed_data['academic_year'].id,
        'route_id': transport['route'].id,
        'stop_id': transport['stops'][0].id,
        'transport_type': 'NOPE',
        'student_ids': [seed_data['students'][0].id],
    }
    assert api.post('/api/transport/assignments/bulk_assign/', body, token, sid).status_code == 400


def test_assignments_filter_by_route_id(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    TransportAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        student=seed_data['students'][0], route=transport['route'], stop=transport['stops'][0],
    )
    hit = api.get(f"/api/transport/assignments/?route_id={transport['route'].id}", token, sid).json()
    assert hit['count'] == 1
    miss = api.get('/api/transport/assignments/?route_id=999999', token, sid).json()
    assert miss['count'] == 0


def test_bulk_mark_skips_students_not_on_route(api, seed_data, transport):
    token, sid = _ctx(seed_data)
    on_route, off_route = seed_data['students'][0], seed_data['students'][1]
    TransportAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        student=on_route, route=transport['route'], stop=transport['stops'][0],
    )
    body = {
        'route_id': transport['route'].id, 'date': '2026-03-02',
        'records': [
            {'student_id': on_route.id, 'boarding_status': 'BOARDED'},
            {'student_id': off_route.id, 'boarding_status': 'BOARDED'},
        ],
    }
    out = api.post('/api/transport/attendance/bulk_mark/', body, token, sid).json()
    assert out['created'] == 1
    assert [e['student_id'] for e in out['errors']] == [off_route.id]
