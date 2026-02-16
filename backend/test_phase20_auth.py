# -*- coding: utf-8 -*-
"""
Phase 20: Users & Authentication — Comprehensive API Test Suite.

Tests JWT auth, user profile, password change, school switching,
push tokens, and user CRUD management.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase20_auth.py', encoding='utf-8').read())"

What it tests:
    Level A: JWT Login (valid/invalid credentials, response structure)
    Level B: Token Refresh (valid/expired tokens)
    Level C: Current User Profile (GET /auth/me, PATCH /auth/me)
    Level D: Change Password (wrong old, mismatch, success)
    Level E: Switch School (valid switch, no-access, invalid ID)
    Level F: Push Tokens (register/unregister)
    Level G: User CRUD (list, create, retrieve, update, delete)
    Level H: Super Admin User Creation
    Level I: Cross-cutting (role filtering, immutable fields, unauthorized)

Roles tested:
    - SUPER_ADMIN: full platform access
    - SCHOOL_ADMIN: manage users in their school
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
P20 = "P20AUTH_"

try:
    seed = get_seed_data()

    school_a = seed['school_a']
    school_b = seed['school_b']
    SID_A = seed['SID_A']
    SID_B = seed['SID_B']
    org = seed['org']
    token_admin = seed['tokens']['admin']
    token_principal = seed['tokens']['principal']
    token_teacher = seed['tokens']['teacher']
    token_admin_b = seed['tokens']['admin_b']
    token_hr = seed['tokens']['hr_manager']

    reset_counters()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 20 COMPREHENSIVE TEST SUITE — USERS & AUTHENTICATION")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: JWT LOGIN
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: JWT LOGIN")
    print("=" * 70)

    # A1: Valid login returns access + refresh + user
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{SEED_PREFIX}admin',
            'password': PASSWORD,
        }),
        content_type='application/json',
    )
    check("A1: Valid login returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    body = resp.json() if resp.status_code == 200 else {}
    check("A2: Response has access token", 'access' in body)
    check("A3: Response has refresh token", 'refresh' in body)
    check("A4: Response has user object", 'user' in body)
    if 'user' in body:
        user_obj = body['user']
        check("A5: User has id", 'id' in user_obj)
        check("A6: User has role", 'role' in user_obj)
        check("A7: User has schools array", 'schools' in user_obj)
        if 'schools' in user_obj:
            check("A8: Schools is a list", isinstance(user_obj['schools'], list))

    # A9: Invalid password returns 401
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{SEED_PREFIX}admin',
            'password': 'WrongPassword!',
        }),
        content_type='application/json',
    )
    check("A9: Invalid password returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # A10: Non-existent user returns 401
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': 'nonexistent_user_xyz',
            'password': PASSWORD,
        }),
        content_type='application/json',
    )
    check("A10: Non-existent user returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # A11: Missing fields returns 400
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({'username': f'{SEED_PREFIX}admin'}),
        content_type='application/json',
    )
    check("A11: Missing password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: TOKEN REFRESH
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: TOKEN REFRESH")
    print("=" * 70)

    # B1: Get refresh token first
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{SEED_PREFIX}admin',
            'password': PASSWORD,
        }),
        content_type='application/json',
    )
    refresh_token = resp.json().get('refresh', '') if resp.status_code == 200 else ''

    # B2: Valid refresh returns new access token
    resp = _client.post(
        '/api/auth/refresh/',
        data=json.dumps({'refresh': refresh_token}),
        content_type='application/json',
    )
    check("B1: Valid refresh returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    body = resp.json() if resp.status_code == 200 else {}
    check("B2: Refresh response has access token", 'access' in body)

    # B3: Invalid refresh token
    resp = _client.post(
        '/api/auth/refresh/',
        data=json.dumps({'refresh': 'invalid.token.here'}),
        content_type='application/json',
    )
    check("B3: Invalid refresh returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # B4: Empty refresh token
    resp = _client.post(
        '/api/auth/refresh/',
        data=json.dumps({}),
        content_type='application/json',
    )
    check("B4: Empty refresh returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: CURRENT USER PROFILE (GET + PATCH /auth/me/)
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: CURRENT USER PROFILE")
    print("=" * 70)

    # C1: GET /auth/me/ returns user profile
    resp = api_get('/api/auth/me/', token_admin, SID_A)
    check("C1: GET /auth/me/ returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    body = resp.json() if resp.status_code == 200 else {}
    check("C2: Profile has username", 'username' in body)
    check("C3: Profile has email", 'email' in body)
    check("C4: Profile has role", 'role' in body)
    check("C5: Profile has school_id or school", 'school_id' in body or 'school' in body)
    check("C6: Profile has schools array", 'schools' in body)

    # C7: Unauthenticated GET /auth/me/ returns 401
    resp = _client.get('/api/auth/me/', content_type='application/json')
    check("C7: Unauthenticated /auth/me/ returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # C8: PATCH /auth/me/ updates profile
    resp = api_patch('/api/auth/me/', {
        'first_name': f'{P20}UpdatedFirst',
        'last_name': f'{P20}UpdatedLast',
    }, token_admin, SID_A)
    check("C8: PATCH /auth/me/ returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("C9: first_name updated", body.get('first_name') == f'{P20}UpdatedFirst')
        check("C10: last_name updated", body.get('last_name') == f'{P20}UpdatedLast')

    # C11: PATCH cannot change role via /auth/me/
    resp = api_patch('/api/auth/me/', {'role': 'SUPER_ADMIN'}, token_admin, SID_A)
    # Role should NOT change (field is protected)
    me_resp = api_get('/api/auth/me/', token_admin, SID_A)
    if me_resp.status_code == 200:
        check("C11: Cannot change role via /auth/me/",
              me_resp.json().get('role') != 'SUPER_ADMIN',
              f"role is {me_resp.json().get('role')}")

    # Cleanup profile changes
    api_patch('/api/auth/me/', {
        'first_name': '', 'last_name': '',
    }, token_admin, SID_A)

    # ==================================================================
    # LEVEL D: CHANGE PASSWORD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: CHANGE PASSWORD")
    print("=" * 70)

    # Create a temporary user for password tests
    temp_pw_user = User.objects.create_user(
        username=f'{P20}pw_test_user',
        email=f'{P20}pw@test.com',
        password=PASSWORD,
        role='STAFF',
        school=school_a,
    )
    UserSchoolMembership.objects.create(
        user=temp_pw_user, school=school_a, role='STAFF', is_default=True,
    )
    temp_token = login(f'{P20}pw_test_user')

    # D1: Wrong old password
    resp = api_post('/api/auth/change-password/', {
        'old_password': 'WrongOldPassword!',
        'new_password': 'NewPass456!',
        'confirm_password': 'NewPass456!',
    }, temp_token, SID_A)
    check("D1: Wrong old password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # D2: Mismatched new passwords
    resp = api_post('/api/auth/change-password/', {
        'old_password': PASSWORD,
        'new_password': 'NewPass456!',
        'confirm_password': 'DifferentPass789!',
    }, temp_token, SID_A)
    check("D2: Mismatched passwords returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # D3: Successful password change
    resp = api_post('/api/auth/change-password/', {
        'old_password': PASSWORD,
        'new_password': 'NewPass456!',
        'confirm_password': 'NewPass456!',
    }, temp_token, SID_A)
    check("D3: Valid change returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # D4: Can login with new password
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{P20}pw_test_user',
            'password': 'NewPass456!',
        }),
        content_type='application/json',
    )
    check("D4: Login with new password succeeds", resp.status_code == 200,
          f"got {resp.status_code}")

    # D5: Old password no longer works
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{P20}pw_test_user',
            'password': PASSWORD,
        }),
        content_type='application/json',
    )
    check("D5: Old password no longer works", resp.status_code == 401,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL E: SWITCH SCHOOL
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: SWITCH SCHOOL")
    print("=" * 70)

    # Create a multi-school user for testing
    multi_user = User.objects.create_user(
        username=f'{P20}multi_school',
        email=f'{P20}multi@test.com',
        password=PASSWORD,
        role='SCHOOL_ADMIN',
        school=school_a,
    )
    UserSchoolMembership.objects.create(
        user=multi_user, school=school_a, role='SCHOOL_ADMIN', is_default=True,
    )
    UserSchoolMembership.objects.create(
        user=multi_user, school=school_b, role='TEACHER', is_default=False,
    )
    multi_token = login(f'{P20}multi_school')

    # E1: Switch to school B (valid)
    resp = api_post('/api/auth/switch-school/', {
        'school_id': SID_B,
    }, multi_token, SID_A)
    check("E1: Switch school returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("E2: Response has school_id", 'school_id' in body)
        check("E3: School switched to B", body.get('school_id') == SID_B)

    # E4: Switch to non-existent school
    resp = api_post('/api/auth/switch-school/', {
        'school_id': 999999,
    }, multi_token, SID_A)
    check("E4: Non-existent school returns 4xx",
          resp.status_code in (400, 403, 404),
          f"got {resp.status_code}")

    # E5: Switch school without school_id
    resp = api_post('/api/auth/switch-school/', {}, multi_token, SID_A)
    check("E5: Missing school_id returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # E6: User without access to school B cannot switch (use teacher from school A only)
    resp = api_post('/api/auth/switch-school/', {
        'school_id': SID_B,
    }, token_teacher, SID_A)
    check("E6: No-access switch returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL F: PUSH TOKENS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: PUSH TOKENS")
    print("=" * 70)

    # F1: Register push token
    resp = api_post('/api/auth/register-push-token/', {
        'token': 'ExponentPushToken[P20test1234567890]',
        'device_type': 'ANDROID',
    }, token_admin, SID_A)
    check("F1: Register push token returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F2: Register same token again (update)
    resp = api_post('/api/auth/register-push-token/', {
        'token': 'ExponentPushToken[P20test1234567890]',
        'device_type': 'IOS',
    }, token_admin, SID_A)
    check("F2: Re-register same token returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F3: Unregister push token
    resp = _client.delete(
        '/api/auth/unregister-push-token/',
        data=json.dumps({'token': 'ExponentPushToken[P20test1234567890]'}),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("F3: Unregister push token returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # F4: Unregister non-existent token
    resp = _client.delete(
        '/api/auth/unregister-push-token/',
        data=json.dumps({'token': 'ExponentPushToken[nonexistent_token]'}),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("F4: Unregister non-existent token returns 404",
          resp.status_code == 404, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL G: USER CRUD (/api/users/)
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: USER CRUD")
    print("=" * 70)

    # G1: List users (admin)
    resp = api_get('/api/users/', token_admin, SID_A)
    check("G1: List users returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        # Could be paginated or plain list
        users_list = body.get('results', body) if isinstance(body, dict) else body
        check("G2: Users list is non-empty",
              len(users_list) > 0 if isinstance(users_list, list) else True)

    # G3: Create user (admin)
    resp = api_post('/api/users/', {
        'username': f'{P20}new_teacher',
        'email': f'{P20}newteacher@test.com',
        'password': 'CreatePass123!',
        'confirm_password': 'CreatePass123!',
        'first_name': 'New',
        'last_name': 'Teacher',
        'role': 'TEACHER',
    }, token_admin, SID_A)
    check("G3: Create user returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    new_user_id = None
    if resp.status_code == 201:
        new_user_id = resp.json().get('id')
        if not new_user_id:
            # Create serializer may not return id — look up from DB
            _u = User.objects.filter(username=f'{P20}new_teacher').first()
            new_user_id = _u.id if _u else None
        check("G4: Created user exists", new_user_id is not None)
        check("G5: Created user has correct role",
              resp.json().get('role') == 'TEACHER')
        # Ensure user has membership so they appear in school-scoped queryset
        if new_user_id:
            UserSchoolMembership.objects.get_or_create(
                user_id=new_user_id, school=school_a,
                defaults={'role': 'TEACHER', 'is_default': True},
            )

    # G6: Retrieve user
    if new_user_id:
        resp = api_get(f'/api/users/{new_user_id}/', token_admin, SID_A)
        check("G6: Retrieve user returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("G7: Retrieved user has correct username",
                  resp.json().get('username') == f'{P20}new_teacher')

    # G8: Update user (PATCH)
    if new_user_id:
        resp = api_patch(f'/api/users/{new_user_id}/', {
            'first_name': f'{P20}Updated',
            'last_name': 'Name',
        }, token_admin, SID_A)
        check("G8: Update user returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("G9: User name updated",
                  resp.json().get('first_name') == f'{P20}Updated')

    # G10: Create user with mismatched passwords
    resp = api_post('/api/users/', {
        'username': f'{P20}bad_pw_user',
        'email': f'{P20}badpw@test.com',
        'password': 'Pass123!',
        'confirm_password': 'DifferentPass!',
        'role': 'STAFF',
    }, token_admin, SID_A)
    check("G10: Mismatched passwords returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # G11: Create user with duplicate username
    resp = api_post('/api/users/', {
        'username': f'{SEED_PREFIX}admin',
        'email': f'{P20}dup@test.com',
        'password': 'Pass123!',
        'confirm_password': 'Pass123!',
        'role': 'STAFF',
    }, token_admin, SID_A)
    check("G11: Duplicate username returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # G12: Teacher cannot create users
    resp = api_post('/api/users/', {
        'username': f'{P20}teacher_create_attempt',
        'email': f'{P20}teachcreate@test.com',
        'password': 'Pass123!',
        'confirm_password': 'Pass123!',
        'role': 'STAFF',
    }, token_teacher, SID_A)
    check("G12: Teacher create user returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # G13: Teacher cannot list users (or can only see limited)
    resp = api_get('/api/users/', token_teacher, SID_A)
    check("G13: Teacher list users returns 403 or 200",
          resp.status_code in (200, 403),
          f"got {resp.status_code}")

    # G14: Delete user
    if new_user_id:
        resp = api_delete(f'/api/users/{new_user_id}/', token_admin, SID_A)
        check("G14: Delete user returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

        # G15: Deleted user no longer retrievable
        resp = api_get(f'/api/users/{new_user_id}/', token_admin, SID_A)
        check("G15: Deleted user returns 404", resp.status_code == 404,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL H: SUPER ADMIN USER CREATION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL H: SUPER ADMIN USER CREATION")
    print("=" * 70)

    # Create a super admin for testing
    super_user = User.objects.create_superuser(
        username=f'{P20}superadmin',
        email=f'{P20}super@test.com',
        password=PASSWORD,
    )
    super_user.role = 'SUPER_ADMIN'
    super_user.save()
    super_token = login(f'{P20}superadmin')

    if super_token:
        # H1: Super admin can create user via /api/admin/users/create/
        resp = _client.post(
            '/api/admin/users/create/',
            data=json.dumps({
                'username': f'{P20}admin_created',
                'email': f'{P20}admincreated@test.com',
                'password': 'AdminPass123!',
                'confirm_password': 'AdminPass123!',
                'first_name': 'Admin',
                'last_name': 'Created',
                'role': 'SCHOOL_ADMIN',
                'school': SID_A,
            }),
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )
        check("H1: Super admin create user returns 201",
              resp.status_code == 201, f"got {resp.status_code} {resp.content[:200]}")
        sa_created_id = resp.json().get('id') if resp.status_code == 201 else None
        if not sa_created_id and resp.status_code == 201:
            _u = User.objects.filter(username=f'{P20}admin_created').first()
            sa_created_id = _u.id if _u else None

        # H2: Non-super-admin cannot use /api/admin/users/create/
        resp = _client.post(
            '/api/admin/users/create/',
            data=json.dumps({
                'username': f'{P20}should_fail',
                'email': f'{P20}fail@test.com',
                'password': 'Pass123!',
                'confirm_password': 'Pass123!',
                'role': 'STAFF',
            }),
            HTTP_AUTHORIZATION=f'Bearer {token_admin}',
            content_type='application/json',
        )
        check("H2: Non-super admin returns 403", resp.status_code == 403,
              f"got {resp.status_code}")

        # H3: Super admin can list all users via /api/users/
        resp = _client.get(
            '/api/users/',
            HTTP_AUTHORIZATION=f'Bearer {super_token}',
            content_type='application/json',
        )
        check("H3: Super admin list users returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
    else:
        print("  [SKIP] Super admin tests skipped — could not login")

    # ==================================================================
    # LEVEL I: CROSS-CUTTING
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL I: CROSS-CUTTING")
    print("=" * 70)

    # I1: Unauthenticated request to protected endpoint
    resp = _client.get('/api/users/', content_type='application/json')
    check("I1: Unauthenticated /api/users/ returns 401",
          resp.status_code == 401, f"got {resp.status_code}")

    # I2: Invalid token
    resp = _client.get(
        '/api/users/',
        HTTP_AUTHORIZATION='Bearer invalid.token.string',
        content_type='application/json',
    )
    check("I2: Invalid token returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # I3: School admin can only see users in their school
    # Admin A creates a user in school A, admin B should not see it
    resp_a = api_get('/api/users/', token_admin, SID_A)
    resp_b = api_get('/api/users/', token_admin_b, SID_B)
    if resp_a.status_code == 200 and resp_b.status_code == 200:
        users_a = resp_a.json().get('results', resp_a.json())
        users_b = resp_b.json().get('results', resp_b.json())
        if isinstance(users_a, list) and isinstance(users_b, list):
            a_ids = {u['id'] for u in users_a}
            b_ids = {u['id'] for u in users_b}
            # School A admin should not appear in School B admin's list
            admin_a_id = seed['users']['admin'].id
            check("I3: School isolation — admin A not in school B list",
                  admin_a_id not in b_ids,
                  f"admin_a_id={admin_a_id} found in B list")

    # I4: Login response includes schools array with modules
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{SEED_PREFIX}admin',
            'password': PASSWORD,
        }),
        content_type='application/json',
    )
    if resp.status_code == 200:
        user_data = resp.json().get('user', {})
        schools = user_data.get('schools', [])
        check("I4: Login user has schools array", len(schools) > 0)
        if schools:
            check("I5: School entry has enabled_modules",
                  'enabled_modules' in schools[0])

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
