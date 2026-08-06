"""
AI Fee Collection Predictor Service.
Predicts which families are likely to default on upcoming fees.
"""

import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal

logger = logging.getLogger(__name__)


class FeeCollectionPredictorService:
    """
    Predicts fee payment defaults based on historical patterns.

    Usage:
        service = FeeCollectionPredictorService(school_id, academic_year_id)
        predictions = service.predict_defaults(target_month, target_year)
    """

    def __init__(self, school_id, academic_year_id=None):
        self.school_id = school_id
        self.academic_year_id = academic_year_id

    def predict_defaults(self, target_month=None, target_year=None):
        """
        Analyze payment history to predict defaults for the target month.

        Returns:
            {
                'target_period': 'January 2026',
                'total_students': int,
                'at_risk_count': int,
                'predictions': [
                    {
                        'student_id': int,
                        'student_name': str,
                        'class_name': str,
                        'parent_phone': str,
                        'default_probability': float (0-1),
                        'risk_level': 'HIGH' | 'MEDIUM' | 'LOW',
                        'reason': str,
                        'recommended_action': str,
                    }
                ]
            }
        """
        from finance.models import FeePayment
        from students.models import Student

        today = date.today()
        if not target_month:
            target_month = today.month + 1 if today.month < 12 else 1
        if not target_year:
            target_year = today.year if target_month > today.month else today.year + 1

        students = list(Student.objects.filter(
            school_id=self.school_id,
            is_active=True,
        ).select_related('class_obj'))
        total_students = len(students)

        # Bulk-fetch every payment for every active student in one query and
        # bucket by student in Python, instead of 6 queries/student — same
        # bulk-fetch-then-analyze pattern as
        # academic_sessions.attendance_risk_service.AttendanceRiskService.
        student_ids = [s.id for s in students]
        payments_by_student = defaultdict(list)
        for row in FeePayment.objects.filter(
            student_id__in=student_ids,
            school_id=self.school_id,
        ).order_by('student_id', '-year', '-month').values(
            'student_id', 'status', 'amount_due', 'amount_paid'
        ):
            payments_by_student[row['student_id']].append(row)

        predictions = []

        for student in students:
            payments = payments_by_student.get(student.id)
            if not payments:
                continue

            total_payments = len(payments)
            pending_count = sum(1 for p in payments if p['status'] == 'UNPAID')
            partial_count = sum(1 for p in payments if p['status'] == 'PARTIAL')
            late_count = pending_count + partial_count

            # Late payment ratio
            late_ratio = late_count / total_payments if total_payments > 0 else 0

            # Recent trend (last 3 months) — payments are pre-sorted -year, -month per student
            recent = payments[:3]
            recent_unpaid = sum(1 for p in recent if p['status'] in ('UNPAID', 'PARTIAL'))

            # Outstanding amount
            outstanding = sum(
                (p['amount_due'] - p['amount_paid'] for p in payments if p['status'] in ('UNPAID', 'PARTIAL')),
                Decimal('0'),
            )

            # Calculate probability
            probability = 0.0
            reasons = []

            if recent_unpaid >= 2:
                probability += 0.4
                reasons.append(f"{recent_unpaid}/3 recent months unpaid")
            elif recent_unpaid == 1:
                probability += 0.2
                reasons.append("1 recent month unpaid")

            if late_ratio > 0.5:
                probability += 0.3
                reasons.append(f"{round(late_ratio * 100)}% historical late rate")
            elif late_ratio > 0.25:
                probability += 0.15

            if float(outstanding) > 0:
                probability += 0.2
                reasons.append(f"PKR {float(outstanding):,.0f} outstanding")

            probability = min(probability, 1.0)

            if probability >= 0.5:
                risk_level = 'HIGH'
                action = 'Urgent: Personal call or school visit needed'
            elif probability >= 0.3:
                risk_level = 'MEDIUM'
                action = 'Send fee reminder via WhatsApp'
            else:
                risk_level = 'LOW'
                action = 'Standard reminder on due date'

            if probability >= 0.25:  # Only include meaningful predictions
                predictions.append({
                    'student_id': student.id,
                    'student_name': student.name,
                    'class_name': student.class_obj.name,
                    'parent_phone': student.parent_phone or student.guardian_phone,
                    'default_probability': round(probability, 2),
                    'risk_level': risk_level,
                    'reason': '; '.join(reasons),
                    'recommended_action': action,
                })

        # Sort by probability descending
        predictions.sort(key=lambda x: x['default_probability'], reverse=True)

        target_period = date(target_year, target_month, 1).strftime('%B %Y')

        return {
            'target_period': target_period,
            'total_students': total_students,
            'at_risk_count': len([p for p in predictions if p['risk_level'] in ('HIGH', 'MEDIUM')]),
            'predictions': predictions,
        }
