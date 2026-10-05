"""
AI Student 360 Profile Service.
Generates a holistic risk assessment combining attendance, fees, and academics.

The levels and the overall score are NOT computed here: they come from
academic_sessions.student_risk_score_service, the same rules the school-wide Student
Risk Score page uses, so a student has one risk level everywhere. This class adds the
profile-only parts: the per-dimension detail, recommendations and the summary text.
"""

import hashlib
import logging
from collections import defaultdict
from datetime import date

from django.core.cache import cache

logger = logging.getLogger(__name__)

SUMMARY_CACHE_SECONDS = 24 * 60 * 60

# Roles that may see a student's fee position (the finance module's own rule: the
# admin roles plus the accountant). Everyone else gets a profile with no fee detail.
FEE_VISIBLE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'ACCOUNTANT')


def can_see_fees(role):
    return role in FEE_VISIBLE_ROLES


class Student360Service:
    """
    Holistic student risk profiling.

    Usage:
        service = Student360Service(school_id, student_id)
        profile = service.generate_profile(include_fees=can_see_fees(role))
    """

    def __init__(self, school_id, student_id):
        self.school_id = school_id
        self.student_id = student_id

    # ── Dimensions ───────────────────────────────────────────────────────────

    @staticmethod
    def _attendance_section(entry):
        if not entry or entry.get('insufficient_data'):
            entry = entry or {}
            total = entry.get('total_days', 0)
            return {
                'rate': entry.get('current_rate'),
                'present': None, 'absent': None, 'leave': entry.get('excused_leave_days', 0),
                'total_days': total,
                'trend': 'no_data',
                'risk': None,
                'insufficient_data': True,
            }
        present_days = entry['present_days']       # leave days are counted as present
        leave = entry.get('excused_leave_days', 0)
        return {
            'rate': entry['current_rate'],
            'present': max(present_days - leave, 0),
            'absent': entry['total_days'] - present_days,
            'leave': leave,
            'total_days': entry['total_days'],
            'trend': entry['trend'],
            'risk': entry['severity'] or 'LOW',
            'insufficient_data': False,
        }

    def _weakest_subject(self, academic_year_id, segments=None):
        """Subject with the lowest average percentage this year (marks are out of
        different totals per exam, so raw marks cannot be compared). For a transferred
        student the earlier branch's exams dated inside this year count too."""
        from examinations.models import StudentMark

        pcts = defaultdict(list)
        if segments is not None and len(segments) > 1:
            from academic_sessions.models import AcademicYear
            from students.timeline import marks_q

            year = AcademicYear.objects.filter(pk=academic_year_id).only('start_date', 'end_date').first()
            marks = StudentMark.objects.filter(
                marks_q(segments), is_absent=False, marks_obtained__isnull=False, exam_subject__total_marks__gt=0,
                exam_subject__exam__start_date__gte=year.start_date, exam_subject__exam__start_date__lte=year.end_date,
            ).select_related('exam_subject__subject')
        else:
            marks = StudentMark.objects.filter(
                student_id=self.student_id, is_absent=False, marks_obtained__isnull=False,
                exam_subject__exam__academic_year_id=academic_year_id,
                exam_subject__total_marks__gt=0,
            ).select_related('exam_subject__subject')
        for m in marks:
            pcts[m.exam_subject.subject.name].append(
                float(m.marks_obtained) / float(m.exam_subject.total_marks) * 100
            )
        if not pcts:
            return None
        return min(pcts.items(), key=lambda kv: sum(kv[1]) / len(kv[1]))[0]

    def _academic_section(self, entry, academic_year_id, segments=None):
        if not entry or entry.get('insufficient_data'):
            entry = entry or {}
            return {
                'avg_score': entry.get('current_average'),
                'trend': 'no_data',
                'weakest': None,
                'risk': None,
                'exams_recorded': entry.get('exams_recorded', 0),
                'insufficient_data': True,
            }
        return {
            'avg_score': entry['current_average'],        # percentage, last exam
            'trend': entry['trend'],
            'weakest': self._weakest_subject(academic_year_id, segments),
            'risk': entry['severity'] or 'LOW',
            'exams_recorded': entry['exams_recorded'],
            'insufficient_data': False,
        }

    def _financial_section(self, fee, student, segments):
        from finance.models import FeePayment
        from finance.student_balance import student_fee_summary

        summary = student_fee_summary(student, segments)
        due, paid = summary['total_due'], summary['total_paid']
        from students.timeline import fees_q
        has_history = FeePayment.objects.filter(fees_q(segments)).exists()
        return {
            'paid_rate': round(float(paid) / float(due) * 100, 1) if due > 0 else None,
            'outstanding': float(summary['pending']),
            'months_owed': round(float(fee['months_owed']), 1),
            'months_overdue': fee['months_overdue'],
            'risk': (fee['level'] or 'LOW') if has_history else None,
            'insufficient_data': not has_history,
        }

    # ── Summary text ─────────────────────────────────────────────────────────

    @staticmethod
    def _rule_based_summary(attendance, academic, financial, overall_risk, earlier=()):
        parts = []
        if attendance['insufficient_data']:
            parts.append("Not enough attendance data to assess yet")
        elif attendance['risk'] != 'LOW':
            parts.append(f"Attendance is concerning at {attendance['rate']}% ({attendance['trend']} trend)")
        if academic['insufficient_data']:
            parts.append("Not enough exam results to assess academics yet")
        elif academic['risk'] != 'LOW':
            parts.append(f"Academic performance needs attention (last exam average {academic['avg_score']}%)")
        if financial and not financial['insufficient_data'] and financial['risk'] != 'LOW':
            parts.append(
                f"Fees: PKR {financial['outstanding']:,.0f} outstanding "
                f"({financial['months_owed']} months of fees)"
            )
        if not parts:
            parts.append("Student is performing well across all areas")
        text = '. '.join(parts) + '.'
        if earlier:
            text += f" (Includes records from {', '.join(earlier)}.)"
        return text

    def _summary(self, attendance, academic, financial, overall_risk, earlier=()):
        """LLM summary, cached per student per day. The key also carries a hash of the
        facts it was written from (and whether fees were included), so a changed figure
        gets a fresh summary and a teacher's fee-free text is never served to an admin
        (or the reverse). Only LLM answers are cached; the rule-based fallback is cheap
        and a transient LLM failure must not stick for the whole day."""
        facts = f"{attendance}|{academic}|{financial}|{overall_risk}|{list(earlier)}"
        digest = hashlib.sha1(facts.encode()).hexdigest()[:12]
        key = (f"student360:summary:{self.school_id}:{self.student_id}:{date.today().isoformat()}:"
               f"{'fees' if financial else 'nofees'}:{digest}")
        try:
            cached = cache.get(key)
        except Exception:  # cache outage must not break the profile
            cached = None
        if cached:
            return cached

        try:
            from django.conf import settings
            if not settings.GROQ_API_KEY:
                raise RuntimeError("No API key")

            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            lines = [
                f"- Attendance: {attendance['rate']}% rate (leave days count as present), "
                f"trend: {attendance['trend']}, {attendance['absent']} absences"
                if not attendance['insufficient_data'] else "- Attendance: not enough data yet",
                f"- Academics: last exam average {academic['avg_score']}%, trend: {academic['trend']}, "
                f"weakest subject: {academic['weakest']}"
                if not academic['insufficient_data'] else "- Academics: not enough exam results yet",
            ]
            if financial and not financial['insufficient_data']:
                lines.append(
                    f"- Fees: PKR {financial['outstanding']:,.0f} outstanding "
                    f"({financial['months_owed']} months of fees owed)"
                )
            if earlier:
                lines.append(f"- Note: this includes records from the student's earlier branch ({', '.join(earlier)})")
            prompt = (
                "Generate a brief 2-3 sentence student assessment summary based on:\n"
                + "\n".join(lines)
                + f"\n- Overall Risk: {overall_risk}\n\n"
                "Be concise and actionable. Mention the most important concern first. "
                "Only mention what is listed above."
            )
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=200,
            )
            text = response.choices[0].message.content.strip()
            try:
                cache.set(key, text, SUMMARY_CACHE_SECONDS)
            except Exception:  # cache outage must not break the profile
                pass
            return text
        except Exception as e:
            logger.info(f"LLM summary fallback: {e}")
            return self._rule_based_summary(attendance, academic, financial, overall_risk, earlier)

    # ── Entry point ──────────────────────────────────────────────────────────

    def _left_school(self, status, left_date):
        return {
            'left_school': True,
            'left_status': status,
            'left_date': left_date.isoformat() if left_date else None,
            'overall_risk': None,
            'risk_score': None,
            'ai_summary': None,
            'recommendations': [],
        }

    def generate_profile(self, include_fees=True):
        """Complete 360 profile. include_fees False (roles that cannot see finance)
        leaves out every fee figure and scores from attendance and academics only."""
        from academic_sessions.leaving import departed_in_year
        from academic_sessions.student_risk_score_service import StudentRiskScoreService
        from academic_sessions.utils import resolve_current_academic_year_id
        from students.models import Student
        from students.timeline import student_timeline

        year_id = resolve_current_academic_year_id(self.school_id)
        student = Student.objects.select_related('school').get(pk=self.student_id)
        segments = student_timeline(student)

        departed = departed_in_year(self.school_id, [self.student_id], year_id).get(self.student_id)
        if departed:
            return self._left_school(*departed)

        result = StudentRiskScoreService(self.school_id, year_id).score_student(
            self.student_id, include_fees=include_fees, student=student,
        ) if year_id else {'composite_score': 10.0, 'severity': 'LOW',
                           'attendance': None, 'academic': None, 'fee': None}

        attendance = self._attendance_section(result['attendance'])
        academic = self._academic_section(result['academic'], year_id, segments)
        financial = self._financial_section(result['fee'], student, segments) if include_fees and result['fee'] else None

        overall_risk, risk_score = result['severity'], result['composite_score']

        recommendations = []
        if attendance['risk'] in ('HIGH', 'MEDIUM'):
            recommendations.append(f"Investigate attendance pattern - currently at {attendance['rate']}%")
        if attendance['trend'] == 'declining':
            recommendations.append("Attendance is declining - consider parent meeting")
        if academic['weakest'] and academic['risk'] in ('HIGH', 'MEDIUM'):
            recommendations.append(f"Focus on {academic['weakest']} - weakest subject")
        if financial and financial['months_overdue'] > 0:
            months = financial['months_overdue']
            recommendations.append(f"Send fee reminder - {months} month{'' if months == 1 else 's'} overdue")

        profile = {
            'left_school': False,
            'overall_risk': overall_risk,
            'risk_score': risk_score,
            'fees_hidden': not include_fees,
            'earlier_branches': [s.school_name for s in segments if not s.is_current],
            'attendance': attendance,
            'academic': academic,
            'ai_summary': self._summary(
                attendance, academic, financial, overall_risk,
                [s.school_name for s in segments if not s.is_current],
            ),
            'recommendations': recommendations,
        }
        if include_fees:
            profile['financial'] = financial or {
                'paid_rate': None, 'outstanding': 0.0, 'months_owed': 0, 'months_overdue': 0,
                'risk': None, 'insufficient_data': True,
            }
        return profile
