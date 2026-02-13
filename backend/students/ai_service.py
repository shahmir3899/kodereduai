"""
AI Student 360 Profile Service.
Generates a holistic risk assessment combining attendance, fees, and academics.
"""

import logging
from django.db.models import Sum, Avg, Count, Q
from decimal import Decimal

logger = logging.getLogger(__name__)


class Student360Service:
    """
    Holistic student risk profiling.

    Usage:
        service = Student360Service(school_id, student_id)
        profile = service.generate_profile()
    """

    def __init__(self, school_id, student_id):
        self.school_id = school_id
        self.student_id = student_id

    def _get_attendance_data(self):
        from attendance.models import AttendanceRecord

        qs = AttendanceRecord.objects.filter(
            student_id=self.student_id,
            school_id=self.school_id,
        )
        total = qs.count()
        present = qs.filter(status='PRESENT').count()
        absent = qs.filter(status='ABSENT').count()
        rate = round(present / total * 100, 1) if total > 0 else 0.0

        # Trend: compare last 30 records vs previous 30
        recent = qs.order_by('-date')[:30]
        older = qs.order_by('-date')[30:60]
        recent_rate = 0
        older_rate = 0
        if recent.exists():
            recent_present = sum(1 for r in recent if r.status == 'PRESENT')
            recent_rate = recent_present / len(recent) * 100
        if older.exists():
            older_list = list(older)
            if older_list:
                older_present = sum(1 for r in older_list if r.status == 'PRESENT')
                older_rate = older_present / len(older_list) * 100

        if recent_rate > older_rate + 5:
            trend = 'improving'
        elif recent_rate < older_rate - 5:
            trend = 'declining'
        else:
            trend = 'stable'

        # Risk
        if rate < 60:
            risk = 'HIGH'
        elif rate < 75:
            risk = 'MEDIUM'
        else:
            risk = 'LOW'

        return {
            'rate': rate,
            'present': present,
            'absent': absent,
            'total_days': total,
            'trend': trend,
            'risk': risk,
        }

    def _get_academic_data(self):
        try:
            from examinations.models import StudentMark

            marks = StudentMark.objects.filter(
                student_id=self.student_id,
            ).select_related('exam_subject', 'exam_subject__subject')

            if not marks.exists():
                return {
                    'avg_score': None,
                    'trend': 'no_data',
                    'weakest': None,
                    'risk': 'LOW',
                }

            avg = marks.aggregate(avg=Avg('marks_obtained'))['avg']
            avg_score = round(float(avg), 1) if avg else 0

            # Subject-wise averages to find weakest
            subject_avgs = {}
            for m in marks:
                subj = m.exam_subject.subject.name
                if subj not in subject_avgs:
                    subject_avgs[subj] = []
                if m.marks_obtained and m.exam_subject.total_marks:
                    pct = float(m.marks_obtained) / float(m.exam_subject.total_marks) * 100
                    subject_avgs[subj].append(pct)

            weakest = None
            if subject_avgs:
                weakest_subj = min(subject_avgs.items(),
                                   key=lambda x: sum(x[1]) / len(x[1]) if x[1] else 100)
                weakest = weakest_subj[0]

            # Risk
            if avg_score < 40:
                risk = 'HIGH'
            elif avg_score < 60:
                risk = 'MEDIUM'
            else:
                risk = 'LOW'

            return {
                'avg_score': avg_score,
                'trend': 'stable',  # Simplified
                'weakest': weakest,
                'risk': risk,
            }
        except Exception:
            return {'avg_score': None, 'trend': 'no_data', 'weakest': None, 'risk': 'LOW'}

    def _get_financial_data(self):
        from finance.models import FeePayment

        agg = FeePayment.objects.filter(
            student_id=self.student_id,
            school_id=self.school_id,
        ).aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )

        due = agg['total_due'] or Decimal('0')
        paid = agg['total_paid'] or Decimal('0')
        outstanding = due - paid
        paid_rate = round(float(paid) / float(due) * 100, 1) if due > 0 else 100.0

        # Count overdue months
        overdue = FeePayment.objects.filter(
            student_id=self.student_id,
            school_id=self.school_id,
            status='PENDING',
            amount_paid=0,
        ).count()

        if paid_rate < 50 or overdue >= 3:
            risk = 'HIGH'
        elif paid_rate < 75 or overdue >= 1:
            risk = 'MEDIUM'
        else:
            risk = 'LOW'

        return {
            'paid_rate': paid_rate,
            'outstanding': float(outstanding),
            'months_overdue': overdue,
            'risk': risk,
        }

    def _compute_overall_risk(self, attendance, academic, financial):
        risk_scores = {'LOW': 1, 'MEDIUM': 2, 'HIGH': 3}
        weights = {'attendance': 0.4, 'academic': 0.3, 'financial': 0.3}

        score = (
            risk_scores.get(attendance['risk'], 1) * weights['attendance'] +
            risk_scores.get(academic['risk'], 1) * weights['academic'] +
            risk_scores.get(financial['risk'], 1) * weights['financial']
        )

        risk_score = round(score / 3 * 100)

        if score >= 2.5:
            return 'HIGH', risk_score
        elif score >= 1.5:
            return 'MEDIUM', risk_score
        return 'LOW', risk_score

    def _generate_ai_summary(self, attendance, academic, financial, overall_risk):
        """Generate a natural language summary using Groq LLM or rule-based fallback."""
        try:
            from django.conf import settings
            if not settings.GROQ_API_KEY:
                raise Exception("No API key")

            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            prompt = f"""Generate a brief 2-3 sentence student assessment summary based on:
- Attendance: {attendance['rate']}% rate, trend: {attendance['trend']}, {attendance['absent']} absences
- Academics: avg score {academic['avg_score']}, weakest subject: {academic['weakest']}
- Fees: {financial['paid_rate']}% paid, {financial['months_overdue']} months overdue, PKR {financial['outstanding']:,.0f} outstanding
- Overall Risk: {overall_risk}

Be concise and actionable. Mention the most important concern first."""

            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=200,
            )
            return response.choices[0].message.content.strip()

        except Exception as e:
            logger.info(f"LLM summary fallback: {e}")
            # Rule-based fallback
            parts = []
            if attendance['risk'] != 'LOW':
                parts.append(f"Attendance is concerning at {attendance['rate']}% ({attendance['trend']} trend)")
            if academic['risk'] != 'LOW' and academic['avg_score']:
                parts.append(f"Academic performance needs attention (avg: {academic['avg_score']})")
            if financial['risk'] != 'LOW':
                parts.append(f"Fee payment is {financial['paid_rate']}% with PKR {financial['outstanding']:,.0f} outstanding")
            if not parts:
                parts.append("Student is performing well across all areas")
            return '. '.join(parts) + '.'

    def generate_profile(self):
        """Generate complete 360 profile."""
        attendance = self._get_attendance_data()
        academic = self._get_academic_data()
        financial = self._get_financial_data()
        overall_risk, risk_score = self._compute_overall_risk(attendance, academic, financial)

        recommendations = []
        if attendance['risk'] in ('HIGH', 'MEDIUM'):
            recommendations.append(f"Investigate attendance pattern - currently at {attendance['rate']}%")
        if attendance['trend'] == 'declining':
            recommendations.append("Attendance is declining - consider parent meeting")
        if academic['weakest']:
            recommendations.append(f"Focus on {academic['weakest']} - weakest subject")
        if financial['months_overdue'] > 0:
            recommendations.append(f"Send fee reminder - {financial['months_overdue']} months overdue")

        ai_summary = self._generate_ai_summary(attendance, academic, financial, overall_risk)

        return {
            'overall_risk': overall_risk,
            'risk_score': risk_score,
            'attendance': attendance,
            'academic': academic,
            'financial': financial,
            'ai_summary': ai_summary,
            'recommendations': recommendations,
        }
