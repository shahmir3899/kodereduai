from django.db import models


class AcademicYear(models.Model):
    """Represents an academic session like '2025-2026'."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='academic_years',
    )
    name = models.CharField(max_length=50, help_text="e.g. '2025-2026'")
    start_date = models.DateField()
    end_date = models.DateField()
    is_current = models.BooleanField(
        default=False,
        help_text="Only one academic year can be current per school",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['-start_date']
        verbose_name = 'Academic Year'
        verbose_name_plural = 'Academic Years'
        constraints = [
            models.UniqueConstraint(
                fields=['school'],
                condition=models.Q(is_current=True),
                name='unique_current_academic_year_per_school',
            ),
        ]

    def __str__(self):
        return f"{self.name} - {self.school.name}"

    def save(self, *args, **kwargs):
        if self.is_current:
            AcademicYear.objects.filter(
                school=self.school, is_current=True,
            ).exclude(pk=self.pk).update(is_current=False)
        super().save(*args, **kwargs)


class Term(models.Model):
    """Terms/semesters within an academic year."""

    class TermType(models.TextChoices):
        TERM = 'TERM', 'Term'
        SEMESTER = 'SEMESTER', 'Semester'
        QUARTER = 'QUARTER', 'Quarter'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='terms',
    )
    academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.CASCADE,
        related_name='terms',
    )
    name = models.CharField(max_length=50, help_text="e.g. 'Term 1'")
    term_type = models.CharField(
        max_length=10,
        choices=TermType.choices,
        default=TermType.TERM,
    )
    order = models.PositiveIntegerField(
        help_text="Sort order within the academic year",
    )
    start_date = models.DateField()
    end_date = models.DateField()
    is_current = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'academic_year', 'name')
        ordering = ['academic_year', 'order']
        verbose_name = 'Term'
        verbose_name_plural = 'Terms'

    def __str__(self):
        return f"{self.academic_year.name} - {self.name}"


class StudentEnrollment(models.Model):
    """Links a student to a class for a specific academic year."""

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        PROMOTED = 'PROMOTED', 'Promoted'
        RETAINED = 'RETAINED', 'Retained'
        TRANSFERRED = 'TRANSFERRED', 'Transferred'
        WITHDRAWN = 'WITHDRAWN', 'Withdrawn'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_enrollments',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='enrollments',
    )
    academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.CASCADE,
        related_name='enrollments',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='enrollments',
    )
    roll_number = models.CharField(max_length=20)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'student', 'academic_year')
        ordering = ['academic_year', 'class_obj', 'roll_number']
        verbose_name = 'Student Enrollment'
        verbose_name_plural = 'Student Enrollments'
        indexes = [
            models.Index(fields=['school', 'academic_year', 'class_obj']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'class_obj', 'roll_number'],
                name='unique_roll_per_session_class',
            ),
        ]

    def __str__(self):
        return f"{self.student.name} -> {self.class_obj.name} ({self.academic_year.name})"
