import secrets
from django.db import models, transaction
from django.conf import settings
from django.utils import timezone


class RestoreConflict(Exception):
    """A deleted student cannot be restored as-is (roll number now taken)."""


class StudentQuerySet(models.QuerySet):
    def delete(self):
        # A bulk delete used to cascade away every student's attendance, fees and
        # marks with no way back; it now hides them like a single delete does.
        # Use hard_delete() for a real removal.
        count = 0
        for student in self:
            student.soft_delete()
            count += 1
        return count, {self.model._meta.label: count}

    def hard_delete(self):
        from core.db_guards import allow_student_hard_delete
        with allow_student_hard_delete():
            return super().delete()


class StudentManager(models.Manager.from_queryset(StudentQuerySet)):
    """Default manager: soft-deleted students are invisible. Every existing
    Student.objects call, and every reverse relation (class.students,
    school.students), therefore skips them without being touched."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


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
        help_text="Class name, e.g., 'Class 1', 'PlayGroup'"
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
        unique_together = ('school', 'name', 'section')
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
        indexes = [
            models.Index(fields=['school', 'is_active']),
            models.Index(fields=['school', 'grade_level', 'section']),
        ]

    def __str__(self):
        return f"{self.name} - {self.school.name}"

    @staticmethod
    def get_highest_grade_level(school_id):
        """Return the highest grade_level for a given school."""
        from django.db.models import Max

        result = Class.objects.filter(
            school_id=school_id,
            is_active=True,
        ).aggregate(max_level=Max('grade_level'))
        return result['max_level']

    @property
    def student_count(self) -> int:
        """Active students in this class for the current academic year."""
        from academic_sessions.roster import class_student_count

        return class_student_count(self)


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

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        TRANSFERRED = 'TRANSFERRED', 'Transferred'
        WITHDRAWN = 'WITHDRAWN', 'Withdrawn'
        GRADUATED = 'GRADUATED', 'Graduated'
        REPEAT = 'REPEAT', 'Repeat'

    STATUS_CHOICES = Status.choices

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
    photo_url = models.URLField(blank=True, default='')

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

    # Set on the record a transfer creates at the destination branch; the source
    # record stays (with its history) at the branch the student left.
    transferred_from = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='transferred_to',
        help_text='The student record this one was created from by a branch transfer.',
    )

    # Status
    is_active = models.BooleanField(default=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='ACTIVE',
    )
    status_date = models.DateField(null=True, blank=True)
    status_reason = models.TextField(blank=True, default='')

    # Soft delete: a deleted student keeps every row that points at them
    # (attendance, marks, fees, enrollments) and is only hidden, so a mistaken
    # delete can be undone. Deleting for real is Student.hard_delete().
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )
    # db_default: the code deployed before this column existed leaves it out of its
    # INSERTs; without a database-level default creating a student would fail NOT NULL.
    deleted_reason = models.TextField(blank=True, default='', db_default='')
    # Enrollments that were active when the student was deleted, so restore
    # reactivates exactly those and not ones that were already closed.
    deleted_enrollment_ids = models.JSONField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = StudentManager()
    all_objects = models.Manager.from_queryset(StudentQuerySet)()

    class Meta:
        ordering = ['class_obj', 'roll_number']
        verbose_name = 'Student'
        verbose_name_plural = 'Students'
        indexes = [
            models.Index(fields=['school', 'is_active']),
            models.Index(fields=['class_obj', 'is_active']),
            models.Index(fields=['school', 'class_obj']),
            models.Index(fields=['school', 'class_obj', 'roll_number']),
        ]

    def __str__(self):
        return f"{self.roll_number}. {self.name} ({self.class_obj.name})"

    @property
    def is_deleted(self):
        return self.deleted_at is not None

    def delete(self, using=None, keep_parents=False):
        self.soft_delete()
        return 1, {self._meta.label: 1}

    def hard_delete(self, using=None, keep_parents=False):
        """Really remove the row and cascade away everything it owns. Not
        reachable from the API."""
        from core.db_guards import allow_student_hard_delete
        with allow_student_hard_delete():
            return super().delete(using=using, keep_parents=keep_parents)

    def soft_delete(self, by=None, reason=''):
        """Hide the student without touching any row that points at them.

        Their enrollments are closed so class rosters, attendance sheets and
        promotion lists (which read enrollments directly) stop listing them;
        fee payments are left alone because collected money is still on the books.
        """
        from academic_sessions.models import StudentEnrollment
        if self.deleted_at:
            return
        with transaction.atomic():
            enrollment_ids = list(
                StudentEnrollment.objects.filter(student_id=self.pk, is_active=True)
                .values_list('id', flat=True)
            )
            if enrollment_ids:
                StudentEnrollment.objects.filter(id__in=enrollment_ids).update(is_active=False)
            self.deleted_at = timezone.now()
            self.deleted_by = by if getattr(by, 'is_authenticated', False) else None
            self.deleted_reason = (reason or '')[:1000]
            self.deleted_enrollment_ids = enrollment_ids
            self.save(update_fields=[
                'deleted_at', 'deleted_by', 'deleted_reason', 'deleted_enrollment_ids', 'updated_at',
            ])

    def restore(self, roll_number=None):
        """Bring a soft-deleted student back, reopening the enrollments that
        were active at the time. Raises RestoreConflict if their roll number has
        since been given to another active student in the class."""
        from academic_sessions.models import StudentEnrollment
        if not self.deleted_at:
            return
        roll = str(roll_number) if roll_number else self.roll_number
        taken = Student.objects.filter(
            school_id=self.school_id, class_obj_id=self.class_obj_id,
            roll_number=roll, status='ACTIVE', is_active=True,
        ).exclude(pk=self.pk).exists()
        if taken:
            raise RestoreConflict(
                f'Roll number {roll} in {self.class_obj.name} now belongs to another student.'
            )
        with transaction.atomic():
            ids = self.deleted_enrollment_ids or []
            if ids:
                StudentEnrollment.objects.filter(id__in=ids, student_id=self.pk).update(is_active=True)
            self.roll_number = roll
            self.deleted_at = None
            self.deleted_by = None
            self.deleted_reason = ''
            self.deleted_enrollment_ids = None
            self.save(update_fields=[
                'roll_number', 'deleted_at', 'deleted_by', 'deleted_reason',
                'deleted_enrollment_ids', 'updated_at',
            ])


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


class StudyHelperMessage(models.Model):
    """Chat history for AI Study Helper per student."""
    ROLE_CHOICES = [('user', 'User'), ('assistant', 'Assistant')]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='study_helper_messages',
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='study_messages',
    )
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    content = models.TextField()
    flagged = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Study Helper Message'
        verbose_name_plural = 'Study Helper Messages'

    def __str__(self):
        return f"{self.role}: {self.content[:50]}..."
