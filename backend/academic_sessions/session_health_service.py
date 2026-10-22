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

# Leave is an approved absence, so it counts as attended.
ATTENDED_STATUSES = ('PRESENT', 'LEAVE')
# Promoted/repeat/graduated students are still at the school; only these two left it.
LOST_ENROLLMENT_STATUSES = ('WITHDRAWN', 'TRANSFERRED')


class SessionHealthService:
    """Generates a cross-module health report for a given academic year."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_health_report(self, include_ai: bool = True) -> dict:
        """Return a complete health report dict with all module metrics.

        With include_ai=False the summary is the instant rule-based one and the
        Groq call is skipped: the dashboard used to block 1.5-2.3 s on that call
        on every load. Callers then fetch the AI text separately (generate_ai_summary_only).
        """
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

        if include_ai:
            report_data['ai_summary'] = self.generate_ai_summary(report_data)
        else:
            report_data['ai_summary'] = self._rule_based_summary(report_data)
            # Lets the client know an AI version can be requested afterwards.
            report_data['ai_summary_available'] = bool(getattr(settings, 'GROQ_API_KEY', ''))
        report_data['success'] = True

        return report_data

    def generate_ai_summary_only(self) -> dict:
        """Just the AI (or rule-based fallback) summary, for the deferred request."""
        report = self.generate_health_report(include_ai=False)
        if not report.get('success'):
            return report
        return {'success': True, 'ai_summary': self.generate_ai_summary(report)}

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
        """Retention: of everyone who was on the roll at any point this year, the
        share who haven't withdrawn or transferred out. Promoted/repeat/graduated
        students are still ours, so they count as retained."""
        from academic_sessions.models import StudentEnrollment

        # All rows for the year, not only today's active ones: a student who left
        # in March must stay in the denominator or leaving would never lower it.
        on_roll = StudentEnrollment.objects.filter(
            school_id=self.school_id, academic_year=academic_year,
        )
        total_on_roll = on_roll.count()
        left = on_roll.filter(status__in=LOST_ENROLLMENT_STATUSES).count()
        retained = total_on_roll - left
        retention_rate = round((retained / total_on_roll * 100), 1) if total_on_roll > 0 else 0

        return {
            # Kept under this name so the dashboard widget and AI prompt keep working.
            'enrollment_rate': retention_rate,
            'retention_rate': retention_rate,
            'on_roll': total_on_roll,
            'retained': retained,
            'left': left,
            'admission_conversion': self._admission_conversion(academic_year),
        }

    def _admission_conversion(self, academic_year) -> dict:
        from admissions.models import AdmissionEnquiry

        # CANCELLED stays in the denominator: a cancelled enquiry is a lost lead.
        enquiries = AdmissionEnquiry.objects.filter(
            school_id=self.school_id,
            created_at__date__gte=academic_year.start_date,
            created_at__date__lte=academic_year.end_date,
        )
        total = enquiries.count()
        converted = enquiries.filter(status='CONVERTED').count()
        return {
            'enquiries': total,
            'converted': converted,
            'rate': round((converted / total * 100), 1) if total > 0 else None,
        }

    def _attendance_metrics(self, academic_year) -> dict:
        from academic_sessions.models import Term
        from attendance.models import AttendanceRecord
        from schools.models import School

        risk_threshold = School.objects.only('id', 'attendance_config').get(
            id=self.school_id,
        ).get_attendance_risk_threshold()

        # All records for this academic year
        records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
        )

        total_records = records.count()
        present_records = records.filter(status__in=ATTENDED_STATUSES).count()
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
            ct_present = ct_records.filter(status__in=ATTENDED_STATUSES).count()
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
                pt_present = pt_records.filter(status__in=ATTENDED_STATUSES).count()
                previous_term_rate = round(
                    (pt_present / pt_total * 100), 1
                ) if pt_total > 0 else 0

        # Chronic absentees: students below this school's attendance-risk threshold
        chronic_absentees = 0
        student_stats = (
            records.values('student_id')
            .annotate(
                total=Count('id'),
                present=Count('id', filter=Q(status__in=ATTENDED_STATUSES)),
            )
        )
        for s in student_stats:
            if s['total'] > 0 and (s['present'] / s['total'] * 100) < risk_threshold:
                chronic_absentees += 1

        return {
            'average_attendance_rate': average_attendance_rate,
            'current_term_rate': current_term_rate,
            'previous_term_rate': previous_term_rate,
            'chronic_absentees': chronic_absentees,
            'total_records': total_records,
        }

    def _fee_collection_metrics(self, academic_year) -> dict:
        """Two parts, pooled into one rupee-weighted rate:

        * yearly (every non-monthly type): paid / total billed.
        * monthly: paid / (paid + still owed), over the months billed so far.

        Monthly rows can't simply be summed on amount_due: each month's amount_due
        already includes the previous month's carried balance, so a June balance
        would be counted again inside July. previous_balance / base_monthly_fee are
        snapshots taken when the month was generated and go stale once a later
        payment lands, so billed is derived from what was actually received plus
        what the latest row of each (student, category) still shows as owed.
        """
        from finance.models import FeePayment, FeeType

        today = date.today()
        payments = FeePayment.objects.filter(
            school_id=self.school_id,
            academic_year=academic_year,
            handed_over_to_exit__isnull=True,
        )

        yearly = payments.exclude(fee_type=FeeType.MONTHLY).aggregate(
            total=Sum('amount_due'), paid=Sum('amount_paid'),
        )
        yearly_total = float(yearly['total'] or 0)
        yearly_paid = float(yearly['paid'] or 0)

        # Months from the year's first month to now (capped at its last), inclusive.
        first = academic_year.start_date
        last = min(today, academic_year.end_date)
        months_elapsed = max(0, (last.year - first.year) * 12 + last.month - first.month + 1)
        start_key = first.year * 12 + first.month
        end_key = start_key + months_elapsed - 1

        monthly_rows = payments.filter(fee_type=FeeType.MONTHLY).annotate(
            period=F('year') * 12 + F('month'),
        ).filter(period__gte=start_key, period__lte=end_key)

        monthly_paid = 0.0
        latest = {}  # (student, category) -> (period, still owed on that row)
        for student_id, category_id, period, due, paid in monthly_rows.values_list(
            'student_id', 'monthly_category_id', 'period', 'amount_due', 'amount_paid',
        ):
            monthly_paid += float(paid or 0)
            key = (student_id, category_id)
            if key not in latest or period > latest[key][0]:
                latest[key] = (period, float(due or 0) - float(paid or 0))
        monthly_owed = sum(max(owed, 0.0) for _, owed in latest.values())
        monthly_expected = monthly_paid + monthly_owed

        total_expected = yearly_total + monthly_expected
        total_collected = yearly_paid + monthly_paid
        collection_rate = round(
            (total_collected / total_expected * 100), 1
        ) if total_expected > 0 else 0

        return {
            'total_expected': round(total_expected, 2),
            'total_collected': round(total_collected, 2),
            'collection_rate': collection_rate,
            'yearly': {
                'total': yearly_total,
                'paid': yearly_paid,
                'rate': round(yearly_paid / yearly_total * 100, 1) if yearly_total > 0 else None,
            },
            'monthly': {
                'months_elapsed': months_elapsed,
                'expected': round(monthly_expected, 2),
                'paid': monthly_paid,
                'rate': round(monthly_paid / monthly_expected * 100, 1) if monthly_expected > 0 else None,
            },
            'defaulting_students': self._defaulting_students(payments),
        }

    @staticmethod
    def _defaulting_students(payments) -> int:
        """Students still owing something. A monthly row's amount_due carries the
        earlier months' balance, so only the latest row of each (student, category)
        shows what is owed; older UNPAID/PARTIAL rows are already settled or rolled
        into it."""
        from finance.models import FeeType

        latest = {}
        owing = set()
        rows = payments.values_list(
            'student_id', 'fee_type', 'monthly_category_id', 'year', 'month', 'amount_due', 'amount_paid',
        )
        for student_id, fee_type, cat_id, year, month, due, paid in rows:
            if student_id is None:
                continue
            if fee_type != FeeType.MONTHLY:
                if due - paid > 0:
                    owing.add(student_id)
                continue
            key = (student_id, cat_id)
            if key not in latest or (year, month) > latest[key][0]:
                latest[key] = ((year, month), due - paid)
        owing.update(key[0] for key, (_, outstanding) in latest.items() if outstanding > 0)
        return len(owing)

    def _exam_performance_metrics(self, academic_year) -> dict:
        """Pass rate by overall result, not by subject mark: a student passes the
        way the report card says (failed subjects below the exam's threshold) in
        their main exam, the last one covering them. Same rule as the report card
        (examinations.overall_result), so the two can't disagree."""
        from examinations.models import Exam, ExamSubject, StudentMark
        from examinations.views import _exam_roster

        exams = list(Exam.objects.filter(
            school_id=self.school_id, academic_year=academic_year, is_active=True,
        ))
        total_exams = len(exams)

        # An exam nobody has been marked on yet (e.g. a scheduled one) must not
        # become the "main" exam and blank out the results of the one before it.
        marked_exam_ids = set(
            StudentMark.objects.filter(
                school_id=self.school_id, exam_subject__exam__in=exams,
            ).filter(Q(marks_obtained__isnull=False) | Q(is_absent=True))
            .values_list('exam_subject__exam_id', flat=True).distinct()
        )

        by_class = {}
        for exam in exams:
            if exam.id in marked_exam_ids:
                by_class.setdefault(exam.class_obj_id, []).append(exam)

        passed = assessed = pending = 0
        pct_sum = 0.0
        for class_exams in by_class.values():
            class_exams.sort(key=lambda e: (e.end_date or e.start_date or date.min, e.id), reverse=True)
            covered = set()
            for exam in class_exams:
                students, _rolls = _exam_roster(self.school_id, exam)
                roster_ids = {s.id for s in students}
                ids = roster_ids - covered
                covered |= roster_ids
                if ids:
                    result = self._main_exam_outcomes(exam, ids, ExamSubject, StudentMark)
                    passed += result['passed']
                    assessed += result['assessed']
                    pending += result['pending']
                    pct_sum += result['pct_sum']
                # A class-wide exam covers every section, so nothing earlier can be main.
                if exam.session_class_id is None:
                    break

        if assessed == 0:
            return {
                'average_pass_rate': None,
                'average_score': None,
                'students_assessed': 0,
                'students_passed': 0,
                'results_pending': pending,
                'total_exams': total_exams,
            }

        return {
            'average_pass_rate': round(passed / assessed * 100, 1),
            'average_score': round(pct_sum / assessed, 1),
            'students_assessed': assessed,
            'students_passed': passed,
            'results_pending': pending,
            'total_exams': total_exams,
        }

    def _main_exam_outcomes(self, exam, student_ids, ExamSubject, StudentMark) -> dict:
        from examinations.overall_result import calculate_overall_pass, subject_is_pass

        exam_subjects = list(ExamSubject.objects.filter(exam=exam, is_active=True))
        marks = {
            (m.student_id, m.exam_subject_id): m
            for m in StudentMark.objects.filter(
                school_id=self.school_id, exam_subject__in=exam_subjects, student_id__in=student_ids,
            )
        }

        passed = assessed = pending = 0
        pct_sum = 0.0
        for sid in student_ids:
            results = []
            obtained_total = possible_total = 0.0
            incomplete = False
            for es in exam_subjects:
                mark = marks.get((sid, es.id))
                obtained = mark.marks_obtained if mark and not mark.is_absent else None
                if obtained is None and not (mark and mark.is_absent):
                    incomplete = True  # same rule as the results screen: unentered = unfinished
                results.append({'is_pass': subject_is_pass(obtained, es.passing_marks)})
                possible_total += float(es.total_marks)
                if obtained is not None:
                    obtained_total += float(obtained)
            if incomplete:
                pending += 1
                continue
            assessed += 1
            if calculate_overall_pass(results, exam.fail_threshold_subjects):
                passed += 1
            if possible_total > 0:
                pct_sum += obtained_total / possible_total * 100
        return {'passed': passed, 'assessed': assessed, 'pending': pending, 'pct_sum': pct_sum}

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
        """Call Groq LLM (configured via settings.GROQ_MODEL / EDU_GROQ_MODEL) to
        produce a structured summary with highlights, concerns, and action items."""
        from groq import Groq

        client = Groq(api_key=groq_key)

        # Build a concise data snapshot for the prompt
        snapshot = {
            'year': report_data['academic_year']['name'],
            'student_retention_rate': report_data['enrollment']['retention_rate'],
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
            model=settings.GROQ_MODEL,
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            temperature=0.3,
            max_tokens=1500,
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
        if enroll['retention_rate'] >= 90:
            highlights.append(
                f"Strong student retention at {enroll['retention_rate']}%."
            )
        elif enroll['retention_rate'] >= 70:
            highlights.append(
                f"Healthy student retention at {enroll['retention_rate']}%."
            )

        if attend['average_attendance_rate'] >= 85:
            highlights.append(
                f"Attendance is excellent at {attend['average_attendance_rate']}%."
            )

        if fee['collection_rate'] >= 80:
            highlights.append(
                f"Fee collection is on track at {fee['collection_rate']}%."
            )

        pass_rate = exam['average_pass_rate']  # None until a main exam has complete results
        if pass_rate is not None and pass_rate >= 80:
            highlights.append(
                f"Overall pass rate is strong at {pass_rate}%."
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

        if pass_rate is not None and pass_rate < 70:
            concerns.append(
                f"Overall pass rate needs attention at {pass_rate}%."
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

        if exam['average_pass_rate'] is not None and exam['average_pass_rate'] < 75:
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
