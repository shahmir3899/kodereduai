import uuid
from django.conf import settings
from django.db import models
from pgvector.django import VectorField


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
    page_start = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Optional first page for this chapter in the source book',
    )
    page_end = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Optional last page for this chapter in the source book',
    )
    description = models.TextField(blank=True)
    content_blocks = models.JSONField(
        default=list,
        blank=True,
        help_text='Structured rich content blocks for chapter-level notes',
    )
    content_text = models.TextField(
        blank=True,
        help_text='Flattened plain text derived from content blocks for search/prompting',
    )
    content_blocks_schema_version = models.PositiveSmallIntegerField(
        default=1,
        help_text='Schema version of content_blocks payload',
    )
    content_version = models.PositiveIntegerField(
        default=1,
        help_text='Monotonic content revision number for chapter content',
    )
    needs_migration = models.BooleanField(
        default=False,
        help_text='True when stored content blocks require schema migration',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('book', 'chapter_number')
        ordering = ['chapter_number']
        verbose_name = 'Chapter'
        verbose_name_plural = 'Chapters'
        indexes = [
            models.Index(fields=['book', 'chapter_number']),
            models.Index(fields=['book', 'page_start']),
        ]

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
    page_start = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Optional first page for this topic in the source book',
    )
    page_end = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Optional last page for this topic in the source book',
    )
    content_kind = models.CharField(
        max_length=20,
        default='general',
        help_text='Primary classification for topic content (for example general or exercise)',
    )
    description = models.TextField(blank=True)
    content_blocks = models.JSONField(
        default=list,
        blank=True,
        help_text='Structured rich content blocks for topic details',
    )
    content_text = models.TextField(
        blank=True,
        help_text='Flattened plain text derived from content blocks for search/prompting',
    )
    content_blocks_schema_version = models.PositiveSmallIntegerField(
        default=1,
        help_text='Schema version of content_blocks payload',
    )
    content_version = models.PositiveIntegerField(
        default=1,
        help_text='Monotonic content revision number for topic content',
    )
    needs_migration = models.BooleanField(
        default=False,
        help_text='True when stored content blocks require schema migration',
    )
    estimated_periods = models.PositiveIntegerField(
        default=1,
        help_text='Estimated teaching periods needed',
    )
    embedding = VectorField(dimensions=1536, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('chapter', 'topic_number')
        ordering = ['topic_number']
        verbose_name = 'Topic'
        verbose_name_plural = 'Topics'
        indexes = [
            models.Index(fields=['chapter', 'topic_number']),
            models.Index(fields=['chapter', 'page_start']),
            models.Index(fields=['content_kind']),
        ]

    def __str__(self):
        return f"{self.chapter.chapter_number}.{self.topic_number}: {self.title}"

    @property
    def is_covered(self):
        """Check if this topic has any lesson plans linked."""
        return self.lesson_plans.filter(is_active=True).exists()
    
    @property
    def is_tested(self):
        """Check if this topic has any test questions."""
        return self.test_questions.filter(is_active=True).exists()
    
    @property
    def test_question_count(self):
        """Count of active test questions for this topic."""
        return self.test_questions.filter(is_active=True).count()
    
    @property
    def lesson_plan_count(self):
        """Count of lesson plans covering this topic."""
        return self.lesson_plans.filter(is_active=True).count()


class SubTopic(models.Model):
    """Fine-grained unit under a topic (e.g. section or activity) for lesson planning."""

    topic = models.ForeignKey(
        Topic,
        on_delete=models.CASCADE,
        related_name='subtopics',
    )
    title = models.CharField(max_length=300)
    subtopic_number = models.PositiveIntegerField(
        help_text='Ordering within the parent topic (1, 2, 3…)',
    )
    description = models.TextField(blank=True)
    content_text = models.TextField(blank=True)
    content_blocks_json = models.JSONField(null=True, blank=True)
    content_schema_version = models.CharField(max_length=10, default='1.0')
    estimated_minutes = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('topic', 'subtopic_number')
        ordering = ['subtopic_number']
        verbose_name = 'Sub-topic'
        verbose_name_plural = 'Sub-topics'

    def __str__(self):
        return f"{self.topic.chapter.chapter_number}.{self.topic.topic_number}.{self.subtopic_number}: {self.title}"


class ContentBlock(models.Model):
    """Relational curriculum content block linked to chapter/topic/subtopic hierarchy."""

    class BlockType(models.TextChoices):
        TEXT = 'text', 'Text Paragraph'
        DEFINITION = 'definition', 'Definition'
        EXAMPLE = 'example', 'Worked Example'
        EXERCISE = 'exercise', 'Exercise'
        FORMULA = 'formula', 'Formula / Equation'
        DIAGRAM_DESC = 'diagram_desc', 'Diagram Description'
        SUMMARY = 'summary', 'Summary'
        KEY_POINT = 'key_point', 'Key Point'

    # Hierarchy: at least one of chapter/topic/subtopic must be set.
    chapter = models.ForeignKey(
        Chapter,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='content_blocks_rel',
    )
    topic = models.ForeignKey(
        Topic,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='content_blocks_rel',
    )
    subtopic = models.ForeignKey(
        SubTopic,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='content_blocks_rel',
    )

    block_type = models.CharField(
        max_length=30,
        choices=BlockType.choices,
        default=BlockType.TEXT,
    )
    content_text = models.TextField()
    content_rich = models.JSONField(null=True, blank=True)
    sequence_order = models.PositiveIntegerField(default=0)
    difficulty_level = models.IntegerField(null=True, blank=True)
    estimated_minutes = models.IntegerField(null=True, blank=True)
    embedding = VectorField(dimensions=1536, null=True, blank=True)

    is_ai_generated = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sequence_order']
        constraints = [
            models.CheckConstraint(
                name='content_block_has_parent',
                condition=(
                    models.Q(chapter__isnull=False)
                    | models.Q(topic__isnull=False)
                    | models.Q(subtopic__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        return f"{self.block_type} | {self.content_text[:60]}"


class ContentRevision(models.Model):
    content_block = models.ForeignKey(
        ContentBlock,
        on_delete=models.CASCADE,
        related_name='revisions',
    )
    content_text = models.TextField()
    content_rich = models.JSONField(null=True, blank=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='content_revisions',
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    revision_note = models.TextField(blank=True)

    class Meta:
        ordering = ['-changed_at', '-id']

    def __str__(self):
        return f"Revision {self.id} for block {self.content_block_id}"


class Tag(models.Model):
    class TagType(models.TextChoices):
        CONCEPT = 'concept', 'Concept'
        SKILL = 'skill', 'Skill'
        KEYWORD = 'keyword', 'Keyword'
        STANDARD = 'standard', 'Curriculum Standard'

    name = models.CharField(max_length=100, unique=True)
    tag_type = models.CharField(max_length=20, choices=TagType.choices)
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='curriculum_tags',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='curriculum_tags',
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ContentBlockTag(models.Model):
    content_block = models.ForeignKey(
        ContentBlock,
        on_delete=models.CASCADE,
        related_name='content_block_tags',
    )
    tag = models.ForeignKey(
        Tag,
        on_delete=models.CASCADE,
        related_name='content_block_tags',
    )

    class Meta:
        unique_together = ('content_block', 'tag')


class QuestionTag(models.Model):
    question = models.ForeignKey(
        'examinations.Question',
        on_delete=models.CASCADE,
        related_name='question_tags',
    )
    tag = models.ForeignKey(
        Tag,
        on_delete=models.CASCADE,
        related_name='question_tags',
    )

    class Meta:
        unique_together = ('question', 'tag')


OBJECTIVE_BLOOM_LEVELS = [
    ('remember', 'Remember'),
    ('understand', 'Understand'),
    ('apply', 'Apply'),
    ('analyze', 'Analyze'),
    ('evaluate', 'Evaluate'),
    ('create', 'Create'),
]


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
    planned_subtopics = models.ManyToManyField(
        'lms.SubTopic',
        blank=True,
        related_name='lesson_plans',
        help_text='Optional finer curriculum units linked to this lesson',
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
        """Build pre-formatted text from planned topics and sub-topics, grouped by chapter."""
        if not self.pk:
            return ''
        topics = list(
            self.planned_topics.select_related('chapter', 'chapter__book').order_by(
                'chapter__chapter_number', 'topic_number',
            ),
        )
        subtopics = list(
            self.planned_subtopics.select_related('topic', 'topic__chapter').order_by(
                'topic__chapter__chapter_number', 'topic__topic_number', 'subtopic_number',
            ),
        )
        if not topics and not subtopics:
            return ''
        subs_by_topic = {}
        for st in subtopics:
            subs_by_topic.setdefault(st.topic_id, []).append(st)
        lines = []
        current_chapter = None
        for t in topics:
            if t.chapter_id != (current_chapter and current_chapter.id):
                current_chapter = t.chapter
                lines.append(f"Ch {t.chapter.chapter_number}: {t.chapter.title}")
            lines.append(f"  {t.chapter.chapter_number}.{t.topic_number} {t.title}")
            for st in subs_by_topic.get(t.id, ()):
                lines.append(f"      · {st.title}")
        self.display_text = '\n'.join(lines)
        self.save(update_fields=['display_text'])
        return self.display_text


class LearningObjective(models.Model):
    topic = models.ForeignKey(
        Topic,
        on_delete=models.CASCADE,
        related_name='objectives',
    )
    statement = models.TextField()
    bloom_level = models.CharField(max_length=20, choices=OBJECTIVE_BLOOM_LEVELS)
    is_ai_generated = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['topic_id', 'id']

    def __str__(self):
        return self.statement[:80]


class LessonPlanObjective(models.Model):
    lesson_plan = models.ForeignKey(
        LessonPlan,
        on_delete=models.CASCADE,
        related_name='lesson_objectives',
    )
    objective = models.ForeignKey(
        LearningObjective,
        on_delete=models.CASCADE,
        related_name='lesson_links',
    )

    class Meta:
        unique_together = ('lesson_plan', 'objective')


class CurriculumStandard(models.Model):
    name = models.CharField(max_length=100)
    country = models.CharField(max_length=50, default='Pakistan')
    board = models.CharField(max_length=100)

    class Meta:
        ordering = ['name', 'board']

    def __str__(self):
        return f'{self.name} ({self.board})'


class StandardObjective(models.Model):
    standard = models.ForeignKey(
        CurriculumStandard,
        on_delete=models.CASCADE,
        related_name='objectives',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='standard_objectives',
    )
    grade = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='standard_objectives',
    )
    code = models.CharField(max_length=30)
    statement = models.TextField()

    class Meta:
        ordering = ['code']
        unique_together = ('standard', 'subject', 'grade', 'code')

    def __str__(self):
        return self.code


class TopicStandardAlignment(models.Model):
    topic = models.ForeignKey(
        Topic,
        on_delete=models.CASCADE,
        related_name='standard_alignments',
    )
    objective = models.ForeignKey(
        StandardObjective,
        on_delete=models.CASCADE,
        related_name='topic_alignments',
    )

    class Meta:
        unique_together = ('topic', 'objective')


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
        DIARY = 'DIARY', 'Diary'
        PROJECT = 'PROJECT', 'Project'
        CLASSWORK = 'CLASSWORK', 'Classwork'
        LAB = 'LAB', 'Lab'

    # Types that never require student submission (read-only for students)
    READONLY_TYPES = {AssignmentType.DIARY}

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
    # DIARY entries are read-only; other types allow submissions by default.
    # Teachers can turn off submission for HOMEWORK/CLASSWORK/LAB individually.
    requires_submission = models.BooleanField(
        default=True,
        help_text='Whether students can submit work for this assignment. Always False for DIARY.',
    )
    due_date = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Required for submission-based types. Optional for DIARY.',
    )
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
        due = f' (due {self.due_date:%Y-%m-%d})' if self.due_date else ''
        return f"{self.title} - {self.class_obj.name}{due}"

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


class TOCImportJob(models.Model):
    """Background job state for OCR-based TOC extraction."""

    class Status(models.TextChoices):
        QUEUED = 'QUEUED', 'Queued'
        PROCESSING = 'PROCESSING', 'Processing'
        SUCCEEDED = 'SUCCEEDED', 'Succeeded'
        FAILED = 'FAILED', 'Failed'
        TIMED_OUT = 'TIMED_OUT', 'Timed Out'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='toc_import_jobs',
    )
    book = models.ForeignKey(
        Book,
        on_delete=models.CASCADE,
        related_name='toc_import_jobs',
    )
    requested_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='toc_import_jobs',
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)
    image_file_name = models.CharField(max_length=255, blank=True)
    image_content_type = models.CharField(max_length=100, blank=True)
    image_size_bytes = models.PositiveIntegerField(default=0)
    image_payload_b64 = models.TextField(blank=True, help_text='Base64-encoded image payload for worker processing')
    result_payload = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['book', 'created_at']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f"TOC Job {self.id} ({self.status})"
