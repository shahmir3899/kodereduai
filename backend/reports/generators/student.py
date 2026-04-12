"""
Comprehensive student report generator.
Combines attendance, fees, and academic data into a single report.
"""

from datetime import date
from django.db.models import Sum, Count, Q, Avg
from decimal import Decimal
from .base import BaseReportGenerator


class StudentComprehensiveReportGenerator(BaseReportGenerator):
    """All-in-one student report for parent-teacher meetings."""

    def get_data(self):
        student_id = self.parameters.get('student_id')
        if not student_id:
            return {'title': 'Student Report', 'subtitle': 'No student specified',
                    'summary': {}, 'table_headers': [], 'table_rows': []}

        academic_year_id = self._academic_year_id()

        from students.models import Student

        try:
            student = Student.objects.select_related('class_obj', 'school').get(id=student_id)
        except Student.DoesNotExist:
            return {'title': 'Student Report', 'subtitle': 'Student not found',
                    'summary': {}, 'table_headers': [], 'table_rows': []}

        # --- Attendance ---
        from attendance.models import AttendanceRecord
        att_qs = AttendanceRecord.objects.filter(student=student)
        if academic_year_id:
            att_qs = att_qs.filter(academic_year_id=academic_year_id)
        total_days = att_qs.count()
        present = att_qs.filter(status='PRESENT').count()
        absent = att_qs.filter(status='ABSENT').count()
        att_rate = round(present / total_days * 100, 1) if total_days > 0 else 0

        # --- Fees ---
        from finance.models import FeePayment
        fee_qs = FeePayment.objects.filter(student=student)
        if academic_year_id:
            fee_qs = fee_qs.filter(academic_year_id=academic_year_id)
        fee_agg = fee_qs.aggregate(
            total_due=Sum('amount_due'),
            total_paid=Sum('amount_paid'),
        )
        fee_due = fee_agg['total_due'] or Decimal('0')
        fee_paid = fee_agg['total_paid'] or Decimal('0')

        # --- Exams ---
        exam_rows = []
        try:
            from examinations.models import StudentMark
            marks = StudentMark.objects.filter(
                student=student
            )
            if academic_year_id:
                marks = marks.filter(enrollment__academic_year_id=academic_year_id)
            marks = marks.select_related('exam_subject__exam', 'exam_subject__subject')
            for m in marks:
                obtained = float(m.marks_obtained or 0)
                total = float(m.exam_subject.total_marks or 0)
                pct = round(obtained / total * 100, 1) if total > 0 else 0
                exam_rows.append([
                    m.exam_subject.exam.name,
                    m.exam_subject.subject.name,
                    f"{obtained:.0f}/{total:.0f}",
                    f"{pct}%",
                ])
        except Exception:
            pass

        enrollment_map = self._get_enrollment_map([student.id])
        class_name = self._resolve_class_name(student, enrollment_map)
        roll_number = self._resolve_roll_number(student, enrollment_map)

        summary = {
            'Student Name': student.name,
            'Class': class_name,
            'Roll Number': roll_number,
            'Admission #': student.admission_number or '-',
            'Parent/Guardian': student.parent_name or student.guardian_name or '-',
            'Contact': student.parent_phone or student.guardian_phone or '-',
            '--- Attendance ---': '',
            'Days Present': present,
            'Days Absent': absent,
            'Attendance Rate': f"{att_rate}%",
            '--- Fees ---': '',
            'Total Fee Due': f"PKR {fee_due:,.0f}",
            'Total Paid': f"PKR {fee_paid:,.0f}",
            'Outstanding': f"PKR {fee_due - fee_paid:,.0f}",
        }

        subtitle_period = f" | Academic Year ID: {academic_year_id}" if academic_year_id else ''

        return {
            'title': f"Comprehensive Report - {student.name}",
            'subtitle': f"Class: {class_name} | Generated: {date.today().strftime('%d %B %Y')}{subtitle_period}",
            'summary': summary,
            'table_headers': ['Exam', 'Subject', 'Marks', 'Percentage'] if exam_rows else [],
            'table_rows': exam_rows,
        }
