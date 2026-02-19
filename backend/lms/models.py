from django.db import models


# ---------------------------------------------------------------------------
# Curriculum Hierarchy: Book → Chapter → Topic
# ---------------------------------------------------------------------------

class Book(models.Model):
    """
    A prescribed textbook for a specific class-subject combination.
    Supports RTL languages via the language field.
    """

    class Language(models.TextChoices):
        ENGLISH = 'en', 'English'
        URDU = 'ur', 'Urdu'
        ARABIC = 'ar', 'Arabic'
        SINDHI = 'sd', 'Sindhi'
        PASHTO = 'ps', 'Pashto'
        PUNJABI = 'pa', 'Punjabi'
        OTHER = 'other', 'Other'

    RTL_LANGUAGES = {'ur', 'ar', 'sd', 'ps'}

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='curriculum_books',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='curriculum_books',
        verbose_name='Class',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='curriculum_books',
    )
    title = models.CharField(max_length=300)
    author = models.CharField(max_length=200, blank=True)
    publisher = models.CharField(max_length=200, blank=True)
    edition = models.CharField(max_length=50, blank=True)
    language = models.CharField(
        max_length=10,
        choices=Language.choices,
        default=Language.ENGLISH,
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['class_obj', 'subject', 'title']
        verbose_name = 'Curriculum Book'
        verbose_name_plural = 'Curriculum Books'
        indexes = [
            models.Index(fields=['school', 'class_obj', 'subject']),
        ]

    def __str__(self):
        return f"{self.title} ({self.class_obj.name} - {self.subject.name})"

    @property
    def is_rtl(self):
        return self.language in self.RTL_LANGUAGES


class Chapter(models.Model):
    """A chapter within a book, ordered sequentially."""

    book = models.ForeignKey(
        Book,
        on_delete=models.CASCADE,
        related_name='chapters',
    )
    title = models.CharField(max_length=300)
    chapter_number = models.PositiveIntegerField(
        help_text='Chapter ordering number (1, 2, 3...)',
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('book', 'chapter_number')
        ordering = ['chapter_number']
        verbose_name = 'Chapter'
        verbose_name_plural = 'Chapters'

    def __str__(self):
        return f"Ch {self.chapter_number}: {self.title}"


class Topic(models.Model):
    """A topic within a chapter, ordered sequentially."""

    chapter = models.ForeignKey(
        Chapter,
        on_delete=models.CASCADE,
        related_name='topics',
    )
    title = models.CharField(max_length=300)
    topic_number = models.PositiveIntegerField(
        help_text='Topic ordering within chapter (1, 2, 3...)',
    )
    description = models.TextField(blank=True)
    estimated_periods = models.PositiveIntegerField(
        default=1,
        help_text='Estimated teaching periods needed',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('chapter', 'topic_number')
        ordering = ['topic_number']
        verbose_name = 'Topic'
        verbose_name_plural = 'Topics'

    def __str__(self):
        return f"{self.chapter.chapter_number}.{self.topic_number}: {self.title}"


# ---------------------------------------------------------------------------
# Lesson Plans & Assignments
# ---------------------------------------------------------------------------

class LessonPlan(models.Model):
    """
    A lesson plan created by a teacher for a specific class and subject.
    Tracks objectives, materials, teaching methods, and can be published
    for review or kept as draft.
    """

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        PUBLISHED = 'PUBLISHED', 'Published'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='lesson_plans',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='lesson_plans',
        help_text='Academic year this lesson plan belongs to',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='lesson_plans',
        verbose_name='Class',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='lesson_plans',
    )
    teacher = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.CASCADE,
        related_name='lesson_plans',
    )

    title = models.CharField(max_length=200)
    description = models.TextField()
    objectives = models.TextField(blank=True)
    lesson_date = models.DateField()
    duration_minutes = models.PositiveIntegerField(default=40)
    materials_needed = models.TextField(blank=True)
    teaching_methods = models.TextField(blank=True)

    # Structured curriculum links
    planned_topics = models.ManyToManyField(
        'lms.Topic',
        blank=True,
        related_name='lesson_plans',
        help_text='Topics planned for this lesson (from curriculum books)',
    )
    display_text = models.TextField(
        blank=True,
        help_text='Pre-formatted topic display text, computed on save',
    )
    content_mode = models.CharField(
        max_length=10,
        choices=[('TOPICS', 'Topics'), ('FREEFORM', 'Free-form')],
        default='FREEFORM',
        help_text='Whether this plan uses structured topics or free-form text',
    )
    ai_generated = models.BooleanField(
        default=False,
        help_text='Whether the content was AI-generated',
    )

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-lesson_date']
        verbose_name = 'Lesson Plan'
        verbose_name_plural = 'Lesson Plans'

    def __str__(self):
        return f"{self.title} - {self.class_obj.name} ({self.lesson_date})"

    def compute_display_text(self):
        """Build pre-formatted text from planned topics, grouped by chapter."""
        if not self.pk:
            return ''
        topics = self.planned_topics.select_related(
            'chapter', 'chapter__book',
        ).order_by('chapter__chapter_number', 'topic_number')
        if not topics:
            return ''
        lines = []
        current_chapter = None
        for t in topics:
            if t.chapter_id != (current_chapter and current_chapter.id):
                current_chapter = t.chapter
                lines.append(f"Ch {t.chapter.chapter_number}: {t.chapter.title}")
            lines.append(f"  {t.chapter.chapter_number}.{t.topic_number} {t.title}")
        self.display_text = '\n'.join(lines)
        self.save(update_fields=['display_text'])
        return self.display_text


class LessonAttachment(models.Model):
    """File attachment associated with a lesson plan."""

    class AttachmentType(models.TextChoices):
        DOCUMENT = 'DOCUMENT', 'Document'
        IMAGE = 'IMAGE', 'Image'
        VIDEO = 'VIDEO', 'Video'
        LINK = 'LINK', 'Link'

    lesson = models.ForeignKey(
        LessonPlan,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    file_url = models.URLField()
    file_name = models.CharField(max_length=200)
    attachment_type = models.CharField(
        max_length=10,
        choices=AttachmentType.choices,
        default=AttachmentType.DOCUMENT,
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = 'Lesson Attachment'
        verbose_name_plural = 'Lesson Attachments'

    def __str__(self):
        return f"{self.file_name} ({self.lesson.title})"


class Assignment(models.Model):
    """
    An assignment (homework, project, classwork, or lab) created by a teacher
    for a specific class and subject. Can be published and later closed.
    """

    class AssignmentType(models.TextChoices):
        HOMEWORK = 'HOMEWORK', 'Homework'
        PROJECT = 'PROJECT', 'Project'
        CLASSWORK = 'CLASSWORK', 'Classwork'
        LAB = 'LAB', 'Lab'

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        PUBLISHED = 'PUBLISHED', 'Published'
        CLOSED = 'CLOSED', 'Closed'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assignments',
        help_text='Academic year this assignment belongs to',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='assignments',
        verbose_name='Class',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='assignments',
    )
    teacher = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.CASCADE,
        related_name='assignments',
    )

    title = models.CharField(max_length=200)
    description = models.TextField()
    instructions = models.TextField(blank=True)

    assignment_type = models.CharField(
        max_length=10,
        choices=AssignmentType.choices,
        default=AssignmentType.HOMEWORK,
    )
    due_date = models.DateTimeField()
    total_marks = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    attachments_allowed = models.BooleanField(default=True)

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-due_date', '-id']
        verbose_name = 'Assignment'
        verbose_name_plural = 'Assignments'

    def __str__(self):
        return f"{self.title} - {self.class_obj.name} (due {self.due_date:%Y-%m-%d})"

    def get_submission_count(self):
        return self.submissions.count()


class AssignmentAttachment(models.Model):
    """File attachment associated with an assignment."""

    class AttachmentType(models.TextChoices):
        DOCUMENT = 'DOCUMENT', 'Document'
        IMAGE = 'IMAGE', 'Image'
        VIDEO = 'VIDEO', 'Video'
        LINK = 'LINK', 'Link'

    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    file_url = models.URLField()
    file_name = models.CharField(max_length=200)
    attachment_type = models.CharField(
        max_length=10,
        choices=AttachmentType.choices,
        default=AttachmentType.DOCUMENT,
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = 'Assignment Attachment'
        verbose_name_plural = 'Assignment Attachments'

    def __str__(self):
        return f"{self.file_name} ({self.assignment.title})"


class AssignmentSubmission(models.Model):
    """
    A student's submission for an assignment.
    Tracks submission content, grading status, marks, and feedback.
    """

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        SUBMITTED = 'SUBMITTED', 'Submitted'
        LATE = 'LATE', 'Late'
        GRADED = 'GRADED', 'Graded'
        RETURNED = 'RETURNED', 'Returned'

    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name='submissions',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='assignment_submissions',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='assignment_submissions',
    )

    submission_text = models.TextField(blank=True)
    file_url = models.URLField(blank=True)
    file_name = models.CharField(max_length=200, blank=True)

    submitted_at = models.DateTimeField(auto_now_add=True)

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.SUBMITTED,
    )
    marks_obtained = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    feedback = models.TextField(blank=True)
    graded_by = models.ForeignKey(
        'hr.StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='graded_submissions',
    )
    graded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('assignment', 'student')
        ordering = ['-submitted_at']
        verbose_name = 'Assignment Submission'
        verbose_name_plural = 'Assignment Submissions'

    def __str__(self):
        return f"{self.student.name} - {self.assignment.title} ({self.get_status_display()})"
