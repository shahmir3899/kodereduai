from django.db import models


class Class(models.Model):
    """
    Represents a class/section within a school.
    Examples: "5-A", "PlayGroup", "Class 10"
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='classes'
    )
    name = models.CharField(
        max_length=50,
        help_text="Class name, e.g., '5-A', 'PlayGroup'"
    )
    grade_level = models.IntegerField(
        null=True,
        blank=True,
        help_text="Numeric grade level for sorting (e.g., 5 for Class 5)"
    )
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['grade_level', 'name']
        verbose_name = 'Class'
        verbose_name_plural = 'Classes'

    def __str__(self):
        return f"{self.name} - {self.school.name}"

    @property
    def student_count(self) -> int:
        """Return the number of active students in this class."""
        return self.students.filter(is_active=True).count()


class Student(models.Model):
    """
    Represents a student enrolled in a school.
    Each student belongs to a specific school and class.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='students'
    )
    class_obj = models.ForeignKey(
        'Class',
        on_delete=models.CASCADE,
        related_name='students',
        verbose_name='Class'
    )

    # Student info
    roll_number = models.CharField(
        max_length=20,
        help_text="Roll number within the class"
    )
    name = models.CharField(max_length=200)

    # Parent contact (for WhatsApp notifications)
    parent_phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        help_text="Parent's phone number for absence notifications"
    )
    parent_name = models.CharField(max_length=200, blank=True)

    # Status
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'roll_number')
        ordering = ['class_obj', 'roll_number']
        verbose_name = 'Student'
        verbose_name_plural = 'Students'

    def __str__(self):
        return f"{self.roll_number}. {self.name} ({self.class_obj.name})"
