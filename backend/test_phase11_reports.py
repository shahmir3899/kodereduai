"""
Phase 11 — Reports Module Tests
=================================
Covers: GenerateReport (PDF/XLSX for each type), ReportList,
        permissions, school isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase11_reports.py', encoding='utf-8').read())"
"""

import json
from datetime import date
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
classes    = seed['classes']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

print("\n" + "=" * 70)
print("  PHASE 11: REPORTS MODULE TESTS")
print("=" * 70)

from reports.models import GeneratedReport

student_1 = students[0]
class_1   = classes[0]

# ── Cleanup previous P11 reports ─────────────────────────────────────────
GeneratedReport.objects.filter(school=school_a, title__contains='Report').delete()


# ==================================================================
# LEVEL A: GENERATE REPORTS — ATTENDANCE
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: GENERATE ATTENDANCE REPORTS")
print("=" * 70)

# A1: Daily attendance report (PDF)
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'PDF',
    'parameters': {'date': str(date.today())},
}, token_admin, SID_A)
check("A1  Daily attendance PDF", resp.status_code == 200,
      f"status={resp.status_code} ct={resp.get('Content-Type', '')}")
if resp.status_code == 200:
    check("A1b Has Content-Disposition",
          'attachment' in resp.get('Content-Disposition', ''),
          f"cd={resp.get('Content-Disposition', '')}")

# A2: Daily attendance with class filter
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'PDF',
    'parameters': {'date': str(date.today()), 'class_id': class_1.id},
}, token_admin, SID_A)
check("A2  Daily attendance with class filter", resp.status_code == 200,
      f"status={resp.status_code}")

# A3: Monthly attendance report (PDF)
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_MONTHLY',
    'format': 'PDF',
    'parameters': {'month': 1, 'year': 2025},
}, token_admin, SID_A)
check("A3  Monthly attendance PDF", resp.status_code == 200,
      f"status={resp.status_code}")

# A4: Daily attendance as XLSX
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'XLSX',
    'parameters': {'date': str(date.today())},
}, token_admin, SID_A)
check("A4  Daily attendance XLSX", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    ct = resp.get('Content-Type', '')
    check("A4b XLSX content type",
          'spreadsheet' in ct or 'openxml' in ct,
          f"ct={ct}")

# A5: Generate report (Principal)
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'PDF',
    'parameters': {},
}, token_principal, SID_A)
check("A5  Generate report (Principal)", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL B: GENERATE REPORTS — FEE
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: GENERATE FEE REPORTS")
print("=" * 70)

# B1: Fee collection summary
resp = api_post('/api/reports/generate/', {
    'report_type': 'FEE_COLLECTION',
    'format': 'PDF',
    'parameters': {'month': 1, 'year': 2025},
}, token_admin, SID_A)
check("B1  Fee collection PDF", resp.status_code == 200,
      f"status={resp.status_code}")

# B2: Fee defaulters list
resp = api_post('/api/reports/generate/', {
    'report_type': 'FEE_DEFAULTERS',
    'format': 'PDF',
    'parameters': {'month': 1, 'year': 2025},
}, token_admin, SID_A)
check("B2  Fee defaulters PDF", resp.status_code == 200,
      f"status={resp.status_code}")

# B3: Fee collection as XLSX
resp = api_post('/api/reports/generate/', {
    'report_type': 'FEE_COLLECTION',
    'format': 'XLSX',
    'parameters': {'month': 1, 'year': 2025},
}, token_admin, SID_A)
check("B3  Fee collection XLSX", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL C: GENERATE REPORTS — ACADEMIC
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: GENERATE ACADEMIC REPORTS")
print("=" * 70)

# C1: Student progress report
resp = api_post('/api/reports/generate/', {
    'report_type': 'STUDENT_PROGRESS',
    'format': 'PDF',
    'parameters': {'student_id': student_1.id},
}, token_admin, SID_A)
check("C1  Student progress PDF", resp.status_code == 200,
      f"status={resp.status_code}")

# C2: Student comprehensive report
resp = api_post('/api/reports/generate/', {
    'report_type': 'STUDENT_COMPREHENSIVE',
    'format': 'PDF',
    'parameters': {'student_id': student_1.id},
}, token_admin, SID_A)
check("C2  Student comprehensive PDF", resp.status_code == 200,
      f"status={resp.status_code}")

# C3: Class result report (may need an exam_id — use 0 or nonexistent gracefully)
resp = api_post('/api/reports/generate/', {
    'report_type': 'CLASS_RESULT',
    'format': 'PDF',
    'parameters': {'exam_id': 0},
}, token_admin, SID_A)
# This may return 200 with empty data or 500 if generator doesn't handle missing exam
check("C3  Class result PDF (no exam data)", resp.status_code == 200,
      f"status={resp.status_code}")

# C4: Student comprehensive as XLSX
resp = api_post('/api/reports/generate/', {
    'report_type': 'STUDENT_COMPREHENSIVE',
    'format': 'XLSX',
    'parameters': {'student_id': student_1.id},
}, token_admin, SID_A)
check("C4  Student comprehensive XLSX", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL D: REPORT LIST
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: REPORT LIST")
print("=" * 70)

# D1: List generated reports (Admin)
resp = api_get('/api/reports/list/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
check("D1  List reports (Admin)", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# D2: Report has correct fields
if data:
    r = data[0]
    check("D2  Report has fields",
          all(k in r for k in ['id', 'report_type', 'format', 'generated_by', 'created_at']),
          f"keys={list(r.keys())}")
else:
    check("D2  Report has fields", False, "no reports")

# D3: Teacher can list reports (HasSchoolAccess, not IsSchoolAdmin)
resp = api_get('/api/reports/list/', token_teacher, SID_A)
check("D3  Teacher can list reports", resp.status_code == 200,
      f"status={resp.status_code}")

# D4: Reports ordered by newest first
if len(data) >= 2:
    check("D4  Ordered newest first", data[0]['created_at'] >= data[1]['created_at'],
          f"first={data[0]['created_at']} second={data[1]['created_at']}")
else:
    check("D4  Ordered newest first", True, "only 1 report (trivially ordered)")


# ==================================================================
# LEVEL E: PERMISSIONS & VALIDATION
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: PERMISSIONS & VALIDATION")
print("=" * 70)

# E1: Teacher can't generate reports -> 403
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'PDF',
    'parameters': {},
}, token_teacher, SID_A)
check("E1  Teacher can't generate -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# E2: Invalid report_type -> 400
resp = api_post('/api/reports/generate/', {
    'report_type': 'INVALID_TYPE_XYZ',
    'format': 'PDF',
}, token_admin, SID_A)
check("E2  Invalid report_type -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# E3: Missing report_type -> 400
resp = api_post('/api/reports/generate/', {
    'format': 'PDF',
}, token_admin, SID_A)
check("E3  Missing report_type -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# E4: Generate without school_id -> 400
resp = _client.post(
    '/api/reports/generate/',
    data=json.dumps({
        'report_type': 'ATTENDANCE_DAILY',
        'format': 'PDF',
    }),
    HTTP_AUTHORIZATION=f'Bearer {token_admin}',
    content_type='application/json',
)
check("E4  Generate without school_id -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# E5: List without school_id -> 400
resp = _client.get(
    '/api/reports/list/',
    HTTP_AUTHORIZATION=f'Bearer {token_admin}',
)
check("E5  List without school_id -> 400", resp.status_code == 400,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL F: CROSS-CUTTING & SECURITY
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL F: CROSS-CUTTING & SECURITY")
print("=" * 70)

# F1: Unauthenticated -> 401
resp = _client.get('/api/reports/list/')
check("F1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F2: Invalid token -> 401
resp = _client.get(
    '/api/reports/list/',
    HTTP_AUTHORIZATION='Bearer garbage_token',
)
check("F2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F3: School B admin can't see School A reports
resp = api_get('/api/reports/list/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else []
check("F3  School B isolation (reports)", resp.status_code == 200 and len(data) == 0,
      f"status={resp.status_code} count={len(data)}")

# F4: School B admin can generate own report
resp = api_post('/api/reports/generate/', {
    'report_type': 'ATTENDANCE_DAILY',
    'format': 'PDF',
    'parameters': {},
}, token_admin_b, SID_B)
check("F4  School B admin can generate", resp.status_code == 200,
      f"status={resp.status_code}")

# F5: School B list now has 1 report
resp = api_get('/api/reports/list/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else []
check("F5  School B has own report", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# Cleanup school B report
GeneratedReport.objects.filter(school=school_b).delete()


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 11 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
