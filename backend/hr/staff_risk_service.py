"""
AI Staff Attrition / Leave-Abuse Risk Predictor Service.

Mirrors AttendanceRiskService's trend/streak/day-pattern approach, applied to
staff LeaveApplication + StaffAttendance instead of student AttendanceRecord.
Scoped by a rolling window (staff leave isn't academic-year-bound) rather
than an academic_year_id.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

logger = logging.getLogger(__name__)

DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

# A run of consecutive absent/on-leave working days is a standalone signal.
STREAK_MEDIUM_THRESHOLD = 3
STREAK_HIGH_THRESHOLD = 5

# Rising leave frequency / attendance decline bands (percentage-point change
# over the window, same ±5 convention as AttendanceRiskService).
TREND_BAND = 5.0


class StaffRiskService:
    """Identifies staff at risk of attrition or leave-pattern abuse."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def get_at_risk_staff(self, window_days: int = 90) -> dict:
        from .models import StaffMember, LeaveApplication, StaffAttendance

        staff = StaffMember.objects.filter(
            school_id=self.school_id,
            is_active=True,
        ).select_related('department')

        total_staff = staff.count()
        if total_staff == 0:
            return {
                'total_staff': 0,
                'at_risk_count': 0,
                'risk_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'staff': [],
            }

        staff_ids = list(staff.values_list('id', flat=True))
        staff_map = {s.id: s for s in staff}

        today = date.today()
        window_start = today - timedelta(days=window_days)

        # Leave days (APPROVED only) in the window, expanded per day.
        leave_apps = LeaveApplication.objects.filter(
            school_id=self.school_id,
            staff_member_id__in=staff_ids,
            status='APPROVED',
            start_date__lte=today,
            end_date__gte=window_start,
        ).values_list('staff_member_id', 'start_date', 'end_date')

        staff_leave_dates = defaultdict(list)
        for sid, start, end in leave_apps:
            start = max(start, window_start)
            end = min(end, today)
            if start > end:
                continue
            for i in range((end - start).days + 1):
                staff_leave_dates[sid].append(start + timedelta(days=i))

        # Attendance records (ABSENT/LATE/ON_LEAVE as negative signals).
        attendance_records = StaffAttendance.objects.filter(
            school_id=self.school_id,
            staff_member_id__in=staff_ids,
            date__gte=window_start,
            date__lte=today,
        ).values_list('staff_member_id', 'date', 'status')

        staff_attendance = defaultdict(list)
        for sid, rec_date, rec_status in attendance_records:
            staff_attendance[sid].append((rec_date, rec_status))

        at_risk_staff = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in staff_ids:
            member = staff_map[sid]
            leave_dates = sorted(staff_leave_dates.get(sid, []))
            attendance = staff_attendance.get(sid, [])

            if not leave_dates and not attendance:
                continue

            leave_trend, leave_detail, leave_slope = self._weekly_trend(leave_dates, today, window_days)
            absence_rate, absence_trend = self._attendance_decline(attendance)
            day_pattern = self._day_of_week_pattern(leave_dates)
            streak = self._current_absence_streak(attendance, leave_dates)

            severity = self._determine_severity(
                len(leave_dates), leave_trend, absence_rate, absence_trend, streak,
            )
            if severity is None:
                continue

            suggested_action = self._suggest_action(severity, leave_trend, day_pattern, streak)

            at_risk_staff.append({
                'staff_id': sid,
                'staff_name': member.full_name,
                'department': member.department.name if member.department else '',
                'leave_days_in_window': len(leave_dates),
                'leave_trend': leave_trend,
                'leave_trend_detail': leave_detail,
                'absence_rate': absence_rate,
                'absence_trend': absence_trend,
                'day_pattern': day_pattern,
                'consecutive_absent_days': streak,
                'severity': severity,
                'suggested_action': suggested_action,
            })

            risk_counts[severity] += 1

        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        at_risk_staff.sort(key=lambda s: (severity_order.get(s['severity'], 3), -s['leave_days_in_window']))

        return {
            'total_staff': total_staff,
            'at_risk_count': len(at_risk_staff),
            'risk_levels': risk_counts,
            'staff': at_risk_staff,
        }

    def _weighted_trend_slope(self, values: list) -> float:
        """Weighted least-squares slope, recent buckets weighted more — same technique as AttendanceRiskService."""
        n = len(values)
        if n < 2:
            return 0.0

        xs = list(range(n))
        weights = [i + 1 for i in range(n)]
        total_weight = sum(weights)
        x_mean = sum(w * x for w, x in zip(weights, xs)) / total_weight
        y_mean = sum(w * y for w, y in zip(weights, values)) / total_weight

        numerator = sum(w * (x - x_mean) * (y - y_mean) for w, x, y in zip(weights, xs, values))
        denominator = sum(w * (x - x_mean) ** 2 for w, x in zip(weights, xs))

        return numerator / denominator if denominator else 0.0

    def _weekly_trend(self, leave_dates: list, today: date, window_days: int) -> tuple:
        """Bucket leave days into weekly counts across the window and trend them."""
        num_weeks = max(window_days // 7, 1)
        weekly_counts = []
        for week_offset in range(num_weeks, 0, -1):
            week_start = today - timedelta(weeks=week_offset)
            week_end = today - timedelta(weeks=week_offset - 1)
            count = sum(1 for d in leave_dates if week_start <= d < week_end)
            weekly_counts.append(count)

        if len(weekly_counts) < 2 or not any(weekly_counts):
            return 'stable', 'Insufficient data for trend analysis', 0.0

        slope = self._weighted_trend_slope(weekly_counts)
        total_change = slope * (len(weekly_counts) - 1)

        if total_change > 1:
            return 'rising', f'Leave frequency rising ({weekly_counts[0]} to {weekly_counts[-1]} days/week)', slope
        if total_change < -1:
            return 'falling', f'Leave frequency falling ({weekly_counts[0]} to {weekly_counts[-1]} days/week)', slope
        return 'stable', 'Leave frequency stable', slope

    def _attendance_decline(self, attendance: list) -> tuple:
        """Overall ABSENT/LATE rate and whether it's trending up recently."""
        if not attendance:
            return 0.0, 'stable'

        total = len(attendance)
        negative = sum(1 for _, status in attendance if status in ('ABSENT', 'LATE'))
        rate = round(negative / total * 100, 1) if total else 0.0

        sorted_records = sorted(attendance, key=lambda r: r[0])
        midpoint = len(sorted_records) // 2
        if midpoint == 0:
            return rate, 'stable'

        first_half = sorted_records[:midpoint]
        second_half = sorted_records[midpoint:]
        first_rate = sum(1 for _, s in first_half if s in ('ABSENT', 'LATE')) / len(first_half)
        second_rate = sum(1 for _, s in second_half if s in ('ABSENT', 'LATE')) / len(second_half)

        if second_rate - first_rate > 0.15:
            return rate, 'declining'
        return rate, 'stable'

    def _day_of_week_pattern(self, leave_dates: list) -> str:
        """Detect Monday/Friday clustering — the classic 'extending the weekend' pattern."""
        if len(leave_dates) < 3:
            return ''

        dow_counts = defaultdict(int)
        for d in leave_dates:
            dow_counts[d.weekday()] += 1

        total = len(leave_dates)
        for dow in (0, 4):  # Monday, Friday
            count = dow_counts.get(dow, 0)
            if count >= 3 and count / total >= 0.4:
                return f'{count}/{total} leave days fall on {DAY_NAMES[dow]}s'

        return ''

    def _current_absence_streak(self, attendance: list, leave_dates: list) -> int:
        """Trailing run of consecutive ABSENT/ON_LEAVE working days or leave days."""
        negative_dates = {d for d, status in attendance if status in ('ABSENT', 'ON_LEAVE')}
        negative_dates.update(leave_dates)

        if not negative_dates:
            return 0

        sorted_dates = sorted(negative_dates, reverse=True)
        streak = 1
        for i in range(1, len(sorted_dates)):
            gap = (sorted_dates[i - 1] - sorted_dates[i]).days
            if gap <= 3:  # allow weekends between consecutive working-day absences
                streak += 1
            else:
                break
        return streak

    def _determine_severity(self, leave_days: int, leave_trend: str, absence_rate: float,
                            absence_trend: str, streak: int) -> str | None:
        if streak >= STREAK_HIGH_THRESHOLD:
            return 'HIGH'

        if leave_trend == 'rising' and absence_trend == 'declining':
            return 'HIGH'

        if leave_trend == 'rising' or absence_rate > 20:
            return 'MEDIUM'

        if streak >= STREAK_MEDIUM_THRESHOLD:
            return 'MEDIUM'

        if absence_trend == 'declining':
            return 'LOW'

        return None

    def _suggest_action(self, severity: str, leave_trend: str, day_pattern: str, streak: int) -> str:
        if streak >= STREAK_MEDIUM_THRESHOLD:
            prefix = f'{streak} consecutive days absent/on leave - '
        else:
            prefix = ''

        if severity == 'HIGH':
            return prefix + 'Schedule a check-in conversation - leave/absence pattern is escalating'

        if severity == 'MEDIUM':
            if day_pattern:
                return prefix + f'Review leave pattern with department head - {day_pattern.lower()}'
            return prefix + 'Monitor leave frequency - trending above normal'

        return prefix + 'Add to watch list - attendance trending downward'
