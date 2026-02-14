"""
Phase 9 — Parents Module Tests (pytest format)
================================================
Covers: ParentRegistration, MyChildren, ChildOverview, ChildAttendance,
        ChildFees, ChildTimetable, ChildExamResults, LeaveRequests,
        Messaging, Admin parent/child management, Admin invite, Admin leave review.

Run:
    cd backend
    pytest tests/test_phase9_parents.py -v --tb=short
"""

import json
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from parents.models import (
    ParentProfile,
    ParentChild,
    ParentInvite,
    ParentLeaveRequest,
    ParentMessage,
)
from students.models import Student
from users.models import User
from schools.models import UserSchoolMembership


# ── Shared prefix for this phase ────────────────────────────────────────────
P9 = "P9PAR_"


# ==========================================================================
# LEVEL A: ADMIN INVITE GENERATION
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestAdminInviteGeneration:
    """Admin / Principal can generate parent invite codes."""

    def test_a1_generate_invite_admin(self, seed_data, api):
        """Admin generates an invite for student_1."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_1.id,
            'relation': 'FATHER',
            'parent_phone': f'{P9}03001234567',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:200]}"
        d = resp.json()
        assert 'invite_code' in d
        assert 'id' in d

    def test_a2_generate_invite_principal(self, seed_data, api):
        """Principal generates an invite for student_2."""
        student_2 = seed_data['students'][1]
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_2.id,
            'relation': 'MOTHER',
            'parent_phone': f'{P9}03009876543',
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_a3_generate_invite_teacher_forbidden(self, seed_data, api):
        """Teacher cannot generate invites -> 403."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_1.id,
            'relation': 'GUARDIAN',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_a4_generate_invite_invalid_student(self, seed_data, api):
        """Non-existent student_id -> 400."""
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': 999999,
            'relation': 'FATHER',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_a5_invite_fields_correct(self, seed_data, api):
        """Generated invite has correct fields (is_valid, not used, correct school)."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_1.id,
            'relation': 'FATHER',
            'parent_phone': f'{P9}03001234567_a5',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        invite_code = resp.json()['invite_code']
        invite_obj = ParentInvite.objects.get(invite_code=invite_code)
        assert invite_obj.is_valid, f"is_valid={invite_obj.is_valid}"
        assert not invite_obj.is_used, f"is_used={invite_obj.is_used}"
        assert invite_obj.school == seed_data['school_a']


# ==========================================================================
# LEVEL B: PARENT REGISTRATION
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestParentRegistration:
    """Registration flow using invite codes."""

    @pytest.fixture(autouse=True)
    def _setup_invites(self, seed_data, api):
        """Generate two invites used throughout this class."""
        self.seed = seed_data
        self.api = api
        self.client = api.client
        self.password = seed_data['password']
        student_1 = seed_data['students'][0]
        student_2 = seed_data['students'][1]

        # Invite 1 (father, student_1)
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_1.id,
            'relation': 'FATHER',
            'parent_phone': f'{P9}03001234567_b',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        self.invite_1_code = resp.json()['invite_code']

        # Invite 2 (mother, student_2)
        resp = api.post('/api/parents/admin/generate-invite/', {
            'student_id': student_2.id,
            'relation': 'MOTHER',
            'parent_phone': f'{P9}03009876543_b',
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 201
        self.invite_2_code = resp.json()['invite_code']

    def test_b1_register_parent_with_invite(self, seed_data, api):
        """Register parent with a valid invite code."""
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b1',
                'password': self.password,
                'confirm_password': self.password,
                'first_name': 'Ahmed',
                'last_name': 'Hassan',
                'phone': f'{P9}03001234567_b',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 201, f"status={resp.status_code} body={resp.content[:300]}"
        d = resp.json()
        assert 'parent_profile_id' in d
        assert 'user_id' in d

    def test_b2_invite_marked_as_used(self, seed_data, api):
        """After registration the invite is marked as used."""
        # Register first
        self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b2',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03001234567_b2',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        invite_obj = ParentInvite.objects.get(invite_code=self.invite_1_code)
        assert invite_obj.is_used is True, f"is_used={invite_obj.is_used}"

    def test_b3_reuse_invite_fails(self, seed_data, api):
        """Re-using an already consumed invite -> 400."""
        # First use
        self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b3',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03001234567_b3',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        # Second use
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_dup_b3',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03005555555_b3',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_b4_invalid_invite_code(self, seed_data, api):
        """Invalid invite code -> 400."""
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': 'INVALID_CODE_XYZ',
                'username': f'{P9}parent_bad_b4',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03006666666_b4',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_b5_password_mismatch(self, seed_data, api):
        """Password mismatch -> 400."""
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_2_code,
                'username': f'{P9}parent_mismatch_b5',
                'password': 'ParentPass123!',
                'confirm_password': 'DifferentPass123!',
                'phone': f'{P9}03007777777_b5',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_b6_duplicate_username(self, seed_data, api):
        """Duplicate username -> 400."""
        # Register first user
        self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b6',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03001234567_b6',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        # Try same username with invite_2
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_2_code,
                'username': f'{P9}parent_father_b6',  # duplicate
                'password': 'ParentPass123!',
                'confirm_password': 'ParentPass123!',
                'phone': f'{P9}03008888888_b6',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_b7_register_second_parent_mother(self, seed_data, api):
        """Register a second parent (mother) with invite_2."""
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_2_code,
                'username': f'{P9}parent_mother_b7',
                'password': self.password,
                'confirm_password': self.password,
                'first_name': 'Fatima',
                'last_name': 'Khan',
                'phone': f'{P9}03009876543_b7',
                'relation': 'MOTHER',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 201, f"status={resp.status_code}"
        assert 'parent_profile_id' in resp.json()

    def test_b8_parent_child_link_created(self, seed_data, api):
        """ParentChild link is created with correct relation and is_primary."""
        student_1 = seed_data['students'][0]
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b8',
                'password': self.password,
                'confirm_password': self.password,
                'first_name': 'Ahmed',
                'last_name': 'Hassan',
                'phone': f'{P9}03001234567_b8',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 201
        parent_profile_id = resp.json()['parent_profile_id']
        link = ParentChild.objects.filter(
            parent_id=parent_profile_id, student=student_1,
        ).first()
        assert link is not None, "ParentChild link was not created"
        assert link.relation == 'FATHER'
        assert link.is_primary is True

    def test_b9_user_school_membership_parent_role(self, seed_data, api):
        """UserSchoolMembership with PARENT role is created."""
        resp = self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b9',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03001234567_b9',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 201
        user_id = resp.json()['user_id']
        mem = UserSchoolMembership.objects.filter(
            user_id=user_id, school=seed_data['school_a'], role='PARENT',
        ).first()
        assert mem is not None, "PARENT membership not created"

    def test_b10_parent_login_works(self, seed_data, api):
        """Registered parent can log in."""
        self.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': self.invite_1_code,
                'username': f'{P9}parent_father_b10',
                'password': self.password,
                'confirm_password': self.password,
                'phone': f'{P9}03001234567_b10',
                'relation': 'FATHER',
            }),
            content_type='application/json',
        )
        token = api.login(f'{P9}parent_father_b10')
        assert token is not None, "Parent login failed"


# ==========================================================================
# Helper fixture: registered parent with token
# ==========================================================================


@pytest.fixture
def parent_env(seed_data, api):
    """
    Register two parents and return a dict with their tokens and profile IDs.
    This fixture is reused by classes C through H.
    Uses a unique suffix per invocation to avoid username collisions.
    """
    uid = uuid.uuid4().hex[:6]
    client = api.client
    password = seed_data['password']
    student_1 = seed_data['students'][0]
    student_2 = seed_data['students'][1]

    # Phone numbers must be <= 20 chars
    phone1 = f'0300{uid}01'
    phone2 = f'0300{uid}02'

    # Generate invites
    resp = api.post('/api/parents/admin/generate-invite/', {
        'student_id': student_1.id,
        'relation': 'FATHER',
        'parent_phone': phone1,
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 201, f"invite1 status={resp.status_code} body={resp.content[:200]}"
    invite_1_code = resp.json()['invite_code']

    resp = api.post('/api/parents/admin/generate-invite/', {
        'student_id': student_2.id,
        'relation': 'MOTHER',
        'parent_phone': phone2,
    }, seed_data['tokens']['principal'], seed_data['SID_A'])
    assert resp.status_code == 201, f"invite2 status={resp.status_code} body={resp.content[:200]}"
    invite_2_code = resp.json()['invite_code']

    # Register parent 1 (father)
    uname1 = f'{P9}pf_{uid}'
    resp = client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': invite_1_code,
            'username': uname1,
            'password': password,
            'confirm_password': password,
            'first_name': 'Ahmed',
            'last_name': 'Hassan',
            'phone': phone1,
            'relation': 'FATHER',
        }),
        content_type='application/json',
    )
    assert resp.status_code == 201, f"reg1 status={resp.status_code} body={resp.content[:300]}"
    parent_1_profile_id = resp.json()['parent_profile_id']
    parent_1_user_id = resp.json()['user_id']

    # Register parent 2 (mother)
    uname2 = f'{P9}pm_{uid}'
    resp = client.post(
        '/api/parents/register/',
        data=json.dumps({
            'invite_code': invite_2_code,
            'username': uname2,
            'password': password,
            'confirm_password': password,
            'first_name': 'Fatima',
            'last_name': 'Khan',
            'phone': phone2,
            'relation': 'MOTHER',
        }),
        content_type='application/json',
    )
    assert resp.status_code == 201, f"reg2 status={resp.status_code} body={resp.content[:300]}"
    parent_2_profile_id = resp.json()['parent_profile_id']

    token_parent_1 = api.login(uname1)
    token_parent_2 = api.login(uname2)
    assert token_parent_1 is not None
    assert token_parent_2 is not None

    return {
        'token_parent_1': token_parent_1,
        'token_parent_2': token_parent_2,
        'parent_1_profile_id': parent_1_profile_id,
        'parent_2_profile_id': parent_2_profile_id,
        'parent_1_user_id': parent_1_user_id,
    }


# ==========================================================================
# LEVEL C: MY CHILDREN & CHILD VIEWS
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestChildViews:
    """Parent-facing child endpoints: my-children, overview, attendance, etc."""

    def test_c1_my_children_parent1(self, seed_data, api, parent_env):
        """parent_1 sees exactly one child (student_1)."""
        student_1 = seed_data['students'][0]
        resp = api.get('/api/parents/my-children/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1, f"count={len(data)}"
        assert data[0].get('student') == student_1.id, (
            f"student_id={data[0].get('student')}")

    def test_c2_my_children_parent2(self, seed_data, api, parent_env):
        """parent_2 sees exactly one child (student_2)."""
        resp = api.get('/api/parents/my-children/',
                       parent_env['token_parent_2'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1, f"count={len(data)}"

    def test_c3_child_overview(self, seed_data, api, parent_env):
        """Child overview returns expected fields."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/overview/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        d = resp.json()
        for key in ['student_name', 'attendance_summary', 'fee_summary']:
            assert key in d, f"Missing key '{key}', keys={list(d.keys())}"

    def test_c4_cannot_access_others_child(self, seed_data, api, parent_env):
        """Parent cannot access a child they are not linked to -> 403."""
        student_2 = seed_data['students'][1]
        resp = api.get(
            f'/api/parents/children/{student_2.id}/overview/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_c5_admin_can_access_child_overview(self, seed_data, api, parent_env):
        """Admin can access any child overview."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/overview/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c6_child_attendance_endpoint(self, seed_data, api, parent_env):
        """Child attendance endpoint returns 200."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/attendance/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c7_child_fees_endpoint(self, seed_data, api, parent_env):
        """Child fees endpoint returns 200."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/fees/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c8_child_timetable_endpoint(self, seed_data, api, parent_env):
        """Child timetable endpoint returns 200."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/timetable/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c9_child_exam_results_endpoint(self, seed_data, api, parent_env):
        """Child exam results endpoint returns 200."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/children/{student_1.id}/exam-results/',
            parent_env['token_parent_1'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c10_teacher_cannot_access_parent_endpoints(self, seed_data, api, parent_env):
        """Teacher cannot access my-children -> 403."""
        resp = api.get('/api/parents/my-children/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"


# ==========================================================================
# LEVEL D: PARENT LEAVE REQUESTS
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestLeaveRequests:
    """Parent-facing leave request CRUD."""

    def test_d1_create_leave_request(self, seed_data, api, parent_env):
        """Parent creates a leave request for their child."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-06-01',
            'end_date': '2025-06-03',
            'reason': f'{P9}Medical appointment for checkup',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201, (
            f"status={resp.status_code} body={resp.content[:300]}")
        assert 'id' in resp.json()

    def test_d2_leave_request_pending_status(self, seed_data, api, parent_env):
        """Newly created leave request has PENDING status."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-06-01',
            'end_date': '2025-06-03',
            'reason': f'{P9}Medical appointment d2',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        lr = ParentLeaveRequest.objects.get(id=resp.json()['id'])
        assert lr.status == 'PENDING', f"status={lr.status}"

    def test_d3_create_second_leave_request(self, seed_data, api, parent_env):
        """Parent can create multiple leave requests."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-07-10',
            'end_date': '2025-07-12',
            'reason': f'{P9}Family function d3',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"

    def test_d4_start_date_after_end_date(self, seed_data, api, parent_env):
        """start_date > end_date -> 400."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-08-10',
            'end_date': '2025-08-05',
            'reason': f'{P9}Invalid dates d4',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_d5_cannot_create_leave_for_others_child(self, seed_data, api, parent_env):
        """Parent cannot create leave for another parent's child -> 403."""
        student_2 = seed_data['students'][1]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_2.id,
            'start_date': '2025-09-01',
            'end_date': '2025-09-02',
            'reason': f'{P9}Not my child d5',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_d6_list_leave_requests(self, seed_data, api, parent_env):
        """Parent lists their own leave requests."""
        student_1 = seed_data['students'][0]
        # Create two requests first
        for i, suffix in enumerate(['d6a', 'd6b']):
            api.post('/api/parents/leave-requests/', {
                'student': student_1.id,
                'start_date': f'2025-06-{10 + i}',
                'end_date': f'2025-06-{11 + i}',
                'reason': f'{P9}Reason {suffix}',
            }, parent_env['token_parent_1'], seed_data['SID_A'])

        resp = api.get('/api/parents/leave-requests/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2, f"count={len(data)}"

    def test_d7_retrieve_single_leave_request(self, seed_data, api, parent_env):
        """Retrieve a single leave request by ID."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-06-01',
            'end_date': '2025-06-03',
            'reason': f'{P9}Retrieve test d7',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        leave_id = resp.json()['id']

        resp = api.get(f'/api/parents/leave-requests/{leave_id}/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_d8_update_pending_leave_request(self, seed_data, api, parent_env):
        """Parent can update a pending leave request."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-06-01',
            'end_date': '2025-06-03',
            'reason': f'{P9}Original reason d8',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        leave_id = resp.json()['id']

        resp = api.patch(f'/api/parents/leave-requests/{leave_id}/', {
            'reason': f'{P9}Updated reason: dental checkup d8',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_d9_soft_delete_cancel_leave_request(self, seed_data, api, parent_env):
        """Soft-delete (cancel) sets status to CANCELLED."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-07-10',
            'end_date': '2025-07-12',
            'reason': f'{P9}To be cancelled d9',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        leave_id = resp.json()['id']

        resp = api.delete(f'/api/parents/leave-requests/{leave_id}/',
                          parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code in (200, 204), f"status={resp.status_code}"

        lr = ParentLeaveRequest.objects.get(id=leave_id)
        assert lr.status == 'CANCELLED', f"status={lr.status}"

    def test_d10_cannot_update_cancelled_request(self, seed_data, api, parent_env):
        """Cannot update a cancelled request -> 400."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-07-10',
            'end_date': '2025-07-12',
            'reason': f'{P9}Will cancel d10',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        leave_id = resp.json()['id']

        # Cancel it
        api.delete(f'/api/parents/leave-requests/{leave_id}/',
                   parent_env['token_parent_1'], seed_data['SID_A'])

        # Try to update
        resp = api.patch(f'/api/parents/leave-requests/{leave_id}/', {
            'reason': f'{P9}Should fail d10',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_d11_teacher_cannot_access_leave_requests(self, seed_data, api, parent_env):
        """Teacher cannot access leave requests -> 403."""
        resp = api.get('/api/parents/leave-requests/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"


# ==========================================================================
# LEVEL E: ADMIN LEAVE REVIEW
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestAdminLeaveReview:
    """Admin-facing leave request review and filtering."""

    @pytest.fixture(autouse=True)
    def _setup_leave(self, seed_data, api, parent_env):
        """Create a leave request to review."""
        self.seed = seed_data
        self.api = api
        self.parent_env = parent_env
        student_1 = seed_data['students'][0]

        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-06-01',
            'end_date': '2025-06-03',
            'reason': f'{P9}Medical leave for review',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        self.leave_req_id = resp.json()['id']

    def test_e1_admin_list_leave_requests(self, seed_data, api, parent_env):
        """Admin can list all leave requests."""
        resp = api.get('/api/parents/admin/leave-requests/',
                       seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1, f"count={len(data)}"

    def test_e2_filter_by_status_pending(self, seed_data, api, parent_env):
        """Filter leave requests by status=PENDING."""
        resp = api.get('/api/parents/admin/leave-requests/?status=PENDING',
                       seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1, f"count={len(data)}"

    def test_e3_filter_by_student_id(self, seed_data, api, parent_env):
        """Filter leave requests by student_id."""
        student_1 = seed_data['students'][0]
        resp = api.get(
            f'/api/parents/admin/leave-requests/?student_id={student_1.id}',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1, f"count={len(data)}"

    def test_e4_approve_leave_request(self, seed_data, api, parent_env):
        """Admin approves a leave request."""
        resp = api.patch(
            f'/api/parents/admin/leave-requests/{self.leave_req_id}/review/', {
                'status': 'APPROVED',
                'review_note': f'{P9}Approved for medical reasons',
            }, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:200]}")

        lr = ParentLeaveRequest.objects.get(id=self.leave_req_id)
        assert lr.status == 'APPROVED', f"status={lr.status}"
        assert lr.reviewed_by == seed_data['users']['admin'], (
            f"reviewed_by={lr.reviewed_by}")

    def test_e5_cannot_re_review(self, seed_data, api, parent_env):
        """Cannot review an already reviewed request -> 400."""
        # Approve first
        api.patch(
            f'/api/parents/admin/leave-requests/{self.leave_req_id}/review/', {
                'status': 'APPROVED',
            }, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        # Try again
        resp = api.patch(
            f'/api/parents/admin/leave-requests/{self.leave_req_id}/review/', {
                'status': 'REJECTED',
            }, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_e6_reject_leave_request(self, seed_data, api, parent_env):
        """Admin rejects a leave request."""
        # Create a fresh one for rejection
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/leave-requests/', {
            'student': student_1.id,
            'start_date': '2025-10-01',
            'end_date': '2025-10-02',
            'reason': f'{P9}To be rejected e6',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        reject_id = resp.json()['id']

        resp = api.patch(
            f'/api/parents/admin/leave-requests/{reject_id}/review/', {
                'status': 'REJECTED',
                'review_note': f'{P9}Insufficient reason',
            }, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"
        lr = ParentLeaveRequest.objects.get(id=reject_id)
        assert lr.status == 'REJECTED', f"status={lr.status}"

    def test_e7_teacher_cannot_access_admin_leave_list(self, seed_data, api, parent_env):
        """Teacher cannot access admin leave list -> 403."""
        resp = api.get('/api/parents/admin/leave-requests/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_e8_parent_cannot_update_approved_leave(self, seed_data, api, parent_env):
        """Parent cannot update an already approved leave -> 400."""
        # Approve the leave first
        api.patch(
            f'/api/parents/admin/leave-requests/{self.leave_req_id}/review/', {
                'status': 'APPROVED',
            }, seed_data['tokens']['admin'], seed_data['SID_A'],
        )

        resp = api.patch(f'/api/parents/leave-requests/{self.leave_req_id}/', {
            'reason': f'{P9}Should fail - already approved e8',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"


# ==========================================================================
# LEVEL F: MESSAGING
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestMessaging:
    """Parent messaging: threads, send, reply, mark read."""

    def test_f1_parent_sends_message_to_admin(self, seed_data, api, parent_env):
        """Parent sends a message to admin about their child."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']
        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Hello, I have a query about my child f1.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201, (
            f"status={resp.status_code} body={resp.content[:200]}")
        d = resp.json()
        assert 'id' in d
        assert 'thread_id' in d

    def test_f2_admin_replies_in_same_thread(self, seed_data, api, parent_env):
        """Admin replies in the same thread; thread_id is preserved."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']

        # Parent sends
        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Query from parent f2.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        thread_id = resp.json()['thread_id']

        # Admin replies
        parent_user = User.objects.get(id=parent_env['parent_1_user_id'])
        resp = api.post('/api/parents/messages/', {
            'recipient_user': parent_user.id,
            'student': student_1.id,
            'message': f'{P9}Sure, what would you like to know? f2',
            'thread_id': thread_id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, f"status={resp.status_code}"
        assert resp.json()['thread_id'] == thread_id, (
            f"thread={resp.json().get('thread_id')}")

    def test_f3_list_threads(self, seed_data, api, parent_env):
        """Parent lists message threads."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']

        # Send a message to create a thread
        api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Thread creation f3.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])

        resp = api.get('/api/parents/messages/threads/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1, f"count={len(data)}"
        thread = data[0]
        for key in ['thread_id', 'latest_message', 'unread_count']:
            assert key in thread, f"Missing key '{key}', keys={list(thread.keys())}"

    def test_f4_get_thread_messages(self, seed_data, api, parent_env):
        """Get all messages in a specific thread."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']

        # Parent sends
        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}First message f4.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        thread_id = resp.json()['thread_id']

        # Admin replies
        parent_user = User.objects.get(id=parent_env['parent_1_user_id'])
        api.post('/api/parents/messages/', {
            'recipient_user': parent_user.id,
            'student': student_1.id,
            'message': f'{P9}Reply f4.',
            'thread_id': thread_id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get(f'/api/parents/messages/threads/{thread_id}/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2, f"count={len(data)}"

    def test_f5_mark_message_as_read(self, seed_data, api, parent_env):
        """Parent marks admin's reply as read."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']

        # Parent sends
        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Message f5.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        thread_id = resp.json()['thread_id']

        # Admin replies to parent
        parent_user = User.objects.get(id=parent_env['parent_1_user_id'])
        resp = api.post('/api/parents/messages/', {
            'recipient_user': parent_user.id,
            'student': student_1.id,
            'message': f'{P9}Admin reply f5.',
            'thread_id': thread_id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        admin_msg_id = resp.json()['id']

        # Parent marks admin's reply as read
        resp = api.patch(f'/api/parents/messages/{admin_msg_id}/read/', {},
                         parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"

        msg = ParentMessage.objects.get(id=admin_msg_id)
        assert msg.is_read is True, f"is_read={msg.is_read}"
        assert msg.read_at is not None, f"read_at={msg.read_at}"

    def test_f6_cannot_mark_own_sent_message_as_read(self, seed_data, api, parent_env):
        """Cannot mark own sent message as read (not recipient) -> 404."""
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']

        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Own message f6.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 201
        own_msg_id = resp.json()['id']

        resp = api.patch(f'/api/parents/messages/{own_msg_id}/read/', {},
                         parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 404, f"status={resp.status_code}"

    def test_f7_cannot_message_about_others_child(self, seed_data, api, parent_env):
        """Parent cannot send message about another parent's child -> 403."""
        student_2 = seed_data['students'][1]
        admin_user = seed_data['users']['admin']
        resp = api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_2.id,
            'message': f'{P9}Should not be allowed f7.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_f8_admin_list_threads(self, seed_data, api, parent_env):
        """Admin can list their message threads."""
        # Create a message so admin has a thread
        student_1 = seed_data['students'][0]
        admin_user = seed_data['users']['admin']
        api.post('/api/parents/messages/', {
            'recipient_user': admin_user.id,
            'student': student_1.id,
            'message': f'{P9}Thread for admin f8.',
        }, parent_env['token_parent_1'], seed_data['SID_A'])

        resp = api.get('/api/parents/messages/threads/',
                       seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"status={resp.status_code}"


# ==========================================================================
# LEVEL G: ADMIN PARENT/CHILD MANAGEMENT
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestAdminParentChildManagement:
    """Admin: list parents, link/unlink children."""

    def test_g1_admin_list_parents(self, seed_data, api, parent_env):
        """Admin lists all parents for the school."""
        resp = api.get('/api/parents/admin/parents/',
                       seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1, f"count={len(data)}"

    def test_g2_admin_link_child_to_parent(self, seed_data, api, parent_env):
        """Admin links an additional child (student_3) to parent_1."""
        student_3 = seed_data['students'][4]  # Hamza Raza, Class 2B
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
            'is_primary': False,
            'can_pickup': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, (
            f"status={resp.status_code} body={resp.content[:200]}")
        assert 'id' in resp.json()

    def test_g3_parent_now_has_two_children(self, seed_data, api, parent_env):
        """After admin links, parent sees 2 children."""
        student_3 = seed_data['students'][4]
        # Link the child first
        api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
            'is_primary': False,
            'can_pickup': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/parents/my-children/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2, f"count={len(data)}"

    def test_g4_duplicate_link_fails(self, seed_data, api, parent_env):
        """Duplicate parent-child link -> 400."""
        student_3 = seed_data['students'][4]
        # Link once
        api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        # Link again -> 400
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_g5_missing_student_id(self, seed_data, api, parent_env):
        """Missing student_id -> 400."""
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            # missing student_id
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_g6_nonexistent_parent_profile(self, seed_data, api, parent_env):
        """Non-existent parent profile -> 404."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': 999999,
            'student_id': student_1.id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 404, f"status={resp.status_code}"

    def test_g7_admin_unlink_child(self, seed_data, api, parent_env):
        """Admin unlinks a child; link is removed from DB."""
        student_3 = seed_data['students'][4]
        # Link first
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
            'is_primary': False,
            'can_pickup': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        link_id = resp.json()['id']

        # Unlink
        resp = api.delete(f'/api/parents/admin/unlink-child/{link_id}/',
                          seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 204, f"status={resp.status_code}"
        assert not ParentChild.objects.filter(id=link_id).exists(), "link still exists"

    def test_g8_parent_back_to_one_child(self, seed_data, api, parent_env):
        """After unlink, parent is back to 1 child."""
        student_3 = seed_data['students'][4]
        # Link
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
            'relation': 'FATHER',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201
        link_id = resp.json()['id']

        # Unlink
        api.delete(f'/api/parents/admin/unlink-child/{link_id}/',
                   seed_data['tokens']['admin'], seed_data['SID_A'])

        resp = api.get('/api/parents/my-children/',
                       parent_env['token_parent_1'], seed_data['SID_A'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1, f"count={len(data)}"

    def test_g9_teacher_cannot_list_parents(self, seed_data, api, parent_env):
        """Teacher cannot list parents -> 403."""
        resp = api.get('/api/parents/admin/parents/',
                       seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_g10_teacher_cannot_link_child(self, seed_data, api, parent_env):
        """Teacher cannot link child -> 403."""
        student_3 = seed_data['students'][4]
        resp = api.post('/api/parents/admin/link-child/', {
            'parent_profile_id': parent_env['parent_1_profile_id'],
            'student_id': student_3.id,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"status={resp.status_code}"


# ==========================================================================
# LEVEL H: CROSS-CUTTING & SECURITY
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase9
class TestCrossCuttingSecurity:
    """Authentication, authorisation, school isolation, edge cases."""

    def test_h1_unauthenticated_returns_401(self, seed_data, api, parent_env):
        """Unauthenticated request -> 401."""
        resp = api.client.get('/api/parents/my-children/')
        assert resp.status_code == 401, f"status={resp.status_code}"

    def test_h2_invalid_token_returns_401(self, seed_data, api, parent_env):
        """Invalid token -> 401."""
        resp = api.client.get(
            '/api/parents/my-children/',
            HTTP_AUTHORIZATION='Bearer invalid_token_xyz',
            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
        assert resp.status_code == 401, f"status={resp.status_code}"

    def test_h3_school_b_cannot_see_school_a_parents(self, seed_data, api, parent_env):
        """School B admin cannot see School A parents."""
        resp = api.get('/api/parents/admin/parents/',
                       seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        p9_parents = [
            p for p in data if any(
                c.get('student_name', '').startswith(seed_data['prefix'])
                for c in p.get('children', [])
            )
        ]
        assert len(p9_parents) == 0, f"p9_count={len(p9_parents)}"

    def test_h4_school_b_cannot_see_school_a_leave_requests(self, seed_data, api, parent_env):
        """School B admin sees no leave requests from School A."""
        resp = api.get('/api/parents/admin/leave-requests/',
                       seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0, f"count={len(data)}"

    def test_h5_expired_invite_code(self, seed_data, api, parent_env):
        """Expired invite code -> 400."""
        student_3 = seed_data['students'][4]
        # Create an expired invite directly
        ParentInvite.objects.create(
            school=seed_data['school_a'],
            student=student_3,
            invite_code=f'{P9}EXPIRED_CODE_h5',
            relation='GUARDIAN',
            parent_phone=f'{P9}expired_h5',
            expires_at=timezone.now() - timedelta(days=1),
            created_by=seed_data['users']['admin'],
        )
        resp = api.client.post(
            '/api/parents/register/',
            data=json.dumps({
                'invite_code': f'{P9}EXPIRED_CODE_h5',
                'username': f'{P9}parent_expired_h5',
                'password': 'ParentPass123!',
                'confirm_password': 'ParentPass123!',
                'phone': f'{P9}00000000_h5',
            }),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_h6_register_endpoint_is_public(self, seed_data, api, parent_env):
        """Register endpoint is AllowAny -- returns 400, not 401."""
        resp = api.client.post(
            '/api/parents/register/',
            data=json.dumps({'invite_code': 'doesntexist'}),
            content_type='application/json',
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_h7_admin_can_view_any_child_overview(self, seed_data, api, parent_env):
        """Admin can access child overview for any student."""
        student_3 = seed_data['students'][4]
        resp = api.get(
            f'/api/parents/children/{student_3.id}/overview/',
            seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_h8_unlink_nonexistent_returns_404(self, seed_data, api, parent_env):
        """Unlink non-existent link -> 404."""
        resp = api.delete('/api/parents/admin/unlink-child/999999/',
                          seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 404, f"status={resp.status_code}"
