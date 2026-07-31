"""
Composite Student Risk Score Service.

Blends AttendanceRiskService, FeeCollectionPredictorService, and
AcademicRiskService into a single per-student risk score, without modifying
any of the three (each keeps its own flagged-students-only output — a
student absent from a dimension's list is treated as "no detected risk"
there, not "confirmed healthy").
"""

import logging

logger = logging.getLogger(__name__)

SEVERITY_POINTS = {'HIGH': 90, 'MEDIUM': 60, 'LOW': 30}
NOT_FLAGGED_POINTS = 10

WEIGHT_ATTENDANCE = 0.35
WEIGHT_FEE = 0.35
WEIGHT_ACADEMIC = 0.30


class StudentRiskScoreService:
    """Computes a blended attendance + fee + academic risk score per student."""

    def __init__(self, school_id: int, academic_year_id: int):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def get_student_risk_scores(self) -> dict:
        from students.models import Student
        from academic_sessions.attendance_risk_service import AttendanceRiskService
        from finance.fee_predictor_service import FeeCollectionPredictorService
        from examinations.academic_risk_service import AcademicRiskService

        total_students = Student.objects.filter(
            school_id=self.school_id, is_active=True,
        ).count()

        if total_students == 0:
            return {
                'total_students': 0,
                'at_risk_count': 0,
                'risk_levels': {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0},
                'students': [],
            }

        attendance_report = AttendanceRiskService(self.school_id, self.academic_year_id).get_at_risk_students()
        academic_report = AcademicRiskService(self.school_id, self.academic_year_id).get_at_risk_students()

        try:
            fee_report = FeeCollectionPredictorService(self.school_id, self.academic_year_id).predict_defaults()
        except Exception as e:
            logger.warning(f"Fee predictor unavailable for composite risk score, school {self.school_id}: {e}")
            fee_report = {'predictions': []}

        attendance_by_student = {s['student_id']: s for s in attendance_report.get('students', [])}
        academic_by_student = {s['student_id']: s for s in academic_report.get('students', [])}
        fee_by_student = {p['student_id']: p for p in fee_report.get('predictions', [])}

        student_ids = set(attendance_by_student) | set(academic_by_student) | set(fee_by_student)

        student_names = {}
        for source in (attendance_by_student, academic_by_student):
            for sid, entry in source.items():
                student_names.setdefault(sid, (entry.get('student_name', ''), entry.get('class_name', '')))
        for sid, entry in fee_by_student.items():
            student_names.setdefault(sid, (entry.get('student_name', ''), entry.get('class_name', '')))

        scored = []
        risk_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

        for sid in student_ids:
            attendance_severity = attendance_by_student.get(sid, {}).get('severity')
            fee_severity = fee_by_student.get(sid, {}).get('risk_level')
            academic_severity = academic_by_student.get(sid, {}).get('severity')

            attendance_points = SEVERITY_POINTS.get(attendance_severity, NOT_FLAGGED_POINTS)
            fee_points = SEVERITY_POINTS.get(fee_severity, NOT_FLAGGED_POINTS)
            academic_points = SEVERITY_POINTS.get(academic_severity, NOT_FLAGGED_POINTS)

            composite = (
                attendance_points * WEIGHT_ATTENDANCE
                + fee_points * WEIGHT_FEE
                + academic_points * WEIGHT_ACADEMIC
            )
            composite = round(composite, 1)

            overall_severity = self._score_to_severity(composite)
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

    def _score_to_severity(self, composite: float) -> str:
        if composite >= 70:
            return 'HIGH'
        if composite >= 45:
            return 'MEDIUM'
        return 'LOW'
