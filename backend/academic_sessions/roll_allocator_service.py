"""
Roll number allocation service.

Provides deterministic roll allocation for enrollment buckets:
(school, academic_year, class).
"""

class RollAllocatorService:
    """Allocate roll numbers with conflict-safe checks."""

    def __init__(self, school_id: int, academic_year_id: int, class_obj_id: int, session_class_id: int = None):
        self.school_id = int(school_id)
        self.academic_year_id = int(academic_year_id)
        self.class_obj_id = int(class_obj_id)
        self.session_class_id = int(session_class_id) if session_class_id else None

    @staticmethod
    def _to_int(roll_value):
        try:
            return int(str(roll_value).strip())
        except (TypeError, ValueError):
            return None

    def _current_numeric_max(self, exclude_student_id=None):
        from academic_sessions.models import StudentEnrollment
        from students.models import Student

        max_roll = 0

        enrollment_qs = StudentEnrollment.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            is_active=True,
        )
        if self.session_class_id:
            enrollment_qs = enrollment_qs.filter(session_class_id=self.session_class_id)
        else:
            enrollment_qs = enrollment_qs.filter(class_obj_id=self.class_obj_id)

        enrollment_rolls = enrollment_qs.values_list('roll_number', flat=True)
        for roll in enrollment_rolls:
            value = self._to_int(roll)
            if value is not None:
                max_roll = max(max_roll, value)

        # For session-class-aware allocation, rely on enrollment bucket only.
        # Student snapshot rows are class-wide and can span multiple sections.
        if self.session_class_id:
            return max_roll

        student_qs = Student.objects.filter(
            school_id=self.school_id,
            class_obj_id=self.class_obj_id,
        )
        if exclude_student_id:
            student_qs = student_qs.exclude(id=exclude_student_id)

        student_rolls = student_qs.values_list('roll_number', flat=True)
        for roll in student_rolls:
            value = self._to_int(roll)
            if value is not None:
                max_roll = max(max_roll, value)

        return max_roll

    def is_roll_taken(self, roll_number: str, exclude_student_id=None):
        from academic_sessions.models import StudentEnrollment
        from students.models import Student

        normalized_roll = str(roll_number).strip()
        if not normalized_roll:
            return False

        enrollment_taken = StudentEnrollment.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            is_active=True,
            roll_number=normalized_roll,
        )
        if self.session_class_id:
            enrollment_taken = enrollment_taken.filter(session_class_id=self.session_class_id)
        else:
            enrollment_taken = enrollment_taken.filter(class_obj_id=self.class_obj_id)

        if exclude_student_id:
            enrollment_taken = enrollment_taken.exclude(student_id=exclude_student_id)

        if self.session_class_id:
            return enrollment_taken.exists()

        student_taken = Student.objects.filter(
            school_id=self.school_id,
            class_obj_id=self.class_obj_id,
            roll_number=normalized_roll,
        )
        if exclude_student_id:
            student_taken = student_taken.exclude(id=exclude_student_id)

        return enrollment_taken.exists() or student_taken.exists()

    def next_highest_roll(self, exclude_student_id=None):
        return str(self._current_numeric_max(exclude_student_id=exclude_student_id) + 1)

    def resolve_roll(self, preferred_roll=None, exclude_student_id=None):
        preferred = str(preferred_roll or '').strip()
        if preferred and not self.is_roll_taken(preferred, exclude_student_id=exclude_student_id):
            return preferred
        return self.next_highest_roll(exclude_student_id=exclude_student_id)
