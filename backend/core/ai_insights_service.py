"""
AI Insights Service - Generates actionable insights across all school modules.

Analyzes attendance, finance, academics, and HR data to surface what needs
the admin's attention today.
"""

import logging
from datetime import timedelta
from django.utils import timezone

logger = logging.getLogger(__name__)


class AIInsightsService:
    """
    Generates prioritized insights for a school by scanning across modules.

    Each insight is a dict:
    {
        'type': 'alert' | 'warning' | 'info',
        'module': 'attendance' | 'finance' | 'academics' | 'hr',
        'priority': 1-10 (1=highest),
        'title': 'Short headline',
        'detail': 'One sentence explanation',
        'action': 'What to do',
        'link': '/route/to/relevant/page',
    }
    """

    def __init__(self, school):
        self.school = school

    def generate_insights(self, max_results=10):
        """Generate and return top insights sorted by priority."""
        insights = []

        insights.extend(self._attendance_insights())
        insights.extend(self._finance_insights())
        insights.extend(self._academic_insights())
        insights.extend(self._hr_insights())

        # Sort by priority (lower = more important)
        insights.sort(key=lambda x: x['priority'])
        return insights[:max_results]

    def _attendance_insights(self):
        insights = []

        try:
            from attendance.models import AttendanceUpload, AttendanceRecord, AccuracySnapshot

            # 1. Pending review backlog
            pending = AttendanceUpload.objects.filter(
                school=self.school,
                status__in=['REVIEW_REQUIRED', 'PROCESSING'],
            ).count()
            if pending > 5:
                insights.append({
                    'type': 'warning',
                    'module': 'attendance',
                    'priority': 3,
                    'title': f'{pending} uploads awaiting review',
                    'detail': f'There are {pending} attendance uploads that need human review. Unreviewed uploads delay notifications.',
                    'action': 'Review pending uploads',
                    'link': '/attendance/review',
                })
            elif pending > 0:
                insights.append({
                    'type': 'info',
                    'module': 'attendance',
                    'priority': 7,
                    'title': f'{pending} upload(s) awaiting review',
                    'detail': 'Attendance uploads are pending your review.',
                    'action': 'Review uploads',
                    'link': '/attendance/review',
                })

            # 2. Active accuracy drift
            recent_drift = AccuracySnapshot.objects.filter(
                school=self.school,
                drift_detected=True,
                date__gte=(timezone.now() - timedelta(days=7)).date(),
            ).first()
            if recent_drift:
                details = recent_drift.drift_details or {}
                insights.append({
                    'type': 'alert',
                    'module': 'attendance',
                    'priority': 2,
                    'title': 'AI accuracy drift detected',
                    'detail': details.get('message', f'Accuracy dropped on {recent_drift.date}. This may indicate register format changes.'),
                    'action': 'Review accuracy dashboard',
                    'link': '/attendance/accuracy',
                })

            # 3. Week-over-week absence spike
            now = timezone.now()
            this_week_start = (now - timedelta(days=now.weekday())).date()
            last_week_start = this_week_start - timedelta(days=7)

            this_week_absent = AttendanceRecord.objects.filter(
                school=self.school, date__gte=this_week_start, status='ABSENT',
            ).count()
            last_week_absent = AttendanceRecord.objects.filter(
                school=self.school, date__gte=last_week_start, date__lt=this_week_start, status='ABSENT',
            ).count()

            if last_week_absent > 0 and this_week_absent > 0:
                increase = (this_week_absent - last_week_absent) / last_week_absent
                if increase > 0.30:
                    insights.append({
                        'type': 'warning',
                        'module': 'attendance',
                        'priority': 4,
                        'title': f'Absence spike: {increase:.0%} increase this week',
                        'detail': f'{this_week_absent} absences this week vs {last_week_absent} last week.',
                        'action': 'View attendance reports',
                        'link': '/attendance',
                    })

        except Exception as e:
            logger.debug(f"Attendance insights error: {e}")

        return insights

    def _finance_insights(self):
        insights = []

        try:
            from finance.models import FeePayment

            now = timezone.now()
            current_month = now.month
            current_year = now.year

            # 1. Low collection rate after 15th
            if now.day >= 15:
                total_due = FeePayment.objects.filter(
                    school=self.school,
                    month=current_month,
                    year=current_year,
                ).count()
                paid = FeePayment.objects.filter(
                    school=self.school,
                    month=current_month,
                    year=current_year,
                    status='PAID',
                ).count()

                if total_due > 0:
                    rate = paid / total_due
                    if rate < 0.50:
                        insights.append({
                            'type': 'alert',
                            'module': 'finance',
                            'priority': 3,
                            'title': f'Low fee collection: {rate:.0%}',
                            'detail': f'Only {paid}/{total_due} fees collected this month and it\'s past the 15th.',
                            'action': 'Send fee reminders',
                            'link': '/finance/fee-payments',
                        })

            # 2. High overdue count
            overdue = FeePayment.objects.filter(
                school=self.school,
                status__in=['PENDING', 'OVERDUE'],
            ).exclude(
                month=current_month, year=current_year,
            ).count()

            if overdue > 20:
                insights.append({
                    'type': 'warning',
                    'module': 'finance',
                    'priority': 5,
                    'title': f'{overdue} overdue fee payments',
                    'detail': 'Multiple fee payments from previous months remain unpaid.',
                    'action': 'Review overdue payments',
                    'link': '/finance/fee-payments',
                })

        except Exception as e:
            logger.debug(f"Finance insights error: {e}")

        return insights

    def _academic_insights(self):
        insights = []

        try:
            from academics.models import ClassSubject
            from students.models import Class

            # 1. Unassigned class-subjects
            active_classes = Class.objects.filter(school=self.school, is_active=True).count()
            unassigned = ClassSubject.objects.filter(
                school=self.school, is_active=True, teacher__isnull=True,
            ).count()

            if unassigned > 0:
                insights.append({
                    'type': 'warning',
                    'module': 'academics',
                    'priority': 6,
                    'title': f'{unassigned} subjects without teachers',
                    'detail': f'{unassigned} class-subject assignments have no teacher assigned.',
                    'action': 'Assign teachers',
                    'link': '/academics/subjects',
                })

        except Exception as e:
            logger.debug(f"Academic insights error: {e}")

        return insights

    def _hr_insights(self):
        insights = []

        try:
            from hr.models import LeaveRequest

            # 1. Pending leave requests
            pending_leaves = LeaveRequest.objects.filter(
                school=self.school, status='PENDING',
            ).count()

            if pending_leaves > 3:
                insights.append({
                    'type': 'warning',
                    'module': 'hr',
                    'priority': 5,
                    'title': f'{pending_leaves} pending leave requests',
                    'detail': 'Multiple leave requests are awaiting approval.',
                    'action': 'Review leave requests',
                    'link': '/hr/leave',
                })
            elif pending_leaves > 0:
                insights.append({
                    'type': 'info',
                    'module': 'hr',
                    'priority': 8,
                    'title': f'{pending_leaves} pending leave request(s)',
                    'detail': 'Leave requests need your attention.',
                    'action': 'Review leave requests',
                    'link': '/hr/leave',
                })

        except Exception as e:
            logger.debug(f"HR insights error: {e}")

        return insights
