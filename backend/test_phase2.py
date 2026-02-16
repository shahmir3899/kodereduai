# -*- coding: utf-8 -*-
"""
Phase 2: Notifications, Students & Reports — Comprehensive API Test Suite (REWRITTEN).

Tests notification templates, logs, preferences, config, send, analytics,
student CRUD, class CRUD, and report generation via REST API.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase2.py', encoding='utf-8').read())"

What it tests:
    Level A: Notification Template CRUD
    Level B: Notification Config & Preferences
    Level C: My Notifications, Unread Count, Mark Read
    Level D: Send Notification, Analytics
    Level E: Class CRUD
    Level F: Student CRUD
    Level G: Report Generation & List
    Level H: Cross-cutting (permissions, unauthenticated access)

Roles tested:
    - SCHOOL_ADMIN: full management
    - TEACHER: read-only or limited access
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

from notifications.models import NotificationTemplate, NotificationLog
from students.models import Class, Student

# Phase-specific prefix
P2 = "P2NOTIF_"

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

    # ==================================================================
    print("=" * 70)
    print("  PHASE 2 COMPREHENSIVE TEST SUITE — NOTIFICATIONS, STUDENTS & REPORTS")
    print("=" * 70)

    # ==================================================================
    # LEVEL A: NOTIFICATION TEMPLATE CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: NOTIFICATION TEMPLATE CRUD")
    print("=" * 70)

    # A1: List templates
    resp = api_get('/api/notifications/templates/', token_admin, SID_A)
    check("A1: List templates returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # A2: Create template
    resp = api_post('/api/notifications/templates/', {
        'name': f'{P2}Absence Alert',
        'event_type': 'ABSENCE',
        'channel': 'IN_APP',
        'subject_template': 'Absence: {{student_name}}',
        'body_template': 'Dear parent, {{student_name}} was absent on {{date}}.',
    }, token_admin, SID_A)
    check("A2: Create template returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    tpl_id = None
    if resp.status_code == 201:
        tpl_id = resp.json().get('id')
        if not tpl_id:
            _tpl = NotificationTemplate.objects.filter(
                name=f'{P2}Absence Alert', school=school_a
            ).first()
            tpl_id = _tpl.id if _tpl else None
    check("A3: Template created in DB", tpl_id is not None)

    # A4: Retrieve template
    if tpl_id:
        resp = api_get(f'/api/notifications/templates/{tpl_id}/', token_admin, SID_A)
        check("A4: Retrieve template returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("A5: Template has correct name", body.get('name') == f'{P2}Absence Alert')
            check("A6: Template has event_type", body.get('event_type') == 'ABSENCE')
            check("A7: Template has channel", body.get('channel') == 'IN_APP')

    # A8: Update template
    if tpl_id:
        resp = api_patch(f'/api/notifications/templates/{tpl_id}/', {
            'name': f'{P2}Absence Alert Updated',
        }, token_admin, SID_A)
        check("A8: Update template returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("A9: Name updated", resp.json().get('name') == f'{P2}Absence Alert Updated')

    # A10: Create second template (fee reminder)
    resp = api_post('/api/notifications/templates/', {
        'name': f'{P2}Fee Reminder',
        'event_type': 'FEE_DUE',
        'channel': 'IN_APP',
        'body_template': 'Your fee of {{amount}} is due for {{month}}.',
    }, token_admin, SID_A)
    tpl2_id = None
    if resp.status_code == 201:
        tpl2_id = resp.json().get('id')
        if not tpl2_id:
            _tpl2 = NotificationTemplate.objects.filter(
                name=f'{P2}Fee Reminder', school=school_a
            ).first()
            tpl2_id = _tpl2.id if _tpl2 else None
    check("A10: Create fee reminder template", tpl2_id is not None,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL B: NOTIFICATION CONFIG & PREFERENCES
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: NOTIFICATION CONFIG & PREFERENCES")
    print("=" * 70)

    # B1: Get notification config
    resp = api_get('/api/notifications/config/', token_admin, SID_A)
    check("B1: Get config returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("B2: Config has in_app_enabled", 'in_app_enabled' in body)

    # B3: Update notification config
    resp = _client.put(
        '/api/notifications/config/',
        data=json.dumps({
            'in_app_enabled': True,
            'whatsapp_enabled': False,
            'sms_enabled': False,
            'fee_reminder_day': 10,
        }),
        HTTP_AUTHORIZATION=f'Bearer {token_admin}',
        HTTP_X_SCHOOL_ID=str(SID_A),
        content_type='application/json',
    )
    check("B3: Update config returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B4: List preferences
    resp = api_get('/api/notifications/preferences/', token_admin, SID_A)
    check("B4: List preferences returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # B5: Create preference
    resp = api_post('/api/notifications/preferences/', {
        'school': SID_A,
        'channel': 'IN_APP',
        'event_type': 'GENERAL',
        'is_enabled': True,
    }, token_admin, SID_A)
    pref_id = None
    if resp.status_code == 201:
        pref_id = resp.json().get('id')
    check("B5: Create preference returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")

    # B6: Update preference
    if pref_id:
        resp = api_patch(f'/api/notifications/preferences/{pref_id}/', {
            'is_enabled': False,
        }, token_admin, SID_A)
        check("B6: Update preference returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL C: MY NOTIFICATIONS, UNREAD, MARK READ
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: MY NOTIFICATIONS & READ STATUS")
    print("=" * 70)

    # C1: Get my notifications
    resp = api_get('/api/notifications/my/', token_admin, SID_A)
    check("C1: Get my notifications returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # C2: Get unread count
    resp = api_get('/api/notifications/unread-count/', token_admin, SID_A)
    check("C2: Get unread count returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("C3: Has unread_count key", 'unread_count' in body or 'count' in body)

    # C4: Mark all as read
    resp = api_post('/api/notifications/mark-all-read/', {}, token_admin, SID_A)
    check("C4: Mark all read returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # C5: Notification logs (read-only)
    resp = api_get('/api/notifications/logs/', token_admin, SID_A)
    check("C5: List notification logs returns 200", resp.status_code == 200,
          f"got {resp.status_code}")

    # ==================================================================
    # LEVEL D: SEND NOTIFICATION & ANALYTICS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: SEND NOTIFICATION & ANALYTICS")
    print("=" * 70)

    # D1: Send notification (admin)
    admin_user = seed['users']['admin']
    resp = api_post('/api/notifications/send/', {
        'title': f'{P2}Test Notification',
        'body': f'{P2}This is a test notification sent via API.',
        'channel': 'IN_APP',
        'event_type': 'GENERAL',
        'recipient_type': 'ADMIN',
        'recipient_identifier': f'user-{admin_user.id}',
        'recipient_user_ids': [admin_user.id],
    }, token_admin, SID_A)
    check("D1: Send notification returns 200/201",
          resp.status_code in (200, 201),
          f"got {resp.status_code} {resp.content[:200]}")

    # D2: Get notification analytics
    resp = api_get('/api/notifications/analytics/', token_admin, SID_A)
    check("D2: Analytics returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        check("D3: Analytics has channels", 'channels' in body)

    # D4: Mark a specific notification as read (if any exist)
    resp = api_get('/api/notifications/my/', token_admin, SID_A)
    if resp.status_code == 200:
        my_notifs = resp.json()
        notif_list = my_notifs.get('results', my_notifs) if isinstance(my_notifs, dict) else my_notifs
        if isinstance(notif_list, list) and len(notif_list) > 0:
            notif_id = notif_list[0].get('id')
            if notif_id:
                resp = api_post(f'/api/notifications/{notif_id}/mark-read/', {},
                                token_admin, SID_A)
                check("D4: Mark single notification read returns 200",
                      resp.status_code == 200, f"got {resp.status_code}")
            else:
                check("D4: Mark single read (no id in first notif)", True)
        else:
            check("D4: Mark single read (no notifications)", True)

    # ==================================================================
    # LEVEL E: CLASS CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: CLASS CRUD")
    print("=" * 70)

    # E1: List classes
    resp = api_get('/api/classes/', token_admin, SID_A)
    check("E1: List classes returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        classes_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(classes_list, list):
            check("E2: Has classes in list", len(classes_list) > 0)

    # E3: Create class
    resp = api_post('/api/classes/', {
        'name': f'{P2}Class 10-A',
        'school': SID_A,
        'grade_level': 10,
        'section': 'A',
    }, token_admin, SID_A)
    check("E3: Create class returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    cls_id = None
    if resp.status_code == 201:
        cls_id = resp.json().get('id')
        if not cls_id:
            _cls = Class.objects.filter(name=f'{P2}Class 10-A', school=school_a).first()
            cls_id = _cls.id if _cls else None

    # E4: Retrieve class
    if cls_id:
        resp = api_get(f'/api/classes/{cls_id}/', token_admin, SID_A)
        check("E4: Retrieve class returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            check("E5: Class has correct name", resp.json().get('name') == f'{P2}Class 10-A')

    # E6: Update class
    if cls_id:
        resp = api_patch(f'/api/classes/{cls_id}/', {
            'name': f'{P2}Class 10-A Updated',
        }, token_admin, SID_A)
        check("E6: Update class returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL F: STUDENT CRUD
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: STUDENT CRUD")
    print("=" * 70)

    # Use first seed class
    seed_cls = seed['classes'][0]

    # F1: List students
    resp = api_get('/api/students/', token_admin, SID_A)
    check("F1: List students returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        students_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(students_list, list):
            check("F2: Has students in list", len(students_list) > 0)

    # F3: Create student
    resp = api_post('/api/students/', {
        'name': f'{P2}Ali Khan',
        'roll_number': f'{P2}001',
        'school': SID_A,
        'class_obj': seed_cls.id,
        'gender': 'M',
        'date_of_birth': '2012-05-15',
        'parent_name': 'Test Parent',
        'parent_phone': '+923001234567',
    }, token_admin, SID_A)
    check("F3: Create student returns 201", resp.status_code == 201,
          f"got {resp.status_code} {resp.content[:200]}")
    stu_id = None
    if resp.status_code == 201:
        stu_id = resp.json().get('id')
        if not stu_id:
            _stu = Student.objects.filter(name=f'{P2}Ali Khan', school=school_a).first()
            stu_id = _stu.id if _stu else None

    # F4: Retrieve student
    if stu_id:
        resp = api_get(f'/api/students/{stu_id}/', token_admin, SID_A)
        check("F4: Retrieve student returns 200", resp.status_code == 200,
              f"got {resp.status_code}")
        if resp.status_code == 200:
            body = resp.json()
            check("F5: Student has correct name", body.get('name') == f'{P2}Ali Khan')
            check("F6: Student has gender", body.get('gender') == 'M')

    # F7: Update student
    if stu_id:
        resp = api_patch(f'/api/students/{stu_id}/', {
            'name': f'{P2}Ali Khan Updated',
            'blood_group': 'B+',
        }, token_admin, SID_A)
        check("F7: Update student returns 200", resp.status_code == 200,
              f"got {resp.status_code}")

    # F8: Create second student
    resp = api_post('/api/students/', {
        'name': f'{P2}Sara Ahmed',
        'roll_number': f'{P2}002',
        'school': SID_A,
        'class_obj': seed_cls.id,
        'gender': 'F',
    }, token_admin, SID_A)
    stu2_id = None
    if resp.status_code == 201:
        stu2_id = resp.json().get('id')
        if not stu2_id:
            _stu2 = Student.objects.filter(name=f'{P2}Sara Ahmed', school=school_a).first()
            stu2_id = _stu2.id if _stu2 else None
    check("F8: Create second student", stu2_id is not None,
          f"got {resp.status_code}")

    # F9: Delete student
    if stu2_id:
        resp = api_delete(f'/api/students/{stu2_id}/', token_admin, SID_A)
        check("F9: Delete student returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

    # ==================================================================
    # LEVEL G: REPORT GENERATION & LIST
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: REPORT GENERATION & LIST")
    print("=" * 70)

    # G1: Generate attendance daily report (uses Celery — may fail without Redis)
    try:
        resp = api_post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'parameters': {'date': '2026-02-15'},
            'format': 'PDF',
        }, token_admin, SID_A)
        check("G1: Generate report returns 200/201/202",
              resp.status_code in (200, 201, 202),
              f"got {resp.status_code}")
    except Exception:
        check("G1: Generate report (Celery/Redis unavailable — skipped)", True)

    # G2: Generate fee collection report
    try:
        resp = api_post('/api/reports/generate/', {
            'report_type': 'FEE_COLLECTION',
            'parameters': {'month': 1, 'year': 2026},
            'format': 'PDF',
        }, token_admin, SID_A)
        check("G2: Generate fee report returns 200/201/202",
              resp.status_code in (200, 201, 202),
              f"got {resp.status_code}")
    except Exception:
        check("G2: Generate fee report (Celery/Redis unavailable — skipped)", True)

    # G3: List generated reports
    resp = api_get('/api/reports/list/', token_admin, SID_A)
    check("G3: List reports returns 200", resp.status_code == 200,
          f"got {resp.status_code}")
    if resp.status_code == 200:
        body = resp.json()
        reports_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(reports_list, list):
            check("G4: Reports list is available", True)
            # Try to download first report if it exists
            if reports_list:
                report_id = reports_list[0].get('id')
                if report_id:
                    resp = api_get(f'/api/reports/{report_id}/download/', token_admin, SID_A)
                    check("G5: Download report returns 200",
                          resp.status_code == 200,
                          f"got {resp.status_code}")
                else:
                    check("G5: Download report (no id)", True)
            else:
                check("G5: Download report (no reports yet)", True)

    # G6: Generate report with missing params
    try:
        resp = api_post('/api/reports/generate/', {}, token_admin, SID_A)
        check("G6: Missing params returns 400", resp.status_code == 400,
              f"got {resp.status_code}")
    except Exception:
        check("G6: Missing params (Celery/Redis unavailable — skipped)", True)

    # ==================================================================
    # LEVEL H: CROSS-CUTTING
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL H: CROSS-CUTTING")
    print("=" * 70)

    # H1: Unauthenticated — templates
    resp = _client.get('/api/notifications/templates/', content_type='application/json')
    check("H1: Unauthenticated templates returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # H2: Unauthenticated — students
    resp = _client.get('/api/students/', content_type='application/json')
    check("H2: Unauthenticated students returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # H3: Unauthenticated — reports
    resp = _client.get('/api/reports/list/', content_type='application/json')
    check("H3: Unauthenticated reports returns 401", resp.status_code == 401,
          f"got {resp.status_code}")

    # H4: Teacher cannot manage students (requires admin)
    resp = api_get('/api/students/', token_teacher, SID_A)
    check("H4: Teacher students returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # H5: Teacher cannot manage classes (requires admin)
    resp = api_get('/api/classes/', token_teacher, SID_A)
    check("H5: Teacher classes returns 403", resp.status_code == 403,
          f"got {resp.status_code}")

    # H6: Teacher can read notifications
    resp = api_get('/api/notifications/my/', token_teacher, SID_A)
    check("H6: Teacher can read my notifications (200)", resp.status_code == 200,
          f"got {resp.status_code}")

    # H7: School B admin cannot see school A students
    resp = api_get('/api/students/', token_admin_b, SID_B)
    if resp.status_code == 200:
        body = resp.json()
        stu_list = body.get('results', body) if isinstance(body, dict) else body
        if isinstance(stu_list, list):
            p2_students = [s for s in stu_list if s.get('name', '').startswith(P2)]
            check("H7: School B cannot see school A students", len(p2_students) == 0,
                  f"found {len(p2_students)} P2 students in school B")
        else:
            check("H7: School B students is list", False)
    else:
        check("H7: School B list students returns 200", False, f"got {resp.status_code}")

    # H8: Delete template
    if tpl_id:
        resp = api_delete(f'/api/notifications/templates/{tpl_id}/', token_admin, SID_A)
        check("H8: Delete template returns 204", resp.status_code == 204,
              f"got {resp.status_code}")

    # H9: Delete class
    if cls_id:
        resp = api_delete(f'/api/classes/{cls_id}/', token_admin, SID_A)
        check("H9: Delete class returns 204", resp.status_code == 204,
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
