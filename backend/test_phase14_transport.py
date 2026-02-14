"""
Phase 14 — Transport Module Tests
===================================
Covers: Routes CRUD, Stops CRUD, Vehicles CRUD, Assignments + bulk_assign,
        Attendance + bulk_mark, permissions, school isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase14_transport.py', encoding='utf-8').read())"
"""

import json
from datetime import date, timedelta
from django.test import Client

# ── Seed data ────────────────────────────────────────────────────────────
exec(open('seed_test_data.py', encoding='utf-8').read())
seed = get_seed_data()
reset_counters()

school_a   = seed['school_a']
school_b   = seed['school_b']
SID_A      = seed['SID_A']
SID_B      = seed['SID_B']
users      = seed['users']
tokens     = seed['tokens']
students   = seed['students']
ay         = seed['academic_year']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

print("\n" + "=" * 70)
print("  PHASE 14: TRANSPORT MODULE TESTS")
print("=" * 70)

from transport.models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
)

P14 = 'P14TRN_'
student_1 = students[0]
student_2 = students[1]

# ── Cleanup previous P14 data ────────────────────────────────────────────
TransportAttendance.objects.filter(school=school_a, route__name__startswith=P14).delete()
TransportAssignment.objects.filter(school=school_a, route__name__startswith=P14).delete()
TransportStop.objects.filter(route__school=school_a, name__startswith=P14).delete()
TransportVehicle.objects.filter(school=school_a, vehicle_number__startswith=P14).delete()
TransportRoute.objects.filter(school=school_a, name__startswith=P14).delete()


# ==================================================================
# LEVEL A: ROUTES CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: ROUTES CRUD")
print("=" * 70)

# A1: Create route (Admin)
resp = api_post('/api/transport/routes/', {
    'name': f'{P14}Route North',
    'start_location': 'School Gate',
    'end_location': 'North Colony',
    'distance_km': 12.5,
    'estimated_duration_minutes': 45,
}, token_admin, SID_A)
check("A1  Create route (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
route_id = resp.json().get('id') if resp.status_code == 201 else None

# A2: Create second route
resp = api_post('/api/transport/routes/', {
    'name': f'{P14}Route South',
    'start_location': 'School Gate',
    'end_location': 'South Town',
    'distance_km': 8.0,
    'estimated_duration_minutes': 30,
}, token_admin, SID_A)
check("A2  Create second route", resp.status_code == 201,
      f"status={resp.status_code}")

# A3: Teacher can't create -> 403
resp = api_post('/api/transport/routes/', {
    'name': f'{P14}Teacher Route',
    'start_location': 'A',
    'end_location': 'B',
}, token_teacher, SID_A)
check("A3  Teacher can't create route -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A4: List routes
resp = api_get('/api/transport/routes/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("A4  List routes", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# A5: Teacher CAN read routes
resp = api_get('/api/transport/routes/', token_teacher, SID_A)
check("A5  Teacher can read routes", resp.status_code == 200,
      f"status={resp.status_code}")

# A6: Update route
if route_id:
    resp = api_patch(f'/api/transport/routes/{route_id}/', {
        'distance_km': 13.0,
    }, token_admin, SID_A)
    check("A6  Update route", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("A6  Update route", False, "no route_id")

# A7: School B isolation
resp = api_get('/api/transport/routes/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("A7  School B isolation (routes)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL B: STOPS CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: STOPS CRUD")
print("=" * 70)

# B1: Create stop
if route_id:
    resp = api_post('/api/transport/stops/', {
        'route': route_id,
        'name': f'{P14}Stop 1',
        'address': '123 Main St',
        'stop_order': 1,
        'pickup_time': '07:30:00',
        'drop_time': '14:30:00',
    }, token_admin, SID_A)
    check("B1  Create stop", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    stop_id = resp.json().get('id') if resp.status_code == 201 else None
else:
    check("B1  Create stop", False, "no route_id")
    stop_id = None

# B2: Create second stop
if route_id:
    resp = api_post('/api/transport/stops/', {
        'route': route_id,
        'name': f'{P14}Stop 2',
        'address': '456 Oak Ave',
        'stop_order': 2,
        'pickup_time': '07:40:00',
        'drop_time': '14:20:00',
    }, token_admin, SID_A)
    check("B2  Create second stop", resp.status_code == 201,
          f"status={resp.status_code}")
else:
    check("B2  Create second stop", False, "no route_id")

# B3: List stops (filter by route)
if route_id:
    resp = api_get(f'/api/transport/stops/?route_id={route_id}', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get('results', [])
    check("B3  List stops (filter by route)", resp.status_code == 200 and len(data) >= 2,
          f"status={resp.status_code} count={len(data)}")
else:
    check("B3  List stops (filter by route)", False, "no route_id")

# B4: Teacher can't create stop -> 403
if route_id:
    resp = api_post('/api/transport/stops/', {
        'route': route_id,
        'name': f'{P14}Teacher Stop',
        'stop_order': 99,
    }, token_teacher, SID_A)
    check("B4  Teacher can't create stop -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("B4  Teacher can't create stop -> 403", False, "no route_id")


# ==================================================================
# LEVEL C: VEHICLES CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: VEHICLES CRUD")
print("=" * 70)

# C1: Create vehicle
resp = api_post('/api/transport/vehicles/', {
    'vehicle_number': f'{P14}BUS-001',
    'vehicle_type': 'BUS',
    'capacity': 40,
    'make_model': 'Hino AK',
    'driver_name': 'Ahmad Driver',
    'driver_phone': '03001234567',
    'assigned_route': route_id,
}, token_admin, SID_A)
check("C1  Create vehicle", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
vehicle_id = resp.json().get('id') if resp.status_code == 201 else None

# C2: List vehicles
resp = api_get('/api/transport/vehicles/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("C2  List vehicles", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# C3: Teacher can't create vehicle -> 403
resp = api_post('/api/transport/vehicles/', {
    'vehicle_number': f'{P14}VAN-T',
    'vehicle_type': 'VAN',
    'capacity': 15,
}, token_teacher, SID_A)
check("C3  Teacher can't create vehicle -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# C4: School B isolation
resp = api_get('/api/transport/vehicles/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("C4  School B isolation (vehicles)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL D: ASSIGNMENTS + BULK ASSIGN
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: ASSIGNMENTS + BULK ASSIGN")
print("=" * 70)

# D1: Create assignment
if route_id and stop_id:
    resp = api_post('/api/transport/assignments/', {
        'academic_year': ay.id,
        'student': student_1.id,
        'route': route_id,
        'stop': stop_id,
        'transport_type': 'BOTH',
    }, token_admin, SID_A)
    check("D1  Create transport assignment", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    ta_id = resp.json().get('id') if resp.status_code == 201 else None
else:
    check("D1  Create transport assignment", False, "no route/stop")
    ta_id = None

# D2: List assignments
resp = api_get('/api/transport/assignments/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("D2  List assignments", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# D3: Bulk assign
if route_id and stop_id:
    resp = api_post('/api/transport/assignments/bulk_assign/', {
        'academic_year_id': ay.id,
        'route_id': route_id,
        'stop_id': stop_id,
        'student_ids': [student_2.id],
        'transport_type': 'PICKUP',
    }, token_admin, SID_A)
    check("D3  Bulk assign students", resp.status_code in (200, 201),
          f"status={resp.status_code} body={resp.content[:200]}")
    if resp.status_code in (200, 201):
        r = resp.json()
        check("D3b Bulk assign counts", r.get('created', 0) >= 1,
              f"created={r.get('created')} skipped={r.get('skipped')}")
    else:
        check("D3b Bulk assign counts", False, "bulk assign failed")
else:
    check("D3  Bulk assign students", False, "no route/stop")
    check("D3b Bulk assign counts", False, "skipped")

# D4: Teacher can't create assignment -> 403
if route_id and stop_id:
    resp = api_post('/api/transport/assignments/', {
        'academic_year': ay.id,
        'student': students[3].id,
        'route': route_id,
        'stop': stop_id,
    }, token_teacher, SID_A)
    check("D4  Teacher can't create assignment -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("D4  Teacher can't create assignment -> 403", False, "no route/stop")

# D5: Route students list
if route_id:
    resp = api_get(f'/api/transport/routes/{route_id}/students/', token_admin, SID_A)
    check("D5  Route students list", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("D5  Route students list", False, "no route_id")


# ==================================================================
# LEVEL E: TRANSPORT ATTENDANCE + BULK MARK
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: TRANSPORT ATTENDANCE + BULK MARK")
print("=" * 70)

# E1: Create attendance record
if route_id:
    resp = api_post('/api/transport/attendance/', {
        'student': student_1.id,
        'route': route_id,
        'date': str(date.today()),
        'boarding_status': 'BOARDED',
    }, token_admin, SID_A)
    check("E1  Create attendance record", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("E1  Create attendance record", False, "no route_id")

# E2: List attendance
resp = api_get('/api/transport/attendance/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("E2  List attendance", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# E3: Bulk mark attendance
if route_id:
    resp = api_post('/api/transport/attendance/bulk_mark/', {
        'route_id': route_id,
        'date': str(date.today() - timedelta(days=1)),
        'records': [
            {'student_id': student_1.id, 'boarding_status': 'BOARDED'},
            {'student_id': student_2.id, 'boarding_status': 'NOT_BOARDED'},
        ],
    }, token_admin, SID_A)
    check("E3  Bulk mark attendance", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("E3  Bulk mark attendance", False, "no route_id")


# ==================================================================
# LEVEL F: PERMISSIONS & CROSS-CUTTING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL F: PERMISSIONS & CROSS-CUTTING")
print("=" * 70)

# F1: Unauthenticated -> 401
resp = _client.get('/api/transport/routes/')
check("F1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F2: Invalid token -> 401
resp = _client.get(
    '/api/transport/routes/',
    HTTP_AUTHORIZATION='Bearer garbage_token',
)
check("F2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F3: Teacher CAN read attendance
resp = api_get('/api/transport/attendance/', token_teacher, SID_A)
check("F3  Teacher can read attendance", resp.status_code == 200,
      f"status={resp.status_code}")

# F4: School B isolation (assignments)
resp = api_get('/api/transport/assignments/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("F4  School B isolation (assignments)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 14 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
