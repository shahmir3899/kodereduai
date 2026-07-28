"""
AI Attendance Risk Predictor Service.

Analyzes student attendance patterns, weekly trends, and day-of-week behavior
to identify students who are at risk of falling below the attendance threshold,
or are predicted to fall below it within 4 weeks.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

logger = logging.getLogger(__name__)

DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

# Minimum school-day records required before a student is scored at all —
# below this a single bad day can swing the rate 20+ points, which is noise,
# not signal.
MIN_SAMPLE_DAYS = 10

# A run of unexplained consecutive absences is itself a welfare/compliance
# signal, independent of the running attendance percentage.
STREAK_MEDIUM_THRESHOLD = 3
STREAK_HIGH_THRESHOLD = 5


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
        from .models import AcademicYear

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
        student_map = {s.id: s for s in students}

        today = date.today()

        # 2. Build an OFF-day index (Sundays + configured holidays/breaks) so
        #    stray/backfilled records on non-school days don't distort rates,
        #    trends, or day-of-week patterns. Built in bulk (one query) rather
        #    than the per-day calendar_rules helpers, which would be an N+1
        #    query per class across a whole academic year.
        academic_year = AcademicYear.objects.filter(id=self.academic_year_id).first()
        year_start = academic_year.start_date if academic_year else today - timedelta(days=365)
        year_end = min(academic_year.end_date, today) if academic_year else today
        off_day_index = self._build_off_day_index(year_start, year_end)

        # 2b. Approved parent leave shouldn't read as a red flag either — a
        # student on approved medical/planned leave is the opposite of an
        # engagement problem. Excluded the same way as an OFF day.
        leave_index = self._build_leave_index(student_ids, year_start, year_end)

        def is_off_day(student, rec_date):
            if rec_date.weekday() == 6:  # Sunday
                return True
            if rec_date in off_day_index['school']:
                return True
            return rec_date in off_day_index['classes'].get(student.class_obj_id, ())

        def is_approved_leave(sid, rec_date):
            return rec_date in leave_index.get(sid, ())

        # 3. Fetch every attendance record for the academic year once, and derive
        #    overall stats, the 5-week trend window, and day-of-week patterns from
        #    the same off-day-filtered pass instead of three separate queries.
        five_weeks_ago = today - timedelta(weeks=5)

        all_records = AttendanceRecord.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            student_id__in=student_ids,
        ).values_list('student_id', 'date', 'status')

        overall_stats = defaultdict(lambda: {'total_days': 0, 'present_days': 0})
        student_recent = defaultdict(list)
        student_dow = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'absent': 0}))
        excused_leave_counts = defaultdict(int)

        for sid, rec_date, rec_status in all_records:
            student = student_map.get(sid)
            if not student or is_off_day(student, rec_date):
                continue

            # Excused: either a teacher marked the day LEAVE directly on the
            # attendance record, or the parent's leave request was approved.
            if rec_status == 'LEAVE' or is_approved_leave(sid, rec_date):
                excused_leave_counts[sid] += 1
                continue

            stats = overall_stats[sid]
            stats['total_days'] += 1
            if rec_status == 'PRESENT':
                stats['present_days'] += 1

            dow = rec_date.weekday()  # 0=Monday, 6=Sunday
            student_dow[sid][dow]['total'] += 1
            if rec_status == 'ABSENT':
                student_dow[sid][dow]['absent'] += 1

            if rec_date >= five_weeks_ago:
                student_recent[sid].append((rec_date, rec_status))

        for stats in overall_stats.values():
            total = stats['total_days']
            present = stats['present_days']
            stats['rate'] = round((present / total) * 100, 1) if total > 0 else 0.0

        # 4. Analyze each student
        at_risk_students = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in student_ids:
            student = student_map[sid]
            stats = overall_stats.get(sid)

            # Skip students with no attendance records at all
            if not stats or stats['total_days'] == 0:
                continue

            # Skip students with too few school-day records to score reliably —
            # a couple of noisy days shouldn't be enough to flag HIGH/MEDIUM.
            if stats['total_days'] < MIN_SAMPLE_DAYS:
                continue

            current_rate = stats['rate']

            # Weekly trend analysis (recency-weighted — see _weighted_trend_slope)
            trend, trend_detail, weekly_rates, trend_slope = self._analyze_weekly_trend(
                student_recent.get(sid, []), today,
            )

            # Day-of-week pattern
            day_pattern = self._analyze_day_pattern(student_dow.get(sid, {}))

            # Consecutive-absence streak (trailing run of ABSENT school days)
            streak = self._current_absence_streak(student_recent.get(sid, []))

            # Predicted rate in 4 weeks
            predicted_rate = self._predict_rate_4w(current_rate, trend_slope)

            # Determine severity
            severity = self._determine_severity(
                current_rate, threshold, trend, predicted_rate, streak,
            )

            # Only include students who are at risk or predicted to be at risk
            if severity is None:
                continue

            # Generate suggested action
            suggested_action = self._suggest_action(severity, trend, day_pattern, current_rate, streak)

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
                'consecutive_absent_days': streak,
                'excused_leave_days': excused_leave_counts.get(sid, 0),
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

    def _build_off_day_index(self, date_from: date, date_to: date) -> dict:
        """
        Expand active OFF_DAY calendar entries (affecting students) into date
        sets, split into school-wide and per-class. One query regardless of
        the date range's length or how many classes exist.
        """
        from .models import SchoolCalendarEntry

        school_dates = set()
        class_dates = defaultdict(set)

        if date_from > date_to:
            return {'school': school_dates, 'classes': class_dates}

        entries = SchoolCalendarEntry.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            is_active=True,
            entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY,
            affects_students=True,
            start_date__lte=date_to,
            end_date__gte=date_from,
        ).prefetch_related('classes')

        for entry in entries:
            start = max(entry.start_date, date_from)
            end = min(entry.end_date, date_to)
            if start > end:
                continue
            entry_dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]

            if entry.scope == SchoolCalendarEntry.Scope.SCHOOL:
                school_dates.update(entry_dates)
            else:
                for class_obj in entry.classes.all():
                    class_dates[class_obj.id].update(entry_dates)

        return {'school': school_dates, 'classes': class_dates}

    def _build_leave_index(self, student_ids: list, date_from: date, date_to: date) -> dict:
        """
        Expand APPROVED ParentLeaveRequest ranges into a per-student set of
        excused dates. One query regardless of how many students/ranges exist.
        """
        from parents.models import ParentLeaveRequest

        leave_dates = defaultdict(set)

        if date_from > date_to:
            return leave_dates

        requests = ParentLeaveRequest.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            status='APPROVED',
            start_date__lte=date_to,
            end_date__gte=date_from,
        ).values_list('student_id', 'start_date', 'end_date')

        for sid, start, end in requests:
            start = max(start, date_from)
            end = min(end, date_to)
            if start > end:
                continue
            leave_dates[sid].update(start + timedelta(days=i) for i in range((end - start).days + 1))

        return leave_dates

    def _current_absence_streak(self, records: list) -> int:
        """
        Trailing run of consecutive ABSENT school days, most-recent-first.
        `records` is the already off-day/leave-filtered recent window.
        """
        if not records:
            return 0

        streak = 0
        for _, status in sorted(records, key=lambda r: r[0], reverse=True):
            if status == 'ABSENT':
                streak += 1
            else:
                break
        return streak

    def _weighted_trend_slope(self, weekly_rates: list) -> float:
        """
        Weighted least-squares slope (percentage-point change per week) over
        the weekly rates, weights favor recent weeks (oldest=1 .. newest=n) so
        a single noisy week doesn't dominate the way a first-vs-last diff does.
        """
        n = len(weekly_rates)
        if n < 2:
            return 0.0

        xs = list(range(n))
        weights = [i + 1 for i in range(n)]
        total_weight = sum(weights)
        x_mean = sum(w * x for w, x in zip(weights, xs)) / total_weight
        y_mean = sum(w * y for w, y in zip(weights, weekly_rates)) / total_weight

        numerator = sum(w * (x - x_mean) * (y - y_mean) for w, x, y in zip(weights, xs, weekly_rates))
        denominator = sum(w * (x - x_mean) ** 2 for w, x in zip(weights, xs))

        return numerator / denominator if denominator else 0.0

    def _analyze_weekly_trend(self, records: list, today: date) -> tuple:
        """
        Analyze the last 4 weeks of attendance to determine trend.

        Returns:
            (trend, trend_detail, weekly_rates, slope) where trend is
            'improving', 'stable', or 'declining', and slope is the
            recency-weighted percentage-point change per week.
        """
        if not records:
            return 'stable', 'No recent data available', [], 0.0

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
            return 'stable', 'Insufficient weekly data for trend analysis', weekly_rates, 0.0

        first_rate = weekly_rates[0]
        last_rate = weekly_rates[-1]
        slope = self._weighted_trend_slope(weekly_rates)
        total_change = slope * (len(weekly_rates) - 1)

        if total_change > 5:
            trend = 'improving'
            trend_detail = f'Improved from {first_rate}% to {last_rate}% over 4 weeks'
        elif total_change < -5:
            trend = 'declining'
            trend_detail = f'Dropped from {first_rate}% to {last_rate}% over 4 weeks'
        else:
            trend = 'stable'
            trend_detail = f'Stable around {last_rate}% over 4 weeks'

        return trend, trend_detail, weekly_rates, slope

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

    def _predict_rate_4w(self, current_rate: float, slope: float) -> float:
        """
        Project the attendance rate 4 weeks into the future using the
        recency-weighted weekly slope (percentage points per week).
        """
        projected = current_rate + (slope * 4)
        # Clamp to 0-100
        projected = max(0.0, min(100.0, projected))
        return round(projected, 1)

    def _determine_severity(self, current_rate: float, threshold: float, trend: str,
                            predicted_rate: float, streak: int = 0) -> str | None:
        """
        Determine the severity level for a student.

        Returns:
            'HIGH', 'MEDIUM', 'LOW', or None (not at risk)
        """
        # A long unexplained absence streak is a standalone red flag,
        # independent of the running percentage.
        if streak >= STREAK_HIGH_THRESHOLD:
            return 'HIGH'

        # HIGH: below 60%
        if current_rate < 60.0:
            return 'HIGH'

        # MEDIUM: between 60% and threshold
        if current_rate < threshold:
            return 'MEDIUM'

        if streak >= STREAK_MEDIUM_THRESHOLD:
            return 'MEDIUM'

        # LOW: within 5% above threshold and declining trend
        if current_rate <= threshold + 5.0 and trend == 'declining':
            return 'LOW'

        # Predicted at risk: currently above threshold but predicted to fall below in 4 weeks
        if current_rate >= threshold and predicted_rate < threshold and trend == 'declining':
            return 'LOW'

        return None

    def _suggest_action(self, severity: str, trend: str, day_pattern: str,
                        current_rate: float, streak: int = 0) -> str:
        """Generate an actionable suggestion based on the risk profile."""
        if streak >= STREAK_MEDIUM_THRESHOLD:
            prefix = f'{streak} consecutive days absent - verify student\'s status. '
        else:
            prefix = ''

        if severity == 'HIGH':
            if current_rate < 50:
                return prefix + 'Urgent: Immediate parent meeting required - attendance critically low'
            return prefix + 'Schedule parent meeting - attendance dangerously below minimum'

        if severity == 'MEDIUM':
            if trend == 'declining':
                return prefix + 'Schedule parent meeting - attendance declining rapidly'
            if day_pattern:
                return prefix + f'Investigate day-specific absences - {day_pattern.split("(")[0].strip().lower()}'
            return prefix + 'Send attendance warning notice to parents'

        # LOW
        if trend == 'declining':
            return prefix + 'Monitor closely - attendance trending downward, may need intervention soon'
        return prefix + 'Add to watch list - attendance approaching minimum threshold'
