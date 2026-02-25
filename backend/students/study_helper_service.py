"""
AI Study Helper service for student portal.

Uses Groq LLM to provide academic assistance to students,
with content safety filtering, rate limiting, and tool-calling
for data lookups (marks, assignments, attendance, etc.).
"""

import json
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
    Includes content safety filtering, per-student daily rate limiting,
    and tool-calling for data lookups.
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

        # Weak subjects (lowest marks from recent exams)
        try:
            from examinations.models import StudentMark
            from django.db.models import Avg
            subject_avgs = StudentMark.objects.filter(
                school=self.school, student=student,
            ).exclude(
                is_absent=True
            ).values(
                'exam_subject__subject__name'
            ).annotate(
                avg_pct=Avg('percentage')
            ).order_by('avg_pct')[:3]
            weak = [s for s in subject_avgs if s['avg_pct'] is not None and s['avg_pct'] < 60]
            if weak:
                weak_lines = [f"  - {s['exam_subject__subject__name']}: {s['avg_pct']:.0f}% avg" for s in weak]
                parts.append("Subjects needing improvement:\n" + "\n".join(weak_lines))
        except Exception:
            pass

        # Upcoming exams (next 14 days)
        try:
            from examinations.models import Exam
            two_weeks = timezone.now().date() + timedelta(days=14)
            exams = Exam.objects.filter(
                school=self.school,
                start_date__gte=timezone.now().date(),
                start_date__lte=two_weeks,
            ).order_by('start_date')[:3]
            if exams:
                exam_lines = [f"  - {e.name} (starts {e.start_date})" for e in exams]
                parts.append("Upcoming exams:\n" + "\n".join(exam_lines))
        except Exception:
            pass

        return "\n".join(parts)

    # ── Tool Execution ───────────────────────────────────────────────────

    def _execute_tool(self, tool_name, params):
        """Execute a tool call and return the data."""
        tools = {
            'get_my_marks': self._get_my_marks,
            'get_my_assignments': self._get_my_assignments,
            'get_topic_details': self._get_topic_details,
            'get_my_attendance': self._get_my_attendance,
            'get_exam_schedule': self._get_exam_schedule,
            'get_lesson_materials': self._get_lesson_materials,
            'get_grade_targets': self._get_grade_targets,
            'get_teacher_feedback': self._get_teacher_feedback,
        }
        handler = tools.get(tool_name)
        if not handler:
            available = ', '.join(tools.keys())
            return {"error": f"Unknown tool: {tool_name}. Available: {available}"}
        return handler(**params)

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
            "You also have tools to look up the student's data. When the student asks "
            "about their marks, assignments, attendance, exams, etc., use a tool by "
            "responding with ONLY a JSON object. For general study help (explain a "
            "concept, solve a problem), respond directly without using a tool.\n\n"
            "Tools:\n"
            "1. get_my_marks - Get exam marks and grades\n"
            "   Parameters: exam_name (optional), subject_name (optional)\n"
            "2. get_my_assignments - Get assignment status and feedback\n"
            "   Parameters: status (optional: PENDING/SUBMITTED/GRADED)\n"
            "3. get_topic_details - Get curriculum topics from textbooks\n"
            "   Parameters: subject_name (optional)\n"
            "4. get_my_attendance - Get attendance record\n"
            "   Parameters: days (optional, default 30)\n"
            "5. get_exam_schedule - Get upcoming exam dates\n"
            "   Parameters: none\n"
            "6. get_lesson_materials - Get lesson attachments and resources\n"
            "   Parameters: subject_name (optional)\n"
            "7. get_grade_targets - Get grade boundaries and required marks\n"
            "   Parameters: subject_name (optional)\n"
            "8. get_teacher_feedback - Get feedback from graded assignments\n"
            "   Parameters: none\n\n"
            'To call a tool: {{"tool": "get_my_marks", "params": {{"subject_name": "Math"}}}}\n\n'
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
        4. Multi-round tool-calling loop (up to 3 rounds)
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

        # 4. Multi-round tool-calling loop
        from groq import Groq

        client = Groq(api_key=settings.GROQ_API_KEY)
        response = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=1024,
        )
        content = response.choices[0].message.content

        max_tool_rounds = 3
        for _ in range(max_tool_rounds):
            try:
                text = content.strip()
                if '```json' in text:
                    json_str = text.split('```json')[1].split('```')[0]
                elif '```' in text:
                    json_str = text.split('```')[1].split('```')[0]
                elif text.startswith('{'):
                    json_str = text
                else:
                    break  # Not a tool call — final answer

                tool_call = json.loads(json_str)
                if 'tool' not in tool_call:
                    break

                # Execute tool
                data = self._execute_tool(
                    tool_call['tool'],
                    tool_call.get('params', {}),
                )

                # Append and call LLM again
                messages.append({"role": "assistant", "content": content})
                messages.append({"role": "user", "content": f"Tool result: {json.dumps(data, default=str)}"})

                response = client.chat.completions.create(
                    model=settings.GROQ_MODEL,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=1024,
                )
                content = response.choices[0].message.content

            except (json.JSONDecodeError, IndexError, KeyError):
                break

        response_text = content

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

    # ── Tool Implementations ─────────────────────────────────────────────

    def _get_my_marks(self, exam_name=None, subject_name=None):
        from examinations.models import StudentMark
        qs = StudentMark.objects.filter(
            school=self.school, student=self.student,
        ).select_related('exam_subject__exam', 'exam_subject__subject')

        if exam_name:
            qs = qs.filter(exam_subject__exam__name__icontains=exam_name)
        if subject_name:
            qs = qs.filter(exam_subject__subject__name__icontains=subject_name)

        marks = []
        for m in qs.order_by('-exam_subject__exam__start_date')[:20]:
            marks.append({
                'exam': m.exam_subject.exam.name,
                'subject': m.exam_subject.subject.name,
                'marks_obtained': float(m.marks_obtained) if m.marks_obtained else 0,
                'total_marks': float(m.exam_subject.total_marks),
                'percentage': float(m.percentage) if m.percentage else 0,
                'is_pass': m.is_pass,
                'is_absent': m.is_absent,
            })
        return {"marks": marks, "total_results": len(marks)}

    def _get_my_assignments(self, status=None):
        from lms.models import Assignment, AssignmentSubmission

        assignments = Assignment.objects.filter(
            school=self.school,
            class_obj=self.student.class_obj,
            status='PUBLISHED',
        ).select_related('subject').order_by('due_date')[:20]

        result = []
        for a in assignments:
            sub = AssignmentSubmission.objects.filter(
                assignment=a, student=self.student,
            ).first()
            entry = {
                'title': a.title,
                'subject': a.subject.name,
                'due_date': str(a.due_date),
                'type': a.assignment_type,
                'submission_status': sub.status if sub else 'NOT_SUBMITTED',
                'marks': float(sub.marks_obtained) if sub and sub.marks_obtained else None,
                'feedback': sub.feedback if sub and sub.feedback else None,
            }
            if status and entry['submission_status'] != status:
                continue
            result.append(entry)
        return {"assignments": result, "total": len(result)}

    def _get_topic_details(self, subject_name=None):
        from lms.models import Book
        qs = Book.objects.filter(
            school=self.school, class_obj=self.student.class_obj,
        ).select_related('subject').prefetch_related('chapters__topics')

        if subject_name:
            qs = qs.filter(subject__name__icontains=subject_name)

        books = []
        for book in qs[:5]:
            chapters = []
            for ch in book.chapters.all().order_by('chapter_number')[:10]:
                topics = [
                    {'title': t.title, 'description': t.description or ''}
                    for t in ch.topics.all().order_by('topic_number')[:10]
                ]
                chapters.append({
                    'chapter_number': ch.chapter_number,
                    'title': ch.title,
                    'topics': topics,
                })
            books.append({
                'title': book.title,
                'subject': book.subject.name,
                'chapters': chapters,
            })
        return {"books": books}

    def _get_my_attendance(self, days=30):
        from attendance.models import AttendanceRecord

        cutoff = timezone.now().date() - timedelta(days=int(days))
        records = AttendanceRecord.objects.filter(
            student=self.student, school=self.school, date__gte=cutoff,
        ).order_by('-date')

        total = records.count()
        present = records.filter(status='PRESENT').count()
        absent = records.filter(status='ABSENT').count()
        absent_dates = list(
            records.filter(status='ABSENT').values_list('date', flat=True)[:10]
        )

        return {
            "days_checked": total,
            "present": present,
            "absent": absent,
            "attendance_rate": f"{round(present / total * 100, 1)}%" if total else "N/A",
            "recent_absences": [str(d) for d in absent_dates],
        }

    def _get_exam_schedule(self):
        from examinations.models import Exam, ExamSubject

        exams = Exam.objects.filter(
            school=self.school,
            start_date__gte=timezone.now().date(),
        ).order_by('start_date')[:5]

        result = []
        for exam in exams:
            subjects = ExamSubject.objects.filter(
                exam=exam,
            ).select_related('subject').order_by('exam_date')
            result.append({
                'name': exam.name,
                'start_date': str(exam.start_date),
                'end_date': str(exam.end_date) if exam.end_date else None,
                'subjects': [
                    {
                        'subject': es.subject.name,
                        'date': str(es.exam_date) if es.exam_date else None,
                        'total_marks': float(es.total_marks),
                        'passing_marks': float(es.passing_marks),
                    }
                    for es in subjects[:15]
                ],
            })
        return {"upcoming_exams": result}

    def _get_lesson_materials(self, subject_name=None):
        from lms.models import LessonPlan, LessonAttachment

        lessons = LessonPlan.objects.filter(
            school=self.school,
            class_obj=self.student.class_obj,
            status='PUBLISHED',
        ).select_related('subject').order_by('-lesson_date')

        if subject_name:
            lessons = lessons.filter(subject__name__icontains=subject_name)

        lessons = lessons[:10]
        result = []
        for lp in lessons:
            attachments = LessonAttachment.objects.filter(lesson=lp)
            if attachments.exists():
                result.append({
                    'lesson': lp.title,
                    'subject': lp.subject.name,
                    'date': str(lp.lesson_date),
                    'materials': [
                        {'name': a.file_name, 'type': a.attachment_type, 'url': a.file_url}
                        for a in attachments[:5]
                    ],
                })
        return {"lessons_with_materials": result}

    def _get_grade_targets(self, subject_name=None):
        from examinations.models import GradeScale, ExamSubject

        grades = GradeScale.objects.filter(
            school=self.school, is_active=True,
        ).order_by('-min_percentage')

        result = {
            "grade_boundaries": [
                {
                    'grade': g.grade_label,
                    'min_percentage': float(g.min_percentage),
                    'max_percentage': float(g.max_percentage),
                    'gpa_points': float(g.gpa_points) if g.gpa_points else None,
                }
                for g in grades
            ],
        }

        if subject_name:
            exam_subjects = ExamSubject.objects.filter(
                exam__school=self.school,
                subject__name__icontains=subject_name,
            ).select_related('exam', 'subject').order_by('-exam__start_date')[:3]
            result['recent_exams'] = [
                {
                    'exam': es.exam.name,
                    'subject': es.subject.name,
                    'total_marks': float(es.total_marks),
                    'passing_marks': float(es.passing_marks),
                }
                for es in exam_subjects
            ]

        return result

    def _get_teacher_feedback(self):
        from lms.models import AssignmentSubmission

        submissions = AssignmentSubmission.objects.filter(
            student=self.student,
            status='GRADED',
        ).exclude(
            feedback__isnull=True,
        ).exclude(
            feedback='',
        ).select_related(
            'assignment__subject',
        ).order_by('-graded_at')[:10]

        return {
            "feedback": [
                {
                    'assignment': s.assignment.title,
                    'subject': s.assignment.subject.name,
                    'marks': float(s.marks_obtained) if s.marks_obtained else None,
                    'total_marks': float(s.assignment.total_marks) if s.assignment.total_marks else None,
                    'feedback': s.feedback,
                }
                for s in submissions
            ],
        }
