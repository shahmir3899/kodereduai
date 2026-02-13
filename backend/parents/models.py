import uuid
from django.db import models
from django.utils import timezone


class ParentProfile(models.Model):
    """
    Links a User account to their parent identity.
    A parent can have children across multiple schools.
    """
    RELATION_CHOICES = [
        ('FATHER', 'Father'),
        ('MOTHER', 'Mother'),
        ('GUARDIAN', 'Guardian'),
        ('OTHER', 'Other'),
    ]

    user = models.OneToOneField(
        'users.User',
        on_delete=models.CASCADE,
        related_name='parent_profile',
    )
    phone = models.CharField(max_length=20)
    alternate_phone = models.CharField(max_length=20, blank=True, default='')
    address = models.TextField(blank=True, default='')
    occupation = models.CharField(max_length=100, blank=True, default='')
    relation_to_default = models.CharField(
        max_length=20,
        choices=RELATION_CHOICES,
        default='FATHER',
    )
    profile_photo_url = models.URLField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Parent Profile'
        verbose_name_plural = 'Parent Profiles'
        indexes = [models.Index(fields=['phone'])]

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} ({self.get_relation_to_default_display()})"


class ParentChild(models.Model):
    """
    Many-to-many link between parent and students (supports siblings).
    One parent can have multiple children; one child can have multiple parents.
    """
    RELATION_CHOICES = [
        ('FATHER', 'Father'),
        ('MOTHER', 'Mother'),
        ('GUARDIAN', 'Guardian'),
        ('OTHER', 'Other'),
    ]

    parent = models.ForeignKey(
        ParentProfile,
        on_delete=models.CASCADE,
        related_name='children',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='parent_links',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
    )
    relation = models.CharField(max_length=20, choices=RELATION_CHOICES)
    is_primary = models.BooleanField(
        default=False,
        help_text='Primary contact for this child',
    )
    can_pickup = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('parent', 'student')
        verbose_name = 'Parent-Child Link'
        verbose_name_plural = 'Parent-Child Links'
        indexes = [
            models.Index(fields=['school', 'parent']),
            models.Index(fields=['student']),
        ]

    def __str__(self):
        return f"{self.parent.user.username} → {self.student.name} ({self.get_relation_display()})"


class ParentInvite(models.Model):
    """Invite code for parent registration, linked to a student."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='parent_invites',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='parent_invites',
    )
    invite_code = models.CharField(max_length=20, unique=True)
    relation = models.CharField(max_length=20, choices=ParentChild.RELATION_CHOICES)
    parent_phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        help_text='Expected phone number for verification',
    )
    is_used = models.BooleanField(default=False)
    used_by = models.ForeignKey(
        ParentProfile,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    expires_at = models.DateTimeField()
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Parent Invite'
        verbose_name_plural = 'Parent Invites'
        indexes = [
            models.Index(fields=['school', 'is_used']),
            models.Index(fields=['invite_code']),
        ]

    def __str__(self):
        return f"Invite {self.invite_code} for {self.student.name}"

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    @property
    def is_valid(self):
        return not self.is_used and not self.is_expired


class ParentLeaveRequest(models.Model):
    """Parent applies for child's leave from school."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('CANCELLED', 'Cancelled'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='parent_leave_requests',
    )
    parent = models.ForeignKey(
        ParentProfile,
        on_delete=models.CASCADE,
        related_name='leave_requests',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='parent_leave_requests',
    )
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    document_url = models.URLField(blank=True, default='')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='PENDING',
    )
    reviewed_by = models.ForeignKey(
        'users.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_parent_leaves',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Parent Leave Request'
        verbose_name_plural = 'Parent Leave Requests'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['student', 'start_date']),
        ]

    def __str__(self):
        return f"Leave: {self.student.name} {self.start_date} - {self.end_date} ({self.status})"


class ParentMessage(models.Model):
    """
    Simple messaging between parent and teacher/admin.
    Thread-based: messages share a thread_id.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='parent_messages',
    )
    thread_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    sender_user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='sent_parent_messages',
    )
    recipient_user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
        related_name='received_parent_messages',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='parent_messages',
    )
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Parent Message'
        verbose_name_plural = 'Parent Messages'
        indexes = [
            models.Index(fields=['thread_id', 'created_at']),
            models.Index(fields=['recipient_user', 'is_read']),
            models.Index(fields=['school', 'student']),
        ]

    def __str__(self):
        return f"{self.sender_user.username} → {self.recipient_user.username}: {self.message[:50]}"
