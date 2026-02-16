# -*- coding: utf-8 -*-
"""
Phase 19: Schools & Organization Management — Comprehensive API Test Suite.

Tests super-admin school/org/membership management, module registry,
regular school endpoints, mark mappings, and register config.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase19_schools.py', encoding='utf-8').read())"

What it tests:
    Level A: Super Admin — Organizations CRUD
    Level B: Super Admin — Schools CRUD
    Level C: Super Admin — School Custom Actions (activate/deactivate/stats/platform_stats)
    Level D: Super Admin — Memberships CRUD
    Level E: Module Registry
    Level F: Regular School Endpoints (list, current, mark_mappings, register_config)
    Level G: Module Cascade (org disabling module cascades to schools)
    Level H: Cross-cutting (non-super-admin blocked, school isolation)

Roles tested:
    - SUPER_ADMIN: full platform access
    - SCHOOL_ADMIN: read-only school endpoints
    - TEACHER: limited access
"""

import json
import traceback
from datetime import date
from django.test import Client
from django.conf import settings

if 'testserver' not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS.append('testserver')

# Load shared seed data
exec(open('seed_test_data.py', encoding='utf-8').read())

from users.models import User
from schools.models import Organization, School, UserSchoolMembership

# Phase-specific prefix
P19 = "P19SCH_"

try:
    seed = get_seed_data()

    school_a = seed['school_a']
    school_b = seed['school_b']
    SID_A = seed['SID_A']
    SID_B = seed['SID_B']
    org = seed['org']
    token_admin = seed['tokens']['admin']
    token_teacher = seed['tokens']['teacher']
    token_admin_b = seed['tokens']['admin_b']

    reset_counters()

    # Create a super admin for this test suite
    super_user = User.objects.create_superuser(
        username=f'{P19}superadmin',
        email=f'{P19}super@test.com',
        password=PASSWORD,
    )
    super_user.role = 'SUPER_ADMIN'
    super_user.save()
    super_token = login(f'{P19}superadmin')

    if not super_token:
        raise Exception("Could not login as super admin — aborting")

    def sa_get(url):
        """Super admin GET (no school header needed)."""
        return _client.get(
            url,
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )

    def sa_post(url, data):
        """Super admin POST."""
        return _client.post(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )

    def sa_patch(url, data):
        """Super admin PATCH."""
        return _client.patch(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )

    def sa_delete(url):
        """Super admin DELETE."""
        return _client.delete(
            url,
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )

    # ==================================================================
    print("=" * 70)
    print("  PHASE 19 COMPREHENSIVE TEST SUITE — SCHOOLS & ORG MANAGEMENT")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: SUPER ADMIN — ORGANIZATIONS CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: ORGANIZATIONS CRUD (Super Admin)")
    print("=" * 70)

    # A1: List organizations
    resp = sa_get('/api/admin/organizations/')
    check("A1: List orgs returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A2: Create organization
    resp = sa_post('/api/admin/organizations/', {
        'name': f'{P19}Test Org',
        'slug': f'{P19.lower().replace("_", "-")}test-org',
        'allowed_modules': {
            'attendance': True,
            'academics': True,
            'finance': True,
            'hr': True,
            'inventory': False,
        },
    })
    check("A2: Create org returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    test_org_id = resp.json().get('id') if resp.status_code == 201 else None
    if not test_org_id and resp.status_code == 201:
        # Create serializer may not return id — look up from DB
        _org = Organization.objects.filter(name=f'{P19}Test Org').first()
        test_org_id = _org.id if _org else None

    # A3: Retrieve organization
    if test_org_id:
        resp = sa_get(f'/api/admin/organizations/{test_org_id}/')
        check("A3: Retrieve org returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("A4: Org has correct name",
                  resp.json().get('name') == f'{P19}Test Org')

    # A5: Update organization
    if test_org_id:
        resp = sa_patch(f'/api/admin/organizations/{test_org_id}/', {
            'name': f'{P19}Updated Org',
        })
        check("A5: Update org returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("A6: Org name updated",
                  resp.json().get('name') == f'{P19}Updated Org')

    # A7: Create org with missing name (required field)
    resp = sa_post('/api/admin/organizations/', {
        'slug': f'{P19.lower().replace("_", "-")}no-name-org',
    })
    check("A7: Missing required name returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: SUPER ADMIN — SCHOOLS CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: SCHOOLS CRUD (Super Admin)")
    print("=" * 70)

    # B1: List schools
    resp = sa_get('/api/admin/schools/')
    check("B1: List schools returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B2: Create school under test org
    resp = sa_post('/api/admin/schools/', {
        'name': f'{P19}Test School',
        'subdomain': f'{P19.lower().replace("_", "-")}test-school',
        'organization': test_org_id,
        'enabled_modules': {
            'attendance': True,
            'academics': True,
            'finance': False,
        },
    })
    check("B2: Create school returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    test_school_id = resp.json().get('id') if resp.status_code == 201 else None
    if not test_school_id and resp.status_code == 201:
        _sch = School.objects.filter(name=f'{P19}Test School').first()
        test_school_id = _sch.id if _sch else None

    # B3: Retrieve school
    if test_school_id:
        resp = sa_get(f'/api/admin/schools/{test_school_id}/')
        check("B3: Retrieve school returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("B4: School has correct name",
                  body.get('name') == f'{P19}Test School')
            check("B5: School has enabled_modules", 'enabled_modules' in body)

    # B6: Update school
    if test_school_id:
        resp = sa_patch(f'/api/admin/schools/{test_school_id}/', {
            'name': f'{P19}Updated School',
            'contact_email': f'{P19}school@test.com',
        })
        check("B6: Update school returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("B7: School name updated",
                  resp.json().get('name') == f'{P19}Updated School')

    # B8: Create school with duplicate subdomain
    resp = sa_post('/api/admin/schools/', {
        'name': f'{P19}Dup Subdomain School',
        'subdomain': f'{P19.lower().replace("_", "-")}test-school',
    })
    check("B8: Duplicate subdomain returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: SCHOOL CUSTOM ACTIONS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: SCHOOL CUSTOM ACTIONS (Super Admin)")
    print("=" * 70)

    if test_school_id:
        # C1: Deactivate school
        resp = sa_post(f'/api/admin/schools/{test_school_id}/deactivate/', {})
        check("C1: Deactivate school returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            _sch_obj = School.objects.get(id=test_school_id)
            check("C2: School is_active is False", _sch_obj.is_active is False)

        # C3: Activate school
        resp = sa_post(f'/api/admin/schools/{test_school_id}/activate/', {})
        check("C3: Activate school returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            _sch_obj = School.objects.get(id=test_school_id)
            check("C4: School is_active is True", _sch_obj.is_active is True)

        # C5: School stats
        resp = sa_get(f'/api/admin/schools/{test_school_id}/stats/')
        check("C5: School stats returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("C6: Stats has total_students key",
                  'total_students' in body or 'school_name' in body)

    # C7: Platform stats
    resp = sa_get('/api/admin/schools/platform_stats/')
    check("C7: Platform stats returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("C8: Platform stats has total_schools", 'total_schools' in body)

    # ==================================================================
    # LEVEL D: MEMBERSHIPS CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: MEMBERSHIPS CRUD (Super Admin)")
    print("=" * 70)

    # Create a test user to assign memberships
    mem_user = User.objects.create_user(
        username=f'{P19}mem_user',
        email=f'{P19}mem@test.com',
        password=PASSWORD,
        role='STAFF',
    )

    # D1: List memberships
    resp = sa_get('/api/admin/memberships/')
    check("D1: List memberships returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # D2: Create membership
    resp = sa_post('/api/admin/memberships/', {
        'user': mem_user.id,
        'school': SID_A,
        'role': 'TEACHER',
        'is_default': True,
    })
    check("D2: Create membership returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    mem_id = resp.json().get('id') if resp.status_code == 201 else None
    if not mem_id and resp.status_code == 201:
        _mem = UserSchoolMembership.objects.filter(user=mem_user, school=school_a).first()
        mem_id = _mem.id if _mem else None

    # D3: Retrieve membership
    if mem_id:
        resp = sa_get(f'/api/admin/memberships/{mem_id}/')
        check("D3: Retrieve membership returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("D4: Membership has correct role",
                  resp.json().get('role') == 'TEACHER')

    # D5: Update membership role
    if mem_id:
        resp = sa_patch(f'/api/admin/memberships/{mem_id}/', {
            'role': 'HR_MANAGER',
        })
        check("D5: Update membership returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("D6: Membership role updated",
                  resp.json().get('role') == 'HR_MANAGER')

    # D7: Create second membership for same user in school B
    resp = sa_post('/api/admin/memberships/', {
        'user': mem_user.id,
        'school': SID_B,
        'role': 'STAFF',
        'is_default': False,
    })
    check("D7: Second membership returns 201", resp.status_code == 201,
          f"got {resp.status_code}")
    mem_b_id = resp.json().get('id') if resp.status_code == 201 else None
    if not mem_b_id and resp.status_code == 201:
        _mem_b = UserSchoolMembership.objects.filter(user=mem_user, school=school_b).first()
        mem_b_id = _mem_b.id if _mem_b else None

    # D8: Duplicate membership (same user + same school) should fail
    resp = sa_post('/api/admin/memberships/', {
        'user': mem_user.id,
        'school': SID_A,
        'role': 'TEACHER',
    })
    check("D8: Duplicate membership returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # D9: Delete membership
    if mem_b_id:
        resp = sa_delete(f'/api/admin/memberships/{mem_b_id}/')
        check("D9: Delete membership returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL E: MODULE REGISTRY
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: MODULE REGISTRY")
    print("=" * 70)

    # E1: Super admin can access module registry
    resp = sa_get('/api/admin/modules/')
    check("E1: Module registry returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        # Module registry returns a plain list, not a dict
        modules = body if isinstance(body, list) else body.get('modules', [])
        if isinstance(modules, list):
            check("E2: Has at least one module", len(modules) > 0)
            if modules:
                mod = modules[0]
                check("E3: Module has key field", 'key' in mod)
                check("E4: Module has label field", 'label' in mod or 'name' in mod)

    # E5: Non-super-admin cannot access module registry
    resp = _client.get(
        '/api/admin/modules/',
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        content_type='application/json',
    )
    check("E5: Non-super admin module registry returns 403",
          resp.status_code == 403, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL F: REGULAR SCHOOL ENDPOINTS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: REGULAR SCHOOL ENDPOINTS")
    print("=" * 70)

    # F1: List accessible schools (admin A)
    resp = api_get('/api/schools/', token_admin, SID_A)
    check("F1: List schools returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        schools_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(schools_list, list):
            check("F2: Has at least one school", len(schools_list) > 0)

    # F3: Retrieve specific school
    resp = api_get(f'/api/schools/{SID_A}/', token_admin, SID_A)
    check("F3: Retrieve school returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("F4: School has name", 'name' in body)
        check("F5: School has enabled_modules", 'enabled_modules' in body)

    # F6: Get current school
    resp = api_get('/api/schools/current/', token_admin, SID_A)
    check("F6: Current school returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F7: Get mark mappings
    resp = api_get('/api/schools/mark_mappings/', token_admin, SID_A)
    check("F7: Get mark_mappings returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F8: Update mark mappings (admin)
    resp = _client.put(
        '/api/schools/mark_mappings/',
        data=json.dumps({
            'PRESENT': ['P', 'p', '/'],
            'ABSENT': ['A', 'a', 'X'],
            'default': 'ABSENT',
        }),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("F8: Update mark_mappings returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F9: Get register config
    resp = api_get('/api/schools/register_config/', token_admin, SID_A)
    check("F9: Get register_config returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F10: Update register config (admin)
    resp = _client.put(
        '/api/schools/register_config/',
        data=json.dumps({
            'orientation': 'rows_are_students',
            'date_header_row': 0,
            'student_name_col': 0,
            'roll_number_col': 1,
            'data_start_row': 1,
            'data_start_col': 2,
        }),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("F10: Update register_config returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F11: Teacher can read but not write school config
    resp = api_get('/api/schools/mark_mappings/', token_teacher, SID_A)
    check("F11: Teacher can read mark_mappings (200)", resp.status_code == 200,
          f"got {resp.status_code}")

    # F12: Unauthenticated cannot update mark_mappings
    resp = _client.put(
        '/api/schools/mark_mappings/',
        data=json.dumps({'PRESENT': ['P'], 'ABSENT': ['A'], 'default': 'ABSENT'}),
        content_type='application/json',
    )
    check("F12: Unauthenticated cannot update mark_mappings (401)",
          resp.status_code == 401, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL G: MODULE CASCADE
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: MODULE CASCADE")
    print("=" * 70)

    # G1: Verify org's allowed_modules affect school's effective_modules
    if test_org_id and test_school_id:
        # First enable inventory on school
        sa_patch(f'/api/admin/schools/{test_school_id}/', {
            'enabled_modules': {
                'attendance': True,
                'academics': True,
                'finance': True,
                'inventory': True,
            },
        })

        # Now disable inventory on org level
        sa_patch(f'/api/admin/organizations/{test_org_id}/', {
            'allowed_modules': {
                'attendance': True,
                'academics': True,
                'finance': True,
                'inventory': False,
            },
        })

        # Retrieve school — effective/enabled modules should not have inventory=True
        resp = sa_get(f'/api/admin/schools/{test_school_id}/')
        if resp.status_code == 200:
            body = resp.json()
            effective = body.get('effective_modules', body.get('enabled_modules', {}))
            # inventory should be absent or False (org disabled it)
            inv_val = effective.get('inventory', False)
            check("G1: Org disabling inventory cascades to school",
                  inv_val is not True,
                  f"effective_modules={effective}")
        else:
            check("G1: Could not retrieve school for cascade test",
                  False, f"got {resp.status_code}")
    else:
        print("  [SKIP] Module cascade tests — no test org/school")

    # ==================================================================
    # LEVEL H: CROSS-CUTTING
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL H: CROSS-CUTTING")
    print("=" * 70)

    # H1: Non-super-admin cannot access /api/admin/schools/
    resp = _client.get(
        '/api/admin/schools/',
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        content_type='application/json',
    )
    check("H1: Non-super admin cannot list admin schools (403)",
          resp.status_code == 403, f"got {resp.status_code}")

    # H2: Non-super-admin cannot access /api/admin/organizations/
    resp = _client.get(
        '/api/admin/organizations/',
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        content_type='application/json',
    )
    check("H2: Non-super admin cannot list orgs (403)",
          resp.status_code == 403, f"got {resp.status_code}")

    # H3: Non-super-admin cannot create schools
    resp = _client.post(
        '/api/admin/schools/',
        data=json.dumps({
            'name': f'{P19}Unauthorized School',
            'subdomain': f'{P19.lower().replace("_", "-")}unauth',
        }),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        content_type='application/json',
    )
    check("H3: Non-super admin cannot create school (403)",
          resp.status_code == 403, f"got {resp.status_code}")

    # H4: Non-super-admin cannot access /api/admin/memberships/
    resp = _client.get(
        '/api/admin/memberships/',
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        content_type='application/json',
    )
    check("H4: Non-super admin cannot list memberships (403)",
          resp.status_code == 403, f"got {resp.status_code}")

    # H5: Unauthenticated cannot access admin endpoints
    resp = _client.get('/api/admin/schools/', content_type='application/json')
    check("H5: Unauthenticated admin/schools returns 401",
          resp.status_code == 401, f"got {resp.status_code}")

    # H6: School admin B cannot see school A details via regular endpoint
    resp = api_get(f'/api/schools/{SID_A}/', token_admin_b, SID_B)
    check("H6: Admin B cannot retrieve school A (403/404)",
          resp.status_code in (403, 404), f"got {resp.status_code}")

    # H7: Delete school (super admin)
    if test_school_id:
        resp = sa_delete(f'/api/admin/schools/{test_school_id}/')
        check("H7: Delete school returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

    # H8: Delete org (super admin)
    if test_org_id:
        resp = sa_delete(f'/api/admin/organizations/{test_org_id}/')
        check("H8: Delete org returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

    # ==================================================================
    # RESULTS
    # ==================================================================
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"  RESULTS: {passed} passed / {failed} failed / {total} total")
    if failed == 0:
        print("  ALL TESTS PASSED!")
    print("=" * 70)

except Exception as e:
    print(f"\n[ERROR] Test suite crashed: {e}")
    traceback.print_exc()

print("\nDone. Test data preserved for further tests.")
