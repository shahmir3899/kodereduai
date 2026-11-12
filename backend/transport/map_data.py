"""Coordinates for the route map shown to a student or parent (read only).

Only places are sent: the route's start and end, and the stops in order with the person's own stop
marked. No other student's name or position is included.
"""


def _num(value):
    return float(value) if value is not None else None


def route_map(route, own_stop=None):
    stops = []
    for s in route.stops.all().order_by('stop_order', 'id'):
        stops.append({
            'id': s.id,
            'name': s.name,
            'stop_order': s.stop_order,
            'latitude': _num(s.latitude),
            'longitude': _num(s.longitude),
            'pickup_time': str(s.pickup_time) if s.pickup_time else None,
            'drop_time': str(s.drop_time) if s.drop_time else None,
            'is_mine': own_stop is not None and s.id == own_stop.id,
        })
    return {
        'start': {'name': route.start_location, 'latitude': _num(route.start_latitude), 'longitude': _num(route.start_longitude)},
        'end': {'name': route.end_location, 'latitude': _num(route.end_latitude), 'longitude': _num(route.end_longitude)},
        'stops': stops,
    }
