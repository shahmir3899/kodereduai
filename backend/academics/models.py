from django.db import models


class Subject(models.Model):
    """Global subject definitions per school."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='subjects',
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, help_text='Short code like ENG, MATH')
    description = models.TextField(blank=True)
    is_elective = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'code')
        ordering = ['name']
        indexes = [
            models.Index(fields=['school', 'is_active']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"


class ClassSubject(models.Model):
    """Assigns subjects to classes with teacher."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='class_subjects',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='class_subjects',
        help_text="Academic year for this assignment"
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='class_subjects',
        verbose_name='Class',
    )
    subject = models.ForeignKey(
        Subject,
        on_delete=models.CASCADE,
        related_name='class_subjects',
    )
    teacher = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='teaching_assignments',
    )
    periods_per_week = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'subject')
        ordering = ['class_obj', 'subject__name']
        indexes = [
            models.Index(fields=['teacher']),
            models.Index(fields=['academic_year']),
        ]

    def __str__(self):
        teacher_name = self.teacher.full_name if self.teacher else 'Unassigned'
        return f"{self.class_obj.name} - {self.subject.name} ({teacher_name})"


class TimetableSlot(models.Model):
    """Defines the daily schedule structure (school-wide)."""
    class SlotType(models.TextChoices):
        PERIOD = 'PERIOD', 'Period'
        BREAK = 'BREAK', 'Break'
        ASSEMBLY = 'ASSEMBLY', 'Assembly'
        LUNCH = 'LUNCH', 'Lunch'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='timetable_slots',
    )
    name = models.CharField(max_length=50, help_text='e.g. Period 1, Lunch Break')
    slot_type = models.CharField(
        max_length=10,
        choices=SlotType.choices,
        default=SlotType.PERIOD,
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    order = models.PositiveIntegerField(help_text='Sort order within the day')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'order')
        ordering = ['order']

    def __str__(self):
        return f"{self.name} ({self.start_time:%H:%M}-{self.end_time:%H:%M})"


class TimetableEntry(models.Model):
    """Actual timetable grid entries."""
    class Day(models.TextChoices):
        MON = 'MON', 'Monday'
        TUE = 'TUE', 'Tuesday'
        WED = 'WED', 'Wednesday'
        THU = 'THU', 'Thursday'
        FRI = 'FRI', 'Friday'
        SAT = 'SAT', 'Saturday'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='timetable_entries',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='timetable_entries',
        help_text="Academic year for this timetable entry"
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='timetable_entries',
        verbose_name='Class',
    )
    day = models.CharField(max_length=3, choices=Day.choices)
    slot = models.ForeignKey(
        TimetableSlot,
        on_delete=models.CASCADE,
        related_name='entries',
    )
    subject = models.ForeignKey(
        Subject,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='timetable_entries',
        help_text='Null for break/assembly slots',
    )
    teacher = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='timetable_entries',
    )
    room = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'day', 'slot')
        ordering = ['day', 'slot__order']
        indexes = [
            models.Index(fields=['teacher', 'day', 'slot']),
            models.Index(fields=['school', 'class_obj', 'day']),
        ]

    def __str__(self):
        subject_name = self.subject.name if self.subject else self.slot.name
        return f"{self.class_obj.name} {self.get_day_display()} {self.slot.name}: {subject_name}"


class AcademicsAIChatMessage(models.Model):
    """Chat messages for Academics AI assistant."""
    class Role(models.TextChoices):
        USER = 'user', 'User'
        ASSISTANT = 'assistant', 'Assistant'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='academics_chat_messages',
    )
    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='academics_chat_messages',
    )
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.user} ({self.role}): {self.content[:50]}"
