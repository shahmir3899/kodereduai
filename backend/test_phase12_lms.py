"""
Phase 12 — LMS Module Tests
============================
Covers: LessonPlan CRUD, Assignment CRUD + publish/close,
        AssignmentSubmission + grading, permissions, school isolation.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase12_lms.py', encoding='utf-8').read())"
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
classes    = seed['classes']
staff      = seed['staff']
ay         = seed['academic_year']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

print("\n" + "=" * 70)
print("  PHASE 12: LMS MODULE TESTS")
print("=" * 70)

# ── Pre-requisite: Subject (from academics) ──────────────────────────────
from academics.models import Subject

P12 = 'P12LMS_'
subj, _ = Subject.objects.get_or_create(
    school=school_a, code=f'{P12}MATH',
    defaults={'name': f'{P12}Mathematics'},
)

class_1 = classes[0]
student_1 = students[0]
teacher_staff = staff[0]

# ── Cleanup previous P12 data ────────────────────────────────────────────
from lms.models import LessonPlan, Assignment, AssignmentSubmission
LessonPlan.objects.filter(school=school_a, title__startswith=P12).delete()
Assignment.objects.filter(school=school_a, title__startswith=P12).delete()


# ==================================================================
# LEVEL A: LESSON PLANS CRUD
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: LESSON PLANS CRUD")
print("=" * 70)

# A1: Create lesson plan (Admin)
resp = api_post('/api/lms/lesson-plans/', {
    'school': SID_A,
    'academic_year': ay.id,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}Algebra Intro',
    'description': 'Introduction to algebra',
    'lesson_date': str(date.today()),
    'duration_minutes': 45,
    'status': 'DRAFT',
}, token_admin, SID_A)
check("A1  Create lesson plan (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
lp_id = resp.json().get('id') if resp.status_code == 201 else None

# A2: Create lesson plan (Principal)
resp = api_post('/api/lms/lesson-plans/', {
    'school': SID_A,
    'academic_year': ay.id,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}Geometry Basics',
    'description': 'Intro to geometry',
    'lesson_date': str(date.today() + timedelta(days=1)),
    'duration_minutes': 40,
    'status': 'PUBLISHED',
}, token_principal, SID_A)
check("A2  Create lesson plan (Principal)", resp.status_code == 201,
      f"status={resp.status_code}")

# A3: Teacher can't create -> 403
resp = api_post('/api/lms/lesson-plans/', {
    'school': SID_A,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}Teacher Plan',
    'lesson_date': str(date.today()),
}, token_teacher, SID_A)
check("A3  Teacher can't create -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A4: List lesson plans
resp = api_get('/api/lms/lesson-plans/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("A4  List lesson plans", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# A5: Teacher CAN read lesson plans
resp = api_get('/api/lms/lesson-plans/', token_teacher, SID_A)
check("A5  Teacher can read lesson plans", resp.status_code == 200,
      f"status={resp.status_code}")

# A6: Retrieve single
if lp_id:
    resp = api_get(f'/api/lms/lesson-plans/{lp_id}/', token_admin, SID_A)
    check("A6  Retrieve lesson plan", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("A6  Retrieve lesson plan", False, "no lp_id")

# A7: Update lesson plan
if lp_id:
    resp = api_patch(f'/api/lms/lesson-plans/{lp_id}/', {
        'title': f'{P12}Algebra Intro (Updated)',
    }, token_admin, SID_A)
    check("A7  Update lesson plan", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("A7  Update lesson plan", False, "no lp_id")

# A8: Delete lesson plan
if lp_id:
    resp = api_delete(f'/api/lms/lesson-plans/{lp_id}/', token_admin, SID_A)
    check("A8  Delete lesson plan", resp.status_code in (200, 204),
          f"status={resp.status_code}")
else:
    check("A8  Delete lesson plan", False, "no lp_id")

# A9: School B isolation
resp = api_get('/api/lms/lesson-plans/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("A9  School B isolation (lesson plans)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL B: ASSIGNMENTS CRUD + PUBLISH/CLOSE
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: ASSIGNMENTS CRUD + PUBLISH/CLOSE")
print("=" * 70)

# B1: Create assignment (Admin)
resp = api_post('/api/lms/assignments/', {
    'school': SID_A,
    'academic_year': ay.id,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}HW Chapter 1',
    'description': 'Homework on chapter 1',
    'assignment_type': 'HOMEWORK',
    'due_date': f'{date.today() + timedelta(days=7)}T23:59:00Z',
    'total_marks': 20,
    'status': 'DRAFT',
}, token_admin, SID_A)
check("B1  Create assignment (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
assign_id = resp.json().get('id') if resp.status_code == 201 else None

# B2: Create assignment (Principal)
resp = api_post('/api/lms/assignments/', {
    'school': SID_A,
    'academic_year': ay.id,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}Project Alpha',
    'description': 'Alpha project description',
    'assignment_type': 'PROJECT',
    'due_date': f'{date.today() + timedelta(days=14)}T23:59:00Z',
    'total_marks': 50,
    'status': 'DRAFT',
}, token_principal, SID_A)
check("B2  Create assignment (Principal)", resp.status_code == 201,
      f"status={resp.status_code}")

# B3: Teacher can't create -> 403
resp = api_post('/api/lms/assignments/', {
    'school': SID_A,
    'class_obj': class_1.id,
    'subject': subj.id,
    'title': f'{P12}Teacher Assignment',
    'due_date': f'{date.today()}T23:59:00Z',
}, token_teacher, SID_A)
check("B3  Teacher can't create assignment -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# B4: List assignments
resp = api_get('/api/lms/assignments/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("B4  List assignments", resp.status_code == 200 and len(data) >= 2,
      f"status={resp.status_code} count={len(data)}")

# B5: Teacher CAN read assignments
resp = api_get('/api/lms/assignments/', token_teacher, SID_A)
check("B5  Teacher can read assignments", resp.status_code == 200,
      f"status={resp.status_code}")

# B6: Publish assignment (DRAFT -> PUBLISHED)
if assign_id:
    resp = api_post(f'/api/lms/assignments/{assign_id}/publish/', {}, token_admin, SID_A)
    check("B6  Publish assignment", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("B6  Publish assignment", False, "no assign_id")

# B7: Close assignment (PUBLISHED -> CLOSED)
if assign_id:
    resp = api_post(f'/api/lms/assignments/{assign_id}/close/', {}, token_admin, SID_A)
    check("B7  Close assignment", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("B7  Close assignment", False, "no assign_id")

# B8: Update assignment
if assign_id:
    resp = api_patch(f'/api/lms/assignments/{assign_id}/', {
        'title': f'{P12}HW Chapter 1 (Updated)',
    }, token_admin, SID_A)
    check("B8  Update assignment", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("B8  Update assignment", False, "no assign_id")

# B9: School B isolation
resp = api_get('/api/lms/assignments/', token_admin_b, SID_B)
data_b = resp.json() if resp.status_code == 200 else []
if isinstance(data_b, dict):
    data_b = data_b.get('results', [])
check("B9  School B isolation (assignments)", resp.status_code == 200 and len(data_b) == 0,
      f"status={resp.status_code} count={len(data_b)}")


# ==================================================================
# LEVEL C: ASSIGNMENT SUBMISSIONS + GRADING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: ASSIGNMENT SUBMISSIONS + GRADING")
print("=" * 70)

# Need a PUBLISHED assignment for submissions
pub_resp = api_post('/api/lms/assignments/', {
    'school': SID_A,
    'academic_year': ay.id,
    'class_obj': class_1.id,
    'subject': subj.id,
    'teacher': teacher_staff.id,
    'title': f'{P12}Submittable HW',
    'description': 'Submittable homework description',
    'assignment_type': 'HOMEWORK',
    'due_date': f'{date.today() + timedelta(days=7)}T23:59:00Z',
    'total_marks': 100,
    'status': 'DRAFT',
}, token_admin, SID_A)
pub_assign_id = pub_resp.json().get('id') if pub_resp.status_code == 201 else None
if pub_assign_id:
    api_post(f'/api/lms/assignments/{pub_assign_id}/publish/', {}, token_admin, SID_A)

# C1: Create submission
if pub_assign_id:
    resp = api_post('/api/lms/submissions/', {
        'assignment': pub_assign_id,
        'student': student_1.id,
        'school': SID_A,
        'submission_text': 'My homework answers',
    }, token_admin, SID_A)
    check("C1  Create submission", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    sub_id = resp.json().get('id') if resp.status_code == 201 else None
else:
    check("C1  Create submission", False, "no published assignment")
    sub_id = None

# C2: List submissions
resp = api_get('/api/lms/submissions/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
if isinstance(data, dict):
    data = data.get('results', [])
check("C2  List submissions", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# C3: List submissions for specific assignment (nested route)
if pub_assign_id:
    resp = api_get(f'/api/lms/assignments/{pub_assign_id}/submissions/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get('results', [])
    check("C3  Nested submissions list", resp.status_code == 200 and len(data) >= 1,
          f"status={resp.status_code} count={len(data)}")
else:
    check("C3  Nested submissions list", False, "no assignment")

# C4: Grade submission
if sub_id:
    resp = api_patch(f'/api/lms/submissions/{sub_id}/grade/', {
        'marks_obtained': 85,
        'feedback': 'Good work!',
    }, token_admin, SID_A)
    check("C4  Grade submission", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
else:
    check("C4  Grade submission", False, "no sub_id")

# C5: Verify graded submission has marks
if sub_id:
    resp = api_get(f'/api/lms/submissions/{sub_id}/', token_admin, SID_A)
    if resp.status_code == 200:
        r = resp.json()
        check("C5  Graded submission has marks",
              r.get('marks_obtained') is not None and r.get('status') == 'GRADED',
              f"marks={r.get('marks_obtained')} status={r.get('status')}")
    else:
        check("C5  Graded submission has marks", False, f"status={resp.status_code}")
else:
    check("C5  Graded submission has marks", False, "no sub_id")

# C6: Duplicate submission -> 400
if pub_assign_id:
    resp = api_post('/api/lms/submissions/', {
        'assignment': pub_assign_id,
        'student': student_1.id,
        'school': SID_A,
        'submission_text': 'Duplicate',
    }, token_admin, SID_A)
    check("C6  Duplicate submission -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("C6  Duplicate submission -> 400", False, "no assignment")


# ==================================================================
# LEVEL D: PERMISSIONS & CROSS-CUTTING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: PERMISSIONS & CROSS-CUTTING")
print("=" * 70)

# D1: Unauthenticated -> 401
resp = _client.get('/api/lms/lesson-plans/')
check("D1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# D2: Invalid token -> 401
resp = _client.get(
    '/api/lms/lesson-plans/',
    HTTP_AUTHORIZATION='Bearer garbage_token',
)
check("D2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# D3: Teacher can't update assignment -> 403
if assign_id:
    resp = api_patch(f'/api/lms/assignments/{assign_id}/', {
        'title': 'Teacher edit',
    }, token_teacher, SID_A)
    check("D3  Teacher can't update assignment -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("D3  Teacher can't update assignment -> 403", False, "no assign_id")

# D4: Teacher can't delete assignment -> 403
if assign_id:
    resp = api_delete(f'/api/lms/assignments/{assign_id}/', token_teacher, SID_A)
    check("D4  Teacher can't delete assignment -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("D4  Teacher can't delete assignment -> 403", False, "no assign_id")


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 12 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED - review output above.")
print()
