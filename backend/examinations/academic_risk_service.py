"""
AI Academic Risk Predictor Service.

Analyzes a student's marks across exams within an academic year to identify
students trending toward failing grades, mirroring the trend/severity
approach used by academic_sessions.attendance_risk_service.AttendanceRiskService
but bucketed by exam (2-4 per year) instead of by week.
"""

import logging
from collections import defaultdict
from datetime import date

logger = logging.getLogger(__name__)

# Exams are naturally few per year — 10 weekly buckets doesn't apply here.
MIN_EXAMS = 2

# A run of consecutive failing exams is itself a red flag, independent of
# the running average.
STREAK_MEDIUM_THRESHOLD = 2
STREAK_HIGH_THRESHOLD = 3


class AcademicRiskService:
    """Identifies students at risk of failing grades using exam-trend analysis."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def get_at_risk_students(self, threshold: float = 40.0) -> dict:
        """
        Analyze all active students and return those who are at risk or
        predicted to be at risk of falling below the passing threshold.
        """
        from students.models import Student
        from .models import StudentMark

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

        # Fetch every mark for the academic year once. percentage/is_pass are
        # Python properties on StudentMark, not queryable — pull the raw
        # fields and compute in Python.
        marks = StudentMark.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            exam_subject__exam__academic_year_id=self.academic_year_id,
            exam_subject__is_active=True,
            is_absent=False,
            marks_obtained__isnull=False,
        ).values_list(
            'student_id',
            'exam_subject__exam_id',
            'exam_subject__exam__start_date',
            'marks_obtained',
            'exam_subject__total_marks',
        )

        # Bucket into per-student, per-exam (subject-averaged) percentages.
        student_exam_totals = defaultdict(lambda: defaultdict(lambda: {'sum': 0.0, 'count': 0}))
        student_exam_dates = {}

        for sid, exam_id, exam_date, marks_obtained, total_marks in marks:
            if not total_marks:
                continue
            pct = float(marks_obtained) / float(total_marks) * 100
            bucket = student_exam_totals[sid][exam_id]
            bucket['sum'] += pct
            bucket['count'] += 1
            student_exam_dates[exam_id] = exam_date or date.min

        at_risk_students = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in student_ids:
            student = student_map[sid]
            exam_totals = student_exam_totals.get(sid)
            if not exam_totals:
                continue

            # Per-exam average percentage, ordered chronologically.
            exam_averages = sorted(
                (
                    (exam_id, bucket['sum'] / bucket['count'])
                    for exam_id, bucket in exam_totals.items()
                    if bucket['count'] > 0
                ),
                key=lambda item: student_exam_dates.get(item[0], date.min),
            )

            if len(exam_averages) < MIN_EXAMS:
                continue

            averages = [pct for _, pct in exam_averages]
            current_average = round(averages[-1], 1)

            trend, trend_detail, slope = self._analyze_trend(averages)
            streak = self._current_fail_streak(averages, threshold)
            predicted_average = self._predict_next_exam(current_average, slope)

            severity = self._determine_severity(
                current_average, threshold, trend, predicted_average, streak,
            )
            if severity is None:
                continue

            suggested_action = self._suggest_action(severity, trend, streak, current_average)

            at_risk_students.append({
                'student_id': sid,
                'student_name': student.name,
                'roll_number': student.roll_number,
                'class_name': student.class_obj.name if student.class_obj else '',
                'current_average': current_average,
                'severity': severity,
                'trend': trend,
                'trend_detail': trend_detail,
                'predicted_next_exam_average': predicted_average,
                'consecutive_fails': streak,
                'exams_recorded': len(exam_averages),
                'suggested_action': suggested_action,
            })

            risk_counts[severity] += 1

        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        at_risk_students.sort(key=lambda s: (severity_order.get(s['severity'], 3), s['current_average']))

        return {
            'total_students': total_students,
            'at_risk_count': len(at_risk_students),
            'risk_levels': risk_counts,
            'students': at_risk_students,
        }

    def _weighted_trend_slope(self, values: list) -> float:
        """
        Weighted least-squares slope (points change per exam) — recent exams
        weighted more heavily. Same technique as AttendanceRiskService's
        weekly-rate slope, applied to exam-averages instead.
        """
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

    def _analyze_trend(self, averages: list) -> tuple:
        """Returns (trend, trend_detail, slope)."""
        slope = self._weighted_trend_slope(averages)
        total_change = slope * (len(averages) - 1)
        first_avg, last_avg = round(averages[0], 1), round(averages[-1], 1)

        if total_change > 5:
            trend = 'improving'
            trend_detail = f'Improved from {first_avg}% to {last_avg}% across recorded exams'
        elif total_change < -5:
            trend = 'declining'
            trend_detail = f'Dropped from {first_avg}% to {last_avg}% across recorded exams'
        else:
            trend = 'stable'
            trend_detail = f'Stable around {last_avg}% across recorded exams'

        return trend, trend_detail, slope

    def _current_fail_streak(self, averages: list, threshold: float) -> int:
        """Trailing run of consecutive exams where the average was below threshold."""
        streak = 0
        for avg in reversed(averages):
            if avg < threshold:
                streak += 1
            else:
                break
        return streak

    def _predict_next_exam(self, current_average: float, slope: float) -> float:
        """Project the average percentage for the next exam."""
        projected = current_average + slope
        projected = max(0.0, min(100.0, projected))
        return round(projected, 1)

    def _determine_severity(self, current_average: float, threshold: float, trend: str,
                            predicted_average: float, streak: int = 0) -> str | None:
        """
        Returns 'HIGH', 'MEDIUM', 'LOW', or None (not at risk).
        Mirrors AttendanceRiskService's severity ratio (HIGH at 0.8x threshold).
        """
        if streak >= STREAK_HIGH_THRESHOLD:
            return 'HIGH'

        if current_average < threshold * 0.8:
            return 'HIGH'

        if current_average < threshold:
            return 'MEDIUM'

        if streak >= STREAK_MEDIUM_THRESHOLD:
            return 'MEDIUM'

        if current_average <= threshold + 5.0 and trend == 'declining':
            return 'LOW'

        if current_average >= threshold and predicted_average < threshold and trend == 'declining':
            return 'LOW'

        return None

    def _suggest_action(self, severity: str, trend: str, streak: int, current_average: float) -> str:
        """Generate an actionable suggestion based on the risk profile."""
        if streak >= STREAK_MEDIUM_THRESHOLD:
            prefix = f'{streak} consecutive exams below passing - '
        else:
            prefix = ''

        if severity == 'HIGH':
            if current_average < 25:
                return prefix + 'Urgent: Academic intervention required - performance critically low'
            return prefix + 'Schedule academic support session - performance well below passing'

        if severity == 'MEDIUM':
            if trend == 'declining':
                return prefix + 'Notify parents of declining academic performance'
            return prefix + 'Add to academic watch list - below passing threshold'

        # LOW
        if trend == 'declining':
            return prefix + 'Monitor closely - grades trending downward, may need support soon'
        return prefix + 'Add to watch list - approaching passing threshold'
