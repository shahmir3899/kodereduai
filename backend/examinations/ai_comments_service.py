"""
AI Report Card Comment Generator.

Generates personalized, professional comments for each student's exam marks
based on their score, grade, pass/fail status, and attendance record.
Uses Groq LLM (fast inference) to produce 2-3 sentence comments.
"""

import logging
from decimal import Decimal
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

COMMENT_PROMPT_TEMPLATE = """Generate a short report card comment (2-3 sentences) for a student's subject performance.

Subject: {subject_name}
Marks obtained: {marks_obtained} out of {total_marks} ({percentage:.0f}%)
Grade: {grade}
Result: {result}
Attendance rate: {attendance_pct:.0f}%

Rules:
- Be professional, encouraging, and constructive
- Do NOT include the student's name in the comment
- For strong performance: acknowledge achievement and encourage continued effort
- For average performance: note effort and suggest specific areas for improvement
- For weak performance: be constructive, mention need for extra attention, suggest support
- If attendance is below 80%, mention it as a factor affecting performance
- Keep to exactly 2-3 sentences
- Do not use exclamation marks excessively

Comment:"""


class ReportCardCommentGenerator:
    """Generates AI comments for student marks in an exam."""

    def __init__(self, school):
        self.school = school

    def generate_for_exam(self, exam_id):
        """Generate AI comments for all marks in an exam.

        Returns:
            dict: {generated: int, errors: int, total: int, skipped: int}
        """
        from .models import Exam, ExamSubject, StudentMark, GradeScale

        try:
            exam = Exam.objects.select_related('class_obj').get(
                id=exam_id, school=self.school
            )
        except Exam.DoesNotExist:
            return {'generated': 0, 'errors': 0, 'total': 0, 'skipped': 0,
                    'error': 'Exam not found'}

        # Load grade scales
        grade_scales = list(GradeScale.objects.filter(
            school=self.school, is_active=True
        ).order_by('-min_percentage'))

        # Get all exam subjects
        exam_subjects = ExamSubject.objects.filter(
            exam=exam, is_active=True
        ).select_related('subject')

        # Get all marks that have been entered
        marks = StudentMark.objects.filter(
            exam_subject__in=exam_subjects,
            school=self.school,
            marks_obtained__isnull=False,
            is_absent=False,
        ).select_related('student', 'exam_subject', 'exam_subject__subject')

        if not marks.exists():
            return {'generated': 0, 'errors': 0, 'total': 0, 'skipped': 0,
                    'error': 'No marks entered yet'}

        # Pre-compute attendance rates for all students in this class
        attendance_rates = self._get_attendance_rates(exam.class_obj_id)

        generated = 0
        errors = 0
        skipped = 0
        total = marks.count()

        for mark in marks:
            # Skip if already has a comment
            if mark.ai_comment:
                skipped += 1
                continue

            try:
                comment = self._generate_single_comment(
                    mark, grade_scales, attendance_rates
                )
                if comment:
                    mark.ai_comment = comment
                    mark.ai_comment_generated_at = timezone.now()
                    mark.save(update_fields=['ai_comment', 'ai_comment_generated_at'])
                    generated += 1
                else:
                    errors += 1
            except Exception as e:
                logger.warning(f"Comment generation failed for mark {mark.id}: {e}")
                errors += 1

        return {
            'generated': generated,
            'errors': errors,
            'skipped': skipped,
            'total': total,
        }

    def _generate_single_comment(self, mark, grade_scales, attendance_rates):
        """Generate a comment for a single student mark."""
        if not settings.GROQ_API_KEY:
            return self._generate_rule_based_comment(mark, grade_scales, attendance_rates)

        percentage = float(mark.marks_obtained / mark.exam_subject.total_marks * 100)
        grade = self._get_grade(percentage, grade_scales)
        result = 'Pass' if mark.marks_obtained >= mark.exam_subject.passing_marks else 'Fail'
        attendance_pct = attendance_rates.get(mark.student_id, 100)

        prompt = COMMENT_PROMPT_TEMPLATE.format(
            subject_name=mark.exam_subject.subject.name,
            marks_obtained=mark.marks_obtained,
            total_marks=mark.exam_subject.total_marks,
            percentage=percentage,
            grade=grade,
            result=result,
            attendance_pct=attendance_pct,
        )

        try:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY)

            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=200,
                timeout=15,
            )

            comment = response.choices[0].message.content.strip()
            # Clean up any surrounding quotes
            if comment.startswith('"') and comment.endswith('"'):
                comment = comment[1:-1]
            return comment

        except Exception as e:
            logger.warning(f"Groq API call failed, using rule-based fallback: {e}")
            return self._generate_rule_based_comment(mark, grade_scales, attendance_rates)

    def _generate_rule_based_comment(self, mark, grade_scales, attendance_rates):
        """Fallback: generate a rule-based comment without LLM."""
        percentage = float(mark.marks_obtained / mark.exam_subject.total_marks * 100)
        subject = mark.exam_subject.subject.name
        attendance_pct = attendance_rates.get(mark.student_id, 100)

        if percentage >= 90:
            comment = (
                f"Outstanding performance in {subject} with {percentage:.0f}%. "
                f"Demonstrates excellent understanding of the subject. Keep up the great work."
            )
        elif percentage >= 75:
            comment = (
                f"Good performance in {subject} with {percentage:.0f}%. "
                f"Shows solid understanding of key concepts. "
                f"Continue building on this strong foundation."
            )
        elif percentage >= 60:
            comment = (
                f"Satisfactory performance in {subject} with {percentage:.0f}%. "
                f"Has a fair grasp of the basics but can improve with more consistent revision."
            )
        elif percentage >= mark.exam_subject.passing_marks / mark.exam_subject.total_marks * 100:
            comment = (
                f"Needs improvement in {subject} with {percentage:.0f}%. "
                f"Would benefit from additional practice and focused attention "
                f"on weaker topics."
            )
        else:
            comment = (
                f"Requires significant support in {subject} with {percentage:.0f}%. "
                f"Recommend extra tutoring or remedial sessions to strengthen "
                f"foundational concepts."
            )

        if attendance_pct < 80:
            comment += (
                f" Attendance ({attendance_pct:.0f}%) is a concern and may be "
                f"affecting learning outcomes."
            )

        return comment

    def _get_attendance_rates(self, class_obj_id):
        """Get attendance rate for each student in the class."""
        from attendance.models import AttendanceRecord

        rates = {}
        try:
            from students.models import Student
            students = Student.objects.filter(
                school=self.school, class_obj_id=class_obj_id, is_active=True
            )

            for student in students:
                total = AttendanceRecord.objects.filter(
                    school=self.school, student=student
                ).count()
                present = AttendanceRecord.objects.filter(
                    school=self.school, student=student, status='PRESENT'
                ).count()
                rates[student.id] = (present / total * 100) if total > 0 else 100

        except Exception as e:
            logger.debug(f"Could not compute attendance rates: {e}")

        return rates

    def _get_grade(self, percentage, grade_scales):
        """Get grade label for a percentage."""
        for gs in grade_scales:
            if float(gs.min_percentage) <= percentage <= float(gs.max_percentage):
                return gs.grade_label
        return '-'
