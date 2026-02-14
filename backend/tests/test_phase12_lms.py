"""
Phase 12 -- LMS Module Tests (pytest)
======================================
Covers: LessonPlan CRUD, Assignment CRUD + publish/close,
        AssignmentSubmission + grading, permissions, school isolation.

Run:
    cd backend
    pytest tests/test_phase12_lms.py -v
"""

from datetime import date, timedelta

import pytest

P12 = "P12LMS_"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _extract_results(resp):
    """Return list from a paginated or plain-list API response."""
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get("results", [])
    return data


@pytest.fixture
def lms_subject(seed_data):
    """Create or get the prerequisite Subject for LMS tests."""
    from academics.models import Subject

    school_a = seed_data["school_a"]
    subj, _ = Subject.objects.get_or_create(
        school=school_a,
        code=f"{P12}MATH",
        defaults={"name": f"{P12}Mathematics"},
    )
    return subj


@pytest.fixture
def lms_cleanup(seed_data):
    """Remove any leftover P12 data before each test class runs."""
    from lms.models import LessonPlan, Assignment

    school_a = seed_data["school_a"]
    LessonPlan.objects.filter(school=school_a, title__startswith=P12).delete()
    Assignment.objects.filter(school=school_a, title__startswith=P12).delete()


# ==========================================================================
# LEVEL A: LESSON PLANS CRUD
# ==========================================================================

@pytest.mark.phase12
@pytest.mark.django_db
class TestLessonPlans:

    def test_create_lesson_plan_as_admin(self, seed_data, api, lms_subject, lms_cleanup):
        """A1: Admin can create a lesson plan."""
        resp = api.post("/api/lms/lesson-plans/", {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Algebra Intro",
            "description": "Introduction to algebra",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_create_lesson_plan_as_principal(self, seed_data, api, lms_subject, lms_cleanup):
        """A2: Principal can create a lesson plan."""
        resp = api.post("/api/lms/lesson-plans/", {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Geometry Basics",
            "description": "Intro to geometry",
            "lesson_date": str(date.today() + timedelta(days=1)),
            "duration_minutes": 40,
            "status": "PUBLISHED",
        }, seed_data["tokens"]["principal"], seed_data["SID_A"])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_teacher_cannot_create_lesson_plan(self, seed_data, api, lms_subject, lms_cleanup):
        """A3: Teacher cannot create a lesson plan (403)."""
        resp = api.post("/api/lms/lesson-plans/", {
            "school": seed_data["SID_A"],
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Teacher Plan",
            "lesson_date": str(date.today()),
        }, seed_data["tokens"]["teacher"], seed_data["SID_A"])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_list_lesson_plans(self, seed_data, api, lms_subject, lms_cleanup):
        """A4: Admin can list lesson plans (at least 2 after creating them)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Create two lesson plans first
        api.post("/api/lms/lesson-plans/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Algebra Intro",
            "description": "Introduction to algebra",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }, token, sid)
        api.post("/api/lms/lesson-plans/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Geometry Basics",
            "description": "Intro to geometry",
            "lesson_date": str(date.today() + timedelta(days=1)),
            "duration_minutes": 40,
            "status": "PUBLISHED",
        }, token, sid)

        resp = api.get("/api/lms/lesson-plans/", token, sid)
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) >= 2, f"Expected >= 2 lesson plans, got {len(data)}"

    def test_teacher_can_read_lesson_plans(self, seed_data, api, lms_subject, lms_cleanup):
        """A5: Teacher can read (list) lesson plans."""
        resp = api.get("/api/lms/lesson-plans/", seed_data["tokens"]["teacher"], seed_data["SID_A"])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_retrieve_lesson_plan(self, seed_data, api, lms_subject, lms_cleanup):
        """A6: Admin can retrieve a single lesson plan."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/lesson-plans/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Algebra Intro",
            "description": "Introduction to algebra",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create lesson plan"
        lp_id = create_resp.json()["id"]

        resp = api.get(f"/api/lms/lesson-plans/{lp_id}/", token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_update_lesson_plan(self, seed_data, api, lms_subject, lms_cleanup):
        """A7: Admin can update a lesson plan."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/lesson-plans/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Algebra Intro",
            "description": "Introduction to algebra",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create lesson plan"
        lp_id = create_resp.json()["id"]

        resp = api.patch(f"/api/lms/lesson-plans/{lp_id}/", {
            "title": f"{P12}Algebra Intro (Updated)",
        }, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_delete_lesson_plan(self, seed_data, api, lms_subject, lms_cleanup):
        """A8: Admin can delete a lesson plan."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/lesson-plans/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Algebra Intro",
            "description": "Introduction to algebra",
            "lesson_date": str(date.today()),
            "duration_minutes": 45,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create lesson plan"
        lp_id = create_resp.json()["id"]

        resp = api.delete(f"/api/lms/lesson-plans/{lp_id}/", token, sid)
        assert resp.status_code in (200, 204), f"Expected 200 or 204, got {resp.status_code}"

    def test_school_b_isolation_lesson_plans(self, seed_data, api, lms_subject, lms_cleanup):
        """A9: School B admin sees no School A lesson plans."""
        resp = api.get("/api/lms/lesson-plans/", seed_data["tokens"]["admin_b"], seed_data["SID_B"])
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) == 0, f"Expected 0 lesson plans for School B, got {len(data)}"


# ==========================================================================
# LEVEL B: ASSIGNMENTS CRUD + PUBLISH/CLOSE
# ==========================================================================

@pytest.mark.phase12
@pytest.mark.django_db
class TestAssignments:

    def test_create_assignment_as_admin(self, seed_data, api, lms_subject, lms_cleanup):
        """B1: Admin can create an assignment."""
        resp = api.post("/api/lms/assignments/", {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_create_assignment_as_principal(self, seed_data, api, lms_subject, lms_cleanup):
        """B2: Principal can create an assignment."""
        resp = api.post("/api/lms/assignments/", {
            "school": seed_data["SID_A"],
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Project Alpha",
            "description": "Alpha project description",
            "assignment_type": "PROJECT",
            "due_date": f"{date.today() + timedelta(days=14)}T23:59:00Z",
            "total_marks": 50,
            "status": "DRAFT",
        }, seed_data["tokens"]["principal"], seed_data["SID_A"])
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_teacher_cannot_create_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """B3: Teacher cannot create an assignment (403)."""
        resp = api.post("/api/lms/assignments/", {
            "school": seed_data["SID_A"],
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "title": f"{P12}Teacher Assignment",
            "due_date": f"{date.today()}T23:59:00Z",
        }, seed_data["tokens"]["teacher"], seed_data["SID_A"])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_list_assignments(self, seed_data, api, lms_subject, lms_cleanup):
        """B4: Admin can list assignments (at least 2 after creating them)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        # Create two assignments first
        api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token, sid)
        api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Project Alpha",
            "description": "Alpha project description",
            "assignment_type": "PROJECT",
            "due_date": f"{date.today() + timedelta(days=14)}T23:59:00Z",
            "total_marks": 50,
            "status": "DRAFT",
        }, token, sid)

        resp = api.get("/api/lms/assignments/", token, sid)
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) >= 2, f"Expected >= 2 assignments, got {len(data)}"

    def test_teacher_can_read_assignments(self, seed_data, api, lms_subject, lms_cleanup):
        """B5: Teacher can read (list) assignments."""
        resp = api.get("/api/lms/assignments/", seed_data["tokens"]["teacher"], seed_data["SID_A"])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_publish_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """B6: Admin can publish a DRAFT assignment (DRAFT -> PUBLISHED)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        resp = api.post(f"/api/lms/assignments/{assign_id}/publish/", {}, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_close_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """B7: Admin can close a PUBLISHED assignment (PUBLISHED -> CLOSED)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        # Publish first
        pub_resp = api.post(f"/api/lms/assignments/{assign_id}/publish/", {}, token, sid)
        assert pub_resp.status_code == 200, "Setup: failed to publish assignment"

        # Then close
        resp = api.post(f"/api/lms/assignments/{assign_id}/close/", {}, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_update_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """B8: Admin can update an assignment."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        resp = api.patch(f"/api/lms/assignments/{assign_id}/", {
            "title": f"{P12}HW Chapter 1 (Updated)",
        }, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_school_b_isolation_assignments(self, seed_data, api, lms_subject, lms_cleanup):
        """B9: School B admin sees no School A assignments."""
        resp = api.get("/api/lms/assignments/", seed_data["tokens"]["admin_b"], seed_data["SID_B"])
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) == 0, f"Expected 0 assignments for School B, got {len(data)}"


# ==========================================================================
# LEVEL C: ASSIGNMENT SUBMISSIONS + GRADING
# ==========================================================================

@pytest.mark.phase12
@pytest.mark.django_db
class TestAssignmentSubmissions:

    @staticmethod
    def _create_published_assignment(api, seed_data, lms_subject):
        """Helper: create a DRAFT assignment and publish it. Returns its id."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}Submittable HW",
            "description": "Submittable homework description",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 100,
            "status": "DRAFT",
        }, token, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        pub_resp = api.post(f"/api/lms/assignments/{assign_id}/publish/", {}, token, sid)
        assert pub_resp.status_code == 200, "Setup: failed to publish assignment"
        return assign_id

    def test_create_submission(self, seed_data, api, lms_subject, lms_cleanup):
        """C1: Admin can create a submission for a published assignment."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        resp = api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"

    def test_list_submissions(self, seed_data, api, lms_subject, lms_cleanup):
        """C2: Admin can list submissions (at least 1 after creating one)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        # Create a submission first
        api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)

        resp = api.get("/api/lms/submissions/", token, sid)
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) >= 1, f"Expected >= 1 submissions, got {len(data)}"

    def test_nested_submissions_list(self, seed_data, api, lms_subject, lms_cleanup):
        """C3: Admin can list submissions for a specific assignment (nested route)."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        # Create a submission
        api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)

        resp = api.get(f"/api/lms/assignments/{assign_id}/submissions/", token, sid)
        data = _extract_results(resp)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) >= 1, f"Expected >= 1 submissions, got {len(data)}"

    def test_grade_submission(self, seed_data, api, lms_subject, lms_cleanup):
        """C4: Admin can grade a submission."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        sub_resp = api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)
        assert sub_resp.status_code == 201, "Setup: failed to create submission"
        sub_id = sub_resp.json()["id"]

        resp = api.patch(f"/api/lms/submissions/{sub_id}/grade/", {
            "marks_obtained": 85,
            "feedback": "Good work!",
        }, token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_graded_submission_has_marks(self, seed_data, api, lms_subject, lms_cleanup):
        """C5: After grading, submission has marks_obtained set and status GRADED."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        sub_resp = api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)
        assert sub_resp.status_code == 201, "Setup: failed to create submission"
        sub_id = sub_resp.json()["id"]

        # Grade it
        grade_resp = api.patch(f"/api/lms/submissions/{sub_id}/grade/", {
            "marks_obtained": 85,
            "feedback": "Good work!",
        }, token, sid)
        assert grade_resp.status_code == 200, "Setup: failed to grade submission"

        # Verify
        resp = api.get(f"/api/lms/submissions/{sub_id}/", token, sid)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        body = resp.json()
        assert body.get("marks_obtained") is not None, "marks_obtained should not be None"
        assert body.get("status") == "GRADED", f"Expected status GRADED, got {body.get('status')}"

    def test_duplicate_submission_rejected(self, seed_data, api, lms_subject, lms_cleanup):
        """C6: Duplicate submission for the same student+assignment returns 400."""
        token = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]
        assign_id = self._create_published_assignment(api, seed_data, lms_subject)

        # First submission
        api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "My homework answers",
        }, token, sid)

        # Duplicate
        resp = api.post("/api/lms/submissions/", {
            "assignment": assign_id,
            "student": seed_data["students"][0].id,
            "school": sid,
            "submission_text": "Duplicate",
        }, token, sid)
        assert resp.status_code == 400, f"Expected 400 for duplicate, got {resp.status_code}"


# ==========================================================================
# LEVEL D: PERMISSIONS & CROSS-CUTTING
# ==========================================================================

@pytest.mark.phase12
@pytest.mark.django_db
class TestPermissions:

    def test_unauthenticated_returns_401(self, seed_data, api):
        """D1: Unauthenticated request to lesson-plans returns 401."""
        resp = api.client.get("/api/lms/lesson-plans/")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_invalid_token_returns_401(self, seed_data, api):
        """D2: Invalid Bearer token returns 401."""
        resp = api.client.get(
            "/api/lms/lesson-plans/",
            HTTP_AUTHORIZATION="Bearer garbage_token",
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_teacher_cannot_update_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """D3: Teacher cannot update an assignment (403)."""
        token_admin = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token_admin, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        resp = api.patch(f"/api/lms/assignments/{assign_id}/", {
            "title": "Teacher edit",
        }, seed_data["tokens"]["teacher"], sid)
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_teacher_cannot_delete_assignment(self, seed_data, api, lms_subject, lms_cleanup):
        """D4: Teacher cannot delete an assignment (403)."""
        token_admin = seed_data["tokens"]["admin"]
        sid = seed_data["SID_A"]

        create_resp = api.post("/api/lms/assignments/", {
            "school": sid,
            "academic_year": seed_data["academic_year"].id,
            "class_obj": seed_data["classes"][0].id,
            "subject": lms_subject.id,
            "teacher": seed_data["staff"][0].id,
            "title": f"{P12}HW Chapter 1",
            "description": "Homework on chapter 1",
            "assignment_type": "HOMEWORK",
            "due_date": f"{date.today() + timedelta(days=7)}T23:59:00Z",
            "total_marks": 20,
            "status": "DRAFT",
        }, token_admin, sid)
        assert create_resp.status_code == 201, "Setup: failed to create assignment"
        assign_id = create_resp.json()["id"]

        resp = api.delete(f"/api/lms/assignments/{assign_id}/", seed_data["tokens"]["teacher"], sid)
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
