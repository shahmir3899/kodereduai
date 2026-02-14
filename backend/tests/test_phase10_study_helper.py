"""
Phase 10 -- AI Study Helper Tests (pytest)
============================================
Covers: StudyHelperView (GET/POST/DELETE), content safety filtering,
        rate limiting, chat history, school isolation, Groq LLM mocking.

Run:
    cd backend
    pytest tests/test_phase10_study_helper.py -v --tb=short
"""

import uuid
from unittest.mock import patch, MagicMock

import pytest
from django.utils import timezone

from users.models import User
from schools.models import UserSchoolMembership
from students.models import Student, StudentProfile, StudyHelperMessage


# ── Constants ────────────────────────────────────────────────────────────────

P10SH_ = "P10SH_"
URL = "/api/students/portal/study-helper/"
MOCK_RESPONSE_TEXT = (
    "Photosynthesis is the process by which plants convert light energy "
    "into chemical energy."
)


# ── Groq mock helper ────────────────────────────────────────────────────────

def _mock_groq():
    """Return a mock class that simulates Groq chat completion."""
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = MOCK_RESPONSE_TEXT
    mock_client.return_value.chat.completions.create.return_value = mock_response
    return mock_client


# ── Student environment fixture ──────────────────────────────────────────────

@pytest.fixture
def student_env(seed_data, api):
    """
    Create a student user with StudentProfile linked to an existing Student
    record, plus UserSchoolMembership with STUDENT role. Returns a dict with
    the student user, token, student record, and school info.
    """
    uid = uuid.uuid4().hex[:6]
    school_a = seed_data["school_a"]
    student_record = seed_data["students"][0]  # Ali Hassan, Class 1A

    # Create user (role defaults to STAFF; membership overrides to STUDENT)
    username = f"{P10SH_}student_{uid}"
    email = f"{P10SH_}student_{uid}@test.com"
    user = User.objects.create_user(
        username=username,
        email=email,
        password=seed_data["password"],
        role="STAFF",
        school=school_a,
        organization=seed_data["org"],
    )

    # Create STUDENT membership (get_effective_role reads this)
    UserSchoolMembership.objects.create(
        user=user,
        school=school_a,
        role=UserSchoolMembership.Role.STUDENT,
        is_default=True,
    )

    # Link user -> student via StudentProfile
    StudentProfile.objects.create(
        user=user,
        student=student_record,
        school=school_a,
    )

    # Get JWT token
    token = api.login(username)
    assert token is not None, "Student login failed"

    return {
        "user": user,
        "token": token,
        "student": student_record,
        "school": school_a,
        "SID_A": seed_data["SID_A"],
    }


@pytest.fixture
def student_env_b(seed_data, api):
    """
    Create a SECOND student user in School A linked to a different Student
    record. Used for school isolation / cross-student tests.
    """
    uid = uuid.uuid4().hex[:6]
    school_a = seed_data["school_a"]
    student_record = seed_data["students"][1]  # Sara Khan, Class 1A

    username = f"{P10SH_}student_b_{uid}"
    email = f"{P10SH_}student_b_{uid}@test.com"
    user = User.objects.create_user(
        username=username,
        email=email,
        password=seed_data["password"],
        role="STAFF",
        school=school_a,
        organization=seed_data["org"],
    )

    UserSchoolMembership.objects.create(
        user=user,
        school=school_a,
        role=UserSchoolMembership.Role.STUDENT,
        is_default=True,
    )

    StudentProfile.objects.create(
        user=user,
        student=student_record,
        school=school_a,
    )

    token = api.login(username)
    assert token is not None, "Student B login failed"

    return {
        "user": user,
        "token": token,
        "student": student_record,
        "school": school_a,
        "SID_A": seed_data["SID_A"],
    }


# ==========================================================================
# LEVEL A: STUDY HELPER SETUP / PERMISSIONS
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestStudyHelperSetup:
    """Verify basic access: empty history, permission checks."""

    def test_a1_student_can_get_empty_history(self, seed_data, api, student_env):
        """Authenticated student with profile gets an empty list initially."""
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_a2_non_student_admin_gets_403(self, seed_data, api):
        """Admin token (non-student role) receives 403 from IsStudent."""
        resp = api.get(URL, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_a3_non_student_teacher_gets_403(self, seed_data, api):
        """Teacher token receives 403 from IsStudent."""
        resp = api.get(URL, seed_data["tokens"]["teacher"], seed_data["SID_A"])
        assert resp.status_code == 403, f"status={resp.status_code}"

    def test_a4_unauthenticated_gets_401(self, seed_data, api):
        """No token at all receives 401."""
        resp = api.client.get(URL)
        assert resp.status_code == 401, f"status={resp.status_code}"

    def test_a5_invalid_token_gets_401(self, seed_data, api):
        """Invalid bearer token receives 401."""
        resp = api.client.get(
            URL,
            HTTP_AUTHORIZATION="Bearer invalid_token_xyz",
            HTTP_X_SCHOOL_ID=str(seed_data["SID_A"]),
        )
        assert resp.status_code == 401, f"status={resp.status_code}"


# ==========================================================================
# LEVEL B: STUDY HELPER CHAT (mocking Groq)
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestStudyHelperChat:
    """POST message, verify response, history persistence."""

    @patch("groq.Groq", _mock_groq())
    def test_b1_student_can_send_message(self, seed_data, api, student_env):
        """POST with a valid message returns 200 and a response string."""
        resp = api.post(
            URL,
            {"message": "What is photosynthesis?"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )
        data = resp.json()
        assert "response" in data
        assert len(data["response"]) > 0

    def test_b2_empty_message_returns_400(self, seed_data, api, student_env):
        """POST with empty message returns 400."""
        resp = api.post(
            URL,
            {"message": ""},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"
        data = resp.json()
        assert "error" in data

    def test_b3_message_too_long_returns_400(self, seed_data, api, student_env):
        """POST with >2000 char message returns 400."""
        long_msg = "a" * 2001
        resp = api.post(
            URL,
            {"message": long_msg},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"
        data = resp.json()
        assert "error" in data
        assert "too long" in data["error"].lower() or "2000" in data["error"]

    @patch("groq.Groq", _mock_groq())
    def test_b4_chat_history_saved(self, seed_data, api, student_env):
        """After sending a message, GET returns messages in history."""
        # Send a message first
        resp = api.post(
            URL,
            {"message": "What is gravity?"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200

        # Now fetch history
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2, f"Expected at least 2 messages, got {len(data)}"

    @patch("groq.Groq", _mock_groq())
    def test_b5_history_shows_both_roles(self, seed_data, api, student_env):
        """History includes both 'user' and 'assistant' messages."""
        # Send a message
        api.post(
            URL,
            {"message": "Explain the water cycle"},
            student_env["token"],
            student_env["SID_A"],
        )

        # Fetch history
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200
        data = resp.json()
        roles = {m["role"] for m in data}
        assert "user" in roles, f"'user' role not found; roles={roles}"
        assert "assistant" in roles, f"'assistant' role not found; roles={roles}"

    @patch("groq.Groq", _mock_groq())
    def test_b6_response_contains_ai_text(self, seed_data, api, student_env):
        """The response text matches the mocked Groq output."""
        resp = api.post(
            URL,
            {"message": "Explain photosynthesis"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["response"] == MOCK_RESPONSE_TEXT

    def test_b7_missing_message_field_returns_400(self, seed_data, api, student_env):
        """POST without 'message' field returns 400."""
        resp = api.post(
            URL,
            {},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    @patch("groq.Groq", _mock_groq())
    def test_b8_message_exactly_2000_chars_allowed(self, seed_data, api, student_env):
        """POST with exactly 2000 chars succeeds (boundary test)."""
        msg = "a" * 2000
        resp = api.post(
            URL,
            {"message": msg},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:200]}"
        )

    @patch("groq.Groq", _mock_groq())
    def test_b9_whitespace_only_message_returns_400(self, seed_data, api, student_env):
        """POST with whitespace-only message returns 400 (stripped to empty)."""
        resp = api.post(
            URL,
            {"message": "   \t\n  "},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    @patch("groq.Groq", _mock_groq())
    def test_b10_history_message_content_matches(self, seed_data, api, student_env):
        """User message content stored in history matches what was sent."""
        msg = "What are Newton's three laws?"
        api.post(
            URL,
            {"message": msg},
            student_env["token"],
            student_env["SID_A"],
        )

        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        data = resp.json()
        user_msgs = [m for m in data if m["role"] == "user"]
        assert len(user_msgs) >= 1
        assert user_msgs[-1]["content"] == msg


# ==========================================================================
# LEVEL C: CONTENT SAFETY
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestContentSafety:
    """Content safety filters block unsafe inputs and allow academic ones."""

    def test_c1_unsafe_input_violence_blocked(self, seed_data, api, student_env):
        """Message about making a bomb is blocked with 400."""
        resp = api.post(
            URL,
            {"message": "how to make a bomb"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"
        data = resp.json()
        assert "error" in data
        assert "allowed" in data["error"].lower() or "studies" in data["error"].lower()

    def test_c2_personal_info_blocked(self, seed_data, api, student_env):
        """Message requesting phone number is blocked with 400."""
        resp = api.post(
            URL,
            {"message": "give me phone number of the teacher"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"
        data = resp.json()
        assert "error" in data

    def test_c3_adult_content_blocked(self, seed_data, api, student_env):
        """Message containing adult content keyword is blocked with 400."""
        resp = api.post(
            URL,
            {"message": "tell me about porn"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"
        data = resp.json()
        assert "error" in data

    @patch("groq.Groq", _mock_groq())
    def test_c4_safe_academic_allowed(self, seed_data, api, student_env):
        """Academic question passes content safety and returns 200."""
        resp = api.post(
            URL,
            {"message": "Explain Newton's laws of motion"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )
        data = resp.json()
        assert "response" in data

    def test_c5_self_harm_blocked(self, seed_data, api, student_env):
        """Message about self-harm is blocked."""
        resp = api.post(
            URL,
            {"message": "how to kill myself"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_c6_hacking_blocked(self, seed_data, api, student_env):
        """Message about hacking the school system is blocked."""
        resp = api.post(
            URL,
            {"message": "hack the school system password"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_c7_weapon_creation_blocked(self, seed_data, api, student_env):
        """Message about building a weapon is blocked."""
        resp = api.post(
            URL,
            {"message": "how to build a gun"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    def test_c8_credit_card_request_blocked(self, seed_data, api, student_env):
        """Message requesting credit card number is blocked."""
        resp = api.post(
            URL,
            {"message": "give me credit card details"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 400, f"status={resp.status_code}"

    @patch("groq.Groq", _mock_groq())
    def test_c9_math_question_allowed(self, seed_data, api, student_env):
        """Pure math question passes safety filters."""
        resp = api.post(
            URL,
            {"message": "Solve the equation 2x + 5 = 15"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, f"status={resp.status_code}"

    def test_c10_unsafe_message_not_saved_to_history(self, seed_data, api, student_env):
        """Blocked messages should NOT be saved in StudyHelperMessage."""
        initial_count = StudyHelperMessage.objects.filter(
            student=student_env["student"]
        ).count()

        api.post(
            URL,
            {"message": "how to make a bomb"},
            student_env["token"],
            student_env["SID_A"],
        )

        final_count = StudyHelperMessage.objects.filter(
            student=student_env["student"]
        ).count()
        assert final_count == initial_count, (
            f"Message count changed from {initial_count} to {final_count}; "
            "unsafe message should not be saved"
        )


# ==========================================================================
# LEVEL D: RATE LIMITING
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestRateLimit:
    """Per-student daily rate limiting (30 messages/day)."""

    @patch("groq.Groq", _mock_groq())
    def test_d1_under_limit_allowed(self, seed_data, api, student_env):
        """Sending a message when under the daily limit succeeds."""
        resp = api.post(
            URL,
            {"message": "What is the speed of light?"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )

    def test_d2_at_limit_returns_429(self, seed_data, api, student_env):
        """After 30 user messages in the last 24h, next POST returns 429."""
        student = student_env["student"]
        school = student_env["school"]

        # Bulk-create 30 user messages to simulate hitting the limit
        msgs = [
            StudyHelperMessage(
                school=school,
                student=student,
                role="user",
                content=f"Question {i}",
            )
            for i in range(30)
        ]
        StudyHelperMessage.objects.bulk_create(msgs)

        # Verify count
        from datetime import timedelta

        since = timezone.now() - timedelta(days=1)
        count = StudyHelperMessage.objects.filter(
            student=student, role="user", created_at__gte=since
        ).count()
        assert count >= 30, f"Expected >= 30 user messages, got {count}"

        # Next message should be rate-limited
        resp = api.post(
            URL,
            {"message": "What is quantum physics?"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 429, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )
        data = resp.json()
        assert "error" in data
        assert "limit" in data["error"].lower() or "daily" in data["error"].lower()

    @patch("groq.Groq", _mock_groq())
    def test_d3_old_messages_dont_count(self, seed_data, api, student_env):
        """Messages older than 24h do not count towards the daily limit."""
        student = student_env["student"]
        school = student_env["school"]

        from datetime import timedelta

        old_time = timezone.now() - timedelta(hours=25)

        # Create 30 messages with old timestamps
        msgs = []
        for i in range(30):
            m = StudyHelperMessage(
                school=school,
                student=student,
                role="user",
                content=f"Old question {i}",
            )
            msgs.append(m)
        StudyHelperMessage.objects.bulk_create(msgs)

        # Force-update created_at to 25 hours ago (auto_now_add prevents direct set)
        StudyHelperMessage.objects.filter(
            student=student, content__startswith="Old question"
        ).update(created_at=old_time)

        # New message should still be allowed since old ones are outside window
        resp = api.post(
            URL,
            {"message": "What is thermodynamics?"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp.status_code == 200, (
            f"status={resp.status_code} body={resp.content[:300]}"
        )

    def test_d4_rate_limit_per_student(self, seed_data, api, student_env, student_env_b):
        """Rate limit is per-student, not global. Student B is not affected
        by Student A's messages."""
        student_a = student_env["student"]
        school = student_env["school"]

        # Fill Student A's limit
        msgs = [
            StudyHelperMessage(
                school=school,
                student=student_a,
                role="user",
                content=f"A question {i}",
            )
            for i in range(30)
        ]
        StudyHelperMessage.objects.bulk_create(msgs)

        # Student A is rate-limited
        resp_a = api.post(
            URL,
            {"message": "Should be blocked"},
            student_env["token"],
            student_env["SID_A"],
        )
        assert resp_a.status_code == 429

        # Student B should still be allowed
        with patch("groq.Groq", _mock_groq()):
            resp_b = api.post(
                URL,
                {"message": "What is biology?"},
                student_env_b["token"],
                student_env_b["SID_A"],
            )
        assert resp_b.status_code == 200, (
            f"Student B status={resp_b.status_code} body={resp_b.content[:300]}"
        )


# ==========================================================================
# LEVEL E: CLEAR HISTORY (DELETE)
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestClearHistory:
    """DELETE endpoint clears chat history."""

    @patch("groq.Groq", _mock_groq())
    def test_e1_clear_history(self, seed_data, api, student_env):
        """DELETE clears all messages and returns the deleted count."""
        # Send a couple messages first
        api.post(
            URL,
            {"message": "What is chemistry?"},
            student_env["token"],
            student_env["SID_A"],
        )
        api.post(
            URL,
            {"message": "What is physics?"},
            student_env["token"],
            student_env["SID_A"],
        )

        # Verify messages exist
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert len(resp.json()) >= 4  # 2 user + 2 assistant

        # DELETE
        resp = api.delete(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert "deleted" in data
        assert data["deleted"] >= 4

        # Verify history is empty
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    def test_e2_clear_empty_history(self, seed_data, api, student_env):
        """DELETE with no messages returns deleted count of 0."""
        resp = api.delete(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200, f"status={resp.status_code}"
        data = resp.json()
        assert "deleted" in data
        assert data["deleted"] == 0

    @patch("groq.Groq", _mock_groq())
    def test_e3_clear_only_own_messages(self, seed_data, api, student_env, student_env_b):
        """DELETE only clears the requesting student's messages, not other students'."""
        # Student A sends a message
        api.post(
            URL,
            {"message": "What is algebra?"},
            student_env["token"],
            student_env["SID_A"],
        )

        # Student B sends a message
        api.post(
            URL,
            {"message": "What is geometry?"},
            student_env_b["token"],
            student_env_b["SID_A"],
        )

        # Student A clears history
        resp = api.delete(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200
        assert resp.json()["deleted"] >= 2

        # Student A's history is empty
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert len(resp.json()) == 0

        # Student B's history is intact
        resp = api.get(URL, student_env_b["token"], student_env_b["SID_A"])
        assert len(resp.json()) >= 2

    def test_e4_non_student_cannot_delete(self, seed_data, api):
        """Admin cannot call DELETE on study helper -> 403."""
        resp = api.delete(URL, seed_data["tokens"]["admin"], seed_data["SID_A"])
        assert resp.status_code == 403, f"status={resp.status_code}"


# ==========================================================================
# LEVEL F: SCHOOL ISOLATION / CROSS-STUDENT ISOLATION
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestSchoolIsolation:
    """Student A cannot see Student B's messages; school scoping works."""

    @patch("groq.Groq", _mock_groq())
    def test_f1_student_only_sees_own_messages(
        self, seed_data, api, student_env, student_env_b
    ):
        """Student A's GET returns only their own messages, not Student B's."""
        # Student A sends a message
        api.post(
            URL,
            {"message": "What is photosynthesis?"},
            student_env["token"],
            student_env["SID_A"],
        )

        # Student B sends a message
        api.post(
            URL,
            {"message": "What is mitosis?"},
            student_env_b["token"],
            student_env_b["SID_A"],
        )

        # Student A should only see their own messages
        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        assert resp.status_code == 200
        data_a = resp.json()
        a_user_msgs = [m for m in data_a if m["role"] == "user"]
        for m in a_user_msgs:
            assert "mitosis" not in m["content"].lower(), (
                "Student A can see Student B's message"
            )

        # Student B should only see their own messages
        resp = api.get(URL, student_env_b["token"], student_env_b["SID_A"])
        assert resp.status_code == 200
        data_b = resp.json()
        b_user_msgs = [m for m in data_b if m["role"] == "user"]
        for m in b_user_msgs:
            assert "photosynthesis" not in m["content"].lower(), (
                "Student B can see Student A's message"
            )

    @patch("groq.Groq", _mock_groq())
    def test_f2_message_counts_isolated(
        self, seed_data, api, student_env, student_env_b
    ):
        """Each student's history count reflects only their own messages."""
        # Student A sends 2 messages
        api.post(
            URL,
            {"message": "Question one from A"},
            student_env["token"],
            student_env["SID_A"],
        )
        api.post(
            URL,
            {"message": "Question two from A"},
            student_env["token"],
            student_env["SID_A"],
        )

        # Student B sends 1 message
        api.post(
            URL,
            {"message": "Question one from B"},
            student_env_b["token"],
            student_env_b["SID_A"],
        )

        # Student A sees 4 messages (2 user + 2 assistant)
        resp_a = api.get(URL, student_env["token"], student_env["SID_A"])
        assert len(resp_a.json()) == 4, (
            f"Student A expected 4 messages, got {len(resp_a.json())}"
        )

        # Student B sees 2 messages (1 user + 1 assistant)
        resp_b = api.get(URL, student_env_b["token"], student_env_b["SID_A"])
        assert len(resp_b.json()) == 2, (
            f"Student B expected 2 messages, got {len(resp_b.json())}"
        )

    @patch("groq.Groq", _mock_groq())
    def test_f3_db_records_have_correct_school(self, seed_data, api, student_env):
        """Messages stored in DB are tagged with the correct school."""
        api.post(
            URL,
            {"message": "What is chemistry?"},
            student_env["token"],
            student_env["SID_A"],
        )

        msgs = StudyHelperMessage.objects.filter(
            student=student_env["student"]
        )
        for m in msgs:
            assert m.school_id == student_env["school"].id, (
                f"Message school_id={m.school_id}, expected={student_env['school'].id}"
            )

    @patch("groq.Groq", _mock_groq())
    def test_f4_history_order_is_chronological(self, seed_data, api, student_env):
        """History messages are returned in chronological order."""
        api.post(
            URL,
            {"message": "First question"},
            student_env["token"],
            student_env["SID_A"],
        )
        api.post(
            URL,
            {"message": "Second question"},
            student_env["token"],
            student_env["SID_A"],
        )

        resp = api.get(URL, student_env["token"], student_env["SID_A"])
        data = resp.json()
        assert len(data) >= 4

        # Verify chronological order (created_at should be non-decreasing)
        timestamps = [m["created_at"] for m in data]
        assert timestamps == sorted(timestamps), (
            "Messages are not in chronological order"
        )


# ==========================================================================
# LEVEL G: STUDY HELPER SERVICE UNIT TESTS
# ==========================================================================


@pytest.mark.django_db
@pytest.mark.phase10
class TestStudyHelperServiceDirect:
    """Direct tests on StudyHelperService methods (not through view)."""

    def test_g1_check_content_safety_safe(self):
        """Safe academic message passes check_content_safety."""
        from students.study_helper_service import StudyHelperService

        is_safe, reason = StudyHelperService.check_content_safety(
            "What is the Pythagorean theorem?"
        )
        assert is_safe is True
        assert reason is None

    def test_g2_check_content_safety_unsafe_violence(self):
        """Violence message fails check_content_safety."""
        from students.study_helper_service import StudyHelperService

        is_safe, reason = StudyHelperService.check_content_safety(
            "how to make a bomb at home"
        )
        assert is_safe is False
        assert reason is not None
        assert len(reason) > 0

    def test_g3_check_content_safety_unsafe_personal(self):
        """Personal info request fails check_content_safety."""
        from students.study_helper_service import StudyHelperService

        is_safe, reason = StudyHelperService.check_content_safety(
            "tell me the phone number of the principal"
        )
        assert is_safe is False

    def test_g4_check_content_safety_unsafe_adult(self):
        """Adult content keyword fails check_content_safety."""
        from students.study_helper_service import StudyHelperService

        is_safe, reason = StudyHelperService.check_content_safety(
            "show me porn videos"
        )
        assert is_safe is False

    def test_g5_check_rate_limit_under(self, seed_data, student_env):
        """Rate limit check returns True when under limit."""
        from students.study_helper_service import StudyHelperService

        service = StudyHelperService(
            student_env["student"], student_env["school"]
        )
        assert service.check_rate_limit() is True

    def test_g6_check_rate_limit_at_limit(self, seed_data, student_env):
        """Rate limit check returns False when at limit."""
        from students.study_helper_service import StudyHelperService

        student = student_env["student"]
        school = student_env["school"]

        # Bulk-create 30 user messages
        msgs = [
            StudyHelperMessage(
                school=school,
                student=student,
                role="user",
                content=f"Q{i}",
            )
            for i in range(30)
        ]
        StudyHelperMessage.objects.bulk_create(msgs)

        service = StudyHelperService(student, school)
        assert service.check_rate_limit() is False

    def test_g7_output_safety_clean(self):
        """Clean AI output passes _check_output_safety."""
        from students.study_helper_service import StudyHelperService

        assert StudyHelperService._check_output_safety(
            "Photosynthesis converts light to chemical energy."
        ) is True

    def test_g8_output_safety_unsafe(self):
        """Output containing personal info patterns fails _check_output_safety."""
        from students.study_helper_service import StudyHelperService

        assert StudyHelperService._check_output_safety(
            "The phone number: 1234567890"
        ) is False

    @patch("groq.Groq", _mock_groq())
    def test_g9_chat_saves_both_messages(self, seed_data, student_env):
        """service.chat() saves both user and assistant messages to DB."""
        from students.study_helper_service import StudyHelperService

        student = student_env["student"]
        school = student_env["school"]
        service = StudyHelperService(student, school)

        initial_count = StudyHelperMessage.objects.filter(student=student).count()
        service.chat("What is DNA?")
        final_count = StudyHelperMessage.objects.filter(student=student).count()

        assert final_count == initial_count + 2, (
            f"Expected 2 new messages, got {final_count - initial_count}"
        )

        # Verify roles
        last_two = StudyHelperMessage.objects.filter(
            student=student
        ).order_by("-created_at")[:2]
        roles = {m.role for m in last_two}
        assert roles == {"user", "assistant"}

    @patch("groq.Groq", _mock_groq())
    def test_g10_chat_returns_response_text(self, seed_data, student_env):
        """service.chat() returns the response text string."""
        from students.study_helper_service import StudyHelperService

        service = StudyHelperService(
            student_env["student"], student_env["school"]
        )
        result = service.chat("What is RNA?")
        assert result == MOCK_RESPONSE_TEXT
