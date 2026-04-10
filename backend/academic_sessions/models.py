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


class SchoolCalendarEntry(models.Model):
    """Calendar entries for off days and school events."""

    class EntryKind(models.TextChoices):
        OFF_DAY = 'OFF_DAY', 'Off Day'
        EVENT = 'EVENT', 'Event'

    class OffDayType(models.TextChoices):
        SUMMER_VACATION = 'SUMMER_VACATION', 'Summer Vacation'
        WINTER_VACATION = 'WINTER_VACATION', 'Winter Vacation'
        RELIGIOUS_HOLIDAY = 'RELIGIOUS_HOLIDAY', 'Religious Holiday'
        NATIONAL_HOLIDAY = 'NATIONAL_HOLIDAY', 'National Holiday'
        EXAM_BREAK = 'EXAM_BREAK', 'Exam Break'
        OTHER = 'OTHER', 'Other'

    class Scope(models.TextChoices):
        SCHOOL = 'SCHOOL', 'Whole School'
        CLASS = 'CLASS', 'Specific Classes'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='calendar_entries',
    )
    academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.CASCADE,
        related_name='calendar_entries',
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    entry_kind = models.CharField(
        max_length=20,
        choices=EntryKind.choices,
    )
    off_day_type = models.CharField(
        max_length=30,
        choices=OffDayType.choices,
        blank=True,
        default='',
    )
    scope = models.CharField(
        max_length=10,
        choices=Scope.choices,
        default=Scope.SCHOOL,
    )
    classes = models.ManyToManyField(
        'students.Class',
        blank=True,
        related_name='calendar_entries',
    )
    start_date = models.DateField()
    end_date = models.DateField()
    color = models.CharField(max_length=20, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_calendar_entries',
    )
    updated_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_calendar_entries',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_date', 'name', 'id']
        verbose_name = 'School Calendar Entry'
        verbose_name_plural = 'School Calendar Entries'
        indexes = [
            models.Index(fields=['school', 'academic_year', 'start_date', 'end_date']),
            models.Index(fields=['school', 'entry_kind', 'scope', 'is_active']),
        ]

    def __str__(self):
        return f"{self.name} ({self.start_date} - {self.end_date})"


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


class PromotionOperation(models.Model):
    """Batch-level audit record for promotion and correction operations."""

    class OperationType(models.TextChoices):
        BULK_PROMOTE = 'BULK_PROMOTE', 'Bulk Promote'
        BULK_REVERSE = 'BULK_REVERSE', 'Bulk Reverse'
        SINGLE_CORRECTION = 'SINGLE_CORRECTION', 'Single Correction'
        BULK_CORRECTION = 'BULK_CORRECTION', 'Bulk Correction'

    class OperationStatus(models.TextChoices):
        SUCCESS = 'SUCCESS', 'Success'
        PARTIAL = 'PARTIAL', 'Partial'
        FAILED = 'FAILED', 'Failed'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='promotion_operations',
    )
    source_academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_operations_as_source',
    )
    target_academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_operations_as_target',
    )
    source_class = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_operations_as_source',
    )
    source_session_class = models.ForeignKey(
        SessionClass,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_operations_as_source',
    )
    operation_type = models.CharField(
        max_length=32,
        choices=OperationType.choices,
    )
    status = models.CharField(
        max_length=16,
        choices=OperationStatus.choices,
        default=OperationStatus.SUCCESS,
    )
    total_students = models.PositiveIntegerField(default=0)
    processed_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    initiated_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='initiated_promotion_operations',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['school', 'created_at']),
            models.Index(fields=['school', 'operation_type', 'created_at']),
            models.Index(fields=['school', 'source_academic_year', 'target_academic_year']),
        ]

    def __str__(self):
        return f"{self.get_operation_type_display()} ({self.created_at.date()})"


class PromotionEvent(models.Model):
    """Student-level event rows linked to a promotion operation."""

    class EventType(models.TextChoices):
        PROMOTED = 'PROMOTED', 'Promoted'
        REPEATED = 'REPEATED', 'Repeated'
        GRADUATED = 'GRADUATED', 'Graduated'
        REVERSED = 'REVERSED', 'Reversed'
        SKIPPED = 'SKIPPED', 'Skipped'
        FAILED = 'FAILED', 'Failed'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='promotion_events',
    )
    operation = models.ForeignKey(
        PromotionOperation,
        on_delete=models.CASCADE,
        related_name='events',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='promotion_events',
    )
    source_enrollment = models.ForeignKey(
        StudentEnrollment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_source',
    )
    target_enrollment = models.ForeignKey(
        StudentEnrollment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_target',
    )
    source_academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_source',
    )
    target_academic_year = models.ForeignKey(
        AcademicYear,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_target',
    )
    source_class = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_source',
    )
    target_class = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_target',
    )
    source_session_class = models.ForeignKey(
        SessionClass,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_source',
    )
    target_session_class = models.ForeignKey(
        SessionClass,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_as_target',
    )
    event_type = models.CharField(max_length=16, choices=EventType.choices)
    old_status = models.CharField(max_length=20, blank=True, default='')
    new_status = models.CharField(max_length=20, blank=True, default='')
    old_roll_number = models.CharField(max_length=20, blank=True, default='')
    new_roll_number = models.CharField(max_length=20, blank=True, default='')
    reason = models.TextField(blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='promotion_events_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['school', 'created_at']),
            models.Index(fields=['school', 'event_type', 'created_at']),
            models.Index(fields=['school', 'source_academic_year', 'target_academic_year']),
            models.Index(fields=['school', 'student', 'created_at']),
        ]

    def __str__(self):
        return f"{self.student_id} - {self.get_event_type_display()}"
