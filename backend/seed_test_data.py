"""
Shared Seed Test Data for All Test Phases.

Creates a complete, isolated test environment (org, schools, users, classes,
students, staff) that all phase test scripts can reuse.

Usage:
    # Create seed data (idempotent — safe to run multiple times):
    python manage.py shell -c "exec(open('seed_test_data.py', encoding='utf-8').read())"

    # Cleanup:
    python manage.py shell -c "exec(open('seed_test_data.py', encoding='utf-8').read()); cleanup_seed_data()"

Importing from phase scripts:
    exec(open('seed_test_data.py', encoding='utf-8').read())
    seed = get_seed_data()
"""

import json
from datetime import date, time
from django.test import Client
from django.conf import settings

# Allow Django test client's 'testserver' host
if 'testserver' not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS.append('testserver')

# ── Imports ─────────────────────────────────────────────────────────────────
from users.models import User
from schools.models import Organization, School, UserSchoolMembership
from academic_sessions.models import AcademicYear, Term
from students.models import Class, Student
from hr.models import StaffDepartment, StaffDesignation, StaffMember

# ── Constants ───────────────────────────────────────────────────────────────
SEED_PREFIX = "SEED_TEST_"
PASSWORD = "TestPass123!"

# ── Shared test client & helpers ────────────────────────────────────────────
_client = Client()

passed = 0
failed = 0


def check(name, condition, detail=""):
    """Test assertion helper."""
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        print(f"  [FAIL] {name}  ({detail})")


def api_get(url, token, school_id):
    return _client.get(
        url,
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_SCHOOL_ID=str(school_id),
    )


def api_post(url, data, token, school_id):
    return _client.post(
        url,
        data=json.dumps(data),
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_SCHOOL_ID=str(school_id),
        content_type='application/json',
    )


def api_patch(url, data, token, school_id):
    return _client.patch(
        url,
        data=json.dumps(data),
        HTTP_AUTHORIZATION=f'Bearer {token}',
        HTTP_X_SCHOOL_ID=str(school_id),
        content_type='application/json',
    )


def api_delete(url, token, school_id):
    return _client.delete(
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
    resp = _client.post(
        '/api/auth/login/',
        data=json.dumps({'username': username, 'password': PASSWORD}),
        content_type='application/json',
    )
    if resp.status_code == 200:
        return resp.json().get('access')
    print(f"   LOGIN FAILED for {username}: {resp.status_code} {resp.content[:200]}")
    return None


def reset_counters():
    """Reset pass/fail counters for a new test run."""
    global passed, failed
    passed = 0
    failed = 0


# ── Seed Data Management ───────────────────────────────────────────────────

def _seed_exists():
    """Check if seed data already exists."""
    return Organization.objects.filter(name=f"{SEED_PREFIX}Org").exists()


def create_seed_data():
    """Create all shared seed data. Idempotent — skips if already exists."""
    if _seed_exists():
        print(f"[SEED] Data already exists. Skipping creation.")
        return

    print(f"\n[SEED] Creating shared test data...")

    # Organization
    org = Organization.objects.create(
        name=f"{SEED_PREFIX}Org",
        slug=f"{SEED_PREFIX.lower().replace('_', '-')}org",
    )
    print(f"   Org: {org.name} (id={org.id})")

    # Schools
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
    print(f"   School A: {school_a.name} (id={school_a.id})")
    print(f"   School B: {school_b.name} (id={school_b.id})")

    # Users — School A
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

    # School B admin (for isolation tests)
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
    print(f"   Users: {', '.join(users.keys())}")

    # Academic Year
    ay = AcademicYear.objects.create(
        school=school_a,
        name=f"{SEED_PREFIX}2025-2026",
        start_date=date(2025, 4, 1),
        end_date=date(2026, 3, 31),
        is_current=True,
        is_active=True,
    )
    print(f"   Academic Year: {ay.name} (id={ay.id})")

    # Terms
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
    print(f"   Terms: {term1.name}, {term2.name}")

    # Classes
    class_1 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_1A", section="A", grade_level=1,
    )
    class_2 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_2B", section="B", grade_level=2,
    )
    class_3 = Class.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Class_3C", section="C", grade_level=3,
    )
    classes = [class_1, class_2, class_3]
    print(f"   Classes: {', '.join(c.name for c in classes)}")

    # Students
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
    print(f"   Students: {len(students)} created")

    # Staff Departments
    dept_academic = StaffDepartment.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Academic",
    )
    dept_admin = StaffDepartment.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Admin",
    )

    # Staff Designations
    desig_teacher = StaffDesignation.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Teacher", department=dept_academic,
    )
    desig_clerk = StaffDesignation.objects.create(
        school=school_a, name=f"{SEED_PREFIX}Clerk", department=dept_admin,
    )
    print(f"   Departments: {dept_academic.name}, {dept_admin.name}")
    print(f"   Designations: {desig_teacher.name}, {desig_clerk.name}")

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

    # StaffMembers
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
    print(f"   Staff: {', '.join(s.full_name for s in staff_members)}")

    print(f"[SEED] Done. All shared test data created.\n")


def get_seed_data():
    """Return dict of all seed data objects + JWT tokens.

    Auto-creates seed data if it doesn't exist.
    """
    if not _seed_exists():
        create_seed_data()

    org = Organization.objects.get(name=f"{SEED_PREFIX}Org")
    school_a = School.objects.get(name=f"{SEED_PREFIX}School_Alpha")
    school_b = School.objects.get(name=f"{SEED_PREFIX}School_Beta")

    user_names = ['admin', 'principal', 'hr_manager', 'teacher', 'accountant', 'admin_b']
    users = {}
    for uname in user_names:
        users[uname] = User.objects.get(username=f"{SEED_PREFIX}{uname}")

    ay = AcademicYear.objects.get(school=school_a, name=f"{SEED_PREFIX}2025-2026")
    terms = list(Term.objects.filter(school=school_a, name__startswith=SEED_PREFIX).order_by('order'))
    classes = list(Class.objects.filter(school=school_a, name__startswith=SEED_PREFIX).order_by('grade_level'))
    students = list(Student.objects.filter(school=school_a, name__startswith=SEED_PREFIX).order_by('class_obj', 'roll_number'))

    dept_academic = StaffDepartment.objects.get(school=school_a, name=f"{SEED_PREFIX}Academic")
    dept_admin = StaffDepartment.objects.get(school=school_a, name=f"{SEED_PREFIX}Admin")
    desig_teacher = StaffDesignation.objects.get(school=school_a, name=f"{SEED_PREFIX}Teacher")
    desig_clerk = StaffDesignation.objects.get(school=school_a, name=f"{SEED_PREFIX}Clerk")

    staff_members = list(StaffMember.objects.filter(
        school=school_a, employee_id__startswith=SEED_PREFIX,
    ).order_by('employee_id'))

    # Get JWT tokens
    tokens = {}
    for uname in user_names:
        tokens[uname] = login(f"{SEED_PREFIX}{uname}")
    if not all(tokens.values()):
        missing = [k for k, v in tokens.items() if not v]
        print(f"   WARNING: Failed to get tokens for: {missing}")

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
        'terms': terms,
        'classes': classes,
        'students': students,
        'departments': [dept_academic, dept_admin],
        'designations': [desig_teacher, desig_clerk],
        'staff': staff_members,
    }


def cleanup_seed_data():
    """Remove ALL seed test data."""
    print("\n[SEED CLEANUP] Removing all shared test data...")

    # Delete in reverse dependency order
    StaffMember.objects.filter(employee_id__startswith=SEED_PREFIX).delete()
    print("   Deleted: StaffMembers")

    # Delete teacher users for staff
    User.objects.filter(username__startswith=f"{SEED_PREFIX}staff_teacher").delete()
    print("   Deleted: Staff teacher users")

    StaffDesignation.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: StaffDesignations")

    StaffDepartment.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: StaffDepartments")

    Student.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Students")

    Class.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Classes")

    Term.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Terms")

    AcademicYear.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: AcademicYears")

    UserSchoolMembership.objects.filter(user__username__startswith=SEED_PREFIX).delete()
    print("   Deleted: Memberships")

    User.objects.filter(username__startswith=SEED_PREFIX).delete()
    print("   Deleted: Users")

    School.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Schools")

    Organization.objects.filter(name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Organization")

    print("[SEED CLEANUP] Complete.\n")


# ── Face Attendance Seed Data ────────────────────────────────────────────────

def create_face_seed_data(seed=None):
    """
    Create face attendance test data (embeddings, session, detections).

    Args:
        seed: dict from get_seed_data(). If None, calls get_seed_data().
    """
    import numpy as np
    from face_attendance.models import (
        FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult,
    )
    from datetime import date as date_cls

    if seed is None:
        seed = get_seed_data()

    school = seed['school_a']
    students = seed['students']
    class_1 = seed['classes'][0]
    ay = seed['academic_year']
    admin = seed['users']['admin']

    print("\n[FACE SEED] Creating face attendance data...")

    # Create fake 128-d embeddings for first 4 students (Class 1A)
    face_embeddings = []
    for i, student in enumerate(students[:4]):
        # Skip if already exists
        if StudentFaceEmbedding.objects.filter(student=student, is_active=True).exists():
            print(f"   Skipped embedding for {student.name} (already exists)")
            continue
        fake_embedding = np.random.default_rng(seed=42 + i).standard_normal(128).astype(np.float64)
        emb = StudentFaceEmbedding.objects.create(
            student=student,
            school=school,
            embedding=fake_embedding.tobytes(),
            embedding_version='dlib_v1',
            source_image_url=f'https://example.com/faces/{student.id}.jpg',
            quality_score=0.85,
            is_active=True,
        )
        face_embeddings.append(emb)
        print(f"   Created embedding for {student.name}")

    # Create a sample NEEDS_REVIEW session
    session = FaceAttendanceSession.objects.create(
        school=school,
        class_obj=class_1,
        academic_year=ay,
        date=date_cls.today(),
        status=FaceAttendanceSession.Status.NEEDS_REVIEW,
        image_url='https://example.com/group_photo.jpg',
        total_faces_detected=3,
        faces_matched=2,
        faces_flagged=1,
        faces_ignored=0,
        thresholds_used={'high': 0.40, 'medium': 0.55},
        created_by=admin,
    )
    print(f"   Created session: {session.id}")

    # Create detection results
    det_configs = [
        (0, students[0], 92.5, 'AUTO_MATCHED', 0.28),
        (1, students[1], 71.3, 'FLAGGED', 0.47),
        (2, None, 0, 'IGNORED', 0.62),
    ]
    for face_idx, student, confidence, match_status, distance in det_configs:
        FaceDetectionResult.objects.create(
            session=session,
            face_index=face_idx,
            bounding_box={'top': 50 * face_idx, 'right': 100, 'bottom': 50 * face_idx + 80, 'left': 20},
            quality_score=0.8,
            matched_student=student,
            confidence=confidence,
            match_status=match_status,
            match_distance=distance,
        )
    print(f"   Created {len(det_configs)} detection results")

    print("[FACE SEED] Complete.\n")
    return {'session': session, 'embeddings': face_embeddings}


# ── When run directly, create seed data ─────────────────────────────────────
if __name__ == '__main__' or not _seed_exists():
    create_seed_data()
else:
    print(f"[SEED] Data already exists. Use get_seed_data() to retrieve it.")
