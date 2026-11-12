"""The route map a student or parent sees: places only, in stop order, with the person's own stop marked.
Uses the shared seed school; the rows made here are rolled back with the test."""
import datetime
from decimal import Decimal

import pytest

from transport.map_data import route_map
from transport.models import TransportRoute, TransportStop


def _stop(route, name, order, lat, lng):
    return TransportStop.objects.create(
        route=route, name=name, stop_order=order, latitude=lat, longitude=lng,
        pickup_time=datetime.time(7, order), drop_time=datetime.time(14, order),
    )


@pytest.mark.django_db
def test_stops_come_in_order_with_coordinates_and_the_own_stop_marked(seed_data):
    route = TransportRoute.objects.create(
        school_id=seed_data['SID_A'], name='Map Route', start_location='Depot', end_location='School', distance_km=Decimal('5.0'), estimated_duration_minutes=20,
        start_latitude=Decimal('31.520000'), start_longitude=Decimal('74.350000'), end_latitude=None, end_longitude=None,
    )
    second = _stop(route, 'Second', 2, Decimal('31.530000'), Decimal('74.360000'))
    first = _stop(route, 'First', 1, Decimal('31.525000'), Decimal('74.355000'))
    no_pin = _stop(route, 'No pin', 3, None, None)

    data = route_map(route, second)

    assert [s['name'] for s in data['stops']] == ['First', 'Second', 'No pin']
    assert [s['is_mine'] for s in data['stops']] == [False, True, False]
    assert data['stops'][0]['latitude'] == 31.525 and data['stops'][0]['longitude'] == 74.355
    assert data['stops'][2]['latitude'] is None
    assert data['start'] == {'name': 'Depot', 'latitude': 31.52, 'longitude': 74.35}
    assert data['end'] == {'name': 'School', 'latitude': None, 'longitude': None}
    assert data['stops'][0]['pickup_time'] == '07:01:00'
    assert first.id == data['stops'][0]['id'] and no_pin.id == data['stops'][2]['id']


@pytest.mark.django_db
def test_without_an_own_stop_nothing_is_marked_and_no_student_data_is_present(seed_data):
    route = TransportRoute.objects.create(school_id=seed_data['SID_A'], name='Bare Route', start_location='A', end_location='B', distance_km=Decimal('1.0'), estimated_duration_minutes=5)
    _stop(route, 'Only', 1, Decimal('31.5'), Decimal('74.3'))
    data = route_map(route)
    assert [s['is_mine'] for s in data['stops']] == [False]
    assert set(data) == {'start', 'end', 'stops'}
    assert set(data['stops'][0]) == {'id', 'name', 'stop_order', 'latitude', 'longitude', 'pickup_time', 'drop_time', 'is_mine'}
