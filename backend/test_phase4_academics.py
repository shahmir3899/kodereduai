# -*- coding: utf-8 -*-
"""
Phase 4 Comprehensive Test Script — Academics & Timetable Module
=================================================================
Tests ALL Academics module features via HTTP API without disturbing existing data.
Everything created here is cleaned up at the end (or on failure).

Usage:
    cd backend
    python manage.py shell -c "exec(open('test_phase4_academics.py', encoding='utf-8').read())"

What it tests:
    Level A: Subjects API (CRUD, validation, search, permissions, school isolation)
    Level B: Timetable Slots API (CRUD, validation, ordering, permissions)
    Level C: Class-Subject Assignments API (CRUD, filters, teacher linkage, auto-AY)
    Level D: Timetable Entries API (CRUD, bulk_save, by_class grid, teacher conflicts)
    Level E: AI Features (auto_generate, quality_score, suggest_resolution, substitute,
             workload_analysis, gap_analysis, analytics)
    Level F: AI Chat (send, history, clear)
    Level G: Cross-cutting (unauth, invalid token, school isolation, data integrity)

Roles tested:
    - SCHOOL_ADMIN: full write access
    - PRINCIPAL: full write access
    - TEACHER: read-only (GET=200, POST/PATCH/DELETE=403)
"""

import json
import traceback
from datetime import date, time, timedelta
from django.test import Client
from django.conf import settings

# Allow Django test client's 'testserver' host
if 'testserver' not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS.append('testserver')

# --- Constants ---------------------------------------------------------------
TEST_PREFIX = "P4TEST_"  # All test objects use this prefix for easy cleanup
PASSWORD = "TestPass123!"

# Track all created objects for cleanup
created_objects = []


def track(obj):
    """Track an object for cleanup."""
    created_objects.append(obj)
    return obj


def cleanup():
    """Delete all tracked test objects in reverse order."""
    print("\n[CLEANUP] Removing all test data...")
    for obj in reversed(created_objects):
        try:
            obj_repr = repr(obj).encode('ascii', 'replace').decode('ascii')
            obj.delete()
            print(f"   Deleted: {obj_repr}")
        except Exception as e:
            err_msg = str(e).encode('ascii', 'replace').decode('ascii')
            print(f"   WARN: Failed to delete: {err_msg}")
    print("[CLEANUP] Complete. No test data remains.\n")


def run_tests():
    from schools.models import School, Organization, UserSchoolMembership
    from students.models import Class, Student
    from academic_sessions.models import AcademicYear, Term
    from academics.models import Subject, ClassSubject, TimetableSlot, TimetableEntry, AcademicsAIChatMessage
    from hr.models import StaffMember, StaffDepartment, StaffDesignation
    from django.contrib.auth import get_user_model
    User = get_user_model()

    client = Client()

    passed = 0
    failed = 0
    total = 0

    def check(test_name, condition, detail=""):
        nonlocal passed, failed, total
        total += 1
        if condition:
            passed += 1
            print(f"  [PASS] {test_name}")
        else:
            failed += 1
            print(f"  [FAIL] {test_name} {('- ' + detail) if detail else ''}")

    def api_get(url, token, school_id):
        return client.get(
            url,
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def api_post(url, data, token, school_id):
        return client.post(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def api_patch(url, data, token, school_id):
        return client.patch(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def api_delete(url, token, school_id):
        return client.delete(
            url,
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def safe_api_get(url, token, school_id):
        """GET that catches server errors gracefully."""
        try:
            return api_get(url, token, school_id)
        except Exception as e:
            class FakeResp:
                status_code = 500
                content = str(e).encode()[:200]
                def json(self): return {}
            return FakeResp()

    def login(username):
        """Get JWT access token for a user."""
        resp = client.post(
            '/api/auth/login/',
            data=json.dumps({'username': username, 'password': PASSWORD}),
            content_type='application/json',
        )
        if resp.status_code == 200:
            return resp.json().get('access')
        print(f"   LOGIN FAILED for {username}: {resp.status_code} {resp.content[:200]}")
        return None

    # ── Pre-cleanup: remove any leftover test data from previous failed runs ──
    print("\n[PRE-CLEANUP] Checking for leftover test data...")
    leftover_orgs = Organization.objects.filter(slug__startswith=TEST_PREFIX.lower().replace('_', '-'))
    if leftover_orgs.exists():
        print(f"   Found {leftover_orgs.count()} leftover org(s), deleting...")
        leftover_orgs.delete()
    leftover_users = User.objects.filter(username__startswith=TEST_PREFIX)
    if leftover_users.exists():
        print(f"   Found {leftover_users.count()} leftover user(s), deleting...")
        leftover_users.delete()
    leftover_classes = Class.objects.filter(name__startswith=TEST_PREFIX)
    if leftover_classes.exists():
        print(f"   Found {leftover_classes.count()} leftover class(es), deleting...")
        leftover_classes.delete()
    print("   Pre-cleanup done.")

    # ── Snapshot existing data counts for integrity check at end ──
    orig_subject_count = Subject.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    orig_slot_count = TimetableSlot.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    orig_cs_count = ClassSubject.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    orig_entry_count = TimetableEntry.objects.exclude(school__name__startswith=TEST_PREFIX).count()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 4 COMPREHENSIVE TEST SUITE — ACADEMICS & TIMETABLE")
    print("=" * 70)

    # ── SETUP: Create isolated test data ──────────────────────────────
    print("\n[SETUP] Creating isolated test data...")

    # Organization
    org = track(Organization.objects.create(
        name=f"{TEST_PREFIX}Org",
        slug=f"{TEST_PREFIX.lower().replace('_', '-')}org",
    ))
    print(f"   Org: {org.name} (id={org.id})")

    # Schools
    school_a = track(School.objects.create(
        organization=org,
        name=f"{TEST_PREFIX}School_Alpha",
        subdomain=f"{TEST_PREFIX.lower().replace('_', '-')}alpha",
    ))
    school_b = track(School.objects.create(
        organization=org,
        name=f"{TEST_PREFIX}School_Beta",
        subdomain=f"{TEST_PREFIX.lower().replace('_', '-')}beta",
    ))
    print(f"   School A: {school_a.name} (id={school_a.id})")
    print(f"   School B: {school_b.name} (id={school_b.id})")

    # Users
    admin_user = track(User.objects.create_user(
        username=f"{TEST_PREFIX}admin",
        email=f"{TEST_PREFIX}admin@test.com",
        password=PASSWORD,
        role='SCHOOL_ADMIN',
        school=school_a,
        organization=org,
    ))
    principal_user = track(User.objects.create_user(
        username=f"{TEST_PREFIX}principal",
        email=f"{TEST_PREFIX}principal@test.com",
        password=PASSWORD,
        role='PRINCIPAL',
        school=school_a,
        organization=org,
    ))
    teacher_user = track(User.objects.create_user(
        username=f"{TEST_PREFIX}teacher",
        email=f"{TEST_PREFIX}teacher@test.com",
        password=PASSWORD,
        role='TEACHER',
        school=school_a,
        organization=org,
    ))
    admin_b_user = track(User.objects.create_user(
        username=f"{TEST_PREFIX}admin_b",
        email=f"{TEST_PREFIX}admin_b@test.com",
        password=PASSWORD,
        role='SCHOOL_ADMIN',
        school=school_b,
        organization=org,
    ))
    print(f"   Users: admin, principal, teacher (School A) + admin_b (School B)")

    # Memberships
    mem_admin = track(UserSchoolMembership.objects.create(
        user=admin_user, school=school_a,
        role='SCHOOL_ADMIN', is_default=True,
    ))
    mem_principal = track(UserSchoolMembership.objects.create(
        user=principal_user, school=school_a,
        role='PRINCIPAL', is_default=True,
    ))
    mem_teacher = track(UserSchoolMembership.objects.create(
        user=teacher_user, school=school_a,
        role='TEACHER', is_default=True,
    ))
    mem_admin_b = track(UserSchoolMembership.objects.create(
        user=admin_b_user, school=school_b,
        role='SCHOOL_ADMIN', is_default=True,
    ))

    # Academic Year (current)
    academic_year = track(AcademicYear.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}2025-2026",
        start_date=date(2025, 4, 1),
        end_date=date(2026, 3, 31),
        is_current=True,
        is_active=True,
    ))
    print(f"   Academic Year: {academic_year.name} (id={academic_year.id})")

    # Classes
    class_1 = track(Class.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}Class_1A",
        section='A',
        grade_level=100,
    ))
    class_2 = track(Class.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}Class_2B",
        section='B',
        grade_level=101,
    ))
    class_3 = track(Class.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}Class_3C",
        section='C',
        grade_level=102,
    ))
    print(f"   Classes: {class_1.name}, {class_2.name}, {class_3.name}")

    # HR: Department, Designation, StaffMembers
    dept = track(StaffDepartment.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}Academic",
    ))
    desig = track(StaffDesignation.objects.create(
        school=school_a,
        name=f"{TEST_PREFIX}Teacher",
        department=dept,
    ))

    # Create teacher users for staff members
    teacher_user_1 = track(User.objects.create_user(
        username=f"{TEST_PREFIX}staff_teacher1",
        email=f"{TEST_PREFIX}t1@test.com",
        password=PASSWORD,
        role='TEACHER',
        school=school_a,
        organization=org,
    ))
    track(UserSchoolMembership.objects.create(
        user=teacher_user_1, school=school_a, role='TEACHER', is_default=True,
    ))
    teacher_user_2 = track(User.objects.create_user(
        username=f"{TEST_PREFIX}staff_teacher2",
        email=f"{TEST_PREFIX}t2@test.com",
        password=PASSWORD,
        role='TEACHER',
        school=school_a,
        organization=org,
    ))
    track(UserSchoolMembership.objects.create(
        user=teacher_user_2, school=school_a, role='TEACHER', is_default=True,
    ))
    teacher_user_3 = track(User.objects.create_user(
        username=f"{TEST_PREFIX}staff_teacher3",
        email=f"{TEST_PREFIX}t3@test.com",
        password=PASSWORD,
        role='TEACHER',
        school=school_a,
        organization=org,
    ))
    track(UserSchoolMembership.objects.create(
        user=teacher_user_3, school=school_a, role='TEACHER', is_default=True,
    ))

    staff_1 = track(StaffMember.objects.create(
        school=school_a,
        user=teacher_user_1,
        first_name=f"{TEST_PREFIX}Ali",
        last_name="Khan",
        employee_id=f"{TEST_PREFIX}T001",
        department=dept,
        designation=desig,
        employment_status='ACTIVE',
        employment_type='FULL_TIME',
        date_of_joining=date(2024, 1, 1),
    ))
    staff_2 = track(StaffMember.objects.create(
        school=school_a,
        user=teacher_user_2,
        first_name=f"{TEST_PREFIX}Sara",
        last_name="Ahmed",
        employee_id=f"{TEST_PREFIX}T002",
        department=dept,
        designation=desig,
        employment_status='ACTIVE',
        employment_type='FULL_TIME',
        date_of_joining=date(2024, 1, 1),
    ))
    staff_3 = track(StaffMember.objects.create(
        school=school_a,
        user=teacher_user_3,
        first_name=f"{TEST_PREFIX}Usman",
        last_name="Raza",
        employee_id=f"{TEST_PREFIX}T003",
        department=dept,
        designation=desig,
        employment_status='ACTIVE',
        employment_type='FULL_TIME',
        date_of_joining=date(2024, 1, 1),
    ))
    print(f"   Staff: {staff_1.full_name}, {staff_2.full_name}, {staff_3.full_name}")

    # Get JWT tokens
    print("\n[SETUP] Obtaining JWT tokens...")
    token_admin = login(f"{TEST_PREFIX}admin")
    token_principal = login(f"{TEST_PREFIX}principal")
    token_teacher = login(f"{TEST_PREFIX}teacher")
    token_admin_b = login(f"{TEST_PREFIX}admin_b")

    if not all([token_admin, token_principal, token_teacher, token_admin_b]):
        print("\n  [FATAL] Could not obtain all JWT tokens. Aborting.")
        cleanup()
        return

    print("   All 4 tokens obtained successfully.")
    SID_A = school_a.id
    SID_B = school_b.id

    # ==================================================================
    # LEVEL A: SUBJECTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: SUBJECTS API")
    print("=" * 70)

    # Helper: get subject ID by code (since create serializer doesn't return id)
    def get_subject_id(code):
        obj = Subject.objects.filter(school=school_a, code=code.upper()).first()
        return obj.id if obj else None

    def get_slot_id(order):
        obj = TimetableSlot.objects.filter(school=school_a, order=order).first()
        return obj.id if obj else None

    def get_cs_id(class_obj_id, subject_id):
        obj = ClassSubject.objects.filter(school=school_a, class_obj_id=class_obj_id, subject_id=subject_id, is_active=True).first()
        return obj.id if obj else None

    # A1: Create subject (Admin)
    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}Mathematics',
        'code': 'math',
        'description': 'Core math subject',
        'is_elective': False,
    }, token_admin, SID_A)
    check("A1  Create subject (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    subj_math_id = get_subject_id('MATH')

    # A2: Create subject (Principal)
    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}English',
        'code': 'eng',
        'description': 'English language',
        'is_elective': False,
    }, token_principal, SID_A)
    check("A2  Create subject (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    subj_eng_id = get_subject_id('ENG')

    # A3: Create subject (Teacher - should be 403)
    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}Physics',
        'code': 'phy',
    }, token_teacher, SID_A)
    check("A3  Create subject (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # A4: Duplicate code -> 400
    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}Math 2',
        'code': 'MATH',
    }, token_admin, SID_A)
    check("A4  Duplicate code -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # A5: Missing required fields -> 400
    resp = api_post('/api/academics/subjects/', {
        'description': 'no name or code',
    }, token_admin, SID_A)
    check("A5  Missing required fields -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # Create more subjects for testing
    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}Science',
        'code': 'sci',
        'is_elective': False,
    }, token_admin, SID_A)
    subj_sci_id = get_subject_id('SCI')

    resp = api_post('/api/academics/subjects/', {
        'name': f'{TEST_PREFIX}Art',
        'code': 'art',
        'is_elective': True,
    }, token_admin, SID_A)
    subj_art_id = get_subject_id('ART')

    # A6: List subjects
    resp = api_get('/api/academics/subjects/', token_admin, SID_A)
    subjects = resp.json() if resp.status_code == 200 else []
    test_subjects = [s for s in subjects if s.get('name', '').startswith(TEST_PREFIX)]
    check("A6  List subjects", resp.status_code == 200 and len(test_subjects) >= 4,
          f"status={resp.status_code} count={len(test_subjects)}")

    # A7: Search by name
    resp = api_get(f'/api/academics/subjects/?search={TEST_PREFIX}Math', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("A7  Search subjects by name", resp.status_code == 200 and len(results) >= 1,
          f"status={resp.status_code} count={len(results)}")

    # A8: Filter elective
    resp = api_get('/api/academics/subjects/?is_elective=true', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    test_electives = [s for s in results if s.get('name', '').startswith(TEST_PREFIX)]
    check("A8  Filter elective subjects", resp.status_code == 200 and len(test_electives) >= 1,
          f"status={resp.status_code} count={len(test_electives)}")

    # A9: Retrieve single subject
    if subj_math_id:
        resp = api_get(f'/api/academics/subjects/{subj_math_id}/', token_admin, SID_A)
        check("A9  Retrieve single subject", resp.status_code == 200 and resp.json().get('code') == 'MATH',
              f"status={resp.status_code}")
    else:
        check("A9  Retrieve single subject", False, "no subject id")

    # A10: Update subject (Admin)
    if subj_math_id:
        resp = api_patch(f'/api/academics/subjects/{subj_math_id}/', {
            'description': 'Updated math description',
        }, token_admin, SID_A)
        check("A10 Update subject (Admin)", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("A10 Update subject (Admin)", False, "no subject id")

    # A11: Update subject (Principal)
    if subj_eng_id:
        resp = api_patch(f'/api/academics/subjects/{subj_eng_id}/', {
            'description': 'Updated english description',
        }, token_principal, SID_A)
        check("A11 Update subject (Principal)", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("A11 Update subject (Principal)", False, "no subject id")

    # A12: Soft-delete subject
    if subj_art_id:
        resp = api_delete(f'/api/academics/subjects/{subj_art_id}/', token_admin, SID_A)
        check("A12 Soft-delete subject", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        # Verify soft delete (should still exist in DB but is_active=False)
        art_obj = Subject.objects.filter(id=subj_art_id).first()
        check("A12b Soft-delete sets is_active=False",
              art_obj is not None and art_obj.is_active == False,
              f"is_active={art_obj.is_active if art_obj else 'N/A'}")
    else:
        check("A12 Soft-delete subject", False, "no subject id")

    # A13: Code auto-uppercased
    if subj_math_id:
        resp = api_get(f'/api/academics/subjects/{subj_math_id}/', token_admin, SID_A)
        code = resp.json().get('code', '') if resp.status_code == 200 else ''
        check("A13 Code auto-uppercased", code == 'MATH', f"code={code}")
    else:
        check("A13 Code auto-uppercased", False, "no subject id")

    # A14: School B can't see School A subjects
    resp = api_get('/api/academics/subjects/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_b = [s for s in results if s.get('name', '').startswith(TEST_PREFIX)]
    check("A14 School B isolation (empty)", resp.status_code == 200 and len(test_b) == 0,
          f"status={resp.status_code} count={len(test_b)}")

    # ==================================================================
    # LEVEL B: TIMETABLE SLOTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: TIMETABLE SLOTS API")
    print("=" * 70)

    # B1: Create PERIOD slot (Admin)
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Period 1',
        'slot_type': 'PERIOD',
        'start_time': '08:00',
        'end_time': '08:45',
        'order': 901,
    }, token_admin, SID_A)
    check("B1  Create PERIOD slot (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    slot_p1_id = get_slot_id(901)

    # B2: Create BREAK slot (Principal)
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Break',
        'slot_type': 'BREAK',
        'start_time': '08:45',
        'end_time': '09:00',
        'order': 902,
    }, token_principal, SID_A)
    check("B2  Create BREAK slot (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    slot_break_id = get_slot_id(902)

    # B3: Create LUNCH slot
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Lunch',
        'slot_type': 'LUNCH',
        'start_time': '12:00',
        'end_time': '12:30',
        'order': 906,
    }, token_admin, SID_A)
    check("B3  Create LUNCH slot", resp.status_code == 201,
          f"status={resp.status_code}")
    slot_lunch_id = get_slot_id(906)

    # B4: Create ASSEMBLY slot
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Assembly',
        'slot_type': 'ASSEMBLY',
        'start_time': '07:45',
        'end_time': '08:00',
        'order': 900,
    }, token_admin, SID_A)
    check("B4  Create ASSEMBLY slot", resp.status_code == 201,
          f"status={resp.status_code}")
    slot_assembly_id = get_slot_id(900)

    # B5: Create slot (Teacher) -> 403
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Illegal',
        'slot_type': 'PERIOD',
        'start_time': '14:00',
        'end_time': '14:45',
        'order': 999,
    }, token_teacher, SID_A)
    check("B5  Create slot (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # B6: Duplicate order -> 400
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Duplicate Order',
        'slot_type': 'PERIOD',
        'start_time': '09:00',
        'end_time': '09:45',
        'order': 901,  # same as slot_p1
    }, token_admin, SID_A)
    check("B6  Duplicate order -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # B7: end_time <= start_time -> 400
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}BadTimes',
        'slot_type': 'PERIOD',
        'start_time': '10:00',
        'end_time': '09:00',
        'order': 950,
    }, token_admin, SID_A)
    check("B7  end_time <= start_time -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # Create additional period slots for timetable testing
    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Period 2',
        'slot_type': 'PERIOD',
        'start_time': '09:00',
        'end_time': '09:45',
        'order': 903,
    }, token_admin, SID_A)
    slot_p2_id = get_slot_id(903)

    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Period 3',
        'slot_type': 'PERIOD',
        'start_time': '09:45',
        'end_time': '10:30',
        'order': 904,
    }, token_admin, SID_A)
    slot_p3_id = get_slot_id(904)

    resp = api_post('/api/academics/timetable-slots/', {
        'name': f'{TEST_PREFIX}Period 4',
        'slot_type': 'PERIOD',
        'start_time': '10:30',
        'end_time': '11:15',
        'order': 905,
    }, token_admin, SID_A)
    slot_p4_id = get_slot_id(905)

    # B8: List slots (ordered by order)
    resp = api_get('/api/academics/timetable-slots/', token_admin, SID_A)
    slots = resp.json() if resp.status_code == 200 else []
    test_slots = [s for s in slots if s.get('name', '').startswith(TEST_PREFIX)]
    orders = [s['order'] for s in test_slots]
    check("B8  List slots (correct order)", resp.status_code == 200 and orders == sorted(orders),
          f"status={resp.status_code} orders={orders}")

    # B9: Update slot
    if slot_p1_id:
        resp = api_patch(f'/api/academics/timetable-slots/{slot_p1_id}/', {
            'name': f'{TEST_PREFIX}Period 1 Updated',
        }, token_admin, SID_A)
        check("B9  Update slot", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("B9  Update slot", False, "no slot id")

    # B10: Soft-delete slot
    if slot_assembly_id:
        resp = api_delete(f'/api/academics/timetable-slots/{slot_assembly_id}/', token_admin, SID_A)
        check("B10 Soft-delete slot", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        slot_obj = TimetableSlot.objects.filter(id=slot_assembly_id).first()
        check("B10b Soft-delete sets is_active=False",
              slot_obj is not None and slot_obj.is_active == False,
              f"is_active={slot_obj.is_active if slot_obj else 'N/A'}")
    else:
        check("B10 Soft-delete slot", False, "no slot id")

    # B11: School isolation
    resp = api_get('/api/academics/timetable-slots/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_b_slots = [s for s in results if s.get('name', '').startswith(TEST_PREFIX)]
    check("B11 School B isolation (empty)", resp.status_code == 200 and len(test_b_slots) == 0,
          f"status={resp.status_code} count={len(test_b_slots)}")

    # ==================================================================
    # LEVEL C: CLASS-SUBJECT ASSIGNMENTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: CLASS-SUBJECT ASSIGNMENTS API")
    print("=" * 70)

    # C1: Assign subject to class without teacher (Admin)
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_1.id,
        'subject': subj_math_id,
        'periods_per_week': 5,
    }, token_admin, SID_A)
    check("C1  Assign subject without teacher (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    cs_math_1_id = get_cs_id(class_1.id, subj_math_id)

    # C2: Assign subject with teacher (Principal)
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_1.id,
        'subject': subj_eng_id,
        'teacher': staff_1.id,
        'periods_per_week': 4,
    }, token_principal, SID_A)
    check("C2  Assign subject with teacher (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    cs_eng_1_id = get_cs_id(class_1.id, subj_eng_id)

    # C3: Assign subject (Teacher) -> 403
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_2.id,
        'subject': subj_math_id,
    }, token_teacher, SID_A)
    check("C3  Assign subject (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # C4: Duplicate assignment -> 400
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_1.id,
        'subject': subj_math_id,
    }, token_admin, SID_A)
    check("C4  Duplicate assignment -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # C5: Set periods_per_week
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_1.id,
        'subject': subj_sci_id,
        'teacher': staff_2.id,
        'periods_per_week': 3,
    }, token_admin, SID_A)
    check("C5  Set periods_per_week", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    cs_sci_1_id = get_cs_id(class_1.id, subj_sci_id)
    if cs_sci_1_id:
        cs_obj = ClassSubject.objects.get(id=cs_sci_1_id)
        check("C5b periods_per_week saved", cs_obj.periods_per_week == 3,
              f"periods={cs_obj.periods_per_week}")

    # Assign subjects to class_2 for later timetable tests
    api_post('/api/academics/class-subjects/', {
        'class_obj': class_2.id,
        'subject': subj_math_id,
        'teacher': staff_2.id,
        'periods_per_week': 5,
    }, token_admin, SID_A)
    api_post('/api/academics/class-subjects/', {
        'class_obj': class_2.id,
        'subject': subj_eng_id,
        'teacher': staff_3.id,
        'periods_per_week': 4,
    }, token_admin, SID_A)

    # C6: List assignments (check computed fields)
    resp = api_get('/api/academics/class-subjects/', token_admin, SID_A)
    assignments = resp.json() if resp.status_code == 200 else []
    test_assignments = [a for a in assignments if a.get('class_name', '').startswith(TEST_PREFIX)]
    has_computed = False
    if test_assignments:
        a = test_assignments[0]
        has_computed = 'class_name' in a and 'subject_name' in a and 'teacher_name' in a
    check("C6  List assignments (computed fields)", resp.status_code == 200 and has_computed,
          f"status={resp.status_code} count={len(test_assignments)}")

    # C7: Filter by class
    resp = api_get(f'/api/academics/class-subjects/?class_obj={class_1.id}', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("C7  Filter by class", resp.status_code == 200 and len(results) >= 3,
          f"status={resp.status_code} count={len(results)}")

    # C8: by_class action
    resp = api_get(f'/api/academics/class-subjects/by_class/?class_id={class_1.id}', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("C8  by_class action", resp.status_code == 200 and len(results) >= 3,
          f"status={resp.status_code} count={len(results)}")

    # C9: Update teacher assignment
    if cs_math_1_id:
        resp = api_patch(f'/api/academics/class-subjects/{cs_math_1_id}/', {
            'teacher': staff_3.id,
        }, token_admin, SID_A)
        check("C9  Update teacher assignment", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("C9  Update teacher assignment", False, "no cs id")

    # C10: Update periods_per_week
    if cs_math_1_id:
        resp = api_patch(f'/api/academics/class-subjects/{cs_math_1_id}/', {
            'periods_per_week': 6,
        }, token_admin, SID_A)
        check("C10 Update periods_per_week", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("C10 Update periods_per_week", False, "no cs id")

    # C11: Soft-delete assignment
    # Create a temp one to delete
    resp = api_post('/api/academics/class-subjects/', {
        'class_obj': class_3.id,
        'subject': subj_math_id,
    }, token_admin, SID_A)
    temp_cs_id = get_cs_id(class_3.id, subj_math_id)
    if temp_cs_id:
        resp = api_delete(f'/api/academics/class-subjects/{temp_cs_id}/', token_admin, SID_A)
        check("C11 Soft-delete assignment", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        cs_obj = ClassSubject.objects.filter(id=temp_cs_id).first()
        check("C11b Soft-delete sets is_active=False",
              cs_obj is not None and cs_obj.is_active == False,
              f"is_active={cs_obj.is_active if cs_obj else 'N/A'}")
    else:
        check("C11 Soft-delete assignment", False, "creation failed")

    # C12: Auto-resolves current academic year
    if cs_math_1_id:
        cs_obj = ClassSubject.objects.filter(id=cs_math_1_id).first()
        check("C12 Auto-resolves academic year",
              cs_obj is not None and cs_obj.academic_year_id == academic_year.id,
              f"ay_id={cs_obj.academic_year_id if cs_obj else 'N/A'} expected={academic_year.id}")
    else:
        check("C12 Auto-resolves academic year", False, "no cs id")

    # C13: School isolation
    resp = api_get('/api/academics/class-subjects/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_b_cs = [c for c in results if c.get('class_name', '').startswith(TEST_PREFIX)]
    check("C13 School B isolation (empty)", resp.status_code == 200 and len(test_b_cs) == 0,
          f"status={resp.status_code} count={len(test_b_cs)}")

    # ==================================================================
    # LEVEL D: TIMETABLE ENTRIES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: TIMETABLE ENTRIES API")
    print("=" * 70)

    def get_entry_id(class_obj_id, day, slot_id):
        obj = TimetableEntry.objects.filter(
            school=school_a, class_obj_id=class_obj_id, day=day, slot_id=slot_id
        ).first()
        return obj.id if obj else None

    # D1: Create single entry (Admin)
    if slot_p1_id and subj_math_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_p1_id,
            'subject': subj_math_id,
            'teacher': staff_3.id,
            'room': 'Room 101',
        }, token_admin, SID_A)
        check("D1  Create single entry (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
        entry_1_id = get_entry_id(class_1.id, 'MON', slot_p1_id)
    else:
        check("D1  Create single entry (Admin)", False, "missing ids")
        entry_1_id = None

    # D2: Create single entry (Principal)
    if slot_p2_id and subj_eng_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_p2_id,
            'subject': subj_eng_id,
            'teacher': staff_1.id,
        }, token_principal, SID_A)
        check("D2  Create single entry (Principal)", resp.status_code == 201,
              f"status={resp.status_code}")
        entry_2_id = get_entry_id(class_1.id, 'MON', slot_p2_id)
    else:
        check("D2  Create single entry (Principal)", False, "missing ids")
        entry_2_id = None

    # D3: Create entry (Teacher) -> 403
    if slot_p3_id and subj_sci_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_p3_id,
            'subject': subj_sci_id,
        }, token_teacher, SID_A)
        check("D3  Create entry (Teacher) -> 403", resp.status_code == 403,
              f"status={resp.status_code}")
    else:
        check("D3  Create entry (Teacher) -> 403", False, "missing ids")

    # D4: Duplicate class+day+slot -> 400
    if slot_p1_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_p1_id,
            'subject': subj_eng_id,
        }, token_admin, SID_A)
        check("D4  Duplicate class+day+slot -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("D4  Duplicate class+day+slot -> 400", False, "missing slot id")

    # D5: Teacher conflict (same teacher, same day+slot, different class)
    if slot_p1_id and subj_math_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_2.id,
            'day': 'MON',
            'slot': slot_p1_id,
            'subject': subj_math_id,
            'teacher': staff_3.id,  # staff_3 already in class_1 MON slot_p1
        }, token_admin, SID_A)
        check("D5  Teacher conflict -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("D5  Teacher conflict -> 400", False, "missing ids")

    # D6: Get timetable by_class
    resp = api_get(f'/api/academics/timetable-entries/by_class/?class_id={class_1.id}',
                   token_admin, SID_A)
    if resp.status_code == 200:
        data = resp.json()
        has_grid = 'grid' in data and 'entries' in data
        check("D6  by_class grid structure", has_grid,
              f"keys={list(data.keys())}")
    else:
        check("D6  by_class grid structure", False, f"status={resp.status_code}")

    # D7: Bulk save Tuesday entries
    if all([slot_p1_id, slot_p2_id, slot_p3_id, subj_math_id, subj_eng_id, subj_sci_id]):
        resp = api_post('/api/academics/timetable-entries/bulk_save/', {
            'class_obj': class_1.id,
            'day': 'TUE',
            'entries': [
                {'slot': slot_p1_id, 'subject': subj_eng_id, 'teacher': staff_1.id, 'room': 'R1'},
                {'slot': slot_p2_id, 'subject': subj_math_id, 'teacher': staff_3.id, 'room': 'R2'},
                {'slot': slot_p3_id, 'subject': subj_sci_id, 'teacher': staff_2.id, 'room': 'R3'},
            ],
        }, token_admin, SID_A)
        check("D7  Bulk save Tuesday entries", resp.status_code == 200,
              f"status={resp.status_code} body={resp.content[:200]}")
        if resp.status_code == 200:
            check("D7b Correct created count", resp.json().get('created') == 3,
                  f"created={resp.json().get('created')}")
    else:
        check("D7  Bulk save Tuesday entries", False, "missing ids")

    # D8: Bulk save overwrites existing (same day)
    if all([slot_p1_id, subj_sci_id]):
        resp = api_post('/api/academics/timetable-entries/bulk_save/', {
            'class_obj': class_1.id,
            'day': 'TUE',
            'entries': [
                {'slot': slot_p1_id, 'subject': subj_sci_id, 'teacher': staff_2.id},
            ],
        }, token_admin, SID_A)
        check("D8  Bulk save overwrites", resp.status_code == 200 and resp.json().get('created') == 1,
              f"status={resp.status_code}")
        # Verify old TUE entries for class_1 are gone
        tue_count = TimetableEntry.objects.filter(
            school=school_a, class_obj=class_1, day='TUE'
        ).count()
        check("D8b Old entries deleted", tue_count == 1, f"tue_count={tue_count}")
    else:
        check("D8  Bulk save overwrites", False, "missing ids")

    # D9: Check teacher conflicts
    if slot_p1_id:
        resp = api_get(
            f'/api/academics/timetable-entries/teacher_conflicts/'
            f'?teacher={staff_3.id}&day=MON&slot={slot_p1_id}&exclude_class={class_2.id}',
            token_admin, SID_A
        )
        check("D9  Check teacher conflicts (has_conflict=true)",
              resp.status_code == 200 and resp.json().get('has_conflict') == True,
              f"status={resp.status_code} data={resp.content[:200]}")
    else:
        check("D9  Check teacher conflicts", False, "missing ids")

    # D10: No conflict when teacher is free
    if slot_p3_id:
        resp = api_get(
            f'/api/academics/timetable-entries/teacher_conflicts/'
            f'?teacher={staff_3.id}&day=WED&slot={slot_p3_id}',
            token_admin, SID_A
        )
        check("D10 No conflict when free",
              resp.status_code == 200 and resp.json().get('has_conflict') == False,
              f"status={resp.status_code}")
    else:
        check("D10 No conflict when free", False, "missing ids")

    # D11: Entry with room number
    if entry_1_id:
        obj = TimetableEntry.objects.filter(id=entry_1_id).first()
        check("D11 Entry has room", obj is not None and obj.room == 'Room 101',
              f"room={obj.room if obj else 'N/A'}")
    else:
        check("D11 Entry has room", False, "no entry id")

    # D12: Entry without subject (break slot)
    if slot_break_id:
        resp = api_post('/api/academics/timetable-entries/', {
            'class_obj': class_1.id,
            'day': 'MON',
            'slot': slot_break_id,
        }, token_admin, SID_A)
        check("D12 Entry without subject (break)", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("D12 Entry without subject (break)", False, "no break slot id")

    # D13: School isolation
    resp = api_get(f'/api/academics/timetable-entries/by_class/?class_id={class_1.id}',
                   token_admin_b, SID_B)
    if resp.status_code == 200:
        entries = resp.json().get('entries', [])
        check("D13 School B can't see A's timetable", len(entries) == 0,
              f"count={len(entries)}")
    else:
        check("D13 School B can't see A's timetable", resp.status_code == 200,
              f"status={resp.status_code}")

    # ==================================================================
    # LEVEL E: AI FEATURES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: AI FEATURES API")
    print("=" * 70)

    # E1: Auto-generate timetable
    resp = api_post('/api/academics/timetable-entries/auto_generate/', {
        'class_id': class_2.id,
    }, token_admin, SID_A)
    check("E1  Auto-generate timetable", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")
    if resp.status_code == 200:
        data = resp.json()
        check("E1b Has grid+score+warnings",
              'grid' in data and 'score' in data and 'warnings' in data,
              f"keys={list(data.keys())}")

    # E2: Quality score
    resp = api_get(f'/api/academics/timetable-entries/quality_score/?class_id={class_1.id}',
                   token_admin, SID_A)
    check("E2  Quality score", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")
    if resp.status_code == 200:
        data = resp.json()
        check("E2b Has expected metrics",
              'overall_score' in data and 'constraint_satisfaction' in data,
              f"keys={list(data.keys())}")

    # E3: Suggest conflict resolution
    if slot_p1_id:
        resp = api_get(
            f'/api/academics/timetable-entries/suggest_resolution/'
            f'?teacher={staff_3.id}&day=MON&slot={slot_p1_id}&class_id={class_2.id}'
            f'&subject={subj_math_id}',
            token_admin, SID_A
        )
        check("E3  Suggest conflict resolution", resp.status_code == 200,
              f"status={resp.status_code} body={resp.content[:300]}")
        if resp.status_code == 200:
            data = resp.json()
            check("E3b Has expected keys",
                  'alternative_teachers' in data or 'alternative_slots' in data,
                  f"keys={list(data.keys())}")
    else:
        check("E3  Suggest conflict resolution", False, "missing ids")

    # E4: Suggest substitute teacher
    resp = api_get(
        f'/api/academics/timetable-entries/suggest_substitute/'
        f'?teacher={staff_1.id}&date=2025-06-15',
        token_admin, SID_A
    )
    check("E4  Suggest substitute", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")

    # E5: Workload analysis
    resp = api_get('/api/academics/class-subjects/workload_analysis/',
                   token_admin, SID_A)
    check("E5  Workload analysis", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")

    # E6: Curriculum gap analysis
    resp = api_get('/api/academics/subjects/gap_analysis/',
                   token_admin, SID_A)
    check("E6  Gap analysis", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")

    # E7: Analytics overview
    resp = safe_api_get('/api/academics/analytics/?type=overview',
                        token_admin, SID_A)
    check("E7  Analytics overview", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")

    # E8: Analytics with date range
    resp = safe_api_get('/api/academics/analytics/?date_from=2025-01-01&date_to=2025-12-31',
                        token_admin, SID_A)
    check("E8  Analytics with date range", resp.status_code == 200,
          f"status={resp.status_code}")

    # ==================================================================
    # LEVEL F: AI CHAT API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: AI CHAT API")
    print("=" * 70)

    # F1: Send chat message
    resp = api_post('/api/academics/ai-chat/', {
        'message': 'How many subjects are assigned to classes?',
    }, token_admin, SID_A)
    check("F1  Send chat message", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:300]}")
    if resp.status_code == 200:
        data = resp.json()
        check("F1b Has response and message",
              'response' in data and 'message' in data,
              f"keys={list(data.keys())}")

    # F2: Get chat history
    resp = api_get('/api/academics/ai-chat/', token_admin, SID_A)
    check("F2  Get chat history", resp.status_code == 200,
          f"status={resp.status_code}")
    if resp.status_code == 200:
        history = resp.json()
        check("F2b History has messages", len(history) >= 2,
              f"count={len(history)}")

    # F3: Clear chat history
    resp = api_delete('/api/academics/ai-chat/', token_admin, SID_A)
    check("F3  Clear chat history", resp.status_code == 200,
          f"status={resp.status_code}")

    # F4: History empty after clear
    resp = api_get('/api/academics/ai-chat/', token_admin, SID_A)
    if resp.status_code == 200:
        history = resp.json()
        check("F4  History empty after clear", len(history) == 0,
              f"count={len(history)}")
    else:
        check("F4  History empty after clear", False, f"status={resp.status_code}")

    # ==================================================================
    # LEVEL G: CROSS-CUTTING TESTS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: CROSS-CUTTING TESTS")
    print("=" * 70)

    # G1: Unauthenticated request -> 401
    resp = client.get('/api/academics/subjects/', content_type='application/json')
    check("G1  Unauthenticated -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # G2: Invalid token -> 401
    resp = client.get(
        '/api/academics/subjects/',
        HTTP_AUTHORIZATION='Bearer invalidtoken123',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("G2  Invalid token -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # G3: Admin A using School B header -> should see no test data
    resp = api_get('/api/academics/subjects/', token_admin, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_b = [s for s in results if s.get('name', '').startswith(TEST_PREFIX)]
    check("G3  Wrong school header -> no data", len(test_in_b) == 0,
          f"count={len(test_in_b)}")

    # G4: Data integrity (original data untouched)
    final_subject_count = Subject.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    final_slot_count = TimetableSlot.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    final_cs_count = ClassSubject.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    final_entry_count = TimetableEntry.objects.exclude(school__name__startswith=TEST_PREFIX).count()
    check("G4a Original subjects untouched", final_subject_count == orig_subject_count,
          f"before={orig_subject_count} after={final_subject_count}")
    check("G4b Original slots untouched", final_slot_count == orig_slot_count,
          f"before={orig_slot_count} after={final_slot_count}")
    check("G4c Original class-subjects untouched", final_cs_count == orig_cs_count,
          f"before={orig_cs_count} after={final_cs_count}")
    check("G4d Original entries untouched", final_entry_count == orig_entry_count,
          f"before={orig_entry_count} after={final_entry_count}")

    # Teacher read-only verification (bonus)
    print("\n  -- Teacher read-only bonus checks --")
    resp = api_get('/api/academics/subjects/', token_teacher, SID_A)
    check("G5  Teacher can READ subjects", resp.status_code == 200,
          f"status={resp.status_code}")
    resp = api_get('/api/academics/timetable-slots/', token_teacher, SID_A)
    check("G6  Teacher can READ slots", resp.status_code == 200,
          f"status={resp.status_code}")
    resp = api_get('/api/academics/class-subjects/', token_teacher, SID_A)
    check("G7  Teacher can READ class-subjects", resp.status_code == 200,
          f"status={resp.status_code}")
    if slot_p1_id:
        resp = api_patch(f'/api/academics/timetable-slots/{slot_p1_id}/', {
            'name': 'Hacked',
        }, token_teacher, SID_A)
        check("G8  Teacher can't PATCH slot -> 403", resp.status_code == 403,
              f"status={resp.status_code}")
    if cs_math_1_id:
        resp = api_delete(f'/api/academics/class-subjects/{cs_math_1_id}/', token_teacher, SID_A)
        check("G9  Teacher can't DELETE assignment -> 403", resp.status_code == 403,
              f"status={resp.status_code}")

    # ==================================================================
    # RESULTS
    # ==================================================================
    print("\n" + "=" * 70)
    print(f"  RESULTS: {passed} passed / {failed} failed / {total} total")
    if failed == 0:
        print("  ALL TESTS PASSED!")
    else:
        print(f"  {failed} TEST(S) FAILED — review output above")
    print("=" * 70)

    return passed, failed, total


# ── Main ──────────────────────────────────────────────────────────────────────

try:
    passed, failed, total = run_tests()
except Exception as e:
    print(f"\n[FATAL] Unhandled exception:\n{traceback.format_exc()}")
finally:
    cleanup()
    print("Done.")
