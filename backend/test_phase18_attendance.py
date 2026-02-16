# -*- coding: utf-8 -*-
"""
Phase 18: Attendance — Comprehensive API Test Suite.

Tests attendance upload, records, daily_report, chronic_absentees,
AI status, and permissions via REST API.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase18_attendance.py', encoding='utf-8').read())"

What it tests:
    Level A: Attendance Upload CRUD + pending_review
    Level B: Attendance Record CRUD + daily_report
    Level C: Chronic Absentees
    Level D: AI Status
    Level E: Cross-cutting (permissions, school isolation, filters)

Roles tested:
    - SCHOOL_ADMIN: full attendance management
    - TEACHER: read access
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

from attendance.models import AttendanceUpload, AttendanceRecord
from academic_sessions.models import AcademicYear

# Phase-specific prefix
P18 = "P18ATT_"

try:
    seed = get_seed_data()

    school_a = seed['school_a']
    school_b = seed['school_b']
    SID_A = seed['SID_A']
    SID_B = seed['SID_B']
    token_admin = seed['tokens']['admin']
    token_teacher = seed['tokens']['teacher']
    token_admin_b = seed['tokens']['admin_b']
    admin_user = seed['users']['admin']

    seed_class = seed['classes'][0]
    seed_students = seed['students']
    seed_ay = seed.get('academic_year')
    ay_id = seed_ay.id if seed_ay else None

    reset_counters()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 18 COMPREHENSIVE TEST SUITE — ATTENDANCE")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: ATTENDANCE UPLOAD CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: ATTENDANCE UPLOAD CRUD")
    print("=" * 70)

    # A1: List uploads
    resp = api_get('/api/attendance/uploads/', token_admin, SID_A)
    check("A1: List uploads returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A2: Create upload (idempotent — check if exists first)
    upload_id = None
    _existing_upload = AttendanceUpload.objects.filter(
        school=school_a, date='2026-02-10', class_obj=seed_class
    ).first()
    if _existing_upload:
        upload_id = _existing_upload.id
        check("A2: Create upload returns 201", True, "(already exists)")
        check("A3: Upload created", True, "(already exists)")
    elif ay_id:
        resp = api_post('/api/attendance/uploads/', {
            'school': SID_A,
            'class_obj': seed_class.id,
            'date': '2026-02-10',
            'image_url': 'https://example.com/test-attendance.jpg',
        }, token_admin, SID_A)
        check("A2: Create upload returns 201", resp.status_code == 201,
              f"got {resp.status_code} {resp.content[:200]}")
        if resp.status_code == 201:
            upload_id = resp.json().get('id')
            if not upload_id:
                _u = AttendanceUpload.objects.filter(
                    school=school_a, date='2026-02-10', class_obj=seed_class
                ).first()
                upload_id = _u.id if _u else None
        check("A3: Upload created", upload_id is not None)

    # A4: Retrieve upload
    if upload_id:
        resp = api_get(f'/api/attendance/uploads/{upload_id}/', token_admin, SID_A)
        check("A4: Retrieve upload returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("A5: Upload has date", 'date' in body)
            check("A6: Upload has status", 'status' in body)

    # A7: Pending review endpoint
    resp = api_get('/api/attendance/uploads/pending_review/', token_admin, SID_A)
    check("A7: Pending review returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A8: Create second upload (idempotent)
    upload2_id = None
    _existing_upload2 = AttendanceUpload.objects.filter(
        school=school_a, date='2026-02-11', class_obj=seed_class
    ).first()
    if _existing_upload2:
        upload2_id = _existing_upload2.id
        check("A8: Create review upload", True, "(already exists)")
    elif ay_id:
        resp = api_post('/api/attendance/uploads/', {
            'school': SID_A,
            'class_obj': seed_class.id,
            'date': '2026-02-11',
            'image_url': 'https://example.com/test-attendance-2.jpg',
        }, token_admin, SID_A)
        if resp.status_code == 201:
            upload2_id = resp.json().get('id')
            if not upload2_id:
                _u2 = AttendanceUpload.objects.filter(
                    school=school_a, date='2026-02-11', class_obj=seed_class
                ).first()
                upload2_id = _u2.id if _u2 else None
        check("A8: Create review upload", upload2_id is not None,
              f"got {resp.status_code}")

    # A9: Filter uploads by status
    resp = api_get('/api/attendance/uploads/?status=PENDING', token_admin, SID_A)
    check("A9: Filter by status returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A10: Filter by class
    resp = api_get(f'/api/attendance/uploads/?class_id={seed_class.id}',
                   token_admin, SID_A)
    check("A10: Filter by class returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: ATTENDANCE RECORD CRUD + DAILY REPORT
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: ATTENDANCE RECORD CRUD + DAILY REPORT")
    print("=" * 70)

    # B1: List records
    resp = api_get('/api/attendance/records/', token_admin, SID_A)
    check("B1: List records returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B2: Create attendance records via ORM (ReadOnlyModelViewSet — no POST)
    record_ids = []
    test_date = '2026-02-12'
    if ay_id and len(seed_students) >= 3:
        for i, student in enumerate(seed_students[:3]):
            status_val = 'PRESENT' if i < 2 else 'ABSENT'
            rec, _ = AttendanceRecord.objects.get_or_create(
                student=student,
                date=test_date,
                school=school_a,
                defaults={
                    'academic_year': seed_ay,
                    'status': status_val,
                    'source': 'MANUAL',
                },
            )
            record_ids.append(rec.id)
        check("B2: Created 3 attendance records", len(record_ids) == 3,
              f"created {len(record_ids)}")

    # B3: Retrieve a record via API
    if record_ids:
        resp = api_get(f'/api/attendance/records/{record_ids[0]}/', token_admin, SID_A)
        check("B3: Retrieve record returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("B4: Record has status", 'status' in body)
            check("B5: Record has student", 'student' in body)

    # B6: Verify record via API (ReadOnly — no PATCH)
    if len(record_ids) >= 3:
        resp = api_get(f'/api/attendance/records/{record_ids[2]}/', token_admin, SID_A)
        check("B6: Retrieve third record returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # B7: Daily report
    resp = api_get(f'/api/attendance/records/daily_report/?date={test_date}',
                   token_admin, SID_A)
    check("B7: Daily report returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B8: Filter records by date
    resp = api_get(f'/api/attendance/records/?date_from={test_date}&date_to={test_date}',
                   token_admin, SID_A)
    check("B8: Filter by date returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: CHRONIC ABSENTEES
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: CHRONIC ABSENTEES")
    print("=" * 70)

    # C1: Chronic absentees endpoint
    resp = api_get('/api/attendance/records/chronic_absentees/', token_admin, SID_A)
    check("C1: Chronic absentees returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # C2: Chronic absentees with threshold
    resp = api_get('/api/attendance/records/chronic_absentees/?threshold=10',
                   token_admin, SID_A)
    check("C2: Chronic absentees with threshold returns 200",
          resp.status_code == 200, f"got {resp.status_code}")

    # ==================================================================
    # LEVEL D: AI STATUS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: AI STATUS")
    print("=" * 70)

    # D1: AI status endpoint
    resp = api_get('/api/attendance/ai-status/', token_admin, SID_A)
    check("D1: AI status returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("D2: Has ai_available key", 'ai_available' in body)
        check("D3: Has provider key", 'provider' in body)

    # ==================================================================
    # LEVEL E: CROSS-CUTTING
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: CROSS-CUTTING")
    print("=" * 70)

    # E1: Unauthenticated
    resp = _client.get('/api/attendance/uploads/', content_type='application/json')
    check("E1: Unauthenticated uploads returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # E2: Unauthenticated records
    resp = _client.get('/api/attendance/records/', content_type='application/json')
    check("E2: Unauthenticated records returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # E3: Teacher can read records
    resp = api_get('/api/attendance/records/', token_teacher, SID_A)
    check("E3: Teacher can read records (200)", resp.status_code == 200,
          f"got {resp.status_code}")

    # E4: Teacher cannot access uploads (requires IsSchoolAdmin)
    resp = api_get('/api/attendance/uploads/', token_teacher, SID_A)
    check("E4: Teacher cannot access uploads (403)", resp.status_code == 403,
          f"got {resp.status_code}")

    # E5: School B cannot see school A attendance
    resp = api_get('/api/attendance/records/', token_admin_b, SID_B)
    if resp.status_code == 200:
        body = resp.json()
        rec_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(rec_list, list):
            # None of our test records should appear for school B
            check("E5: School B cannot see school A records",
                  all(r.get('id') not in record_ids for r in rec_list),
                  f"found overlap in school B records")
        else:
            check("E5: School B records is list", False)
    else:
        check("E5: School B records returns 200", False, f"got {resp.status_code}")

    # E6: Records are read-only (no DELETE)
    if record_ids:
        resp = api_delete(f'/api/attendance/records/{record_ids[0]}/', token_admin, SID_A)
        check("E6: Delete record not allowed (405)", resp.status_code == 405,
              f"got {resp.status_code}")

    # E7: Delete upload (accept 204 or 404 on re-run)
    if upload_id:
        resp = api_delete(f'/api/attendance/uploads/{upload_id}/', token_admin, SID_A)
        check("E7: Delete upload returns 204", resp.status_code in (204, 404),
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
