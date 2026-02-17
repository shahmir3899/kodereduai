from django.db import models


class AdmissionEnquiry(models.Model):
    """Simplified enquiry/lead from a prospective parent."""

    STATUS_CHOICES = [
        ('NEW', 'New'),
        ('CONFIRMED', 'Confirmed'),
        ('CONVERTED', 'Converted'),
        ('CANCELLED', 'Cancelled'),
    ]

    SOURCE_CHOICES = [
        ('WALK_IN', 'Walk-in'),
        ('PHONE', 'Phone Call'),
        ('WEBSITE', 'Website'),
        ('WHATSAPP', 'WhatsApp'),
        ('REFERRAL', 'Referral'),
        ('SOCIAL_MEDIA', 'Social Media'),
        ('AD_CAMPAIGN', 'Ad Campaign'),
        ('OTHER', 'Other'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='admission_enquiries',
    )

    # Core fields
    name = models.CharField(max_length=100, help_text="Child's name")
    father_name = models.CharField(max_length=100)
    mobile = models.CharField(max_length=20)
    applying_for_grade_level = models.IntegerField(
        null=True,
        blank=True,
        help_text="Grade level applying for (e.g., 0=Playgroup, 3=Class 1)",
    )

    # Extra tracked fields
    source = models.CharField(
        max_length=30,
        choices=SOURCE_CHOICES,
        default='WALK_IN',
    )
    next_followup_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')

    # Status
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='NEW',
    )

    # Conversion link
    converted_student = models.ForeignKey(
        'students.Student',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='admission_enquiry',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Admission Enquiry'
        verbose_name_plural = 'Admission Enquiries'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['school', 'next_followup_date']),
            models.Index(fields=['mobile']),
        ]

    def __str__(self):
        return f"{self.name} - {self.get_status_display()} ({self.school.name})"


class AdmissionNote(models.Model):
    """Activity log / notes on an enquiry."""

    NOTE_TYPE_CHOICES = [
        ('NOTE', 'Note'),
        ('CALL', 'Phone Call'),
        ('STATUS_CHANGE', 'Status Change'),
        ('SYSTEM', 'System'),
    ]

    enquiry = models.ForeignKey(
        AdmissionEnquiry,
        on_delete=models.CASCADE,
        related_name='activity_notes',
    )
    user = models.ForeignKey(
        'users.User',
        on_delete=models.CASCADE,
    )
    note = models.TextField()
    note_type = models.CharField(
        max_length=20,
        choices=NOTE_TYPE_CHOICES,
        default='NOTE',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Admission Note'
        verbose_name_plural = 'Admission Notes'

    def __str__(self):
        return f"{self.get_note_type_display()}: {self.note[:50]}"
