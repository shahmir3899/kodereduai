"""
Composite Student Risk Score Service.

Blends AttendanceRiskService, FeeCollectionPredictorService, and
AcademicRiskService into a single per-student risk score, without changing what
each reports (each keeps its own flagged-students-only output by default; a student
absent from a dimension's list is "no detected risk" there, not "confirmed healthy").

This is the ONE definition of risk. The school-wide Student Risk Score page uses
get_student_risk_scores(); the student profile uses score_student(). Both go through
combine(), so the same student gets the same level on both.

Fees: the level is the worse of two signals: how many months of fees the family
owes today (finance.fee_risk) and the payment-pattern default probability
(FeeCollectionPredictorService). Roles that cannot see finance get a score from
attendance and academics only (include_fees=False, weights renormalised).
"""

import logging

logger = logging.getLogger(__name__)

SEVERITY_POINTS = {'HIGH': 90, 'MEDIUM': 60, 'LOW': 30}
NOT_FLAGGED_POINTS = 10

WEIGHT_ATTENDANCE = 0.35
WEIGHT_FEE = 0.35
WEIGHT_ACADEMIC = 0.30

PREDICTION_CUTOFF = 0.25  # matches the predictor's own "meaningful prediction" line
HIGH_AT = 70
MEDIUM_AT = 45

_RANK = {None: 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3}


def worse(a, b):
    """The more severe of two levels (None = not flagged)."""
    return a if _RANK.get(a, 0) >= _RANK.get(b, 0) else b


def score_to_severity(composite: float) -> str:
    if composite >= HIGH_AT:
        return 'HIGH'
    if composite >= MEDIUM_AT:
        return 'MEDIUM'
    return 'LOW'


def combine(attendance_severity, fee_severity, academic_severity, include_fees=True):
    """(composite 0-100 rounded to 1 dp, overall severity). Not flagged = 10 points."""
    attendance_points = SEVERITY_POINTS.get(attendance_severity, NOT_FLAGGED_POINTS)
    academic_points = SEVERITY_POINTS.get(academic_severity, NOT_FLAGGED_POINTS)
    if include_fees:
        fee_points = SEVERITY_POINTS.get(fee_severity, NOT_FLAGGED_POINTS)
        composite = (
            attendance_points * WEIGHT_ATTENDANCE
            + fee_points * WEIGHT_FEE
            + academic_points * WEIGHT_ACADEMIC
        )
    else:
        total = WEIGHT_ATTENDANCE + WEIGHT_ACADEMIC
        composite = (
            attendance_points * WEIGHT_ATTENDANCE + academic_points * WEIGHT_ACADEMIC
        ) / total
    composite = round(composite, 1)
    return composite, score_to_severity(composite)


class StudentRiskScoreService:
    """Computes a blended attendance + fee + academic risk score per student."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def _predictor_report(self, only_student_ids=None, include_unflagged=False):
        from finance.fee_predictor_service import FeeCollectionPredictorService
        try:
            return FeeCollectionPredictorService(self.school_id, self.academic_year_id).predict_defaults(
                only_student_ids=only_student_ids, include_unflagged=include_unflagged,
            )
        except Exception as e:
            logger.warning(f"Fee predictor unavailable for composite risk score, school {self.school_id}: {e}")
            return {'predictions': []}

    def get_student_risk_scores(self) -> dict:
        from students.models import Student
        from academic_sessions.attendance_risk_service import AttendanceRiskService
        from academic_sessions.roster import placement_group, placements_for
        from examinations.academic_risk_service import AcademicRiskService
        from finance.fee_risk import fee_risk_for_students

        active = list(Student.objects.filter(
            school_id=self.school_id, is_active=True,
        ).select_related('class_obj'))
        total_students = len(active)

        if total_students == 0:
            return {
                'total_students': 0,
                'at_risk_count': 0,
                'risk_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'students': [],
            }

        attendance_report = AttendanceRiskService(self.school_id, self.academic_year_id).get_at_risk_students()
        academic_report = AcademicRiskService(self.school_id, self.academic_year_id).get_at_risk_students()
        fee_report = self._predictor_report()

        attendance_by_student = {s['student_id']: s for s in attendance_report.get('students', [])}
        academic_by_student = {s['student_id']: s for s in academic_report.get('students', [])}
        predicted_by_student = {p['student_id']: p for p in fee_report.get('predictions', [])}

        # Arrears are measured for every active student, so a family that owes three
        # months is flagged even when its payment history looks regular.
        students_by_id = {s.id: s for s in active}
        arrears = fee_risk_for_students(students_by_id)
        fee_level = {}
        for sid, info in arrears.items():
            level = worse(info['level'], predicted_by_student.get(sid, {}).get('risk_level'))
            if level:
                fee_level[sid] = level
        for sid, pred in predicted_by_student.items():
            fee_level.setdefault(sid, pred.get('risk_level'))

        student_ids = set(attendance_by_student) | set(academic_by_student) | set(fee_level)

        student_names = {}
        for source in (attendance_by_student, academic_by_student, predicted_by_student):
            for sid, entry in source.items():
                student_names.setdefault(sid, (entry.get('student_name', ''), entry.get('class_name', '')))
        missing = [sid for sid in student_ids if sid not in student_names or not student_names[sid][1]]
        if missing:
            from academic_sessions.utils import resolve_current_academic_year_id
            year_id = self.academic_year_id or resolve_current_academic_year_id(self.school_id)
            placements = placements_for(
                self.school_id, ((sid, year_id) for sid in missing if sid in students_by_id)
            ) if year_id else {}
            for sid in missing:
                student = students_by_id.get(sid)
                if student is None:
                    continue
                known = student_names.get(sid, ('', ''))
                student_names[sid] = (
                    known[0] or student.name,
                    known[1] or placement_group(placements.get((sid, year_id)), student)[1],
                )

        scored = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in student_ids:
            attendance_severity = attendance_by_student.get(sid, {}).get('severity')
            fee_severity = fee_level.get(sid)
            academic_severity = academic_by_student.get(sid, {}).get('severity')

            composite, overall_severity = combine(attendance_severity, fee_severity, academic_severity)
            name, class_name = student_names.get(sid, ('', ''))

            scored.append({
                'student_id': sid,
                'student_name': name,
                'class_name': class_name,
                'composite_score': composite,
                'severity': overall_severity,
                'attendance_severity': attendance_severity,
                'fee_risk_level': fee_severity,
                'academic_severity': academic_severity,
            })
            risk_counts[overall_severity] += 1

        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        scored.sort(key=lambda s: (severity_order.get(s['severity'], 3), -s['composite_score']))

        return {
            'total_students': total_students,
            'at_risk_count': len(scored),
            'risk_levels': risk_counts,
            'students': scored,
        }

    def score_student(self, student_id: int, include_fees: bool = True) -> dict:
        """One student's full picture, using exactly the school-wide rules.

        Returns the composite/severity plus each dimension's detail record (with
        insufficient_data flags). With include_fees False the fee dimension is neither
        computed nor returned, and the composite uses attendance and academics only.
        """
        from academic_sessions.attendance_risk_service import AttendanceRiskService
        from examinations.academic_risk_service import AcademicRiskService

        ids = [student_id]
        attendance = next(iter(AttendanceRiskService(self.school_id, self.academic_year_id)
                               .get_at_risk_students(only_student_ids=ids, include_unflagged=True)
                               .get('students', [])), None)
        academic = next(iter(AcademicRiskService(self.school_id, self.academic_year_id)
                             .get_at_risk_students(only_student_ids=ids, include_unflagged=True)
                             .get('students', [])), None)

        fee = None
        fee_severity = None
        if include_fees:
            from finance.fee_risk import student_fee_risk
            arrears = student_fee_risk(student_id)
            predicted = next(iter(self._predictor_report(ids, include_unflagged=True)
                                  .get('predictions', [])), None)
            # The school-wide page only sees predictions at or above PREDICTION_CUTOFF
            # (the predictor drops the rest), so a lower one must not count here either.
            predicted_level = (
                predicted['risk_level']
                if predicted and predicted['default_probability'] >= PREDICTION_CUTOFF else None
            )
            fee_severity = worse(arrears['level'], predicted_level)
            fee = {
                'level': fee_severity,
                'arrears_level': arrears['level'],
                'pending': arrears['pending'],
                'months_owed': arrears['months_owed'],
                'months_overdue': arrears['months_overdue'],
                'default_probability': (predicted or {}).get('default_probability'),
                'has_fee_history': bool(predicted) or arrears['pending'] > 0,
            }

        attendance_severity = (attendance or {}).get('severity')
        academic_severity = (academic or {}).get('severity')
        composite, severity = combine(attendance_severity, fee_severity, academic_severity, include_fees)
        return {
            'composite_score': composite,
            'severity': severity,
            'attendance': attendance,
            'academic': academic,
            'fee': fee,
        }
