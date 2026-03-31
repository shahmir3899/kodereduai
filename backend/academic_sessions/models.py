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


class SessionClass(models.Model):
    """Year-specific class catalog entry.

    This allows schools to keep different class structures per academic year
    while preserving the existing master Class model for cross-module
    compatibility.
    """

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='session_classes',
    )
    academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.CASCADE,
        related_name='session_classes',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='session_class_links',
        help_text='Optional link to master class for backward compatibility.',
    )
    display_name = models.CharField(max_length=50)
    section = models.CharField(max_length=10, blank=True, default='')
    grade_level = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['academic_year', 'grade_level', 'section', 'display_name']
        verbose_name = 'Session Class'
        verbose_name_plural = 'Session Classes'
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'display_name', 'section'],
                name='unique_session_class_name_per_year',
            ),
        ]
        indexes = [
            models.Index(fields=['school', 'academic_year', 'is_active']),
            models.Index(fields=['school', 'academic_year', 'grade_level', 'section']),
        ]

    @property
    def label(self):
        if self.section:
            return f"{self.display_name} - {self.section}"
        return self.display_name

    def __str__(self):
        return f"{self.label} ({self.academic_year.name})"


class StudentEnrollment(models.Model):
    """Links a student to a class for a specific academic year.
    Statuses:
      - ACTIVE: Currently enrolled
      - PROMOTED: Promoted to next class
      - REPEAT: Repeating the same class
      - TRANSFERRED: Moved to another school
      - WITHDRAWN: Left school before completion
      - GRADUATED: Completed highest class or left school as graduate
    """

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        PROMOTED = 'PROMOTED', 'Promoted'
        REPEAT = 'REPEAT', 'Repeat'
        TRANSFERRED = 'TRANSFERRED', 'Transferred'
        WITHDRAWN = 'WITHDRAWN', 'Withdrawn'
        GRADUATED = 'GRADUATED', 'Graduated'  # New: For students who have completed highest class or left school as graduate

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
    session_class = models.ForeignKey(
        SessionClass,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='enrollments',
        help_text='Year-specific class placement for this enrollment.',
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
        ordering = ['academic_year', 'session_class', 'class_obj', 'roll_number']
        verbose_name = 'Student Enrollment'
        verbose_name_plural = 'Student Enrollments'
        indexes = [
            models.Index(fields=['school', 'academic_year', 'class_obj']),
            models.Index(fields=['school', 'academic_year', 'session_class']),
            models.Index(fields=['academic_year', 'is_active', 'student']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'session_class', 'roll_number'],
                condition=models.Q(session_class__isnull=False),
                name='unique_roll_per_session_class_enrollment',
            ),
            models.UniqueConstraint(
                fields=['school', 'academic_year', 'class_obj', 'roll_number'],
                condition=models.Q(session_class__isnull=True),
                name='unique_roll_per_legacy_class_enrollment',
            ),
        ]

    def __str__(self):
        class_label = self.session_class.label if self.session_class_id else self.class_obj.name
        return f"{self.student.name} -> {class_label} ({self.academic_year.name})"
