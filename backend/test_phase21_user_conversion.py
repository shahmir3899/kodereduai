# -*- coding: utf-8 -*-
"""
Phase 21: User Conversion — Comprehensive API Test Suite.

Tests individual and bulk conversion of existing students and staff
to user accounts, plus role hierarchy enforcement.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase21_user_conversion.py', encoding='utf-8').read())"

What it tests:
    Level A: Student Individual Conversion (create-user-account per student)
    Level B: Student Bulk Conversion (bulk-create-accounts)
    Level C: Staff Individual Conversion (create-user-account per staff)
    Level D: Staff Bulk Conversion (bulk-create-accounts)
    Level E: Role Hierarchy Enforcement
    Level F: Serializer Fields (has_user_account, user_username)
    Level G: Edge Cases & Validation
    Level H: Cross-School Isolation

Roles tested:
    - SCHOOL_ADMIN: can convert students & staff
    - PRINCIPAL: can convert with limited role assignment
    - TEACHER: cannot convert (403)
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
from students.models import Student, StudentProfile
from hr.models import StaffMember

# Phase-specific prefix
P21 = "P21CONV_"

# ── Cleanup helper ───────────────────────────────────────────────────────────
def cleanup_p21():
    """Remove all phase 21 test artifacts."""
    # Remove StudentProfiles linked to P21 users
    StudentProfile.objects.filter(user__username__startswith=P21).delete()
    # Unlink staff from P21 users
    StaffMember.objects.filter(user__username__startswith=P21).update(user=None)
    # Remove memberships & users
    UserSchoolMembership.objects.filter(user__username__startswith=P21).delete()
    User.objects.filter(username__startswith=P21).delete()
    # Also remove auto-generated users from bulk (use seed prefix pattern)
    # These have names derived from student names like "seed_test_ali_hassan"
    User.objects.filter(username__startswith='seed_test_').delete()
    StudentProfile.objects.filter(user__username__startswith='seed_test_').delete()


try:
    # Clean up any leftover data from previous runs
    cleanup_p21()

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
    students = seed['students']
    staff_members = seed['staff']

    reset_counters()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 21 COMPREHENSIVE TEST SUITE — USER CONVERSION")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: STUDENT INDIVIDUAL CONVERSION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: STUDENT INDIVIDUAL CONVERSION")
    print("=" * 70)

    # Use first seed student (Ali Hassan) — should not have a user account yet
    target_student = students[0]

    # A1: Create user account for student — success
    resp = api_post(
        f'/api/students/{target_student.id}/create-user-account/',
        {
            'username': f'{P21}ali_student',
            'email': 'ali@test.com',
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_admin, SID_A,
    )
    check("A1: Create student user returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    if resp.status_code == 201:
        body = resp.json()
        check("A2: Response has user_id", 'user_id' in body)
        check("A3: Response has username", body.get('username') == f'{P21}ali_student')
        check("A4: Response has success message", 'message' in body)

    # A5: Verify user was actually created in DB
    user_exists = User.objects.filter(username=f'{P21}ali_student').exists()
    check("A5: User exists in DB", user_exists)

    # A6: Verify StudentProfile link
    if user_exists:
        user_obj = User.objects.get(username=f'{P21}ali_student')
        profile_exists = StudentProfile.objects.filter(user=user_obj, student=target_student).exists()
        check("A6: StudentProfile link created", profile_exists)

        # A7: Verify UserSchoolMembership
        membership = UserSchoolMembership.objects.filter(user=user_obj, school=school_a).first()
        check("A7: UserSchoolMembership created", membership is not None)
        if membership:
            check("A8: Membership role is STUDENT", membership.role == 'STUDENT')

    # A9: Second attempt on same student should fail (already has account)
    resp = api_post(
        f'/api/students/{target_student.id}/create-user-account/',
        {
            'username': f'{P21}ali_duplicate',
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_admin, SID_A,
    )
    check("A9: Duplicate convert returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # A10: Missing password returns 400
    target_student_2 = students[1]
    resp = api_post(
        f'/api/students/{target_student_2.id}/create-user-account/',
        {
            'username': f'{P21}no_password',
        },
        token_admin, SID_A,
    )
    check("A10: Missing password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # A11: Mismatched passwords returns 400
    resp = api_post(
        f'/api/students/{target_student_2.id}/create-user-account/',
        {
            'username': f'{P21}mismatch',
            'password': 'Student@123',
            'confirm_password': 'Different@123',
        },
        token_admin, SID_A,
    )
    check("A11: Mismatched passwords returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # A12: Short password returns 400
    resp = api_post(
        f'/api/students/{target_student_2.id}/create-user-account/',
        {
            'username': f'{P21}short_pw',
            'password': 'Short1',
            'confirm_password': 'Short1',
        },
        token_admin, SID_A,
    )
    check("A12: Short password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # A13: Duplicate username returns 400
    resp = api_post(
        f'/api/students/{target_student_2.id}/create-user-account/',
        {
            'username': f'{P21}ali_student',  # already used in A1
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_admin, SID_A,
    )
    check("A13: Duplicate username returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # A14: Teacher cannot convert students
    resp = api_post(
        f'/api/students/{target_student_2.id}/create-user-account/',
        {
            'username': f'{P21}teacher_attempt',
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_teacher, SID_A,
    )
    check("A14: Teacher convert returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # A15: Non-existent student returns 404
    resp = api_post(
        '/api/students/999999/create-user-account/',
        {
            'username': f'{P21}no_student',
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_admin, SID_A,
    )
    check("A15: Non-existent student returns 404", resp.status_code == 404,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: STUDENT BULK CONVERSION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: STUDENT BULK CONVERSION")
    print("=" * 70)

    # Pick students that don't have user accounts yet (skip student[0] which we converted in Level A)
    bulk_student_ids = [s.id for s in students[2:6]]  # 4 students

    # B1: Bulk create accounts — success
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': bulk_student_ids,
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("B1: Bulk create returns 200", resp.status_code == 200,
          f"got {resp.status_code} {resp.content[:300]}")
    if resp.status_code == 200:
        body = resp.json()
        check("B2: Has created_count field", 'created_count' in body)
        check("B3: Has skipped_count field", 'skipped_count' in body)
        check("B4: Has error_count field", 'error_count' in body)
        check("B5: Created count = 4", body.get('created_count') == 4,
              f"got {body.get('created_count')}")
        check("B6: Skipped count = 0", body.get('skipped_count') == 0,
              f"got {body.get('skipped_count')}")
        check("B7: Error count = 0", body.get('error_count') == 0,
              f"got {body.get('error_count')}")
        check("B8: created array has 4 items", len(body.get('created', [])) == 4,
              f"got {len(body.get('created', []))}")
        # B9: Each created item has required fields
        if body.get('created'):
            first = body['created'][0]
            check("B9: Created item has student_id", 'student_id' in first)
            check("B10: Created item has username", 'username' in first)
            check("B11: Created item has student_name", 'student_name' in first)

    # B12: Re-run bulk on same students (all should be skipped)
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': bulk_student_ids,
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("B12: Re-run bulk returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("B13: All skipped (created=0)", body.get('created_count') == 0,
              f"got {body.get('created_count')}")
        check("B14: Skipped = 4", body.get('skipped_count') == 4,
              f"got {body.get('skipped_count')}")

    # B15: Mixed — include already-converted + new student
    mixed_ids = [students[0].id, students[6].id]  # student[0] has account, student[6] doesn't
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': mixed_ids,
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("B15: Mixed bulk returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("B16: Created=1 for mixed batch", body.get('created_count') == 1,
              f"got {body.get('created_count')}")
        check("B17: Skipped=1 for mixed batch", body.get('skipped_count') == 1,
              f"got {body.get('skipped_count')}")

    # B18: Empty student_ids returns 400
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [],
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("B18: Empty student_ids returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # B19: Short password returns 400
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [students[7].id],
            'default_password': 'Short1',
        },
        token_admin, SID_A,
    )
    check("B19: Short bulk password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # B20: Teacher cannot do bulk conversion
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [students[8].id],
            'default_password': 'BulkPass@123',
        },
        token_teacher, SID_A,
    )
    check("B20: Teacher bulk convert returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: STAFF INDIVIDUAL CONVERSION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: STAFF INDIVIDUAL CONVERSION")
    print("=" * 70)

    # Seed staff all already have user accounts. Create a new staff member without one.
    new_staff = StaffMember.objects.create(
        school=school_a,
        user=None,
        first_name=f"{P21}Jane",
        last_name="Doe",
        employee_id=f"{P21}EMP001",
        department=seed['departments'][0],
        designation=seed['designations'][0],
        employment_status='ACTIVE',
        employment_type='FULL_TIME',
        date_of_joining=date(2024, 6, 1),
        email='jane.doe@test.com',
    )

    new_staff_2 = StaffMember.objects.create(
        school=school_a,
        user=None,
        first_name=f"{P21}John",
        last_name="Smith",
        employee_id=f"{P21}EMP002",
        department=seed['departments'][0],
        designation=seed['designations'][0],
        employment_status='ACTIVE',
        employment_type='FULL_TIME',
        date_of_joining=date(2024, 6, 1),
        email='john.smith@test.com',
    )

    # C1: Create user account for staff — success
    resp = api_post(
        f'/api/hr/staff/{new_staff.id}/create-user-account/',
        {
            'username': f'{P21}jane_teacher',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("C1: Create staff user returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    if resp.status_code == 201:
        body = resp.json()
        check("C2: Response has user_id", 'user_id' in body)
        check("C3: Response has username", body.get('username') == f'{P21}jane_teacher')

    # C4: Verify user in DB
    user_exists = User.objects.filter(username=f'{P21}jane_teacher').exists()
    check("C4: Staff user exists in DB", user_exists)

    # C5: Verify staff linked to user
    new_staff.refresh_from_db()
    check("C5: Staff.user is linked", new_staff.user is not None)

    # C6: Verify membership
    if user_exists:
        staff_user = User.objects.get(username=f'{P21}jane_teacher')
        membership = UserSchoolMembership.objects.filter(user=staff_user, school=school_a).first()
        check("C6: Membership created", membership is not None)
        if membership:
            check("C7: Membership role is TEACHER", membership.role == 'TEACHER')

    # C8: Can login with new staff credentials
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({
            'username': f'{P21}jane_teacher',
            'password': 'Teacher@123',
        }),
        content_type='application/json',
    )
    check("C8: Login with staff credentials succeeds", resp.status_code == 200,
          f"got {resp.status_code}")

    # C9: Duplicate convert on same staff returns 400
    resp = api_post(
        f'/api/hr/staff/{new_staff.id}/create-user-account/',
        {
            'username': f'{P21}jane_duplicate',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("C9: Duplicate staff convert returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # C10: Missing password
    resp = api_post(
        f'/api/hr/staff/{new_staff_2.id}/create-user-account/',
        {
            'username': f'{P21}no_pw_staff',
        },
        token_admin, SID_A,
    )
    check("C10: Missing password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # C11: Mismatched passwords
    resp = api_post(
        f'/api/hr/staff/{new_staff_2.id}/create-user-account/',
        {
            'username': f'{P21}mismatch_staff',
            'password': 'Teacher@123',
            'confirm_password': 'Wrong@123',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("C11: Mismatched passwords returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # C12: Short password
    resp = api_post(
        f'/api/hr/staff/{new_staff_2.id}/create-user-account/',
        {
            'username': f'{P21}short_staff',
            'password': 'Short1',
            'confirm_password': 'Short1',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("C12: Short password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # C13: Duplicate username
    resp = api_post(
        f'/api/hr/staff/{new_staff_2.id}/create-user-account/',
        {
            'username': f'{P21}jane_teacher',  # used in C1
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("C13: Duplicate username returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL D: STAFF BULK CONVERSION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: STAFF BULK CONVERSION")
    print("=" * 70)

    # Create several staff members without user accounts
    bulk_staff = []
    for i in range(1, 5):
        sm = StaffMember.objects.create(
            school=school_a,
            user=None,
            first_name=f"{P21}Bulk{i}",
            last_name=f"Staff{i}",
            employee_id=f"{P21}BEMP{i:03d}",
            department=seed['departments'][0],
            designation=seed['designations'][0],
            employment_status='ACTIVE',
            employment_type='FULL_TIME',
            date_of_joining=date(2024, 1, 1),
        )
        bulk_staff.append(sm)

    bulk_staff_ids = [s.id for s in bulk_staff]

    # D1: Bulk create staff accounts — success
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': bulk_staff_ids,
            'default_password': 'BulkStaff@123',
            'default_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("D1: Bulk staff create returns 200", resp.status_code == 200,
          f"got {resp.status_code} {resp.content[:300]}")
    if resp.status_code == 200:
        body = resp.json()
        check("D2: Has created_count", 'created_count' in body)
        check("D3: Created = 4", body.get('created_count') == 4,
              f"got {body.get('created_count')}")
        check("D4: Skipped = 0", body.get('skipped_count') == 0,
              f"got {body.get('skipped_count')}")
        check("D5: Errors = 0", body.get('error_count') == 0,
              f"got {body.get('error_count')}")
        if body.get('created'):
            first = body['created'][0]
            check("D6: Created item has staff_id", 'staff_id' in first)
            check("D7: Created item has username", 'username' in first)
            check("D8: Created item has name", 'name' in first)

    # D9: Verify staff members are now linked
    for sm in bulk_staff:
        sm.refresh_from_db()
    check("D9: All bulk staff have user linked",
          all(sm.user is not None for sm in bulk_staff),
          f"linked: {[sm.user_id for sm in bulk_staff]}")

    # D10: Can login with bulk-created credentials
    if bulk_staff[0].user:
        resp = _client.post(
            '/api/auth/login/',
            data=json.dumps({
                'username': bulk_staff[0].user.username,
                'password': 'BulkStaff@123',
            }),
            content_type='application/json',
        )
        check("D10: Login with bulk staff credentials", resp.status_code == 200,
              f"got {resp.status_code}")

    # D11: Re-run on same staff (all skipped)
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': bulk_staff_ids,
            'default_password': 'BulkStaff@123',
            'default_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("D11: Re-run bulk returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("D12: All skipped", body.get('skipped_count') == 4,
              f"got {body.get('skipped_count')}")
        check("D13: None created", body.get('created_count') == 0,
              f"got {body.get('created_count')}")

    # D14: Empty staff_ids returns 400
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': [],
            'default_password': 'BulkStaff@123',
            'default_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("D14: Empty staff_ids returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # D15: Short password returns 400
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': [new_staff_2.id],
            'default_password': 'Short1',
            'default_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("D15: Short bulk staff password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL E: ROLE HIERARCHY ENFORCEMENT
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: ROLE HIERARCHY ENFORCEMENT")
    print("=" * 70)

    # E1: Admin can assign TEACHER role to staff
    resp = api_post(
        f'/api/hr/staff/{new_staff_2.id}/create-user-account/',
        {
            'username': f'{P21}john_teacher',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("E1: Admin assigns TEACHER — 201", resp.status_code == 201,
          f"got {resp.status_code}")

    # Create new staff for hierarchy tests
    hierarchy_staff = []
    for i in range(1, 5):
        sm = StaffMember.objects.create(
            school=school_a,
            user=None,
            first_name=f"{P21}Hier{i}",
            last_name=f"Test{i}",
            employee_id=f"{P21}HEMP{i:03d}",
            department=seed['departments'][0],
            designation=seed['designations'][0],
            employment_status='ACTIVE',
            employment_type='FULL_TIME',
            date_of_joining=date(2024, 1, 1),
        )
        hierarchy_staff.append(sm)

    # E2: Principal can assign TEACHER (within hierarchy)
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[0].id}/create-user-account/',
        {
            'username': f'{P21}hier_teacher',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_principal, SID_A,
    )
    check("E2: Principal assigns TEACHER — 201", resp.status_code == 201,
          f"got {resp.status_code}")

    # E3: Principal cannot assign SCHOOL_ADMIN (above their level)
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[1].id}/create-user-account/',
        {
            'username': f'{P21}hier_admin_attempt',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'SCHOOL_ADMIN',
        },
        token_principal, SID_A,
    )
    check("E3: Principal cannot assign SCHOOL_ADMIN — 403",
          resp.status_code == 403, f"got {resp.status_code}")

    # E4: Principal cannot assign PRINCIPAL (own level — not in hierarchy)
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[1].id}/create-user-account/',
        {
            'username': f'{P21}hier_principal_attempt',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'PRINCIPAL',
        },
        token_principal, SID_A,
    )
    check("E4: Principal cannot assign PRINCIPAL — 403",
          resp.status_code == 403, f"got {resp.status_code}")

    # E5: Staff bulk — role hierarchy enforced
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': [hierarchy_staff[2].id],
            'default_password': 'BulkPass@123',
            'default_role': 'SCHOOL_ADMIN',
        },
        token_principal, SID_A,
    )
    check("E5: Bulk with SCHOOL_ADMIN role by principal — 403",
          resp.status_code == 403, f"got {resp.status_code}")

    # E6: Admin CAN assign PRINCIPAL
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[1].id}/create-user-account/',
        {
            'username': f'{P21}hier_principal_ok',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'PRINCIPAL',
        },
        token_admin, SID_A,
    )
    check("E6: Admin assigns PRINCIPAL — 201", resp.status_code == 201,
          f"got {resp.status_code}")

    # E7: Teacher cannot create staff accounts at all (should be 403)
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[2].id}/create-user-account/',
        {
            'username': f'{P21}teacher_attempt_staff',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'STAFF',
        },
        token_teacher, SID_A,
    )
    check("E7: Teacher cannot create staff account — 403",
          resp.status_code == 403, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL F: SERIALIZER FIELDS (has_user_account, user_username)
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: SERIALIZER FIELDS")
    print("=" * 70)

    # F1: List students — check has_user_account field
    resp = api_get('/api/students/', token_admin, SID_A)
    check("F1: List students returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        results = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(results, list) and len(results) > 0:
            first_student = results[0]
            check("F2: Student has has_user_account field",
                  'has_user_account' in first_student)
            check("F3: Student has user_username field",
                  'user_username' in first_student)

            # Find a student we converted — should have has_user_account=True
            converted = [s for s in results if s.get('id') == target_student.id]
            if converted:
                check("F4: Converted student has_user_account=True",
                      converted[0].get('has_user_account') is True)
                check("F5: Converted student has username",
                      converted[0].get('user_username') == f'{P21}ali_student')

            # Find a student we didn't convert — should have has_user_account=False
            unconverted = [s for s in results
                           if s.get('has_user_account') is False]
            if unconverted:
                check("F6: Non-converted student has_user_account=False", True)
                check("F7: Non-converted student user_username is None",
                      unconverted[0].get('user_username') is None)
            else:
                check("F6: Non-converted student has_user_account=False", False,
                      "no unconverted students found")
                check("F7: Non-converted student user_username is None", False,
                      "no unconverted students found")

    # F8: Staff list — check user fields
    resp = api_get('/api/hr/staff/', token_admin, SID_A)
    check("F8: List staff returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        results = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(results, list) and len(results) > 0:
            # Staff serializer has 'user' and 'user_username' fields
            first_staff_item = results[0]
            check("F9: Staff response has user field", 'user' in first_staff_item)
            check("F10: Staff response has user_username field",
                  'user_username' in first_staff_item)

    # ==================================================================
    # LEVEL G: EDGE CASES & VALIDATION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: EDGE CASES & VALIDATION")
    print("=" * 70)

    # G1: Bulk with non-existent student IDs (should be ignored, not error)
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [999997, 999998, 999999],
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("G1: Bulk with nonexistent IDs returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("G2: None created for nonexistent IDs", body.get('created_count') == 0)

    # G3: Missing default_password returns 400
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [students[8].id],
        },
        token_admin, SID_A,
    )
    check("G3: Missing bulk password returns 400", resp.status_code == 400,
          f"got {resp.status_code}")

    # G4: Staff bulk with non-existent IDs
    resp = api_post(
        '/api/hr/staff/bulk-create-accounts/',
        {
            'staff_ids': [999997, 999998],
            'default_password': 'BulkPass@123',
            'default_role': 'TEACHER',
        },
        token_admin, SID_A,
    )
    check("G4: Staff bulk with nonexistent IDs returns 200",
          resp.status_code == 200, f"got {resp.status_code}")

    # G5: Successfully convert remaining students for completeness
    remaining_ids = [s.id for s in students[7:10]]
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': remaining_ids,
            'default_password': 'BulkPass@123',
        },
        token_admin, SID_A,
    )
    check("G5: Convert remaining students returns 200",
          resp.status_code == 200, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL H: CROSS-SCHOOL ISOLATION
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL H: CROSS-SCHOOL ISOLATION")
    print("=" * 70)

    # H1: School B admin cannot convert School A students
    resp = api_post(
        f'/api/students/{students[8].id}/create-user-account/',
        {
            'username': f'{P21}cross_school_attempt',
            'password': 'Student@123',
            'confirm_password': 'Student@123',
        },
        token_admin_b, SID_B,
    )
    check("H1: School B admin cannot convert School A student — 404",
          resp.status_code == 404, f"got {resp.status_code}")

    # H2: School B admin bulk convert with School A student IDs
    resp = api_post(
        '/api/students/bulk-create-accounts/',
        {
            'student_ids': [students[8].id, students[9].id],
            'default_password': 'BulkPass@123',
        },
        token_admin_b, SID_B,
    )
    check("H2: Cross-school bulk returns 200 with 0 created",
          resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("H3: No cross-school students created",
              body.get('created_count') == 0,
              f"got {body.get('created_count')}")

    # H4: School B admin cannot convert School A staff
    resp = api_post(
        f'/api/hr/staff/{hierarchy_staff[2].id}/create-user-account/',
        {
            'username': f'{P21}cross_staff_attempt',
            'password': 'Teacher@123',
            'confirm_password': 'Teacher@123',
            'user_role': 'TEACHER',
        },
        token_admin_b, SID_B,
    )
    check("H4: School B admin cannot convert School A staff — 404",
          resp.status_code == 404, f"got {resp.status_code}")

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

finally:
    # Clean up phase 21 test data
    print("\n[P21 CLEANUP] Removing phase 21 test artifacts...")
    try:
        cleanup_p21()
        # Also clean up staff members created during tests
        StaffMember.objects.filter(employee_id__startswith=P21).delete()
        print("[P21 CLEANUP] Complete.")
    except Exception as e:
        print(f"[P21 CLEANUP] Error: {e}")

print("\nDone. Seed data preserved for further tests.")
