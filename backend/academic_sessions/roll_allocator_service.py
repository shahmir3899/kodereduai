"""
Roll number allocation service.

Provides deterministic roll allocation for enrollment buckets:
(school, academic_year, class). A new roll is the lowest free whole number, so the
numbers left by students who left are filled before the sequence grows.
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

    def _occupied_numeric_rolls(self, exclude_student_id=None):
        """Whole-number rolls held by active students in this bucket."""
        from academic_sessions.models import StudentEnrollment
        from students.models import Student

        enrollment_qs = StudentEnrollment.objects.filter(
            school_id=self.school_id,
            academic_year_id=self.academic_year_id,
            is_active=True,
        )
        if self.session_class_id:
            enrollment_qs = enrollment_qs.filter(session_class_id=self.session_class_id)
        else:
            enrollment_qs = enrollment_qs.filter(class_obj_id=self.class_obj_id)
        if exclude_student_id:
            enrollment_qs = enrollment_qs.exclude(student_id=exclude_student_id)

        rolls = list(enrollment_qs.values_list('roll_number', flat=True))

        # For session-class-aware allocation, rely on enrollment bucket only.
        # Student snapshot rows are class-wide and can span multiple sections.
        if not self.session_class_id:
            student_qs = Student.objects.filter(school_id=self.school_id, class_obj_id=self.class_obj_id)
            if exclude_student_id:
                student_qs = student_qs.exclude(id=exclude_student_id)
            rolls += list(student_qs.values_list('roll_number', flat=True))

        values = (self._to_int(roll) for roll in rolls)
        return {value for value in values if value is not None and value > 0}

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

    def lowest_free_roll(self, exclude_student_id=None):
        """The smallest whole number nobody active holds: a leaver's or a removed
        student's number is reused before a new one is started."""
        occupied = self._occupied_numeric_rolls(exclude_student_id=exclude_student_id)
        candidate = 1
        while candidate in occupied:
            candidate += 1
        return str(candidate)

    def resolve_roll(self, preferred_roll=None, exclude_student_id=None):
        """The roll asked for when it is free, otherwise the lowest free one."""
        preferred = str(preferred_roll or '').strip()
        if preferred and not self.is_roll_taken(preferred, exclude_student_id=exclude_student_id):
            return preferred
        return self.lowest_free_roll(exclude_student_id=exclude_student_id)
