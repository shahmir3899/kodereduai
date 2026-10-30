"""Driver boarding: a driver marks today's boarding for their own route only.

Uses the shared `seed_data` school; no per-test school creation.
"""
import pytest

from .models import TransportAssignment, TransportAttendance, TransportRoute, TransportStop
from .tests import transport  # noqa: F401  (fixture)

pytestmark = pytest.mark.django_db

BOARDING_URL = '/api/transport/driver/boarding/'


@pytest.fixture
def driver(api, seed_data, transport):  # noqa: F811
    """A DRIVER user who drives the first vehicle (on the shared T-Route)."""
    from users.models import User
    from schools.models import UserSchoolMembership
    from conftest import PASSWORD

    school = seed_data['school_a']
    user = User.objects.create_user(
        username='PYTEST_boarding_driver', email='pytest_boarding_driver@test.com', password=PASSWORD,
        role='DRIVER', school=school, organization=seed_data['org'],
    )
    UserSchoolMembership.objects.create(user=user, school=school, role='DRIVER', is_default=True)
    vehicle = transport['vehicles'][0]
    vehicle.driver_user = user
    vehicle.save()
    return {'user': user, 'token': api.login('PYTEST_boarding_driver'), 'sid': seed_data['SID_A']}


def _assign(seed_data, student, route, stop):
    return TransportAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        student=student, route=route, stop=stop,
    )


def _other_route(seed_data):
    route = TransportRoute.objects.create(
        school=seed_data['school_a'], name='Other-Route', start_location='C', end_location='D',
        estimated_duration_minutes=20,
    )
    stop = TransportStop.objects.create(route=route, name='O1', stop_order=1, pickup_time='07:00', drop_time='14:00')
    return route, stop


def test_driver_roster_is_only_their_own_route(api, seed_data, transport, driver):  # noqa: F811
    mine, theirs = seed_data['students'][0], seed_data['students'][1]
    _assign(seed_data, mine, transport['route'], transport['stops'][0])
    other, other_stop = _other_route(seed_data)
    _assign(seed_data, theirs, other, other_stop)

    body = api.get(BOARDING_URL, driver['token'], driver['sid']).json()
    assert body['route']['id'] == transport['route'].id
    assert [s['student_id'] for s in body['students']] == [mine.id]
    assert body['students'][0]['boarding_status'] is None
    assert body['students'][0]['stop_name'] == 'S1'


def test_driver_marks_and_remarks_today(api, seed_data, transport, driver):  # noqa: F811
    s = seed_data['students'][0]
    _assign(seed_data, s, transport['route'], transport['stops'][0])
    first = api.post(BOARDING_URL, {'records': [{'student_id': s.id, 'boarding_status': 'BOARDED'}]},
                     driver['token'], driver['sid']).json()
    assert (first['created'], first['updated'], first['errors']) == (1, 0, [])
    again = api.post(BOARDING_URL, {'records': [{'student_id': s.id, 'boarding_status': 'NOT_BOARDED'}]},
                     driver['token'], driver['sid']).json()
    assert (again['created'], again['updated']) == (0, 1)
    roster = api.get(BOARDING_URL, driver['token'], driver['sid']).json()
    assert roster['students'][0]['boarding_status'] == 'NOT_BOARDED'
    row = TransportAttendance.objects.get(student=s, route=transport['route'])
    assert row.recorded_by_id == driver['user'].id


def test_driver_cannot_mark_another_date(api, seed_data, transport, driver):  # noqa: F811
    s = seed_data['students'][0]
    _assign(seed_data, s, transport['route'], transport['stops'][0])
    resp = api.post(BOARDING_URL, {'date': '2020-01-01',
                                   'records': [{'student_id': s.id, 'boarding_status': 'BOARDED'}]},
                    driver['token'], driver['sid'])
    assert resp.status_code == 400
    assert not TransportAttendance.objects.exists()


def test_driver_cannot_mark_a_student_on_another_route(api, seed_data, transport, driver):  # noqa: F811
    mine, theirs = seed_data['students'][0], seed_data['students'][1]
    _assign(seed_data, mine, transport['route'], transport['stops'][0])
    other, other_stop = _other_route(seed_data)
    _assign(seed_data, theirs, other, other_stop)
    out = api.post(BOARDING_URL, {'records': [
        {'student_id': mine.id, 'boarding_status': 'BOARDED'},
        {'student_id': theirs.id, 'boarding_status': 'BOARDED'},
    ]}, driver['token'], driver['sid']).json()
    assert out['created'] == 1
    assert [e['student_id'] for e in out['errors']] == [theirs.id]
    assert not TransportAttendance.objects.filter(student=theirs).exists()


def test_route_comes_from_the_drivers_vehicle_not_the_request(api, seed_data, transport, driver):  # noqa: F811
    theirs = seed_data['students'][1]
    other, other_stop = _other_route(seed_data)
    _assign(seed_data, theirs, other, other_stop)
    api.post(BOARDING_URL, {'route_id': other.id, 'records': [{'student_id': theirs.id, 'boarding_status': 'BOARDED'}]},
             driver['token'], driver['sid'])
    assert not TransportAttendance.objects.filter(route=other).exists()


def test_bad_boarding_status_is_400(api, seed_data, transport, driver):  # noqa: F811
    s = seed_data['students'][0]
    _assign(seed_data, s, transport['route'], transport['stops'][0])
    resp = api.post(BOARDING_URL, {'records': [{'student_id': s.id, 'boarding_status': 'FLYING'}]},
                    driver['token'], driver['sid'])
    assert resp.status_code == 400


def test_only_drivers_use_the_driver_endpoint(api, seed_data, transport, driver):  # noqa: F811
    admin, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    assert api.get(BOARDING_URL, admin, sid).status_code == 403
    assert api.post(BOARDING_URL, {'records': []}, admin, sid).status_code == 403


def test_driver_without_a_vehicle_gets_a_clear_400(api, seed_data, transport, driver):  # noqa: F811
    transport['vehicles'][0].driver_user = None
    transport['vehicles'][0].save()
    resp = api.get(BOARDING_URL, driver['token'], driver['sid'])
    assert resp.status_code == 400
    assert 'vehicle' in resp.json()['error']


def test_driver_still_cannot_use_the_admin_attendance_endpoints(api, seed_data, transport, driver):  # noqa: F811
    s = seed_data['students'][0]
    _assign(seed_data, s, transport['route'], transport['stops'][0])
    body = {'route_id': transport['route'].id, 'date': '2026-03-02',
            'records': [{'student_id': s.id, 'boarding_status': 'BOARDED'}]}
    assert api.post('/api/transport/attendance/bulk_mark/', body, driver['token'], driver['sid']).status_code == 403
