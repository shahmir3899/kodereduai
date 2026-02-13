import secrets
from django.db import models
from django.conf import settings
from django.utils import timezone


class Class(models.Model):
    """
    Represents a class/section within a school.
    Examples: "Class 5-A", "PlayGroup", "Class 10"
    grade_level groups classes by level (0=Playgroup, 1=Nursery, 3=Class 1, etc.)
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='classes'
    )
    name = models.CharField(
        max_length=50,
        help_text="Class name, e.g., 'Class 5-A', 'PlayGroup'"
    )
    section = models.CharField(
        max_length=10,
        blank=True,
        default='',
        help_text="Section identifier: 'A', 'B', 'C', or '' for single-section classes",
    )
    grade_level = models.IntegerField(
        default=0,
        help_text="Numeric grade level for sorting/grouping (e.g., 0=Playgroup, 3=Class 1, 12=Class 10)"
    )
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['grade_level', 'section', 'name']
        verbose_name = 'Class'
        verbose_name_plural = 'Classes'
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'grade_level', 'section'],
                condition=models.Q(section__gt=''),
                name='unique_level_section_per_school',
            ),
        ]

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

    GENDER_CHOICES = [
        ('M', 'Male'),
        ('F', 'Female'),
        ('O', 'Other'),
    ]

    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('TRANSFERRED', 'Transferred'),
        ('WITHDRAWN', 'Withdrawn'),
        ('GRADUATED', 'Graduated'),
        ('SUSPENDED', 'Suspended'),
    ]

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

    # Admission details (Phase 2)
    admission_number = models.CharField(max_length=30, blank=True, default='')
    admission_date = models.DateField(null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, blank=True, default='')
    blood_group = models.CharField(max_length=5, blank=True, default='')
    address = models.TextField(blank=True, default='')
    previous_school = models.CharField(max_length=200, blank=True, default='')

    # Parent contact (for WhatsApp notifications)
    parent_phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        help_text="Parent's phone number for absence notifications"
    )
    parent_name = models.CharField(max_length=200, blank=True)

    # Guardian details (Phase 2)
    guardian_name = models.CharField(max_length=200, blank=True, default='')
    guardian_relation = models.CharField(max_length=50, blank=True, default='')
    guardian_phone = models.CharField(max_length=20, blank=True, default='')
    guardian_email = models.EmailField(blank=True, default='')
    guardian_occupation = models.CharField(max_length=100, blank=True, default='')
    guardian_address = models.TextField(blank=True, default='')
    emergency_contact = models.CharField(max_length=20, blank=True, default='')

    # Status
    is_active = models.BooleanField(default=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='ACTIVE',
    )
    status_date = models.DateField(null=True, blank=True)
    status_reason = models.TextField(blank=True, default='')

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


class StudentDocument(models.Model):
    """
    Uploaded documents for a student (birth certificate, photos, TC, etc.).
    """

    DOCUMENT_TYPE_CHOICES = [
        ('PHOTO', 'Photo'),
        ('BIRTH_CERT', 'Birth Certificate'),
        ('PREV_REPORT', 'Previous Report Card'),
        ('TC', 'Transfer Certificate'),
        ('MEDICAL', 'Medical Record'),
        ('OTHER', 'Other'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_documents',
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    document_type = models.CharField(max_length=20, choices=DOCUMENT_TYPE_CHOICES)
    title = models.CharField(max_length=200)
    file_url = models.URLField(help_text='Supabase storage URL')
    uploaded_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Student Document'
        verbose_name_plural = 'Student Documents'

    def __str__(self):
        return f"{self.title} - {self.student.name}"


class StudentProfile(models.Model):
    """
    Links a User account to a Student record, enabling student portal access.
    Created when a student registers via an invite code.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='student_profile',
    )
    student = models.OneToOneField(
        Student,
        on_delete=models.CASCADE,
        related_name='user_profile',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_profiles',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Student Profile'
        verbose_name_plural = 'Student Profiles'

    def __str__(self):
        return f"{self.user.email} → {self.student.name}"


class StudentInvite(models.Model):
    """
    Invite code for student self-registration on the student portal.
    Admin generates an invite linked to a specific student record.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_invites',
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='invites',
    )
    invite_code = models.CharField(max_length=20, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Student Invite'
        verbose_name_plural = 'Student Invites'

    def __str__(self):
        return f"Invite {self.invite_code} → {self.student.name}"

    @property
    def is_valid(self):
        return not self.is_used and self.expires_at > timezone.now()

    def save(self, *args, **kwargs):
        if not self.invite_code:
            self.invite_code = secrets.token_urlsafe(12)[:16].upper()
        if not self.expires_at:
            self.expires_at = timezone.now() + timezone.timedelta(days=30)
        super().save(*args, **kwargs)
