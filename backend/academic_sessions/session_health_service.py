"""
AI Session Health Dashboard Service.

Aggregates data across enrollment, attendance, fee collection, exam performance,
and staff modules to produce a holistic health report for an academic session.
Optionally generates an AI-powered natural-language summary via Groq LLM.
"""

import json
import logging
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db.models import Avg, Count, Q, Sum, F

logger = logging.getLogger(__name__)


class SessionHealthService:
    """Generates a cross-module health report for a given academic year."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_health_report(self) -> dict:
        """Return a complete health report dict with all module metrics."""
        from academic_sessions.models import AcademicYear

        academic_year = AcademicYear.objects.filter(
            id=self.academic_year_id, school_id=self.school_id,
        ).first()

        if not academic_year:
            return {'error': 'Academic year not found.', 'success': False}

        enrollment = self._enrollment_metrics(academic_year)
        attendance = self._attendance_metrics(academic_year)
        fee_collection = self._fee_collection_metrics(academic_year)
        exam_performance = self._exam_performance_metrics(academic_year)
        staff = self._staff_metrics(academic_year)

        report_data = {
            'academic_year': {
                'id': academic_year.id,
                'name': academic_year.name,
                'start_date': str(academic_year.start_date),
                'end_date': str(academic_year.end_date),
            },
            'enrollment': enrollment,
            'attendance': attendance,
            'fee_collection': fee_collection,
            'exam_performance': exam_performance,
            'staff': staff,
        }

        # Generate AI or rule-based summary
        ai_summary = self.generate_ai_summary(report_data)
        report_data['ai_summary'] = ai_summary
        report_data['success'] = True

        return report_data

    def generate_ai_summary(self, report_data: dict) -> dict:
        """Generate a natural-language summary with highlights, concerns,
        and action items. Uses Groq LLM when available, otherwise falls
        back to a deterministic rule-based summary."""
        groq_key = getattr(settings, 'GROQ_API_KEY', '')
        if groq_key:
            try:
                return self._ai_summary_via_groq(groq_key, report_data)
            except Exception as exc:
                logger.warning('Groq AI summary failed, using rule-based fallback: %s', exc)

        return self._rule_based_summary(report_data)

    # ------------------------------------------------------------------
    # Module metric helpers
    # ------------------------------------------------------------------

    def _enrollment_metrics(self, academic_year) -> dict:
        from academic_sessions.models import StudentEnrollment
        from students.models import Student

        enrolled = StudentEnrollment.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
            is_active=True,
            status='ACTIVE',
        ).count()

        capacity = Student.objects.filter(
            school_id=self.school_id,
            is_active=True,
        ).count()

        enrollment_rate = round((enrolled / capacity * 100), 1) if capacity > 0 else 0

        return {
            'total_enrolled': enrolled,
            'capacity': capacity,
            'enrollment_rate': enrollment_rate,
        }

    def _attendance_metrics(self, academic_year) -> dict:
        from academic_sessions.models import Term
        from attendance.models import AttendanceRecord

        # All records for this academic year
        records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
        )

        total_records = records.count()
        present_records = records.filter(status='PRESENT').count()
        average_attendance_rate = round(
            (present_records / total_records * 100), 1
        ) if total_records > 0 else 0

        # Current vs previous term comparison
        today = date.today()
        terms = Term.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
            is_active=True,
        ).order_by('order')

        current_term = terms.filter(
            start_date__lte=today, end_date__gte=today,
        ).first()

        current_term_rate = None
        previous_term_rate = None

        if current_term:
            ct_records = records.filter(
                date__gte=current_term.start_date,
                date__lte=current_term.end_date,
            )
            ct_total = ct_records.count()
            ct_present = ct_records.filter(status='PRESENT').count()
            current_term_rate = round(
                (ct_present / ct_total * 100), 1
            ) if ct_total > 0 else 0

            # Previous term
            prev_term = terms.filter(order__lt=current_term.order).order_by('-order').first()
            if prev_term:
                pt_records = records.filter(
                    date__gte=prev_term.start_date,
                    date__lte=prev_term.end_date,
                )
                pt_total = pt_records.count()
                pt_present = pt_records.filter(status='PRESENT').count()
                previous_term_rate = round(
                    (pt_present / pt_total * 100), 1
                ) if pt_total > 0 else 0

        # Chronic absentees: students with < 75% attendance in this session
        chronic_absentees = 0
        student_stats = (
            records.values('student_id')
            .annotate(
                total=Count('id'),
                present=Count('id', filter=Q(status='PRESENT')),
            )
        )
        for s in student_stats:
            if s['total'] > 0 and (s['present'] / s['total'] * 100) < 75:
                chronic_absentees += 1

        return {
            'average_attendance_rate': average_attendance_rate,
            'current_term_rate': current_term_rate,
            'previous_term_rate': previous_term_rate,
            'chronic_absentees': chronic_absentees,
            'total_records': total_records,
        }

    def _fee_collection_metrics(self, academic_year) -> dict:
        from finance.models import FeePayment

        payments = FeePayment.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
        )

        agg = payments.aggregate(
            total_expected=Sum('amount_due'),
            total_collected=Sum('amount_paid'),
        )

        total_expected = float(agg['total_expected'] or 0)
        total_collected = float(agg['total_collected'] or 0)
        collection_rate = round(
            (total_collected / total_expected * 100), 1
        ) if total_expected > 0 else 0

        defaulting_students = payments.filter(
            status__in=['UNPAID', 'PARTIAL'],
        ).values('student_id').distinct().count()

        return {
            'total_expected': total_expected,
            'total_collected': total_collected,
            'collection_rate': collection_rate,
            'defaulting_students': defaulting_students,
        }

    def _exam_performance_metrics(self, academic_year) -> dict:
        from examinations.models import Exam, StudentMark, ExamSubject

        exams = Exam.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
            is_active=True,
        )

        exam_subject_ids = ExamSubject.objects.filter(
            exam__in=exams, is_active=True,
        ).values_list('id', flat=True)

        marks = StudentMark.objects.filter(
            school_id=self.school_id,
            exam_subject_id__in=exam_subject_ids,
            marks_obtained__isnull=False,
            is_absent=False,
        )

        total_marks_count = marks.count()
        if total_marks_count == 0:
            return {
                'average_pass_rate': 0,
                'average_score': 0,
                'total_exams': exams.count(),
            }

        pass_count = 0
        score_sum = 0
        for m in marks.select_related('exam_subject').iterator():
            pct = float(m.marks_obtained / m.exam_subject.total_marks * 100)
            score_sum += pct
            if m.marks_obtained >= m.exam_subject.passing_marks:
                pass_count += 1

        average_pass_rate = round((pass_count / total_marks_count * 100), 1)
        average_score = round(score_sum / total_marks_count, 1)

        return {
            'average_pass_rate': average_pass_rate,
            'average_score': average_score,
            'total_exams': exams.count(),
        }

    def _staff_metrics(self, academic_year) -> dict:
        from academic_sessions.models import Term
        from hr.models import StaffMember, StaffAttendance, LeaveApplication

        total_staff = StaffMember.objects.filter(
            school_id=self.school_id,
            is_active=True,
            employment_status='ACTIVE',
        ).count()

        # Staff attendance rate across the entire session date range
        staff_attendance = StaffAttendance.objects.filter(
            school_id=self.school_id,
            date__gte=academic_year.start_date,
            date__lte=academic_year.end_date,
        )
        sa_total = staff_attendance.count()
        sa_present = staff_attendance.filter(
            status__in=['PRESENT', 'LATE', 'HALF_DAY'],
        ).count()
        staff_attendance_rate = round(
            (sa_present / sa_total * 100), 1
        ) if sa_total > 0 else 0

        # Leaves in current term
        today = date.today()
        current_term = Term.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
            is_active=True,
            start_date__lte=today,
            end_date__gte=today,
        ).first()

        if current_term:
            leaves_this_term = LeaveApplication.objects.filter(
                school_id=self.school_id,
                status='APPROVED',
                start_date__lte=current_term.end_date,
                end_date__gte=current_term.start_date,
            ).count()
        else:
            leaves_this_term = LeaveApplication.objects.filter(
                school_id=self.school_id,
                status='APPROVED',
                start_date__gte=academic_year.start_date,
                end_date__lte=academic_year.end_date,
            ).count()

        return {
            'total_staff': total_staff,
            'staff_attendance_rate': staff_attendance_rate,
            'leaves_this_term': leaves_this_term,
        }

    # ------------------------------------------------------------------
    # AI Summary helpers
    # ------------------------------------------------------------------

    def _ai_summary_via_groq(self, groq_key: str, report_data: dict) -> dict:
        """Call Groq LLM (llama-3.3-70b-versatile) to produce a structured
        summary with highlights, concerns, and action items."""
        from groq import Groq

        client = Groq(api_key=groq_key)

        # Build a concise data snapshot for the prompt
        snapshot = {
            'year': report_data['academic_year']['name'],
            'enrollment_rate': report_data['enrollment']['enrollment_rate'],
            'attendance_rate': report_data['attendance']['average_attendance_rate'],
            'current_term_attendance': report_data['attendance']['current_term_rate'],
            'previous_term_attendance': report_data['attendance']['previous_term_rate'],
            'chronic_absentees': report_data['attendance']['chronic_absentees'],
            'fee_collection_rate': report_data['fee_collection']['collection_rate'],
            'defaulting_students': report_data['fee_collection']['defaulting_students'],
            'exam_pass_rate': report_data['exam_performance']['average_pass_rate'],
            'average_score': report_data['exam_performance']['average_score'],
            'total_staff': report_data['staff']['total_staff'],
            'staff_attendance_rate': report_data['staff']['staff_attendance_rate'],
            'leaves_this_term': report_data['staff']['leaves_this_term'],
        }

        system_prompt = (
            "You are a school analytics assistant. Given the session health metrics, "
            "produce a JSON object with exactly three keys:\n"
            '  "highlights": [3 brief sentences about things going well],\n'
            '  "concerns": [3 brief sentences about issues to address],\n'
            '  "action_items": [3 brief, actionable recommendations]\n'
            "Respond ONLY with valid JSON, no markdown, no explanation."
        )

        user_prompt = f"Session health metrics:\n{json.dumps(snapshot, indent=2)}"

        response = client.chat.completions.create(
            model='llama-3.3-70b-versatile',
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            temperature=0.3,
            max_tokens=600,
        )

        raw = response.choices[0].message.content.strip()
        # Strip markdown fences if present
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1] if '\n' in raw else raw[3:]
        if raw.endswith('```'):
            raw = raw[:-3]
        raw = raw.strip()

        parsed = json.loads(raw)
        return {
            'highlights': parsed.get('highlights', [])[:3],
            'concerns': parsed.get('concerns', [])[:3],
            'action_items': parsed.get('action_items', [])[:3],
            'source': 'ai',
        }

    def _rule_based_summary(self, report_data: dict) -> dict:
        """Deterministic fallback when Groq is unavailable."""
        highlights = []
        concerns = []
        action_items = []

        enroll = report_data['enrollment']
        attend = report_data['attendance']
        fee = report_data['fee_collection']
        exam = report_data['exam_performance']
        staff = report_data['staff']

        # --- Highlights ---
        if enroll['enrollment_rate'] >= 90:
            highlights.append(
                f"Strong enrollment at {enroll['enrollment_rate']}% capacity."
            )
        elif enroll['enrollment_rate'] >= 70:
            highlights.append(
                f"Healthy enrollment at {enroll['enrollment_rate']}% capacity."
            )

        if attend['average_attendance_rate'] >= 85:
            highlights.append(
                f"Attendance is excellent at {attend['average_attendance_rate']}%."
            )

        if fee['collection_rate'] >= 80:
            highlights.append(
                f"Fee collection is on track at {fee['collection_rate']}%."
            )

        if exam['average_pass_rate'] >= 80:
            highlights.append(
                f"Exam pass rate is strong at {exam['average_pass_rate']}%."
            )

        if staff['staff_attendance_rate'] >= 90:
            highlights.append(
                f"Staff attendance is excellent at {staff['staff_attendance_rate']}%."
            )

        # Ensure exactly 3
        default_highlights = [
            "Academic session is in progress.",
            "Data collection is ongoing across modules.",
            "Systems are operational and tracking metrics.",
        ]
        while len(highlights) < 3:
            highlights.append(default_highlights[len(highlights)])
        highlights = highlights[:3]

        # --- Concerns ---
        if attend['average_attendance_rate'] < 80:
            concerns.append(
                f"Average attendance is below target at {attend['average_attendance_rate']}%."
            )

        if attend['chronic_absentees'] > 0:
            concerns.append(
                f"{attend['chronic_absentees']} student(s) are chronically absent (below 75%)."
            )

        if fee['collection_rate'] < 70:
            concerns.append(
                f"Fee collection is low at {fee['collection_rate']}%."
            )

        if fee['defaulting_students'] > 0:
            concerns.append(
                f"{fee['defaulting_students']} student(s) have outstanding fee dues."
            )

        if exam['average_pass_rate'] < 70:
            concerns.append(
                f"Exam pass rate needs attention at {exam['average_pass_rate']}%."
            )

        if staff['staff_attendance_rate'] < 85:
            concerns.append(
                f"Staff attendance is below expectations at {staff['staff_attendance_rate']}%."
            )

        default_concerns = [
            "Continue monitoring attendance trends.",
            "Review fee defaulter list regularly.",
            "Ensure exam preparation support is in place.",
        ]
        while len(concerns) < 3:
            concerns.append(default_concerns[len(concerns)])
        concerns = concerns[:3]

        # --- Action Items ---
        if attend['chronic_absentees'] > 0:
            action_items.append(
                "Reach out to parents of chronically absent students via WhatsApp alerts."
            )

        if fee['defaulting_students'] > 5:
            action_items.append(
                "Schedule a fee-collection drive and send payment reminders."
            )

        if exam['average_pass_rate'] < 75:
            action_items.append(
                "Organize extra tutoring sessions for underperforming students."
            )

        if (
            attend['current_term_rate'] is not None
            and attend['previous_term_rate'] is not None
            and attend['current_term_rate'] < attend['previous_term_rate']
        ):
            action_items.append(
                "Investigate the attendance decline from the previous term."
            )

        default_actions = [
            "Review and update fee structures for the upcoming term.",
            "Conduct a staff performance review this quarter.",
            "Prepare and share progress reports with parents.",
        ]
        while len(action_items) < 3:
            action_items.append(default_actions[len(action_items)])
        action_items = action_items[:3]

        return {
            'highlights': highlights,
            'concerns': concerns,
            'action_items': action_items,
            'source': 'rule_based',
        }
