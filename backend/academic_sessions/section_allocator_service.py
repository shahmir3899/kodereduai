"""
AI Smart Section Allocator Service.

Distributes students across N sections using a balanced serpentine algorithm
that ensures each section has a mix of high, medium, and low performers.
"""

import logging
from collections import defaultdict

from django.db.models import Avg, F, Q, Case, When, DecimalField

logger = logging.getLogger(__name__)


class SectionAllocatorService:
    """Allocates students across sections with balanced academic performance."""

    def __init__(self, school_id: int):
        self.school_id = school_id

    def allocate_students(self, grade_id: int = None, academic_year_id: int = None,
                          num_sections: int = 2, class_id: int = None) -> dict:
        """
        Allocate students across N sections using serpentine distribution.

        Supports two modes:
        - class_id: Split a single class into N section-classes.
        - grade_id: Split all students in a grade across N sections (legacy).

        1. Gets students for the class or grade.
        2. Computes each student's average percentage from StudentMark.
        3. Sorts by performance (descending) and distributes using serpentine/snake order.
        4. Returns a preview with allocation details and balance metrics.
        """
        from students.models import Class, Student
        from academic_sessions.models import StudentEnrollment

        if num_sections < 2 or num_sections > 6:
            return {'success': False, 'error': 'Number of sections must be between 2 and 6.'}

        source_name = None
        source_class = None
        student_ids = []
        enrollment_map = {}

        if class_id:
            # ── Class-based allocation ──
            try:
                source_class = Class.objects.get(id=class_id, school_id=self.school_id)
            except Class.DoesNotExist:
                return {'success': False, 'error': 'Class not found for this school.'}

            source_name = source_class.name

            # Try enrollments first
            if academic_year_id:
                enrollments = StudentEnrollment.objects.filter(
                    school_id=self.school_id,
                    academic_year_id=academic_year_id,
                    class_obj_id=class_id,
                    is_active=True,
                    status=StudentEnrollment.Status.ACTIVE,
                ).select_related('student', 'class_obj')
                student_ids = list(enrollments.values_list('student_id', flat=True))
                for enr in enrollments:
                    enrollment_map[enr.student_id] = enr

            # Fallback: students directly in this class
            if not student_ids:
                fallback_students = Student.objects.filter(
                    school_id=self.school_id,
                    class_obj_id=class_id,
                    is_active=True,
                ).select_related('class_obj')
                student_ids = list(fallback_students.values_list('id', flat=True))
                for s in fallback_students:
                    enrollment_map[s.id] = None

        else:
            return {'success': False, 'error': 'class_id is required.'}

        if not student_ids:
            return {
                'success': False,
                'error': f'No students found in {source_name}.',
            }

        # 2. Compute average percentage for each student from StudentMark
        student_averages = self._compute_student_averages(student_ids)

        # 3. Check if Student model has a gender field
        has_gender = self._model_has_field(Student, 'gender')

        # 4. Build student info list
        students_info = []
        student_objects = Student.objects.filter(
            id__in=student_ids, school_id=self.school_id,
        ).select_related('class_obj')
        student_obj_map = {s.id: s for s in student_objects}

        for sid in student_ids:
            student = student_obj_map.get(sid)
            if not student:
                continue

            enrollment = enrollment_map.get(sid)
            roll_number = ''
            if enrollment and hasattr(enrollment, 'roll_number'):
                roll_number = enrollment.roll_number
            else:
                roll_number = student.roll_number or ''

            info = {
                'student_id': student.id,
                'name': student.name,
                'roll_number': roll_number,
                'avg_score': student_averages.get(sid, 0.0),
            }

            if has_gender:
                info['gender'] = getattr(student, 'gender', '') or ''

            students_info.append(info)

        # 5. Sort students by academic performance descending
        students_info.sort(key=lambda s: s['avg_score'], reverse=True)

        # 6. Serpentine/snake allocation
        section_labels = [chr(ord('A') + i) for i in range(num_sections)]
        sections = {label: [] for label in section_labels}

        for idx, student in enumerate(students_info):
            # Determine which "round" we're in
            round_num = idx // num_sections
            pos_in_round = idx % num_sections

            if round_num % 2 == 0:
                # Forward: A, B, C, ...
                section_label = section_labels[pos_in_round]
            else:
                # Reverse: ..., C, B, A
                section_label = section_labels[num_sections - 1 - pos_in_round]

            sections[section_label].append(student)

        # 7. Build response
        section_results = []
        section_avg_scores = []

        for label in section_labels:
            section_students = sections[label]
            count = len(section_students)
            avg_score = (
                round(sum(s['avg_score'] for s in section_students) / count, 2)
                if count > 0 else 0.0
            )
            section_avg_scores.append(avg_score)

            section_data = {
                'section_name': label,
                'students': section_students,
                'count': count,
                'avg_score': avg_score,
            }

            # Gender distribution if available
            if has_gender:
                gender_counts = defaultdict(int)
                for s in section_students:
                    g = s.get('gender', '') or 'Unknown'
                    gender_counts[g] += 1
                section_data['gender_distribution'] = dict(gender_counts)

            section_results.append(section_data)

        # 8. Balance metrics
        section_counts = [s['count'] for s in section_results]
        score_variance = self._compute_variance(section_avg_scores)
        count_variance = self._compute_variance(section_counts)

        return {
            'success': True,
            'total_students': len(students_info),
            'source_name': source_name,
            'source_class_id': class_id,
            'sections': section_results,
            'balance_metrics': {
                'score_variance': round(score_variance, 2),
                'count_variance': round(count_variance, 2),
            },
        }

    def apply_allocation(self, grade_id: int = None, academic_year_id: int = None,
                         allocation_data: dict = None, class_id: int = None) -> dict:
        """
        Apply the allocation preview: create/update Class records for each section
        and update student assignments.
        """
        from students.models import Class, Student
        from academic_sessions.models import StudentEnrollment

        if not class_id:
            return {'success': False, 'error': 'class_id is required.'}

        try:
            source_class = Class.objects.get(id=class_id, school_id=self.school_id)
        except Class.DoesNotExist:
            return {'success': False, 'error': 'Class not found.'}

        source_name = source_class.name
        grade_level = source_class.grade_level

        sections_created = 0
        students_moved = 0
        errors = []

        for section_data in allocation_data.get('sections', []):
            section_name = section_data['section_name']
            class_name = f"{source_name}-{section_name}"

            # Create or get the Class for this section
            class_obj, created = Class.objects.get_or_create(
                school_id=self.school_id,
                name=class_name,
                defaults={
                    'section': section_name,
                    'grade_level': grade_level,
                    'is_active': True,
                },
            )

            if created:
                sections_created += 1
            else:
                if not class_obj.is_active:
                    class_obj.is_active = True
                    class_obj.save(update_fields=['is_active', 'updated_at'])

            # Move students to this class
            for student_info in section_data.get('students', []):
                student_id = student_info['student_id']
                try:
                    # Update enrollment
                    enrollment = StudentEnrollment.objects.filter(
                        school_id=self.school_id,
                        student_id=student_id,
                        academic_year_id=academic_year_id,
                        is_active=True,
                    ).first()

                    if enrollment:
                        enrollment.class_obj = class_obj
                        enrollment.save(update_fields=['class_obj', 'updated_at'])

                    # Also update student's current class_obj
                    Student.objects.filter(
                        id=student_id, school_id=self.school_id,
                    ).update(class_obj=class_obj)

                    students_moved += 1
                except Exception as e:
                    errors.append({
                        'student_id': student_id,
                        'error': str(e),
                    })

        return {
            'success': True,
            'sections_created': sections_created,
            'students_moved': students_moved,
            'errors': errors,
            'message': (
                f'Allocation applied: {students_moved} students distributed '
                f'across {len(allocation_data.get("sections", []))} sections.'
            ),
        }

    def _compute_student_averages(self, student_ids: list) -> dict:
        """
        Compute average percentage for each student from their StudentMark records.
        Returns dict of {student_id: average_percentage}.
        """
        from examinations.models import StudentMark

        marks_qs = StudentMark.objects.filter(
            school_id=self.school_id,
            student_id__in=student_ids,
            marks_obtained__isnull=False,
            is_absent=False,
            exam_subject__total_marks__gt=0,
        ).values('student_id').annotate(
            avg_pct=Avg(
                F('marks_obtained') * 100.0 / F('exam_subject__total_marks'),
                output_field=DecimalField(max_digits=8, decimal_places=2),
            ),
        )

        averages = {}
        for row in marks_qs:
            averages[row['student_id']] = round(float(row['avg_pct']), 1)

        return averages

    @staticmethod
    def _model_has_field(model_class, field_name: str) -> bool:
        """Check if a Django model has a specific field."""
        try:
            model_class._meta.get_field(field_name)
            return True
        except Exception:
            return False

    @staticmethod
    def _compute_variance(values: list) -> float:
        """Compute population variance of a list of numbers."""
        if not values or len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        return sum((v - mean) ** 2 for v in values) / len(values)
