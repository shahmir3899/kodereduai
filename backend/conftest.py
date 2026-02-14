"""
Root conftest.py — shared pytest fixtures for all test phases.

Converts the manual seed_test_data.py approach into proper pytest fixtures
with automatic setup/teardown.
"""

import json
from datetime import date
from decimal import Decimal

import pytest
from django.test import Client
from django.conf import settings

# Ensure 'testserver' is in ALLOWED_HOSTS for Django's test client
if 'testserver' not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS.append('testserver')


# ── Constants ────────────────────────────────────────────────────────────────

SEED_PREFIX = "PYTEST_"
PASSWORD = "TestPass123!"


# ── API helper fixtures ──────────────────────────────────────────────────────

@pytest.fixture
def api_client():
    """Return a Django test client."""
    return Client()


class APIHelper:
    """Provides convenience methods for authenticated API calls."""

    def __init__(self, client):
        self.client = client

    def login(self, username):
        resp = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'username': username, 'password': PASSWORD}),
            content_type='application/json',
        )
        if resp.status_code == 200:
            return resp.json().get('access')
        return None

    def get(self, url, token, school_id):
        return self.client.get(
            url,
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
        )

    def post(self, url, data, token, school_id):
        return self.client.post(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def patch(self, url, data, token, school_id):
        return self.client.patch(
            url,
            data=json.dumps(data),
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def delete(self, url, token, school_id):
        return self.client.delete(
            url,
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_SCHOOL_ID=str(school_id),
            content_type='application/json',
        )

    def safe_get(self, url, token, school_id):
        try:
            return self.get(url, token, school_id)
        except Exception as e:
            class FakeResp:
                status_code = 500
                content = str(e).encode()[:200]
                def json(self):
                    return {}
            return FakeResp()


@pytest.fixture
def api(api_client):
    """Return an APIHelper instance for making authenticated calls."""
    return APIHelper(api_client)


# ── Seed Data Fixture ────────────────────────────────────────────────────────

@pytest.fixture
def seed_data(api_client, db):
    """
    Create a complete test environment mirroring seed_test_data.py.

    Returns a dict with all objects + JWT tokens.
    Uses the PYTEST_ prefix to avoid collisions with manual seed data.
    """
    from users.models import User
    from schools.models import Organization, School, UserSchoolMembership
    from academic_sessions.models import AcademicYear, Term
    from students.models import Class, Student
    from hr.models import StaffDepartment, StaffDesignation, StaffMember

    # ---------- Organization ----------
    org = Organization.objects.create(
        name=f"{SEED_PREFIX}Org",
        slug=f"{SEED_PREFIX.lower().replace('_', '-')}org",
    )

    # ---------- Schools ----------
    school_a = School.objects.create(
        organization=org,
        name=f"{SEED_PREFIX}School_Alpha",
        subdomain=f"{SEED_PREFIX.lower().replace('_', '-')}alpha",
    )
    school_b = School.objects.create(
        organization=org,
        name=f"{SEED_PREFIX}School_Beta",
        subdomain=f"{SEED_PREFIX.lower().replace('_', '-')}beta",
    )

    # ---------- Users (School A) ----------
    users = {}
    user_configs = [
        ('admin', 'SCHOOL_ADMIN', school_a),
        ('principal', 'PRINCIPAL', school_a),
        ('hr_manager', 'HR_MANAGER', school_a),
        ('teacher', 'TEACHER', school_a),
        ('accountant', 'ACCOUNTANT', school_a),
    ]
    for uname, role, school in user_configs:
        u = User.objects.create_user(
            username=f"{SEED_PREFIX}{uname}",
            email=f"{SEED_PREFIX}{uname}@test.com",
            password=PASSWORD,
            role=role,
            school=school,
            organization=org,
        )
        UserSchoolMembership.objects.create(
            user=u, school=school, role=role, is_default=True,
        )
        users[uname] = u

    # School B admin
    admin_b = User.objects.create_user(
        username=f"{SEED_PREFIX}admin_b",
        email=f"{SEED_PREFIX}admin_b@test.com",
        password=PASSWORD,
        role='SCHOOL_ADMIN',
        school=school_b,
        organization=org,
    )
    UserSchoolMembership.objects.create(
        user=admin_b, school=school_b, role='SCHOOL_ADMIN', is_default=True,
    )
    users['admin_b'] = admin_b

    # ---------- Academic Year ----------
    ay = AcademicYear.objects.create(
        school=school_a,
        name=f"{SEED_PREFIX}2025-2026",
        start_date=date(2025, 4, 1),
        end_date=date(2026, 3, 31),
        is_current=True,
        is_active=True,
    )

    # ---------- Terms ----------
    term1 = Term.objects.create(
        school=school_a,
        academic_year=ay,
        name=f"{SEED_PREFIX}Term 1",
        term_type='TERM',
        order=1,
        start_date=date(2025, 4, 1),
        end_date=date(2025, 9, 30),
        is_current=True,
    )
    term2 = Term.objects.create(
        school=school_a,
        academic_year=ay,
        name=f"{SEED_PREFIX}Term 2",
        term_type='TERM',
        order=2,
        start_date=date(2025, 10, 1),
        end_date=date(2026, 3, 31),
    )

    # ---------- Classes ----------
    class_1 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_1A", section="A", grade_level=1,
    )
    class_2 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_2B", section="B", grade_level=2,
    )
    class_3 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_3C", section="C", grade_level=3,
    )

    # ---------- Students ----------
    students = []
    student_data = [
        (class_1, '1', 'Ali Hassan'), (class_1, '2', 'Sara Khan'),
        (class_1, '3', 'Usman Ahmed'), (class_1, '4', 'Fatima Noor'),
        (class_2, '1', 'Hamza Raza'), (class_2, '2', 'Ayesha Malik'),
        (class_2, '3', 'Bilal Shah'), (class_3, '1', 'Zara Iqbal'),
        (class_3, '2', 'Omar Farooq'), (class_3, '3', 'Hira Javed'),
    ]
    for cls, roll, name in student_data:
        s = Student.objects.create(
            school=school_a, class_obj=cls, roll_number=roll,
            name=f"{SEED_PREFIX}{name}", is_active=True, status='ACTIVE',
        )
        students.append(s)

    # ---------- HR ----------
    dept_academic = StaffDepartment.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Academic",
    )
    dept_admin = StaffDepartment.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Admin",
    )
    desig_teacher = StaffDesignation.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Teacher", department=dept_academic,
    )
    desig_clerk = StaffDesignation.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Clerk", department=dept_admin,
    )

    # Teacher users for StaffMembers
    teacher_users = []
    for i in range(1, 4):
        tu = User.objects.create_user(
            username=f"{SEED_PREFIX}staff_teacher{i}",
            email=f"{SEED_PREFIX}t{i}@test.com",
            password=PASSWORD,
            role='TEACHER',
            school=school_a,
            organization=org,
        )
        UserSchoolMembership.objects.create(
            user=tu, school=school_a, role='TEACHER', is_default=True,
        )
        teacher_users.append(tu)

    staff_data = [
        (teacher_users[0], 'Ali', 'Khan', 'T001'),
        (teacher_users[1], 'Sara', 'Ahmed', 'T002'),
        (teacher_users[2], 'Usman', 'Raza', 'T003'),
    ]
    staff_members = []
    for tu, first, last, emp_id in staff_data:
        sm = StaffMember.objects.create(
            school=school_a,
            user=tu,
            first_name=f"{SEED_PREFIX}{first}",
            last_name=last,
            employee_id=f"{SEED_PREFIX}{emp_id}",
            department=dept_academic,
            designation=desig_teacher,
            employment_status='ACTIVE',
            employment_type='FULL_TIME',
            date_of_joining=date(2024, 1, 1),
        )
        staff_members.append(sm)

    # ---------- JWT Tokens ----------
    helper = APIHelper(api_client)
    tokens = {}
    for uname in ['admin', 'principal', 'hr_manager', 'teacher', 'accountant', 'admin_b']:
        tokens[uname] = helper.login(f"{SEED_PREFIX}{uname}")

    return {
        'prefix': SEED_PREFIX,
        'password': PASSWORD,
        'org': org,
        'school_a': school_a,
        'school_b': school_b,
        'SID_A': school_a.id,
        'SID_B': school_b.id,
        'users': users,
        'tokens': tokens,
        'academic_year': ay,
        'terms': [term1, term2],
        'classes': [class_1, class_2, class_3],
        'students': students,
        'departments': [dept_academic, dept_admin],
        'designations': [desig_teacher, desig_clerk],
        'staff': staff_members,
    }
