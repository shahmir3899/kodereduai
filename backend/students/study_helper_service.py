"""
AI Study Helper service for student portal.

Uses Groq LLM to provide academic assistance to students,
with content safety filtering and rate limiting.
"""

import logging
import re
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# ── Content Safety Patterns ─────────────────────────────────────────────────
UNSAFE_PATTERNS = [
    # Personal information requests
    re.compile(
        r'(give\s+me|share|tell\s+me|what\s*is).{0,30}'
        r'(phone\s*number|address|email|password|social\s*security|'
        r'credit\s*card|bank\s*account|aadhaar|passport)',
        re.IGNORECASE,
    ),
    # Violence / weapons
    re.compile(
        r'(how\s+to|make|build|create).{0,20}'
        r'(bomb|weapon|gun|explosive|poison|kill|murder|hurt)',
        re.IGNORECASE,
    ),
    # Adult / sexual content
    re.compile(
        r'(sex|porn|nude|naked|erotic|xxx|adult\s*content)',
        re.IGNORECASE,
    ),
    # Self-harm
    re.compile(
        r'(how\s+to|ways\s+to|help\s+me).{0,20}'
        r'(suicide|self[- ]?harm|cut\s+my|kill\s+myself|end\s+my\s+life)',
        re.IGNORECASE,
    ),
    # Hacking / cheating
    re.compile(
        r'(hack|crack|bypass|cheat).{0,20}'
        r'(system|password|exam|test|school|account)',
        re.IGNORECASE,
    ),
]

UNSAFE_OUTPUT_PATTERNS = [
    re.compile(
        r'(phone\s*number|home\s*address|social\s*security|'
        r'credit\s*card|bank\s*account|aadhaar\s*number|passport\s*number)'
        r'\s*[:=]\s*\S+',
        re.IGNORECASE,
    ),
    re.compile(
        r'(detailed\s+instructions?\s+(to|for)\s+(make|build|create))\s+'
        r'(bomb|weapon|explosive|poison)',
        re.IGNORECASE,
    ),
]

DAILY_MESSAGE_LIMIT = 30


class StudyHelperService:
    """
    AI-powered study helper for students.

    Provides academic assistance using Groq LLM, contextualised to the
    student's class, subjects, recent lessons, and active assignments.
    Includes content safety filtering and per-student daily rate limiting.
    """

    def __init__(self, student, school):
        self.student = student
        self.school = school

    # ── Rate Limiting ────────────────────────────────────────────────────

    def check_rate_limit(self):
        """Return True if the student is within the daily message limit."""
        from .models import StudyHelperMessage

        since = timezone.now() - timedelta(days=1)
        count = StudyHelperMessage.objects.filter(
            student=self.student,
            role='user',
            created_at__gte=since,
        ).count()
        return count < DAILY_MESSAGE_LIMIT

    # ── Content Safety ───────────────────────────────────────────────────

    @staticmethod
    def check_content_safety(text):
        """
        Check whether *text* is safe.

        Returns:
            (True, None)               – if safe
            (False, <reason string>)   – if unsafe
        """
        for pattern in UNSAFE_PATTERNS:
            if pattern.search(text):
                return (
                    False,
                    "Your message contains content that isn't allowed. "
                    "Please keep questions related to your studies.",
                )
        return True, None

    @staticmethod
    def _check_output_safety(text):
        """Return True if the AI output passes safety checks."""
        for pattern in UNSAFE_OUTPUT_PATTERNS:
            if pattern.search(text):
                return False
        return True

    # ── Student Context ──────────────────────────────────────────────────

    def _get_student_context(self):
        """Build a context string describing the student's academic situation."""
        student = self.student
        parts = []

        # Basic info
        parts.append(f"Student name: {student.name}")
        parts.append(f"Class: {student.class_obj.name}")

        # Subjects from ClassSubject
        try:
            from academics.models import ClassSubject
            class_subjects = ClassSubject.objects.filter(
                school=self.school,
                class_obj=student.class_obj,
            ).select_related('subject')
            subject_names = [cs.subject.name for cs in class_subjects]
            if subject_names:
                parts.append(f"Subjects: {', '.join(subject_names)}")
        except Exception:
            pass

        # Recent lesson plans (last 7 days)
        try:
            from lms.models import LessonPlan
            week_ago = timezone.now().date() - timedelta(days=7)
            lessons = LessonPlan.objects.filter(
                school=self.school,
                class_obj=student.class_obj,
                status='PUBLISHED',
                lesson_date__gte=week_ago,
            ).select_related('subject').order_by('-lesson_date')[:5]
            if lessons:
                lesson_lines = []
                for lp in lessons:
                    lesson_lines.append(
                        f"  - {lp.subject.name}: {lp.title} ({lp.lesson_date})"
                    )
                parts.append("Recent lessons:\n" + "\n".join(lesson_lines))
        except Exception:
            pass

        # Active assignments (published, due in the future)
        try:
            from lms.models import Assignment
            assignments = Assignment.objects.filter(
                school=self.school,
                class_obj=student.class_obj,
                status='PUBLISHED',
                due_date__gte=timezone.now(),
            ).select_related('subject').order_by('due_date')[:5]
            if assignments:
                assignment_lines = []
                for a in assignments:
                    assignment_lines.append(
                        f"  - {a.subject.name}: {a.title} (due {a.due_date.strftime('%Y-%m-%d')})"
                    )
                parts.append(
                    "Active assignments:\n" + "\n".join(assignment_lines)
                )
        except Exception:
            pass

        return "\n".join(parts)

    # ── System Prompt ────────────────────────────────────────────────────

    def _build_system_prompt(self):
        context = self._get_student_context()
        return (
            "You are a friendly and helpful AI study assistant for a school student. "
            "Your role is to help the student understand their subjects, complete "
            "assignments, and prepare for exams. Always be encouraging, patient, and "
            "age-appropriate.\n\n"
            "Rules:\n"
            "1. Only answer questions related to academics and school studies.\n"
            "2. If asked about non-academic topics, politely redirect to studies.\n"
            "3. Never share personal information or inappropriate content.\n"
            "4. Give clear, step-by-step explanations when solving problems.\n"
            "5. Encourage the student to think and learn, don't just give answers.\n"
            "6. Reference the student's actual subjects and assignments when relevant.\n\n"
            f"Student context:\n{context}"
        )

    # ── Chat ─────────────────────────────────────────────────────────────

    def chat(self, user_message):
        """
        Process a student message and return the AI response.

        Steps:
        1. Check rate limit
        2. Check input safety
        3. Build message list (system + last 10 history + new user message)
        4. Call Groq LLM
        5. Check output safety
        6. Save both messages to DB
        7. Return response text
        """
        from .models import StudyHelperMessage

        # 1. Rate limit
        if not self.check_rate_limit():
            raise ValueError("Daily message limit reached.")

        # 2. Input safety
        is_safe, reason = self.check_content_safety(user_message)
        if not is_safe:
            raise ValueError(reason)

        # 3. Build messages
        system_prompt = self._build_system_prompt()
        messages = [{"role": "system", "content": system_prompt}]

        # Last 10 history messages
        history = StudyHelperMessage.objects.filter(
            student=self.student,
        ).order_by('-created_at')[:10]

        for msg in reversed(list(history)):
            messages.append({"role": msg.role, "content": msg.content})

        # Add current user message
        messages.append({"role": "user", "content": user_message})

        # 4. Call Groq LLM
        from groq import Groq

        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=1024,
        )
        response_text = response.choices[0].message.content

        # 5. Check output safety
        if not self._check_output_safety(response_text):
            response_text = (
                "I'm sorry, I can't provide that information. "
                "Let me help you with something related to your studies instead."
            )

        # 6. Save both messages
        StudyHelperMessage.objects.create(
            school=self.school,
            student=self.student,
            role='user',
            content=user_message,
        )
        StudyHelperMessage.objects.create(
            school=self.school,
            student=self.student,
            role='assistant',
            content=response_text,
        )

        # 7. Return response
        return response_text
