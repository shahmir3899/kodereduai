import uuid
from django.db import models
from django.conf import settings


class MessageThread(models.Model):
    """
    Conversation container between two users.
    Optionally linked to a student for teacher-parent/student context.
    """
    MESSAGE_TYPE_CHOICES = [
        ('ADMIN_STAFF', 'Admin to Staff'),
        ('TEACHER_PARENT', 'Teacher to Parent'),
        ('TEACHER_STUDENT', 'Teacher to Student'),
        ('GENERAL', 'General'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='message_threads',
    )
    message_type = models.CharField(
        max_length=20,
        choices=MESSAGE_TYPE_CHOICES,
        default='GENERAL',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='message_threads',
    )
    subject = models.CharField(max_length=200, blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='created_threads',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['school', '-updated_at']),
            models.Index(fields=['school', 'message_type']),
        ]

    def __str__(self):
        return f"Thread {self.id} ({self.get_message_type_display()})"


class ThreadParticipant(models.Model):
    """Tracks who is part of a thread and their read state."""
    thread = models.ForeignKey(
        MessageThread,
        on_delete=models.CASCADE,
        related_name='participants',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='thread_participations',
    )
    last_read_at = models.DateTimeField(null=True, blank=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('thread', 'user')
        indexes = [
            models.Index(fields=['user']),
        ]

    def __str__(self):
        return f"{self.user.username} in {self.thread_id}"


class Message(models.Model):
    """Individual message within a thread."""
    thread = models.ForeignKey(
        MessageThread,
        on_delete=models.CASCADE,
        related_name='messages',
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_messages',
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['thread', 'created_at']),
        ]

    def __str__(self):
        return f"{self.sender.username}: {self.body[:50]}"
