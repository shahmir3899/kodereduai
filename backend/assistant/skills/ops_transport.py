"""Transport through Aura (Operations agent): routes, who rides which route, whether a route is running now, vehicles; assign or remove a student.

Admins and principal only (owner decision 2026-11-08). Reads and writes go through TransportRouteViewSet / TransportAssignmentViewSet /
TransportVehicleViewSet and the route-journey view as the signed-in user, so the app's rules apply: stop must belong to the route, vehicle to
the route, one assignment per student per academic year. Removing = deactivating (history kept). Writes only PROPOSE.
Left out: creating routes / stops / vehicles, bulk assignment, starting or ending a journey.
"""
from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items, _year_id, resolve_student

LIST_LIMIT = 40
TYPES = {'PICKUP': 'Pickup only', 'DROP': 'Drop only', 'BOTH': 'Pickup and drop'}


def _route(ctx, name=None, route_id=None):
    from transport.models import TransportRoute

    qs = TransportRoute.objects.filter(school_id=ctx.school_id, is_active=True)
    if route_id:
        r = qs.filter(id=int(route_id)).first()
        if r is None:
            raise ProposalError(f'No route with id {route_id}.')
        return r
    if not name:
        raise ProposalError('Which route? Ask the user.')
    want = lc.tokens(name)
    pool = [r for r in qs if all(w in lc.tokens(r.name) for w in want)]
    exact = [r for r in qs if r.name.strip().lower() == name.strip().lower()]
    if len(exact) == 1:
        return exact[0]
    if not pool:
        raise ProposalError(f'No route matching "{name}". Routes: ' + ', '.join(r.name for r in qs[:15]))
    if len(pool) > 1:
        raise ProposalError('Several routes match: ' + '; '.join(f'{r.name} (route_id {r.id})' for r in pool[:8]) + '. Ask which one.')
    return pool[0]


# ── reads ────────────────────────────────────────────────────────────────────

def list_routes(ctx):
    from transport.views import TransportRouteViewSet

    st, body = call(ctx.user, ctx.school_id, TransportRouteViewSet, {'get': 'list'}, 'get', '/api/transport/routes/', {'page_size': 100, 'is_active': 'true'})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the routes.'))
    return {'routes': [{'route_id': r['id'], 'name': r['name'], 'from': r.get('start_location'), 'to': r.get('end_location'), 'stops': r['stops_count'],
                        'vehicles': r['vehicles_count'], 'students': r['students_count'], 'seats': r['total_capacity']} for r in _items(body)]}


def get_route_students(ctx, route_name=None, route_id=None):
    from transport.views import TransportRouteViewSet

    r = _route(ctx, route_name, route_id)
    st, body = call(ctx.user, ctx.school_id, TransportRouteViewSet, {'get': 'students'}, 'get', f'/api/transport/routes/{r.id}/students/',
                    {'academic_year': _year_id(ctx)}, pk=r.id)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the route students.'))
    rows = _items(body)
    return {'route': r.name, 'count': len(rows), 'students': [{'student': a['student_name'], 'class': a.get('student_class_name'), 'stop': a['stop_name'],
                                                                'vehicle': a.get('vehicle_number'), 'type': a['transport_type_display']} for a in rows[:LIST_LIMIT]]}


def get_route_status(ctx, route_name=None, route_id=None):
    from transport.views import ActiveRouteJourneysView

    st, body = call(ctx.user, ctx.school_id, ActiveRouteJourneysView, {'get': 'get'}, 'get', '/api/transport/route-journey/active/')
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the running journeys.'))
    rows = _items(body)
    want = _route(ctx, route_name, route_id) if (route_name or route_id) else None
    if want:
        rows = [j for j in rows if j.get('route') == want.id]
    return {'route': want.name if want else None, 'running_now': len(rows), 'journeys': [
        {k: j.get(k) for k in ('route_name', 'vehicle_number', 'driver_name', 'journey_type', 'started_at', 'tracking_mode') if k in j} for j in rows[:LIST_LIMIT]],
        **({} if rows else {'note': 'No journey is running right now' + (f' on {want.name}.' if want else '.')})}


def get_student_transport(ctx, student_name=None, student_id=None, student_class=None):
    from transport.views import TransportAssignmentViewSet

    st_obj = resolve_student(ctx, student_id, student_name, student_class)
    st, body = call(ctx.user, ctx.school_id, TransportAssignmentViewSet, {'get': 'list'}, 'get', '/api/transport/assignments/',
                    {'student_id': st_obj.id, 'page_size': 10})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the transport assignment.'))
    rows = _items(body)
    return {'student': st_obj.name, 'assignments': [{'year': a['academic_year_name'], 'route': a['route_name'], 'stop': a['stop_name'],
                                                      'pickup': a.get('stop_pickup_time'), 'drop': a.get('stop_drop_time'), 'vehicle': a.get('vehicle_number'),
                                                      'type': a['transport_type_display'], 'active': a['is_active']} for a in rows],
            **({} if rows else {'note': 'This student has no transport assignment.'})}


def list_vehicles(ctx):
    from transport.views import TransportVehicleViewSet

    st, body = call(ctx.user, ctx.school_id, TransportVehicleViewSet, {'get': 'list'}, 'get', '/api/transport/vehicles/', {'page_size': 100, 'is_active': 'true'})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the vehicles.'))
    return {'vehicles': [{'vehicle_id': v['id'], 'number': v['vehicle_number'], 'type': v['vehicle_type_display'], 'seats': v['capacity'],
                          'driver': v.get('driver_name'), 'driver_phone': v.get('driver_phone'), 'route': v.get('route_name')} for v in _items(body)]}


# ── assign / change ──────────────────────────────────────────────────────────

def _existing(ctx, student_id):
    from transport.models import TransportAssignment
    return TransportAssignment.objects.filter(school_id=ctx.school_id, student_id=student_id, academic_year_id=_year_id(ctx)).select_related('route', 'stop', 'vehicle').first()


def _build_assign(ctx, payload):
    from students.models import Student
    from transport.models import TransportRoute, TransportStop, TransportVehicle

    st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
    route = TransportRoute.objects.filter(school_id=ctx.school_id, id=payload['route_id'], is_active=True).first()
    stop = TransportStop.objects.filter(id=payload['stop_id'], route=route).first() if route else None
    if st is None or route is None or stop is None:
        raise ProposalError('The student, route or stop no longer exists.')
    vehicle = None
    if payload.get('vehicle_id'):
        vehicle = TransportVehicle.objects.filter(school_id=ctx.school_id, id=payload['vehicle_id'], is_active=True).first()
        if vehicle is None:
            raise ProposalError('That vehicle no longer exists.')
        if vehicle.assigned_route_id and vehicle.assigned_route_id != route.id:
            raise ProposalError(f'{vehicle.vehicle_number} is assigned to a different route.')
    old = _existing(ctx, st.id)
    if old and old.is_active and old.route_id == route.id and old.stop_id == stop.id and old.transport_type == payload['transport_type'] \
            and (old.vehicle_id or None) == (vehicle.id if vehicle else None):
        raise ProposalError(f'{st.name} is already on {route.name} at {stop.name} with those settings.')
    warnings = []
    if vehicle:
        from transport.models import TransportAssignment
        used = TransportAssignment.objects.filter(school_id=ctx.school_id, vehicle=vehicle, is_active=True, academic_year_id=_year_id(ctx)).exclude(student=st).count()
        if used >= vehicle.capacity:
            warnings.append(f'{vehicle.vehicle_number} already carries {used} of {vehicle.capacity} seats.')
    cur = (f'{old.route.name} / {old.stop.name}' if old and old.is_active else 'not on transport')
    rows = [{'field': 'Student', 'from': '', 'to': st.name}, {'field': 'Route and stop', 'from': cur, 'to': f'{route.name} / {stop.name}'},
            {'field': 'Vehicle', 'from': (old.vehicle.vehicle_number if old and old.vehicle_id else 'none'), 'to': vehicle.vehicle_number if vehicle else 'none'},
            {'field': 'Rides', 'from': TYPES.get(old.transport_type, '') if old else '', 'to': TYPES[payload['transport_type']]}]
    if old:
        warnings.append('The student already has a transport record this year; it is updated, not duplicated.')
    return {'payload': {**payload, 'assignment_id': old.id if old else None}, 'preview': {
        'kind': 'edit_entry', 'title': 'Change transport' if old and old.is_active else 'Assign transport',
        'summary': f'{st.name}: {route.name}, {stop.name}', 'columns': ['Field', 'From', 'To'], 'rows': rows, 'totals': {'count': 1},
        'warnings': warnings, 'editable': {}}}


def assign_student_transport(ctx, route_name=None, route_id=None, stop_name=None, student_name=None, student_id=None, student_class=None,
                             vehicle_number=None, transport_type=None):
    from transport.models import TransportStop, TransportVehicle

    st = resolve_student(ctx, student_id, student_name, student_class)
    route = _route(ctx, route_name, route_id)
    stops = list(TransportStop.objects.filter(route=route))
    if not stop_name:
        raise ProposalError(f'Which stop on {route.name}? ' + ', '.join(s.name for s in stops[:20]) + '. Ask the user.')
    want = lc.tokens(stop_name)
    hits = [s for s in stops if all(w in lc.tokens(s.name) for w in want)]
    exact = [s for s in stops if s.name.strip().lower() == stop_name.strip().lower()]
    stop = exact[0] if len(exact) == 1 else (hits[0] if len(hits) == 1 else None)
    if stop is None:
        raise ProposalError(f'Stop "{stop_name}" is not clear on {route.name}. Stops: ' + ', '.join(s.name for s in stops[:20]) + '. Ask the user.')
    vehicle = None
    if vehicle_number:
        cands = [v for v in TransportVehicle.objects.filter(school_id=ctx.school_id, is_active=True) if lc.flat(vehicle_number) in lc.flat(v.vehicle_number)]
        if len(cands) != 1:
            raise ProposalError(f'Vehicle "{vehicle_number}" is not clear. Vehicles: ' + ', '.join(v.vehicle_number for v in TransportVehicle.objects.filter(school_id=ctx.school_id, is_active=True)[:15]))
        vehicle = cands[0]
    t = (transport_type or 'BOTH').upper()
    if t not in TYPES:
        raise ProposalError('Transport type must be PICKUP, DROP or BOTH.')
    return _build_assign(ctx, {'kind': 'edit_entry', 'student_id': st.id, 'route_id': route.id, 'stop_id': stop.id,
                               'vehicle_id': vehicle.id if vehicle else None, 'transport_type': t})


def revise_assign(ctx, payload, edits):
    return _build_assign(ctx, payload)


def apply_assign(ctx, payload):
    from transport.views import TransportAssignmentViewSet

    data = {'academic_year': _year_id(ctx), 'student': payload['student_id'], 'route': payload['route_id'], 'stop': payload['stop_id'],
            'vehicle': payload.get('vehicle_id'), 'transport_type': payload['transport_type'], 'is_active': True}
    if payload.get('assignment_id'):
        st, body = call(ctx.user, ctx.school_id, TransportAssignmentViewSet, {'patch': 'partial_update'}, 'patch',
                        f"/api/transport/assignments/{payload['assignment_id']}/", data, pk=payload['assignment_id'])
    else:
        st, body = call(ctx.user, ctx.school_id, TransportAssignmentViewSet, {'post': 'create'}, 'post', '/api/transport/assignments/', data)
    if st not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The transport could not be saved.')}
    return {'ok': True}


# ── remove (deactivate) ──────────────────────────────────────────────────────

def _build_remove(ctx, payload):
    from transport.models import TransportAssignment

    a = TransportAssignment.objects.filter(school_id=ctx.school_id, id=payload['assignment_id']).select_related('student', 'route', 'stop').first()
    if a is None or not a.is_active:
        raise ProposalError('That student is no longer on transport.')
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': 'Remove from transport', 'summary': f'{a.student.name}: off {a.route.name}',
        'columns': ['Field', 'From', 'To'], 'rows': [{'field': 'Route and stop', 'from': f'{a.route.name} / {a.stop.name}', 'to': 'none'}],
        'totals': {'count': 1}, 'warnings': ['The record is kept as inactive, so history stays and the student can be assigned again later.'], 'editable': {}}}


def remove_student_transport(ctx, student_name=None, student_id=None, student_class=None):
    st = resolve_student(ctx, student_id, student_name, student_class)
    a = _existing(ctx, st.id)
    if a is None or not a.is_active:
        raise ProposalError(f'{st.name} is not on transport this year.')
    return _build_remove(ctx, {'kind': 'edit_entry', 'assignment_id': a.id})


def revise_remove(ctx, payload, edits):
    return _build_remove(ctx, payload)


def apply_remove(ctx, payload):
    from transport.views import TransportAssignmentViewSet

    st, body = call(ctx.user, ctx.school_id, TransportAssignmentViewSet, {'patch': 'partial_update'}, 'patch',
                    f"/api/transport/assignments/{payload['assignment_id']}/", {'is_active': False}, pk=payload['assignment_id'])
    if st != 200:
        return {'ok': False, 'error': _fail(body, 'The student could not be removed.')}
    return {'ok': True}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_WHO = {'student_name': {'type': 'string'}, 'student_id': {'type': 'integer'}, 'student_class': {'type': 'string', 'description': 'Class to tell same-named students apart'}}
_ROUTE = {'route_name': {'type': 'string'}, 'route_id': {'type': 'integer'}}


def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='operations', module='transport', roles=ADMINS))


_read('list_routes', 'Transport routes with stops, vehicles, students and seats.', {}, list_routes)
_read('get_route_students', 'Students riding a route this year, with stop, vehicle and type.', dict(_ROUTE), get_route_students)
_read('get_route_status', 'Whether a bus journey is running right now (all routes, or one route). Use for "is the bus on route 2 running today?".', dict(_ROUTE), get_route_status)
_read('get_student_transport', "A student's route, stop, times and vehicle.", dict(_WHO), get_student_transport)
_read('list_vehicles', 'Vehicles with seats, driver and route.', {}, list_vehicles)

register(Tool(
    name='assign_student_transport',
    description=('PREPARE putting a student on a transport route and stop for the current year ("Ali ko route 2, Model Town stop par lagao"). Optional vehicle and '
                 'PICKUP / DROP / BOTH (default BOTH). If the student already has a record this year it is changed, not duplicated. Ask when the route or stop is unclear. '
                 'Nothing is saved until the user approves the card.'),
    parameters={'type': 'object', **_O, 'properties': {**_WHO, **_ROUTE, 'stop_name': {'type': 'string'}, 'vehicle_number': {'type': 'string'},
                                                       'transport_type': {'type': 'string', 'enum': list(TYPES)}}},
    handler=assign_student_transport, sub_agent='operations', module='transport', roles=ADMINS, kind='write', revise=revise_assign, apply=apply_assign,
))
register(Tool(
    name='remove_student_transport',
    description='PREPARE taking a student off transport (the record is kept as inactive). Nothing changes until the user approves the card.',
    parameters={'type': 'object', **_O, 'properties': dict(_WHO)},
    handler=remove_student_transport, sub_agent='operations', module='transport', roles=ADMINS, kind='write', revise=revise_remove, apply=apply_remove,
))
