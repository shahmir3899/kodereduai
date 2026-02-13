"""
AI Attendance Risk Predictor Service.

Analyzes student attendance patterns, weekly trends, and day-of-week behavior
to identify students who are at risk of falling below the attendance threshold,
or are predicted to fall below it within 4 weeks.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from django.db.models import Q, Count

logger = logging.getLogger(__name__)

DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


class AttendanceRiskService:
    """Identifies students at risk of poor attendance using trend and pattern analysis."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def get_at_risk_students(self, threshold: float = 75.0) -> dict:
        """
        Analyze all active students and return those who are at risk or
        predicted to be at risk of falling below the attendance threshold.
        """
        from students.models import Student
        from attendance.models import AttendanceRecord

        # 1. Get all active students in this school with their class info
        students = Student.objects.filter(
            school_id=self.school_id,
            is_active=True,
        ).select_related('class_obj')

        total_students = students.count()
        if total_students == 0:
            return {
                'total_students': 0,
                'at_risk_count': 0,
                'risk_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'students': [],
            }

        student_ids = list(students.values_list('id', flat=True))

        # 2. Aggregate overall attendance per student for this academic year
        overall_stats = {}
        overall_qs = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            student_id__in=student_ids,
        ).values('student_id').annotate(
            total_days=Count('id'),
            present_days=Count('id', filter=Q(status='PRESENT')),
        )
        for row in overall_qs:
            total = row['total_days']
            present = row['present_days']
            overall_stats[row['student_id']] = {
                'total_days': total,
                'present_days': present,
                'rate': round((present / total) * 100, 1) if total > 0 else 0.0,
            }

        # 3. Fetch all attendance records for weekly trend and day-pattern analysis
        #    We fetch individual records for the last 5 weeks to compute weekly trends
        today = date.today()
        five_weeks_ago = today - timedelta(weeks=5)

        recent_records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            student_id__in=student_ids,
            date__gte=five_weeks_ago,
        ).values_list('student_id', 'date', 'status')

        # Organize records per student
        student_recent = defaultdict(list)
        for sid, rec_date, status in recent_records:
            student_recent[sid].append((rec_date, status))

        # 4. Fetch day-of-week pattern data for the full academic year
        all_records_dow = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            student_id__in=student_ids,
        ).values_list('student_id', 'date', 'status')

        student_dow = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'absent': 0}))
        for sid, rec_date, status in all_records_dow:
            dow = rec_date.weekday()  # 0=Monday, 6=Sunday
            student_dow[sid][dow]['total'] += 1
            if status == 'ABSENT':
                student_dow[sid][dow]['absent'] += 1

        # 5. Build student lookup
        student_map = {s.id: s for s in students}

        # 6. Analyze each student
        at_risk_students = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in student_ids:
            student = student_map[sid]
            stats = overall_stats.get(sid)

            # Skip students with no attendance records at all
            if not stats or stats['total_days'] == 0:
                continue

            current_rate = stats['rate']

            # Weekly trend analysis
            trend, trend_detail, weekly_rates = self._analyze_weekly_trend(
                student_recent.get(sid, []), today,
            )

            # Day-of-week pattern
            day_pattern = self._analyze_day_pattern(student_dow.get(sid, {}))

            # Predicted rate in 4 weeks
            predicted_rate = self._predict_rate_4w(current_rate, weekly_rates)

            # Determine severity
            severity = self._determine_severity(
                current_rate, threshold, trend, predicted_rate,
            )

            # Only include students who are at risk or predicted to be at risk
            if severity is None:
                continue

            # Generate suggested action
            suggested_action = self._suggest_action(severity, trend, day_pattern, current_rate)

            at_risk_students.append({
                'student_id': sid,
                'student_name': student.name,
                'roll_number': student.roll_number,
                'class_name': student.class_obj.name if student.class_obj else '',
                'current_rate': current_rate,
                'severity': severity,
                'trend': trend,
                'trend_detail': trend_detail,
                'day_pattern': day_pattern,
                'predicted_rate_4w': predicted_rate,
                'suggested_action': suggested_action,
            })

            risk_counts[severity] += 1

        # Sort: HIGH first, then MEDIUM, then LOW
        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        at_risk_students.sort(key=lambda s: (severity_order.get(s['severity'], 3), s['current_rate']))

        return {
            'total_students': total_students,
            'at_risk_count': len(at_risk_students),
            'risk_levels': risk_counts,
            'students': at_risk_students,
        }

    def _analyze_weekly_trend(self, records: list, today: date) -> tuple:
        """
        Analyze the last 4 weeks of attendance to determine trend.

        Returns:
            (trend, trend_detail, weekly_rates) where trend is
            'improving', 'stable', or 'declining'.
        """
        if not records:
            return 'stable', 'No recent data available', []

        # Group records into weekly buckets (last 4 full weeks)
        weekly_rates = []
        for week_offset in range(4, 0, -1):
            week_start = today - timedelta(weeks=week_offset)
            week_end = today - timedelta(weeks=week_offset - 1)
            week_records = [
                (d, s) for d, s in records
                if week_start <= d < week_end
            ]
            if week_records:
                present = sum(1 for _, s in week_records if s == 'PRESENT')
                total = len(week_records)
                weekly_rates.append(round((present / total) * 100, 1))

        if len(weekly_rates) < 2:
            return 'stable', 'Insufficient weekly data for trend analysis', weekly_rates

        first_rate = weekly_rates[0]
        last_rate = weekly_rates[-1]
        diff = last_rate - first_rate

        if diff > 5:
            trend = 'improving'
            trend_detail = f'Improved from {first_rate}% to {last_rate}% over 4 weeks'
        elif diff < -5:
            trend = 'declining'
            trend_detail = f'Dropped from {first_rate}% to {last_rate}% over 4 weeks'
        else:
            trend = 'stable'
            trend_detail = f'Stable around {last_rate}% over 4 weeks'

        return trend, trend_detail, weekly_rates

    def _analyze_day_pattern(self, dow_data: dict) -> str:
        """
        Check if the student has a specific day they are frequently absent.

        Returns a descriptive string or empty string if no pattern found.
        """
        if not dow_data:
            return ''

        worst_day = None
        worst_rate = 0.0
        worst_absent = 0
        worst_total = 0

        for dow, counts in dow_data.items():
            total = counts['total']
            absent = counts['absent']
            if total >= 3:  # Need at least 3 occurrences to identify a pattern
                absent_rate = absent / total
                if absent_rate > worst_rate and absent_rate >= 0.5:
                    worst_rate = absent_rate
                    worst_day = dow
                    worst_absent = absent
                    worst_total = total

        if worst_day is not None:
            day_name = DAY_NAMES[worst_day]
            return f'Frequently absent on {day_name}s ({worst_absent}/{worst_total} {day_name}s absent)'

        return ''

    def _predict_rate_4w(self, current_rate: float, weekly_rates: list) -> float:
        """
        Project the attendance rate 4 weeks into the future based on weekly trends.
        Uses simple linear extrapolation from the weekly rates.
        """
        if len(weekly_rates) < 2:
            return round(current_rate, 1)

        # Calculate average weekly change
        changes = [weekly_rates[i] - weekly_rates[i - 1] for i in range(1, len(weekly_rates))]
        avg_weekly_change = sum(changes) / len(changes)

        # Project 4 weeks ahead
        projected = current_rate + (avg_weekly_change * 4)
        # Clamp to 0-100
        projected = max(0.0, min(100.0, projected))
        return round(projected, 1)

    def _determine_severity(self, current_rate: float, threshold: float,
                            trend: str, predicted_rate: float) -> str | None:
        """
        Determine the severity level for a student.

        Returns:
            'HIGH', 'MEDIUM', 'LOW', or None (not at risk)
        """
        # HIGH: below 60%
        if current_rate < 60.0:
            return 'HIGH'

        # MEDIUM: between 60% and threshold
        if current_rate < threshold:
            return 'MEDIUM'

        # LOW: within 5% above threshold and declining trend
        if current_rate <= threshold + 5.0 and trend == 'declining':
            return 'LOW'

        # Predicted at risk: currently above threshold but predicted to fall below in 4 weeks
        if current_rate >= threshold and predicted_rate < threshold and trend == 'declining':
            return 'LOW'

        return None

    def _suggest_action(self, severity: str, trend: str, day_pattern: str,
                        current_rate: float) -> str:
        """Generate an actionable suggestion based on the risk profile."""
        if severity == 'HIGH':
            if current_rate < 50:
                return 'Urgent: Immediate parent meeting required - attendance critically low'
            return 'Schedule parent meeting - attendance dangerously below minimum'

        if severity == 'MEDIUM':
            if trend == 'declining':
                return 'Schedule parent meeting - attendance declining rapidly'
            if day_pattern:
                return f'Investigate day-specific absences - {day_pattern.split("(")[0].strip().lower()}'
            return 'Send attendance warning notice to parents'

        # LOW
        if trend == 'declining':
            return 'Monitor closely - attendance trending downward, may need intervention soon'
        return 'Add to watch list - attendance approaching minimum threshold'
