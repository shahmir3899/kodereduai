"""
Phase 15 — Admissions Module Tests
====================================
Covers: AdmissionSession CRUD, AdmissionEnquiry CRUD + stage update + convert,
        Documents, Notes, Analytics, Followups, permissions, school isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase15_admissions.py', encoding='utf-8').read())"
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
classes    = seed['classes']
ay         = seed['academic_year']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

print("\n" + "=" * 70)
print("  PHASE 15: ADMISSIONS MODULE TESTS")
print("=" * 70)

from admissions.models import AdmissionSession, AdmissionEnquiry, AdmissionDocument, AdmissionNote

P15 = 'P15ADM_'
class_1 = classes[0]

# ── Cleanup previous P15 data ────────────────────────────────────────────
AdmissionNote.objects.filter(enquiry__school=school_a, enquiry__child_name__startswith=P15).delete()
AdmissionDocument.objects.filter(enquiry__school=school_a, enquiry__child_name__startswith=P15).delete()
AdmissionEnquiry.objects.filter(school=school_a, child_name__startswith=P15).delete()
AdmissionSession.objects.filter(school=school_a, name__startswith=P15).delete()


# ==================================================================
# LEVEL A: ADMISSION SESSIONS CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: ADMISSION SESSIONS CRUD")
print("=" * 70)

# A1: Create session (Admin)
resp = api_post('/api/admissions/sessions/', {
    'academic_year': ay.id,
    'name': f'{P15}Session 2025',
    'start_date': str(date.today()),
    'end_date': str(date.today() + timedelta(days=90)),
    'grade_levels_open': [1, 2, 3],
    'is_active': True,
}, token_admin, SID_A)
check("A1  Create session (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
session_id = resp.json().get('id') if resp.status_code == 201 else None

# A2: Teacher can't create session -> 403
resp = api_post('/api/admissions/sessions/', {
    'academic_year': ay.id,
    'name': f'{P15}Teacher Session',
    'start_date': str(date.today()),
    'end_date': str(date.today() + timedelta(days=30)),
}, token_teacher, SID_A)
check("A2  Teacher can't create session -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A3: List sessions
resp = api_get('/api/admissions/sessions/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("A3  List sessions", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# A4: Active sessions
resp = api_get('/api/admissions/sessions/active/', token_admin, SID_A)
check("A4  Active sessions", resp.status_code == 200,
      f"status={resp.status_code}")

# A5: Update session
if session_id:
    resp = api_patch(f'/api/admissions/sessions/{session_id}/', {
        'name': f'{P15}Session 2025 (Updated)',
    }, token_admin, SID_A)
    check("A5  Update session", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("A5  Update session", False, "no session_id")

# A6: School B isolation
resp = api_get('/api/admissions/sessions/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("A6  School B isolation (sessions)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL B: ADMISSION ENQUIRIES CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: ADMISSION ENQUIRIES CRUD")
print("=" * 70)

# B1: Create enquiry (Admin)
resp = api_post('/api/admissions/enquiries/', {
    'session': session_id,
    'child_name': f'{P15}Ali Khan',
    'child_dob': '2018-05-15',
    'child_gender': 'MALE',
    'applying_for_grade_level': '1',
    'parent_name': f'{P15}Mr. Khan',
    'parent_phone': '03001111111',
    'parent_email': f'{P15}khan@test.com',
    'source': 'WALK_IN',
    'priority': 'HIGH',
}, token_admin, SID_A)
check("B1  Create enquiry (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
enq_id = resp.json().get('id') if resp.status_code == 201 else None

# B2: Create second enquiry
resp = api_post('/api/admissions/enquiries/', {
    'child_name': f'{P15}Sara Ahmed',
    'child_dob': '2019-03-10',
    'child_gender': 'FEMALE',
    'applying_for_grade_level': '1',
    'parent_name': f'{P15}Mrs. Ahmed',
    'parent_phone': '03002222222',
    'source': 'PHONE',
    'priority': 'MEDIUM',
}, token_admin, SID_A)
check("B2  Create second enquiry", resp.status_code == 201,
      f"status={resp.status_code}")
enq2_id = resp.json().get('id') if resp.status_code == 201 else None

# B3: List enquiries
resp = api_get('/api/admissions/enquiries/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("B3  List enquiries", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# B4: Retrieve enquiry detail
if enq_id:
    resp = api_get(f'/api/admissions/enquiries/{enq_id}/', token_admin, SID_A)
    check("B4  Retrieve enquiry detail", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("B4  Retrieve enquiry detail", False, "no enq_id")

# B5: Filter by stage
resp = api_get('/api/admissions/enquiries/?stage=NEW', token_admin, SID_A)
check("B5  Filter by stage", resp.status_code == 200,
      f"status={resp.status_code}")

# B6: Filter by source
resp = api_get('/api/admissions/enquiries/?source=WALK_IN', token_admin, SID_A)
check("B6  Filter by source", resp.status_code == 200,
      f"status={resp.status_code}")

# B7: Teacher CAN read enquiries
resp = api_get('/api/admissions/enquiries/', token_teacher, SID_A)
check("B7  Teacher can read enquiries", resp.status_code == 200,
      f"status={resp.status_code}")

# B8: Teacher can't create enquiry -> 403
resp = api_post('/api/admissions/enquiries/', {
    'child_name': f'{P15}Teacher Child',
    'parent_name': 'Teacher Parent',
    'parent_phone': '03009999999',
}, token_teacher, SID_A)
check("B8  Teacher can't create enquiry -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# B9: School B isolation
resp = api_get('/api/admissions/enquiries/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("B9  School B isolation (enquiries)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL C: STAGE UPDATE + CONVERT
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: STAGE UPDATE + CONVERT")
print("=" * 70)

# C1: Update stage to CONTACTED
if enq_id:
    resp = api_patch(f'/api/admissions/enquiries/{enq_id}/update-stage/', {
        'stage': 'CONTACTED',
        'note': 'Called parent, scheduled visit',
    }, token_admin, SID_A)
    check("C1  Update stage to CONTACTED", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("C1  Update stage to CONTACTED", False, "no enq_id")

# C2: Update stage to FORM_SUBMITTED
if enq_id:
    resp = api_patch(f'/api/admissions/enquiries/{enq_id}/update-stage/', {
        'stage': 'FORM_SUBMITTED',
    }, token_admin, SID_A)
    check("C2  Update stage to FORM_SUBMITTED", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C2  Update stage to FORM_SUBMITTED", False, "no enq_id")

# C3: Convert enquiry to student
if enq2_id:
    # First move to ACCEPTED stage
    api_patch(f'/api/admissions/enquiries/{enq2_id}/update-stage/', {
        'stage': 'ACCEPTED',
    }, token_admin, SID_A)

    resp = api_post(f'/api/admissions/enquiries/{enq2_id}/convert/', {
        'class_id': class_1.id,
        'roll_number': f'{P15}99',
    }, token_admin, SID_A)
    check("C3  Convert enquiry to student", resp.status_code in (200, 201),
          f"status={resp.status_code} body={resp.content[:200]}")

    # Verify stage became ENROLLED
    if resp.status_code in (200, 201):
        enq_obj = AdmissionEnquiry.objects.filter(id=enq2_id).first()
        check("C3b Enquiry stage is ENROLLED",
              enq_obj and enq_obj.stage == 'ENROLLED',
              f"stage={enq_obj.stage if enq_obj else 'N/A'}")
    else:
        check("C3b Enquiry stage is ENROLLED", False, "convert failed")
else:
    check("C3  Convert enquiry to student", False, "no enq2_id")
    check("C3b Enquiry stage is ENROLLED", False, "skipped")


# ==================================================================
# LEVEL D: DOCUMENTS & NOTES
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: DOCUMENTS & NOTES")
print("=" * 70)

# D1: Add document to enquiry
if enq_id:
    resp = api_post(f'/api/admissions/enquiries/{enq_id}/documents/', {
        'enquiry': enq_id,
        'document_type': 'BIRTH_CERT',
        'file_url': 'https://example.com/birth_cert.pdf',
        'file_name': 'birth_certificate.pdf',
    }, token_admin, SID_A)
    check("D1  Add document", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("D1  Add document", False, "no enq_id")

# D2: List documents
if enq_id:
    resp = api_get(f'/api/admissions/enquiries/{enq_id}/documents/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get('results', [])
    check("D2  List documents", resp.status_code == 200 and len(data) >= 1,
          f"status={resp.status_code} count={len(data)}")
else:
    check("D2  List documents", False, "no enq_id")

# D3: Add note to enquiry
if enq_id:
    resp = api_post(f'/api/admissions/enquiries/{enq_id}/notes/', {
        'enquiry': enq_id,
        'note': 'Parent seemed interested in admission',
        'note_type': 'NOTE',
    }, token_admin, SID_A)
    check("D3  Add note", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("D3  Add note", False, "no enq_id")

# D4: List notes
if enq_id:
    resp = api_get(f'/api/admissions/enquiries/{enq_id}/notes/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get('results', [])
    # Should have at least 1 manual note + auto-created stage change notes
    check("D4  List notes", resp.status_code == 200 and len(data) >= 1,
          f"status={resp.status_code} count={len(data)}")
else:
    check("D4  List notes", False, "no enq_id")


# ==================================================================
# LEVEL E: ANALYTICS & FOLLOWUPS
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: ANALYTICS & FOLLOWUPS")
print("=" * 70)

# E1: Pipeline analytics
resp = api_get('/api/admissions/analytics/pipeline/', token_admin, SID_A)
check("E1  Pipeline analytics", resp.status_code == 200,
      f"status={resp.status_code}")
if resp.status_code == 200:
    analytics = resp.json()
    check("E2  Analytics has expected fields",
          'total_enquiries' in analytics and 'pipeline_funnel' in analytics,
          f"keys={list(analytics.keys())}")
else:
    check("E2  Analytics has expected fields", False, "analytics failed")

# E3: Today's followups
resp = api_get('/api/admissions/followups/today/', token_admin, SID_A)
check("E3  Today's followups", resp.status_code == 200,
      f"status={resp.status_code}")

# E4: Overdue followups
resp = api_get('/api/admissions/followups/overdue/', token_admin, SID_A)
check("E4  Overdue followups", resp.status_code == 200,
      f"status={resp.status_code}")

# E5: Teacher can't access analytics -> 403
resp = api_get('/api/admissions/analytics/pipeline/', token_teacher, SID_A)
check("E5  Teacher can't access analytics -> 403", resp.status_code == 403,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL F: PERMISSIONS & CROSS-CUTTING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL F: PERMISSIONS & CROSS-CUTTING")
print("=" * 70)

# F1: Unauthenticated -> 401
resp = _client.get('/api/admissions/enquiries/')
check("F1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F2: Invalid token -> 401
resp = _client.get(
    '/api/admissions/enquiries/',
    HTTP_AUTHORIZATION='Bearer garbage_token',
)
check("F2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# F3: Teacher can't update enquiry -> 403
if enq_id:
    resp = api_patch(f'/api/admissions/enquiries/{enq_id}/', {
        'priority': 'LOW',
    }, token_teacher, SID_A)
    check("F3  Teacher can't update enquiry -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("F3  Teacher can't update enquiry -> 403", False, "no enq_id")

# F4: Teacher can't delete session -> 403
if session_id:
    resp = api_delete(f'/api/admissions/sessions/{session_id}/', token_teacher, SID_A)
    check("F4  Teacher can't delete session -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("F4  Teacher can't delete session -> 403", False, "no session_id")


# ==================================================================
# CLEANUP converted student
# ==================================================================
from students.models import Student
Student.objects.filter(school=school_a, roll_number=f'{P15}99').delete()


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 15 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
