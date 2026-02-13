from django.db import models


class AdmissionSession(models.Model):
    """Defines an admission window for a specific academic year."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='admission_sessions',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        related_name='admission_sessions',
    )
    name = models.CharField(max_length=100)
    start_date = models.DateField()
    end_date = models.DateField()
    grade_levels_open = models.JSONField(
        default=list,
        blank=True,
        help_text="List of grade level integers open for admission, e.g. [0, 1, 2, 3]",
    )
    is_active = models.BooleanField(default=True)
    form_fields = models.JSONField(
        default=dict,
        help_text='Customizable form fields configuration',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date']
        verbose_name = 'Admission Session'
        verbose_name_plural = 'Admission Sessions'
        indexes = [models.Index(fields=['school', 'is_active'])]

    def __str__(self):
        return f"{self.name} - {self.school.name}"


class AdmissionEnquiry(models.Model):
    """Initial enquiry/lead from a prospective parent."""
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

    STAGE_CHOICES = [
        ('NEW', 'New Enquiry'),
        ('CONTACTED', 'Contacted'),
        ('VISIT_SCHEDULED', 'Campus Visit Scheduled'),
        ('VISIT_DONE', 'Campus Visit Done'),
        ('FORM_SUBMITTED', 'Application Submitted'),
        ('TEST_SCHEDULED', 'Test Scheduled'),
        ('TEST_DONE', 'Test Completed'),
        ('OFFERED', 'Offer Made'),
        ('ACCEPTED', 'Accepted'),
        ('ENROLLED', 'Enrolled'),
        ('REJECTED', 'Rejected'),
        ('WITHDRAWN', 'Withdrawn'),
        ('LOST', 'Lost'),
    ]

    PRIORITY_CHOICES = [
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='admission_enquiries',
    )
    session = models.ForeignKey(
        AdmissionSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='enquiries',
    )

    # Child info
    child_name = models.CharField(max_length=100)
    child_dob = models.DateField(null=True, blank=True)
    child_gender = models.CharField(max_length=10, blank=True, default='')
    applying_for_grade_level = models.IntegerField(
        null=True,
        blank=True,
        help_text="Grade level the child is applying for (e.g., 0=Playgroup, 3=Class 1)",
    )
    previous_school = models.CharField(max_length=200, blank=True, default='')

    # Parent info
    parent_name = models.CharField(max_length=100)
    parent_phone = models.CharField(max_length=20)
    parent_email = models.EmailField(blank=True, default='')
    parent_occupation = models.CharField(max_length=100, blank=True, default='')
    address = models.TextField(blank=True, default='')

    # Lead tracking
    source = models.CharField(
        max_length=30,
        choices=SOURCE_CHOICES,
        default='WALK_IN',
    )
    referral_details = models.CharField(max_length=200, blank=True, default='')

    # Pipeline stage
    stage = models.CharField(
        max_length=20,
        choices=STAGE_CHOICES,
        default='NEW',
    )

    # Interaction tracking
    assigned_to = models.ForeignKey(
        'users.User',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_enquiries',
    )
    priority = models.CharField(
        max_length=10,
        choices=PRIORITY_CHOICES,
        default='MEDIUM',
    )
    next_followup_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict)

    # Conversion
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
            models.Index(fields=['school', 'stage']),
            models.Index(fields=['school', 'next_followup_date']),
            models.Index(fields=['parent_phone']),
        ]

    def __str__(self):
        return f"{self.child_name} - {self.get_stage_display()} ({self.school.name})"


class AdmissionDocument(models.Model):
    """Documents uploaded during admission process."""
    DOCUMENT_TYPE_CHOICES = [
        ('PHOTO', 'Passport Photo'),
        ('BIRTH_CERT', 'Birth Certificate'),
        ('PREV_REPORT', 'Previous Report Card'),
        ('TC', 'Transfer Certificate'),
        ('MEDICAL', 'Medical Certificate'),
        ('ID_PROOF', 'Parent ID Proof'),
        ('ADDRESS_PROOF', 'Address Proof'),
        ('OTHER', 'Other'),
    ]

    enquiry = models.ForeignKey(
        AdmissionEnquiry,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPE_CHOICES)
    file_url = models.URLField()
    file_name = models.CharField(max_length=200)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = 'Admission Document'
        verbose_name_plural = 'Admission Documents'

    def __str__(self):
        return f"{self.file_name} - {self.enquiry.child_name}"


class AdmissionNote(models.Model):
    """Activity log / notes on an enquiry."""
    NOTE_TYPE_CHOICES = [
        ('NOTE', 'Note'),
        ('CALL', 'Phone Call'),
        ('VISIT', 'Campus Visit'),
        ('EMAIL', 'Email Sent'),
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
