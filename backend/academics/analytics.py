"""
Academics Predictive Analytics.

This service powers the analytics dashboard and now supports a versioned
overview contract with:
- signals
- alerts
- recommendations
- risk and intervention intelligence
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from django.db.models import Avg, Count, F, Q
from django.utils import timezone

logger = logging.getLogger(__name__)


class AcademicsAnalytics:
    """Aggregation-based analytics for academics planning."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def subject_attendance_by_slot(self, date_from=None, date_to=None) -> dict:
        """Compute attendance rates per subject grouped by weekday (Mon-Sat)."""
        from attendance.models import AttendanceRecord
        from .models import TimetableEntry

        day_order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
        day_map = {0: 'MON', 1: 'TUE', 2: 'WED', 3: 'THU', 4: 'FRI', 5: 'SAT'}

        # Build class+day -> subject names from timetable.
        class_day_subjects = defaultdict(set)
        timetable_rows = TimetableEntry.objects.filter(
            school_id=self.school_id, subject__isnull=False
        ).values('class_obj_id', 'day', 'subject__name')

        for row in timetable_rows:
            class_day_subjects[(row['class_obj_id'], row['day'])].add(row['subject__name'])

        if not class_day_subjects:
            return {'subjects': [], 'message': 'No timetable subject mapping found.'}

        att_qs = AttendanceRecord.objects.filter(school_id=self.school_id)
        if date_from:
            att_qs = att_qs.filter(date__gte=date_from)
        if date_to:
            att_qs = att_qs.filter(date__lte=date_to)

        class_date_attendance = att_qs.values('student__class_obj_id', 'date').annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        )

        # subject_day_stats[subject][day] -> {'total': x, 'present': y}
        subject_day_stats = defaultdict(
            lambda: defaultdict(lambda: {'total': 0, 'present': 0})
        )

        for record in class_date_attendance:
            day_code = day_map.get(record['date'].weekday())
            if not day_code:
                continue

            class_id = record['student__class_obj_id']
            subjects_for_day = class_day_subjects.get((class_id, day_code), set())
            if not subjects_for_day:
                continue

            for subject_name in subjects_for_day:
                subject_day_stats[subject_name][day_code]['total'] += record['total']
                subject_day_stats[subject_name][day_code]['present'] += record['present']

        results = []
        for subject_name, day_stats in subject_day_stats.items():
            day_rates = {}
            total_present = 0
            total_all = 0

            for day_code in day_order:
                stats = day_stats.get(day_code, {'total': 0, 'present': 0})
                total_present += stats['present']
                total_all += stats['total']
                day_rates[day_code] = round(stats['present'] / stats['total'] * 100, 1) if stats['total'] > 0 else None

            overall_rate = round(total_present / total_all * 100, 1) if total_all > 0 else None
            results.append({
                'subject_name': subject_name,
                'day_rates': day_rates,
                'mon_rate': day_rates['MON'],
                'tue_rate': day_rates['TUE'],
                'wed_rate': day_rates['WED'],
                'thu_rate': day_rates['THU'],
                'fri_rate': day_rates['FRI'],
                'sat_rate': day_rates['SAT'],
                'overall_rate': overall_rate,
            })

        results.sort(key=lambda x: x.get('overall_rate') or 0, reverse=True)
        return {'subjects': results}

    def attendance_signals(self, date_from=None, date_to=None, months: int = 6) -> dict:
        """Attendance-focused signal block."""
        subject_attendance = self.subject_attendance_by_slot(date_from, date_to)
        trends = self.attendance_trends(months)

        subject_rates = [
            s.get('overall_rate')
            for s in subject_attendance.get('subjects', [])
            if s.get('overall_rate') is not None
        ]
        average_rate = round(sum(subject_rates) / len(subject_rates), 1) if subject_rates else None

        return {
            'subject_attendance': subject_attendance,
            'attendance_trends': trends,
            'summary': {
                'average_subject_attendance_rate': average_rate,
                'subject_count': len(subject_attendance.get('subjects', [])),
            },
            'metric_definitions': {
                'attendance_rate': 'Student present records / total student attendance records * 100. Teacher attendance is not used.',
            },
        }

    def teacher_effectiveness(self, date_from=None, date_to=None) -> dict:
        """Per-teacher average class attendance rate + appraisal rating."""
        from hr.models import PerformanceAppraisal
        from attendance.models import AttendanceRecord
        from .models import TimetableEntry

        # Get teachers with timetable entries
        teacher_entries = TimetableEntry.objects.filter(
            school_id=self.school_id, teacher__isnull=False
        ).values('teacher_id', 'teacher__first_name', 'teacher__last_name').annotate(
            classes_count=Count('class_obj_id', distinct=True),
            total_periods=Count('id'),
        )

        att_qs = AttendanceRecord.objects.filter(school_id=self.school_id)
        if date_from:
            att_qs = att_qs.filter(date__gte=date_from)
        if date_to:
            att_qs = att_qs.filter(date__lte=date_to)

        # Get class attendance rates (AttendanceRecord -> Student -> class_obj)
        class_attendance = att_qs.values('student__class_obj_id').annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        )
        class_rate_map = {}
        for ca in class_attendance:
            if ca['total'] > 0:
                class_rate_map[ca['student__class_obj_id']] = round(ca['present'] / ca['total'] * 100, 1)

        teacher_class_map = defaultdict(set)
        for entry in TimetableEntry.objects.filter(
            school_id=self.school_id, teacher__isnull=False
        ).values_list('teacher_id', 'class_obj_id').distinct():
            teacher_class_map[entry[0]].add(entry[1])

        # Get appraisal ratings
        ratings = PerformanceAppraisal.objects.filter(
            school_id=self.school_id
        ).values('staff_member_id').annotate(avg_rating=Avg('rating'))
        rating_map = {r['staff_member_id']: round(r['avg_rating'], 1) for r in ratings}

        results = []
        for te in teacher_entries:
            tid = te['teacher_id']
            teacher_name = f"{te['teacher__first_name']} {te['teacher__last_name']}"

            # Compute avg attendance across classes this teacher teaches
            class_ids = teacher_class_map.get(tid, set())
            class_rates = [class_rate_map[cid] for cid in class_ids if cid in class_rate_map]
            avg_attendance = round(sum(class_rates) / len(class_rates), 1) if class_rates else None

            avg_rating = rating_map.get(tid)
            # Scale rating (1-5) to percentage (0-100) for chart display
            avg_rating_scaled = round(avg_rating * 20, 1) if avg_rating is not None else None

            results.append({
                'teacher_id': tid,
                'teacher_name': teacher_name,
                'avg_class_attendance_rate': avg_attendance,
                'avg_rating': avg_rating,
                'avg_rating_scaled': avg_rating_scaled,
                'classes_count': te['classes_count'],
                'total_periods': te['total_periods'],
            })

        results.sort(key=lambda x: x.get('avg_class_attendance_rate') or 0, reverse=True)
        return {'teachers': results}

    def lms_signals(self, date_from=None, date_to=None) -> dict:
        """Lesson plan and assignment engagement signals."""
        from lms.models import Assignment, AssignmentSubmission, LessonPlan
        from students.models import Student

        lesson_qs = LessonPlan.objects.filter(
            school_id=self.school_id,
            is_active=True,
            status=LessonPlan.Status.PUBLISHED,
        )
        if date_from:
            lesson_qs = lesson_qs.filter(lesson_date__gte=date_from)
        if date_to:
            lesson_qs = lesson_qs.filter(lesson_date__lte=date_to)

        published_lesson_plans = lesson_qs.count()
        lesson_class_count = lesson_qs.values('class_obj_id').distinct().count()
        lesson_subject_count = lesson_qs.values('subject_id').distinct().count()

        assignment_qs = Assignment.objects.filter(
            school_id=self.school_id,
            is_active=True,
            status__in=[Assignment.Status.PUBLISHED, Assignment.Status.CLOSED],
            requires_submission=True,
        )
        if date_from:
            assignment_qs = assignment_qs.filter(due_date__date__gte=date_from)
        if date_to:
            assignment_qs = assignment_qs.filter(due_date__date__lte=date_to)

        assignment_ids = list(assignment_qs.values_list('id', flat=True))
        submissions_qs = AssignmentSubmission.objects.filter(assignment_id__in=assignment_ids)
        submitted_count = submissions_qs.count()
        on_time_count = submissions_qs.filter(
            assignment__due_date__isnull=False,
            submitted_at__lte=F('assignment__due_date'),
        ).count()

        class_student_counts = {
            row['class_obj_id']: row['student_count']
            for row in Student.objects.filter(
                school_id=self.school_id, is_active=True
            ).values('class_obj_id').annotate(student_count=Count('id'))
        }
        expected_submissions = sum(class_student_counts.get(a.class_obj_id, 0) for a in assignment_qs)

        submission_rate = round(submitted_count / expected_submissions * 100, 1) if expected_submissions else None
        on_time_rate = round(on_time_count / submitted_count * 100, 1) if submitted_count else None

        return {
            'lesson_plan_coverage': {
                'published_count': published_lesson_plans,
                'active_classes_covered': lesson_class_count,
                'active_subjects_covered': lesson_subject_count,
            },
            'assignment_engagement': {
                'published_assignments': len(assignment_ids),
                'submitted_count': submitted_count,
                'expected_submissions': expected_submissions,
                'submission_rate': submission_rate,
                'on_time_rate': on_time_rate,
            },
        }

    def coverage_signals(self, date_from=None, date_to=None) -> dict:
        """Curriculum coverage pace by topics and lesson plans."""
        from lms.models import Topic, LessonPlan

        topic_qs = Topic.objects.filter(
            chapter__book__school_id=self.school_id,
            is_active=True,
            chapter__is_active=True,
            chapter__book__is_active=True,
        )
        total_topics = topic_qs.count()

        covered_topic_qs = topic_qs.filter(lesson_plans__school_id=self.school_id, lesson_plans__is_active=True)
        if date_from:
            covered_topic_qs = covered_topic_qs.filter(lesson_plans__lesson_date__gte=date_from)
        if date_to:
            covered_topic_qs = covered_topic_qs.filter(lesson_plans__lesson_date__lte=date_to)
        covered_topics = covered_topic_qs.distinct().count()
        coverage_pct = round(covered_topics / total_topics * 100, 1) if total_topics else None

        lesson_qs = LessonPlan.objects.filter(
            school_id=self.school_id,
            is_active=True,
            status=LessonPlan.Status.PUBLISHED,
        )
        if date_from:
            lesson_qs = lesson_qs.filter(lesson_date__gte=date_from)
        if date_to:
            lesson_qs = lesson_qs.filter(lesson_date__lte=date_to)
        monthly_lesson_plans = (
            lesson_qs.values('lesson_date__year', 'lesson_date__month')
            .annotate(total=Count('id'))
            .order_by('lesson_date__year', 'lesson_date__month')
        )

        return {
            'curriculum_coverage_pace': {
                'total_topics': total_topics,
                'covered_topics': covered_topics,
                'backlog_topics': max(total_topics - covered_topics, 0),
                'coverage_rate': coverage_pct,
            },
            'lesson_plan_velocity': {
                'monthly': [
                    {
                        'month': f"{m['lesson_date__year']}-{m['lesson_date__month']:02d}",
                        'lesson_plans': m['total'],
                    }
                    for m in monthly_lesson_plans
                ],
            },
        }

    def optimal_slot_recommendations(self) -> dict:
        """Recommend best weekday for each subject based on attendance patterns."""
        data = self.subject_attendance_by_slot()
        recommendations = []

        for subj in data.get('subjects', []):
            day_rates = {k: v for k, v in (subj.get('day_rates') or {}).items() if v is not None}
            if len(day_rates) < 2:
                continue

            best_day = max(day_rates, key=day_rates.get)
            worst_day = min(day_rates, key=day_rates.get)
            best_rate = day_rates[best_day]
            worst_rate = day_rates[worst_day]
            diff = best_rate - worst_rate

            if diff >= 3:
                recommendations.append({
                    'subject_name': subj['subject_name'],
                    'recommended_day': best_day,
                    'evidence': f'{diff:.1f}% higher attendance on {best_day} than {worst_day}',
                    'best_rate': best_rate,
                    'worst_rate': worst_rate,
                })

        recommendations.sort(key=lambda x: (x.get('best_rate') or 0) - (x.get('worst_rate') or 0), reverse=True)

        return {'recommendations': recommendations}

    def build_alerts(self, attendance_signals: dict, lms_signals: dict, coverage_signals: dict) -> dict:
        """Rule-based explainable alerts."""
        alerts = []

        avg_attendance = attendance_signals.get('summary', {}).get('average_subject_attendance_rate')
        if avg_attendance is not None and avg_attendance < 85:
            alerts.append({
                'alert_code': 'ATTENDANCE_LOW',
                'title': 'Average attendance is below target',
                'severity': 'high' if avg_attendance < 75 else 'medium',
                'rationale': f'Average subject attendance is {avg_attendance}%, below the 85% target.',
                'suggested_action': 'Review classes with low attendance and schedule parent outreach + remedial support.',
                'metric_key': 'signals.attendance.summary.average_subject_attendance_rate',
                'metric_value': avg_attendance,
            })

        submission_rate = lms_signals.get('assignment_engagement', {}).get('submission_rate')
        if submission_rate is not None and submission_rate < 70:
            alerts.append({
                'alert_code': 'ASSIGNMENT_SUBMISSION_LOW',
                'title': 'Assignment submission rate is low',
                'severity': 'high' if submission_rate < 50 else 'medium',
                'rationale': f'Submission rate is {submission_rate}%, below 70%.',
                'suggested_action': 'Follow up with class teachers and add due-date reminders for pending students.',
                'metric_key': 'signals.lms.assignment_engagement.submission_rate',
                'metric_value': submission_rate,
            })

        coverage_rate = coverage_signals.get('curriculum_coverage_pace', {}).get('coverage_rate')
        if coverage_rate is not None and coverage_rate < 60:
            alerts.append({
                'alert_code': 'CURRICULUM_COVERAGE_LOW',
                'title': 'Curriculum coverage is lagging',
                'severity': 'high' if coverage_rate < 45 else 'medium',
                'rationale': f'Only {coverage_rate}% of topics are covered.',
                'suggested_action': 'Rebalance timetable and prioritize uncovered high-weight topics.',
                'metric_key': 'signals.coverage.curriculum_coverage_pace.coverage_rate',
                'metric_value': coverage_rate,
            })

        return {'items': alerts}

    def risk_index(self, attendance_signals: dict, lms_signals: dict, coverage_signals: dict) -> dict:
        """Composite risk score from attendance, engagement, and coverage."""
        avg_attendance = attendance_signals.get('summary', {}).get('average_subject_attendance_rate') or 0
        submission_rate = lms_signals.get('assignment_engagement', {}).get('submission_rate') or 0
        coverage_rate = coverage_signals.get('curriculum_coverage_pace', {}).get('coverage_rate') or 0

        attendance_deficit = max(0, 100 - avg_attendance)
        submission_deficit = max(0, 100 - submission_rate)
        coverage_deficit = max(0, 100 - coverage_rate)

        score = round((attendance_deficit * 0.4) + (submission_deficit * 0.35) + (coverage_deficit * 0.25), 1)
        if score >= 45:
            level = 'high'
        elif score >= 25:
            level = 'medium'
        else:
            level = 'low'

        return {
            'score': score,
            'level': level,
            'components': {
                'attendance_deficit': round(attendance_deficit, 1),
                'submission_deficit': round(submission_deficit, 1),
                'coverage_deficit': round(coverage_deficit, 1),
            },
        }

    def intervention_impact(self) -> dict:
        """Before/after attendance movement over recent windows."""
        from attendance.models import AttendanceRecord

        today = date.today()
        recent_start = today - timedelta(days=30)
        previous_start = today - timedelta(days=60)

        def _rate(start, end):
            qs = AttendanceRecord.objects.filter(
                school_id=self.school_id,
                date__gte=start,
                date__lt=end,
            ).aggregate(
                total=Count('id'),
                present=Count('id', filter=Q(status='PRESENT')),
            )
            total = qs.get('total') or 0
            present = qs.get('present') or 0
            return round(present / total * 100, 1) if total else None

        previous_rate = _rate(previous_start, recent_start)
        recent_rate = _rate(recent_start, today + timedelta(days=1))

        delta = None
        if previous_rate is not None and recent_rate is not None:
            delta = round(recent_rate - previous_rate, 1)

        return {
            'window_days': 30,
            'previous_period_rate': previous_rate,
            'recent_period_rate': recent_rate,
            'delta': delta,
        }

    def recommendation_prioritization(self, alerts: dict, risk_index: dict) -> dict:
        """Top actions ranked by severity and impact potential."""
        ranked = []
        severity_weights = {'high': 3, 'medium': 2, 'low': 1}
        base_risk = risk_index.get('score') or 0

        for a in alerts.get('items', []):
            weight = severity_weights.get(a.get('severity', 'low'), 1)
            impact = round((weight * 20) + (base_risk * 0.5), 1)
            ranked.append({
                'title': a.get('title'),
                'severity': a.get('severity'),
                'impact_score': impact,
                'action': a.get('suggested_action'),
                'source_alert_code': a.get('alert_code'),
            })

        ranked.sort(key=lambda x: x.get('impact_score') or 0, reverse=True)
        return {'top_actions': ranked[:5]}

    def attendance_trends(self, months: int = 6) -> dict:
        """Monthly attendance rates per class over last N months."""
        from attendance.models import AttendanceRecord

        end_date = date.today()
        start_date = date(end_date.year, end_date.month, 1) - timedelta(days=30 * (months - 1))

        records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            date__gte=start_date,
            date__lte=end_date,
        ).values(
            'student__class_obj_id', 'student__class_obj__name', 'date__year', 'date__month'
        ).annotate(
            total=Count('id'),
            present=Count('id', filter=Q(status='PRESENT')),
        ).order_by('date__year', 'date__month')

        month_data = defaultdict(lambda: defaultdict(dict))
        for r in records:
            month_key = f"{r['date__year']}-{r['date__month']:02d}"
            class_name = r['student__class_obj__name']
            rate = round(r['present'] / r['total'] * 100, 1) if r['total'] > 0 else 0
            month_data[month_key][class_name] = rate

        months_list = []
        for month_key in sorted(month_data.keys()):
            classes = [
                {'class_name': cn, 'rate': rate}
                for cn, rate in sorted(month_data[month_key].items())
            ]
            months_list.append({
                'month': month_key,
                'classes': classes,
            })

        return {'months': months_list}

    def list_alerts(self) -> dict:
        """List persisted analytics alerts for this school."""
        from .models import AcademicsAnalyticsAlert

        rows = AcademicsAnalyticsAlert.objects.filter(
            school_id=self.school_id
        ).order_by('-updated_at')[:100]
        return {
            'items': [
                {
                    'id': row.id,
                    'alert_code': row.alert_code,
                    'title': row.title,
                    'severity': row.severity,
                    'status': row.status,
                    'rationale': row.rationale,
                    'suggested_action': row.suggested_action,
                    'metric_key': row.metric_key,
                    'metric_value': row.metric_value,
                    'first_seen_at': row.first_seen_at,
                    'last_seen_at': row.last_seen_at,
                    'acknowledged_at': row.acknowledged_at,
                    'resolved_at': row.resolved_at,
                }
                for row in rows
            ]
        }

    def update_alert_status(self, alert_id: int, status_value: str):
        """Update lifecycle status for a persisted alert."""
        from .models import AcademicsAnalyticsAlert

        row = AcademicsAnalyticsAlert.objects.filter(
            id=alert_id,
            school_id=self.school_id,
        ).first()
        if not row:
            return None

        row.status = status_value
        if status_value == AcademicsAnalyticsAlert.Status.ACKNOWLEDGED:
            row.acknowledged_at = timezone.now()
        elif status_value == AcademicsAnalyticsAlert.Status.RESOLVED:
            row.resolved_at = timezone.now()
        row.save(update_fields=['status', 'acknowledged_at', 'resolved_at', 'updated_at'])
        return row

    def sync_alerts(self, alerts: dict):
        """Upsert currently generated alerts into lifecycle table."""
        from .models import AcademicsAnalyticsAlert

        now = timezone.now()
        for item in alerts.get('items', []):
            row, created = AcademicsAnalyticsAlert.objects.get_or_create(
                school_id=self.school_id,
                alert_code=item.get('alert_code'),
                defaults={
                    'title': item.get('title') or '',
                    'severity': item.get('severity') or AcademicsAnalyticsAlert.Severity.MEDIUM,
                    'status': AcademicsAnalyticsAlert.Status.NEW,
                    'rationale': item.get('rationale') or '',
                    'suggested_action': item.get('suggested_action') or '',
                    'metric_key': item.get('metric_key') or '',
                    'metric_value': item.get('metric_value'),
                    'first_seen_at': now,
                    'last_seen_at': now,
                }
            )
            if not created:
                row.title = item.get('title') or row.title
                row.severity = item.get('severity') or row.severity
                row.rationale = item.get('rationale') or row.rationale
                row.suggested_action = item.get('suggested_action') or row.suggested_action
                row.metric_key = item.get('metric_key') or row.metric_key
                row.metric_value = item.get('metric_value')
                row.last_seen_at = now
                row.save(update_fields=[
                    'title', 'severity', 'rationale', 'suggested_action',
                    'metric_key', 'metric_value', 'last_seen_at', 'updated_at'
                ])

    def build_v2_overview(self, date_from=None, date_to=None, months: int = 6, scope: str = 'school') -> dict:
        """Build new response contract while preserving old keys."""
        attendance = self.attendance_signals(date_from, date_to, months)
        lms = self.lms_signals(date_from, date_to)
        coverage = self.coverage_signals(date_from, date_to)
        teacher = self.teacher_effectiveness(date_from, date_to)
        recommendations = self.optimal_slot_recommendations()
        alerts = self.build_alerts(attendance, lms, coverage)
        risk = self.risk_index(attendance, lms, coverage)
        impact = self.intervention_impact()
        prioritized = self.recommendation_prioritization(alerts, risk)

        return {
            'meta': {
                'scope': scope,
                'generated_at': timezone.now(),
                'date_from': date_from,
                'date_to': date_to,
                'months': months,
                'data_sufficiency': {
                    'attendance_subjects': len(attendance.get('subject_attendance', {}).get('subjects', [])),
                    'teacher_rows': len(teacher.get('teachers', [])),
                },
            },
            'signals': {
                'attendance': attendance,
                'lms': lms,
                'coverage': coverage,
                'teacher_effectiveness': teacher,
            },
            'alerts': alerts,
            'risk_index': risk,
            'intervention_impact': impact,
            'recommendations': {
                'slot_recommendations': recommendations,
                'prioritized_actions': prioritized,
            },
            # Backward compatibility keys
            'subject_attendance': attendance.get('subject_attendance', {}),
            'teacher_effectiveness': teacher,
            'slot_recommendations': recommendations,
            'attendance_trends': attendance.get('attendance_trends', {}),
            'lesson_plan_coverage': lms.get('lesson_plan_coverage', {}),
            'assignment_engagement': lms.get('assignment_engagement', {}),
            'curriculum_coverage_pace': coverage.get('curriculum_coverage_pace', {}),
        }

    @classmethod
    def merge_overviews(cls, overviews: list) -> dict:
        """Aggregate school-level overviews into super-admin global summary."""
        if not overviews:
            return {
                'meta': {'scope': 'global', 'school_count': 0},
                'signals': {'attendance': {'summary': {}}, 'lms': {}, 'coverage': {}},
                'alerts': {'items': []},
                'risk_index': {'score': None, 'level': 'low'},
                'intervention_impact': {'delta': None},
                'recommendations': {'slot_recommendations': {'recommendations': []}, 'prioritized_actions': {'top_actions': []}},
            }

        def _avg(values):
            values = [v for v in values if v is not None]
            return round(sum(values) / len(values), 1) if values else None

        avg_attendance = _avg([
            o.get('signals', {}).get('attendance', {}).get('summary', {}).get('average_subject_attendance_rate')
            for o in overviews
        ])
        avg_submission = _avg([
            o.get('signals', {}).get('lms', {}).get('assignment_engagement', {}).get('submission_rate')
            for o in overviews
        ])
        avg_coverage = _avg([
            o.get('signals', {}).get('coverage', {}).get('curriculum_coverage_pace', {}).get('coverage_rate')
            for o in overviews
        ])
        avg_risk = _avg([o.get('risk_index', {}).get('score') for o in overviews])
        avg_delta = _avg([o.get('intervention_impact', {}).get('delta') for o in overviews])

        merged_alerts = []
        for o in overviews:
            merged_alerts.extend(o.get('alerts', {}).get('items', []))
        merged_alerts = merged_alerts[:30]

        merged_actions = []
        for o in overviews:
            merged_actions.extend(o.get('recommendations', {}).get('prioritized_actions', {}).get('top_actions', []))
        merged_actions.sort(key=lambda x: x.get('impact_score') or 0, reverse=True)

        return {
            'meta': {'scope': 'global', 'school_count': len(overviews), 'generated_at': timezone.now()},
            'signals': {
                'attendance': {'summary': {'average_subject_attendance_rate': avg_attendance}},
                'lms': {'assignment_engagement': {'submission_rate': avg_submission}},
                'coverage': {'curriculum_coverage_pace': {'coverage_rate': avg_coverage}},
            },
            'alerts': {'items': merged_alerts},
            'risk_index': {
                'score': avg_risk,
                'level': 'high' if (avg_risk or 0) >= 45 else ('medium' if (avg_risk or 0) >= 25 else 'low'),
            },
            'intervention_impact': {'delta': avg_delta},
            'recommendations': {
                'slot_recommendations': {'recommendations': []},
                'prioritized_actions': {'top_actions': merged_actions[:5]},
            },
            # compatibility keys
            'subject_attendance': {'subjects': []},
            'teacher_effectiveness': {'teachers': []},
            'slot_recommendations': {'recommendations': []},
            'attendance_trends': {'months': []},
            'lesson_plan_coverage': {},
            'assignment_engagement': {'submission_rate': avg_submission},
            'curriculum_coverage_pace': {'coverage_rate': avg_coverage},
        }
