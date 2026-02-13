"""
Academic/Examination report generators.
"""

from django.db.models import Avg, Count, Q
from .base import BaseReportGenerator


class ClassResultReportGenerator(BaseReportGenerator):
    """Class result summary for a specific exam."""

    def get_data(self):
        exam_id = self.parameters.get('exam_id')
        if not exam_id:
            return {'title': 'Class Result', 'subtitle': 'No exam specified',
                    'summary': {}, 'table_headers': [], 'table_rows': []}

        try:
            from examinations.models import Exam, StudentMark, ExamSubject

            exam = Exam.objects.get(id=exam_id)
            marks = StudentMark.objects.filter(
                exam_subject__exam=exam,
                student__school=self.school,
            ).select_related(
                'student', 'student__class_obj', 'exam_subject', 'exam_subject__subject'
            ).order_by('student__class_obj__name', 'student__roll_number')

            # Aggregate per student
            student_totals = {}
            for mark in marks:
                sid = mark.student_id
                if sid not in student_totals:
                    student_totals[sid] = {
                        'name': mark.student.name,
                        'roll': mark.student.roll_number,
                        'class': mark.student.class_obj.name,
                        'obtained': 0,
                        'total': 0,
                        'subjects': 0,
                    }
                student_totals[sid]['obtained'] += float(mark.marks_obtained or 0)
                student_totals[sid]['total'] += float(mark.exam_subject.total_marks or 0)
                student_totals[sid]['subjects'] += 1

            rows = []
            pass_count = 0
            for sid, s in sorted(student_totals.items(), key=lambda x: (x[1]['class'], x[1]['roll'])):
                pct = round(s['obtained'] / s['total'] * 100, 1) if s['total'] > 0 else 0
                passed = pct >= 40  # Configurable threshold
                if passed:
                    pass_count += 1
                rows.append([
                    s['class'],
                    s['roll'],
                    s['name'],
                    f"{s['obtained']:.0f}",
                    f"{s['total']:.0f}",
                    f"{pct}%",
                    'Pass' if passed else 'Fail',
                ])

            total_students = len(student_totals)
            return {
                'title': f"Class Result Summary - {exam.name}",
                'subtitle': f"Exam: {exam.name}",
                'summary': {
                    'Total Students': total_students,
                    'Passed': pass_count,
                    'Failed': total_students - pass_count,
                    'Pass Rate': f"{round(pass_count / total_students * 100, 1)}%" if total_students > 0 else 'N/A',
                },
                'table_headers': ['Class', 'Roll #', 'Name', 'Obtained', 'Total', 'Percentage', 'Result'],
                'table_rows': rows,
            }
        except Exception as e:
            return {'title': 'Class Result', 'subtitle': f'Error: {str(e)}',
                    'summary': {}, 'table_headers': [], 'table_rows': []}


class StudentProgressReportGenerator(BaseReportGenerator):
    """Individual student progress across all exams."""

    def get_data(self):
        student_id = self.parameters.get('student_id')
        if not student_id:
            return {'title': 'Student Progress', 'subtitle': 'No student specified',
                    'summary': {}, 'table_headers': [], 'table_rows': []}

        try:
            from students.models import Student
            from examinations.models import StudentMark

            student = Student.objects.select_related('class_obj').get(id=student_id)

            marks = StudentMark.objects.filter(
                student=student
            ).select_related(
                'exam_subject', 'exam_subject__exam', 'exam_subject__subject'
            ).order_by('exam_subject__exam__date', 'exam_subject__subject__name')

            rows = []
            for m in marks:
                obtained = float(m.marks_obtained or 0)
                total = float(m.exam_subject.total_marks or 0)
                pct = round(obtained / total * 100, 1) if total > 0 else 0
                rows.append([
                    m.exam_subject.exam.name,
                    m.exam_subject.subject.name,
                    f"{obtained:.0f}",
                    f"{total:.0f}",
                    f"{pct}%",
                    m.grade if hasattr(m, 'grade') and m.grade else '-',
                ])

            return {
                'title': f"Student Progress Report - {student.name}",
                'subtitle': f"Class: {student.class_obj.name} | Roll #: {student.roll_number}",
                'summary': {
                    'Student': student.name,
                    'Class': student.class_obj.name,
                    'Roll Number': student.roll_number,
                },
                'table_headers': ['Exam', 'Subject', 'Obtained', 'Total', 'Percentage', 'Grade'],
                'table_rows': rows,
            }
        except Exception as e:
            return {'title': 'Student Progress', 'subtitle': f'Error: {str(e)}',
                    'summary': {}, 'table_headers': [], 'table_rows': []}
