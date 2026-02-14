"""
Phase 9 — Parents Module Tests
===============================
Covers: ParentRegistration, MyChildren, ChildOverview, ChildAttendance,
        ChildFees, ChildTimetable, ChildExamResults, LeaveRequests,
        Messaging, Admin parent/child management, Admin invite, Admin leave review.

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase9_parents.py', encoding='utf-8').read())"
"""

import json, uuid
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone
from django.test import Client

# ── Seed data ────────────────────────────────────────────────────────────
exec(open('seed_test_data.py', encoding='utf-8').read())
seed = get_seed_data()
reset_counters()

org        = seed['org']
school_a   = seed['school_a']
school_b   = seed['school_b']
SID_A      = seed['SID_A']
SID_B      = seed['SID_B']
users      = seed['users']
tokens     = seed['tokens']
students   = seed['students']
classes    = seed['classes']
terms      = seed['terms']
ay         = seed['academic_year']

token_admin     = tokens['admin']
token_principal = tokens['principal']
token_teacher   = tokens['teacher']
token_admin_b   = tokens['admin_b']

P9 = "P9PAR_"

print("\n" + "=" * 70)
print("  PHASE 9: PARENTS MODULE TESTS")
print("=" * 70)

# ── Model imports ────────────────────────────────────────────────────────
from parents.models import (
    ParentProfile, ParentChild, ParentInvite,
    ParentLeaveRequest, ParentMessage,
)
from students.models import Student
from users.models import User
from schools.models import UserSchoolMembership

# ── Clean up any leftover P9 data ────────────────────────────────────────
ParentMessage.objects.filter(message__startswith=P9).delete()
ParentLeaveRequest.objects.filter(reason__startswith=P9).delete()
ParentChild.objects.filter(parent__phone__startswith=P9).delete()
ParentInvite.objects.filter(parent_phone__startswith=P9).delete()
ParentProfile.objects.filter(phone__startswith=P9).delete()
User.objects.filter(username__startswith=P9).delete()

# Pick test students
student_1 = students[0]  # Ali Hassan, Class 1A
student_2 = students[1]  # Sara Khan, Class 1A
student_3 = students[4]  # Hamza Raza, Class 2B

# ==================================================================
# LEVEL A: ADMIN INVITE GENERATION
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL A: ADMIN INVITE GENERATION")
print("=" * 70)

# A1: Generate invite for student_1 (Admin)
resp = api_post('/api/parents/admin/generate-invite/', {
    'student_id': student_1.id,
    'relation': 'FATHER',
    'parent_phone': f'{P9}03001234567',
}, token_admin, SID_A)
check("A1  Generate invite (Admin)", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:200]}")
invite_1_code = None
invite_1_id = None
if resp.status_code == 201:
    d = resp.json()
    invite_1_code = d.get('invite_code')
    invite_1_id = d.get('id')

# A2: Generate invite for student_2 (Principal)
resp = api_post('/api/parents/admin/generate-invite/', {
    'student_id': student_2.id,
    'relation': 'MOTHER',
    'parent_phone': f'{P9}03009876543',
}, token_principal, SID_A)
check("A2  Generate invite (Principal)", resp.status_code == 201,
      f"status={resp.status_code}")
invite_2_code = None
if resp.status_code == 201:
    invite_2_code = resp.json().get('invite_code')

# A3: Generate invite (Teacher) -> 403
resp = api_post('/api/parents/admin/generate-invite/', {
    'student_id': student_1.id,
    'relation': 'GUARDIAN',
}, token_teacher, SID_A)
check("A3  Generate invite (Teacher) -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# A4: Generate invite for non-existent student -> 400
resp = api_post('/api/parents/admin/generate-invite/', {
    'student_id': 999999,
    'relation': 'FATHER',
}, token_admin, SID_A)
check("A4  Invalid student_id -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# A5: Invite has correct fields
if invite_1_code:
    invite_obj = ParentInvite.objects.get(invite_code=invite_1_code)
    check("A5  Invite fields correct",
          invite_obj.is_valid and not invite_obj.is_used and invite_obj.school == school_a,
          f"is_valid={invite_obj.is_valid} is_used={invite_obj.is_used}")
else:
    check("A5  Invite fields correct", False, "no invite code")


# ==================================================================
# LEVEL B: PARENT REGISTRATION
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL B: PARENT REGISTRATION")
print("=" * 70)

# B1: Register parent with invite code
resp = _client.post(
    '/api/parents/register/',
    data=json.dumps({
        'invite_code': invite_1_code,
        'username': f'{P9}parent_father',
        'password': PASSWORD,
        'confirm_password': PASSWORD,
        'first_name': 'Ahmed',
        'last_name': 'Hassan',
        'phone': f'{P9}03001234567',
        'relation': 'FATHER',
    }),
    content_type='application/json',
)
check("B1  Register parent with invite", resp.status_code == 201,
      f"status={resp.status_code} body={resp.content[:300]}")
parent_1_profile_id = None
parent_1_user_id = None
if resp.status_code == 201:
    d = resp.json()
    parent_1_profile_id = d.get('parent_profile_id')
    parent_1_user_id = d.get('user_id')

# B2: Verify invite is now used
if invite_1_code:
    invite_obj.refresh_from_db()
    check("B2  Invite marked as used", invite_obj.is_used == True,
          f"is_used={invite_obj.is_used}")
else:
    check("B2  Invite marked as used", False, "no invite")

# B3: Re-use same invite -> 400
resp = _client.post(
    '/api/parents/register/',
    data=json.dumps({
        'invite_code': invite_1_code,
        'username': f'{P9}parent_dup',
        'password': PASSWORD,
        'confirm_password': PASSWORD,
        'phone': f'{P9}03005555555',
    }),
    content_type='application/json',
)
check("B3  Re-use invite -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# B4: Invalid invite code -> 400
resp = _client.post(
    '/api/parents/register/',
    data=json.dumps({
        'invite_code': 'INVALID_CODE_XYZ',
        'username': f'{P9}parent_bad',
        'password': PASSWORD,
        'confirm_password': PASSWORD,
        'phone': f'{P9}03006666666',
    }),
    content_type='application/json',
)
check("B4  Invalid invite code -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# B5: Password mismatch -> 400
if invite_2_code:
    resp = _client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': invite_2_code,
            'username': f'{P9}parent_mismatch',
            'password': 'ParentPass123!',
            'confirm_password': 'DifferentPass123!',
            'phone': f'{P9}03007777777',
        }),
        content_type='application/json',
    )
    check("B5  Password mismatch -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("B5  Password mismatch -> 400", False, "no invite_2")

# B6: Duplicate username -> 400
if invite_2_code:
    resp = _client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': invite_2_code,
            'username': f'{P9}parent_father',  # already exists
            'password': 'ParentPass123!',
            'confirm_password': 'ParentPass123!',
            'phone': f'{P9}03008888888',
        }),
        content_type='application/json',
    )
    check("B6  Duplicate username -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("B6  Duplicate username -> 400", False, "no invite_2")

# B7: Register second parent (mother) with invite_2
if invite_2_code:
    resp = _client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': invite_2_code,
            'username': f'{P9}parent_mother',
            'password': PASSWORD,
            'confirm_password': PASSWORD,
            'first_name': 'Fatima',
            'last_name': 'Khan',
            'phone': f'{P9}03009876543',
            'relation': 'MOTHER',
        }),
        content_type='application/json',
    )
    check("B7  Register second parent (Mother)", resp.status_code == 201,
          f"status={resp.status_code}")
    parent_2_profile_id = None
    if resp.status_code == 201:
        parent_2_profile_id = resp.json().get('parent_profile_id')
else:
    check("B7  Register second parent (Mother)", False, "no invite_2")
    parent_2_profile_id = None

# B8: Verify ParentChild link was created
if parent_1_profile_id:
    link = ParentChild.objects.filter(parent_id=parent_1_profile_id, student=student_1).first()
    check("B8  ParentChild link created",
          link is not None and link.relation == 'FATHER' and link.is_primary == True,
          f"link={link}")
else:
    check("B8  ParentChild link created", False, "no parent profile")

# B9: Verify UserSchoolMembership with PARENT role
if parent_1_user_id:
    mem = UserSchoolMembership.objects.filter(
        user_id=parent_1_user_id, school=school_a, role='PARENT'
    ).first()
    check("B9  Membership with PARENT role", mem is not None, f"mem={mem}")
else:
    check("B9  Membership with PARENT role", False, "no user id")

# Login as parent
token_parent_1 = login(f'{P9}parent_father')
token_parent_2 = login(f'{P9}parent_mother') if parent_2_profile_id else None
check("B10 Parent login works", token_parent_1 is not None, "login failed")

# ==================================================================
# LEVEL C: MY CHILDREN & CHILD VIEWS
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL C: MY CHILDREN & CHILD VIEWS")
print("=" * 70)

# C1: My children (parent_1 -> student_1)
if token_parent_1:
    resp = api_get('/api/parents/my-children/', token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("C1  My children (parent_1)", resp.status_code == 200 and len(data) == 1,
          f"status={resp.status_code} count={len(data)}")
    if data:
        check("C1b Correct student linked",
              data[0].get('student') == student_1.id,
              f"student_id={data[0].get('student')}")
else:
    check("C1  My children (parent_1)", False, "no parent token")
    check("C1b Correct student linked", False, "no parent token")

# C2: My children (parent_2 -> student_2)
if token_parent_2:
    resp = api_get('/api/parents/my-children/', token_parent_2, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("C2  My children (parent_2)", resp.status_code == 200 and len(data) == 1,
          f"status={resp.status_code} count={len(data)}")
else:
    check("C2  My children (parent_2)", False, "no parent_2 token")

# C3: Child overview
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_1.id}/overview/',
                   token_parent_1, SID_A)
    check("C3  Child overview", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
    if resp.status_code == 200:
        d = resp.json()
        check("C3b Overview has required fields",
              all(k in d for k in ['student_name', 'attendance_summary', 'fee_summary']),
              f"keys={list(d.keys())}")
else:
    check("C3  Child overview", False, "no parent token")
    check("C3b Overview has required fields", False, "no parent token")

# C4: Parent can't access other's child
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_2.id}/overview/',
                   token_parent_1, SID_A)
    check("C4  Can't access other's child -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("C4  Can't access other's child -> 403", False, "no parent token")

# C5: Admin can access any child overview
resp = api_get(f'/api/parents/children/{student_1.id}/overview/',
               token_admin, SID_A)
check("C5  Admin can access child overview", resp.status_code == 200,
      f"status={resp.status_code}")

# C6: Child attendance (no records yet, should return empty list)
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_1.id}/attendance/',
                   token_parent_1, SID_A)
    check("C6  Child attendance endpoint", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C6  Child attendance endpoint", False, "no parent token")

# C7: Child fees (no records yet)
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_1.id}/fees/',
                   token_parent_1, SID_A)
    check("C7  Child fees endpoint", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C7  Child fees endpoint", False, "no parent token")

# C8: Child timetable
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_1.id}/timetable/',
                   token_parent_1, SID_A)
    check("C8  Child timetable endpoint", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C8  Child timetable endpoint", False, "no parent token")

# C9: Child exam results
if token_parent_1:
    resp = api_get(f'/api/parents/children/{student_1.id}/exam-results/',
                   token_parent_1, SID_A)
    check("C9  Child exam results endpoint", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("C9  Child exam results endpoint", False, "no parent token")

# C10: Teacher can't access parent endpoints
resp = api_get('/api/parents/my-children/', token_teacher, SID_A)
check("C10 Teacher can't access my-children -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# ==================================================================
# LEVEL D: PARENT LEAVE REQUESTS
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL D: PARENT LEAVE REQUESTS")
print("=" * 70)

leave_req_id = None

# D1: Create leave request (parent)
if token_parent_1:
    resp = api_post('/api/parents/leave-requests/', {
        'student': student_1.id,
        'start_date': '2025-06-01',
        'end_date': '2025-06-03',
        'reason': f'{P9}Medical appointment for checkup',
    }, token_parent_1, SID_A)
    check("D1  Create leave request (parent)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:300]}")
    if resp.status_code == 201:
        leave_req_id = resp.json().get('id')
else:
    check("D1  Create leave request (parent)", False, "no parent token")

# D2: Leave request has PENDING status
if leave_req_id:
    lr = ParentLeaveRequest.objects.get(id=leave_req_id)
    check("D2  Leave status is PENDING", lr.status == 'PENDING',
          f"status={lr.status}")
else:
    check("D2  Leave status is PENDING", False, "no leave req")

# D3: Create second leave request
leave_req_2_id = None
if token_parent_1:
    resp = api_post('/api/parents/leave-requests/', {
        'student': student_1.id,
        'start_date': '2025-07-10',
        'end_date': '2025-07-12',
        'reason': f'{P9}Family function',
    }, token_parent_1, SID_A)
    check("D3  Create second leave request", resp.status_code == 201,
          f"status={resp.status_code}")
    if resp.status_code == 201:
        leave_req_2_id = resp.json().get('id')
else:
    check("D3  Create second leave request", False, "no parent token")

# D4: Start date > end date -> 400
if token_parent_1:
    resp = api_post('/api/parents/leave-requests/', {
        'student': student_1.id,
        'start_date': '2025-08-10',
        'end_date': '2025-08-05',
        'reason': f'{P9}Invalid dates',
    }, token_parent_1, SID_A)
    check("D4  start_date > end_date -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("D4  start_date > end_date -> 400", False, "no parent token")

# D5: Parent can't create leave for other's child
if token_parent_1:
    resp = api_post('/api/parents/leave-requests/', {
        'student': student_2.id,
        'start_date': '2025-09-01',
        'end_date': '2025-09-02',
        'reason': f'{P9}Not my child',
    }, token_parent_1, SID_A)
    check("D5  Can't create leave for other's child -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("D5  Can't create leave for other's child -> 403", False, "no parent token")

# D6: List leave requests (parent sees own)
if token_parent_1:
    resp = api_get('/api/parents/leave-requests/', token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("D6  List leave requests (parent)", resp.status_code == 200 and len(data) >= 2,
          f"status={resp.status_code} count={len(data)}")
else:
    check("D6  List leave requests (parent)", False, "no parent token")

# D7: Retrieve single leave request
if token_parent_1 and leave_req_id:
    resp = api_get(f'/api/parents/leave-requests/{leave_req_id}/',
                   token_parent_1, SID_A)
    check("D7  Retrieve leave request", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("D7  Retrieve leave request", False, "missing data")

# D8: Update leave request (only pending)
if token_parent_1 and leave_req_id:
    resp = api_patch(f'/api/parents/leave-requests/{leave_req_id}/', {
        'reason': f'{P9}Updated reason: dental checkup',
    }, token_parent_1, SID_A)
    check("D8  Update pending leave request", resp.status_code == 200,
          f"status={resp.status_code}")
else:
    check("D8  Update pending leave request", False, "missing data")

# D9: Soft-delete (cancel) leave request
if token_parent_1 and leave_req_2_id:
    resp = api_delete(f'/api/parents/leave-requests/{leave_req_2_id}/',
                      token_parent_1, SID_A)
    check("D9  Soft-delete (cancel) leave request", resp.status_code in (200, 204),
          f"status={resp.status_code}")
    lr2 = ParentLeaveRequest.objects.get(id=leave_req_2_id)
    check("D9b Status is CANCELLED", lr2.status == 'CANCELLED',
          f"status={lr2.status}")
else:
    check("D9  Soft-delete (cancel) leave request", False, "missing data")
    check("D9b Status is CANCELLED", False, "missing data")

# D10: Can't update cancelled request
if token_parent_1 and leave_req_2_id:
    resp = api_patch(f'/api/parents/leave-requests/{leave_req_2_id}/', {
        'reason': f'{P9}Should fail',
    }, token_parent_1, SID_A)
    check("D10 Can't update cancelled request -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("D10 Can't update cancelled request -> 400", False, "missing data")

# D11: Teacher can't access leave requests -> 403
resp = api_get('/api/parents/leave-requests/', token_teacher, SID_A)
check("D11 Teacher can't access leave requests -> 403", resp.status_code == 403,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL E: ADMIN LEAVE REVIEW
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL E: ADMIN LEAVE REVIEW")
print("=" * 70)

# E1: Admin list all leave requests
resp = api_get('/api/parents/admin/leave-requests/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
check("E1  Admin list leave requests", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# E2: Filter by status=PENDING
resp = api_get('/api/parents/admin/leave-requests/?status=PENDING',
               token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
pending_count = len(data)
check("E2  Filter by status=PENDING", resp.status_code == 200 and pending_count >= 1,
      f"status={resp.status_code} count={pending_count}")

# E3: Filter by student_id
resp = api_get(f'/api/parents/admin/leave-requests/?student_id={student_1.id}',
               token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
check("E3  Filter by student_id", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# E4: Approve leave request
if leave_req_id:
    resp = api_patch(f'/api/parents/admin/leave-requests/{leave_req_id}/review/', {
        'status': 'APPROVED',
        'review_note': f'{P9}Approved for medical reasons',
    }, token_admin, SID_A)
    check("E4  Approve leave request", resp.status_code == 200,
          f"status={resp.status_code} body={resp.content[:200]}")
    if resp.status_code == 200:
        lr = ParentLeaveRequest.objects.get(id=leave_req_id)
        check("E4b Status is APPROVED", lr.status == 'APPROVED',
              f"status={lr.status}")
        check("E4c reviewed_by is admin", lr.reviewed_by == users['admin'],
              f"reviewed_by={lr.reviewed_by}")
else:
    check("E4  Approve leave request", False, "no leave_req_id")
    check("E4b Status is APPROVED", False, "no leave_req_id")
    check("E4c reviewed_by is admin", False, "no leave_req_id")

# E5: Can't review already reviewed request -> 400
if leave_req_id:
    resp = api_patch(f'/api/parents/admin/leave-requests/{leave_req_id}/review/', {
        'status': 'REJECTED',
    }, token_admin, SID_A)
    check("E5  Can't re-review -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("E5  Can't re-review -> 400", False, "no leave_req_id")

# E6: Create and reject another leave request
leave_reject_id = None
if token_parent_1:
    resp = api_post('/api/parents/leave-requests/', {
        'student': student_1.id,
        'start_date': '2025-10-01',
        'end_date': '2025-10-02',
        'reason': f'{P9}To be rejected',
    }, token_parent_1, SID_A)
    if resp.status_code == 201:
        leave_reject_id = resp.json().get('id')

if leave_reject_id:
    resp = api_patch(f'/api/parents/admin/leave-requests/{leave_reject_id}/review/', {
        'status': 'REJECTED',
        'review_note': f'{P9}Insufficient reason',
    }, token_admin, SID_A)
    check("E6  Reject leave request", resp.status_code == 200,
          f"status={resp.status_code}")
    lr = ParentLeaveRequest.objects.get(id=leave_reject_id)
    check("E6b Status is REJECTED", lr.status == 'REJECTED',
          f"status={lr.status}")
else:
    check("E6  Reject leave request", False, "failed to create")
    check("E6b Status is REJECTED", False, "failed to create")

# E7: Teacher can't access admin leave list -> 403
resp = api_get('/api/parents/admin/leave-requests/', token_teacher, SID_A)
check("E7  Teacher can't access admin leave list -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

# E8: Parent can't update approved leave -> 400
if token_parent_1 and leave_req_id:
    resp = api_patch(f'/api/parents/leave-requests/{leave_req_id}/', {
        'reason': f'{P9}Should fail - already approved',
    }, token_parent_1, SID_A)
    check("E8  Parent can't update approved leave -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("E8  Parent can't update approved leave -> 400", False, "missing data")


# ==================================================================
# LEVEL F: MESSAGING
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL F: MESSAGING")
print("=" * 70)

admin_user = users['admin']
teacher_user = users['teacher']

# F1: Parent sends message to admin
msg_1_id = None
thread_1_id = None
if token_parent_1:
    resp = api_post('/api/parents/messages/', {
        'recipient_user': admin_user.id,
        'student': student_1.id,
        'message': f'{P9}Hello, I have a query about my child.',
    }, token_parent_1, SID_A)
    check("F1  Parent sends message to admin", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    if resp.status_code == 201:
        d = resp.json()
        msg_1_id = d.get('id')
        thread_1_id = d.get('thread_id')
else:
    check("F1  Parent sends message to admin", False, "no parent token")

# F2: Admin replies in same thread
msg_2_id = None
if token_admin and thread_1_id:
    resp = api_post('/api/parents/messages/', {
        'recipient_user': User.objects.get(username=f'{P9}parent_father').id,
        'student': student_1.id,
        'message': f'{P9}Sure, what would you like to know?',
        'thread_id': thread_1_id,
    }, token_admin, SID_A)
    check("F2  Admin replies in same thread", resp.status_code == 201,
          f"status={resp.status_code}")
    if resp.status_code == 201:
        msg_2_id = resp.json().get('id')
        # Verify same thread
        check("F2b Same thread_id", resp.json().get('thread_id') == thread_1_id,
              f"thread={resp.json().get('thread_id')}")
else:
    check("F2  Admin replies in same thread", False, "missing data")
    check("F2b Same thread_id", False, "missing data")

# F3: List threads (parent sees 1 thread)
if token_parent_1:
    resp = api_get('/api/parents/messages/threads/', token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("F3  List threads (parent)", resp.status_code == 200 and len(data) >= 1,
          f"status={resp.status_code} count={len(data)}")
    if data:
        thread = data[0]
        check("F3b Thread has correct fields",
              'thread_id' in thread and 'latest_message' in thread and 'unread_count' in thread,
              f"keys={list(thread.keys())}")
else:
    check("F3  List threads (parent)", False, "no parent token")
    check("F3b Thread has correct fields", False, "no parent token")

# F4: Get thread messages
if token_parent_1 and thread_1_id:
    resp = api_get(f'/api/parents/messages/threads/{thread_1_id}/',
                   token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("F4  Get thread messages", resp.status_code == 200 and len(data) >= 2,
          f"status={resp.status_code} count={len(data)}")
else:
    check("F4  Get thread messages", False, "missing data")

# F5: Mark message as read (parent marks admin's reply)
if token_parent_1 and msg_2_id:
    resp = api_patch(f'/api/parents/messages/{msg_2_id}/read/', {},
                     token_parent_1, SID_A)
    check("F5  Mark message as read", resp.status_code == 200,
          f"status={resp.status_code}")
    if resp.status_code == 200:
        msg = ParentMessage.objects.get(id=msg_2_id)
        check("F5b is_read=True", msg.is_read == True, f"is_read={msg.is_read}")
        check("F5c read_at set", msg.read_at is not None, f"read_at={msg.read_at}")
else:
    check("F5  Mark message as read", False, "missing data")
    check("F5b is_read=True", False, "missing data")
    check("F5c read_at set", False, "missing data")

# F6: Can't mark own sent message as read (not recipient) -> 404
if token_parent_1 and msg_1_id:
    resp = api_patch(f'/api/parents/messages/{msg_1_id}/read/', {},
                     token_parent_1, SID_A)
    check("F6  Can't mark own msg as read -> 404", resp.status_code == 404,
          f"status={resp.status_code}")
else:
    check("F6  Can't mark own msg as read -> 404", False, "missing data")

# F7: Parent can't send message about other's child -> 403
if token_parent_1:
    resp = api_post('/api/parents/messages/', {
        'recipient_user': admin_user.id,
        'student': student_2.id,
        'message': f'{P9}Should not be allowed',
    }, token_parent_1, SID_A)
    check("F7  Can't message about other's child -> 403", resp.status_code == 403,
          f"status={resp.status_code}")
else:
    check("F7  Can't message about other's child -> 403", False, "no parent token")

# F8: Admin list threads
resp = api_get('/api/parents/messages/threads/', token_admin, SID_A)
check("F8  Admin list threads", resp.status_code == 200,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL G: ADMIN PARENT/CHILD MANAGEMENT
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL G: ADMIN PARENT/CHILD MANAGEMENT")
print("=" * 70)

# G1: Admin list parents for school
resp = api_get('/api/parents/admin/parents/', token_admin, SID_A)
data = resp.json() if resp.status_code == 200 else []
check("G1  Admin list parents", resp.status_code == 200 and len(data) >= 1,
      f"status={resp.status_code} count={len(data)}")

# G2: Admin link parent_1 to student_3 (additional child)
link_id = None
if parent_1_profile_id:
    resp = api_post('/api/parents/admin/link-child/', {
        'parent_profile_id': parent_1_profile_id,
        'student_id': student_3.id,
        'relation': 'FATHER',
        'is_primary': False,
        'can_pickup': True,
    }, token_admin, SID_A)
    check("G2  Admin link child to parent", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    if resp.status_code == 201:
        link_id = resp.json().get('id')
else:
    check("G2  Admin link child to parent", False, "no parent profile")

# G3: Verify parent now has 2 children
if token_parent_1:
    resp = api_get('/api/parents/my-children/', token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("G3  Parent now has 2 children", resp.status_code == 200 and len(data) == 2,
          f"status={resp.status_code} count={len(data)}")
else:
    check("G3  Parent now has 2 children", False, "no parent token")

# G4: Duplicate link -> 400
if parent_1_profile_id:
    resp = api_post('/api/parents/admin/link-child/', {
        'parent_profile_id': parent_1_profile_id,
        'student_id': student_3.id,
        'relation': 'FATHER',
    }, token_admin, SID_A)
    check("G4  Duplicate link -> 400", resp.status_code == 400,
          f"status={resp.status_code}")
else:
    check("G4  Duplicate link -> 400", False, "no parent profile")

# G5: Missing fields -> 400
resp = api_post('/api/parents/admin/link-child/', {
    'parent_profile_id': parent_1_profile_id,
    # missing student_id
}, token_admin, SID_A)
check("G5  Missing student_id -> 400", resp.status_code == 400,
      f"status={resp.status_code}")

# G6: Non-existent parent profile -> 404
resp = api_post('/api/parents/admin/link-child/', {
    'parent_profile_id': 999999,
    'student_id': student_1.id,
}, token_admin, SID_A)
check("G6  Non-existent parent -> 404", resp.status_code == 404,
      f"status={resp.status_code}")

# G7: Admin unlink child
if link_id:
    resp = api_delete(f'/api/parents/admin/unlink-child/{link_id}/',
                      token_admin, SID_A)
    check("G7  Admin unlink child", resp.status_code == 204,
          f"status={resp.status_code}")
    # Verify link deleted
    check("G7b Link removed from DB",
          not ParentChild.objects.filter(id=link_id).exists(),
          "link still exists")
else:
    check("G7  Admin unlink child", False, "no link_id")
    check("G7b Link removed from DB", False, "no link_id")

# G8: Verify parent back to 1 child
if token_parent_1:
    resp = api_get('/api/parents/my-children/', token_parent_1, SID_A)
    data = resp.json() if resp.status_code == 200 else []
    check("G8  Parent back to 1 child", resp.status_code == 200 and len(data) == 1,
          f"status={resp.status_code} count={len(data)}")
else:
    check("G8  Parent back to 1 child", False, "no parent token")

# G9: Teacher can't access admin endpoints -> 403
resp = api_get('/api/parents/admin/parents/', token_teacher, SID_A)
check("G9  Teacher can't list parents -> 403", resp.status_code == 403,
      f"status={resp.status_code}")

resp = api_post('/api/parents/admin/link-child/', {
    'parent_profile_id': parent_1_profile_id,
    'student_id': student_3.id,
}, token_teacher, SID_A)
check("G10 Teacher can't link child -> 403", resp.status_code == 403,
      f"status={resp.status_code}")


# ==================================================================
# LEVEL H: CROSS-CUTTING & SECURITY
# ==================================================================
print("\n" + "=" * 70)
print("  LEVEL H: CROSS-CUTTING & SECURITY")
print("=" * 70)

# H1: Unauthenticated -> 401 (except register which is AllowAny)
resp = _client.get('/api/parents/my-children/')
check("H1  Unauthenticated -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# H2: Invalid token -> 401
resp = _client.get(
    '/api/parents/my-children/',
    HTTP_AUTHORIZATION='Bearer invalid_token_xyz',
    HTTP_X_SCHOOL_ID=str(SID_A),
)
check("H2  Invalid token -> 401", resp.status_code == 401,
      f"status={resp.status_code}")

# H3: School B admin can't see School A parents
resp = api_get('/api/parents/admin/parents/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else []
p9_parents = [p for p in data if any(
    c.get('student_name', '').startswith('SEED_TEST_') for c in p.get('children', [])
)]
check("H3  School B isolation (parents)", resp.status_code == 200 and len(p9_parents) == 0,
      f"status={resp.status_code} p9_count={len(p9_parents)}")

# H4: School B admin can't see School A leave requests
resp = api_get('/api/parents/admin/leave-requests/', token_admin_b, SID_B)
data = resp.json() if resp.status_code == 200 else []
check("H4  School B isolation (leave reqs)", resp.status_code == 200 and len(data) == 0,
      f"status={resp.status_code} count={len(data)}")

# H5: Expired invite code -> 400
if True:
    # Create an expired invite directly
    expired_invite = ParentInvite.objects.create(
        school=school_a,
        student=student_3,
        invite_code=f'{P9}EXPIRED_CODE',
        relation='GUARDIAN',
        parent_phone=f'{P9}expired',
        expires_at=timezone.now() - timedelta(days=1),
        created_by=users['admin'],
    )
    resp = _client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': f'{P9}EXPIRED_CODE',
            'username': f'{P9}parent_expired',
            'password': 'ParentPass123!',
            'confirm_password': 'ParentPass123!',
            'phone': f'{P9}00000000',
        }),
        content_type='application/json',
    )
    check("H5  Expired invite code -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

# H6: Register endpoint is public (AllowAny) - returns 400 not 401
resp = _client.post(
    '/api/parents/register/',
    data=json.dumps({'invite_code': 'doesntexist'}),
    content_type='application/json',
)
check("H6  Register is public (not 401)", resp.status_code == 400,
      f"status={resp.status_code}")

# H7: Admin can access child overview via parent endpoint
resp = api_get(f'/api/parents/children/{student_3.id}/overview/',
               token_admin, SID_A)
check("H7  Admin can view any child overview", resp.status_code == 200,
      f"status={resp.status_code}")

# H8: Unlink non-existent link -> 404
resp = api_delete('/api/parents/admin/unlink-child/999999/', token_admin, SID_A)
check("H8  Unlink non-existent -> 404", resp.status_code == 404,
      f"status={resp.status_code}")


# ==================================================================
# SUMMARY
# ==================================================================
print("\n" + "=" * 70)
total = passed + failed
print(f"  PHASE 9 RESULTS: {passed}/{total} passed, {failed} failed")
print("=" * 70)

if failed == 0:
    print("  ALL TESTS PASSED!")
else:
    print(f"  {failed} TESTS FAILED — review output above.")
print()
