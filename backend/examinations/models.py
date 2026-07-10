from django.db import models
from django.conf import settings
from decimal import Decimal
from pgvector.django import VectorField


class ExamType(models.Model):
    """Defines exam categories for a school (e.g., Mid-Term, Final Exam)."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='exam_types',
    )
    name = models.CharField(max_length=100)
    weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=100.00,
        help_text="Weightage percentage for GPA calculation",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']

    def __str__(self):
        return self.name


class ExamGroup(models.Model):
    """Groups per-class Exam records created by the wizard."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='exam_groups',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        related_name='exam_groups',
    )
    term = models.ForeignKey(
        'academic_sessions.Term',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_groups',
    )
    exam_type = models.ForeignKey(
        ExamType,
        on_delete=models.CASCADE,
        related_name='exam_groups',
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name', 'academic_year')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'is_active']),
        ]

    def __str__(self):
        return self.name

    @property
    def active_exams(self):
        from django.db.models import Count, Q
        return self.exams.filter(is_active=True).select_related(
            'class_obj', 'exam_type', 'academic_year', 'term',
        ).annotate(
            subjects_count=Count('exam_subjects', filter=Q(exam_subjects__is_active=True)),
        )


class Exam(models.Model):
    """A specific exam instance for a class."""

    class Status(models.TextChoices):
        SCHEDULED = 'SCHEDULED', 'Scheduled'
        IN_PROGRESS = 'IN_PROGRESS', 'In Progress'
        MARKS_ENTRY = 'MARKS_ENTRY', 'Marks Entry'
        COMPLETED = 'COMPLETED', 'Completed'
        PUBLISHED = 'PUBLISHED', 'Published'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='exams',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        related_name='exams',
    )
    term = models.ForeignKey(
        'academic_sessions.Term',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exams',
    )
    exam_type = models.ForeignKey(
        ExamType,
        on_delete=models.CASCADE,
        related_name='exams',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='exams',
    )
    exam_group = models.ForeignKey(
        ExamGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='exams',
    )
    name = models.CharField(max_length=200)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.SCHEDULED,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date']
        indexes = [
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'class_obj']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'exam_group', 'class_obj'],
                condition=models.Q(exam_group__isnull=False),
                name='exam_group_class_unique',
            ),
        ]

    def __str__(self):
        return self.name


class ExamSubject(models.Model):
    """Subjects included in an exam with total/passing marks."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='exam_subjects',
    )
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        related_name='exam_subjects',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='exam_subjects',
    )
    total_marks = models.DecimalField(
        max_digits=6, decimal_places=2, default=100.00,
    )
    passing_marks = models.DecimalField(
        max_digits=6, decimal_places=2, default=33.00,
    )
    exam_date = models.DateField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'exam', 'subject')
        ordering = ['subject__name']
        indexes = [
            models.Index(fields=['exam', 'is_active']),
        ]

    def __str__(self):
        return f"{self.exam.name} - {self.subject.name}"


class StudentMark(models.Model):
    """Individual student marks for a subject in an exam."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_marks',
    )
    exam_subject = models.ForeignKey(
        ExamSubject,
        on_delete=models.CASCADE,
        related_name='student_marks',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='marks',
    )
    enrollment = models.ForeignKey(
        'academic_sessions.StudentEnrollment',
        on_delete=models.SET_NULL,
        related_name='student_marks',
        null=True,
        blank=True,
        help_text='Enrollment snapshot used for historical/session report accuracy',
    )
    marks_obtained = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Null means not entered yet",
    )
    is_absent = models.BooleanField(default=False)
    remarks = models.CharField(max_length=200, blank=True)
    ai_comment = models.TextField(
        blank=True,
        default='',
        help_text="AI-generated report card comment based on marks, grade, and attendance"
    )
    ai_comment_generated_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the AI comment was generated"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'exam_subject', 'student')
        ordering = ['student__roll_number']
        indexes = [
            models.Index(fields=['school', 'student']),
            models.Index(fields=['school', 'enrollment']),
        ]

    def __str__(self):
        return f"{self.student.name} - {self.exam_subject.subject.name}: {self.marks_obtained}"

    @property
    def percentage(self):
        if self.marks_obtained is None or self.is_absent:
            return None
        total = self.exam_subject.total_marks
        if total == 0:
            return 0
        return float(self.marks_obtained / total * 100)

    @property
    def is_pass(self):
        if self.marks_obtained is None or self.is_absent:
            return False
        return self.marks_obtained >= self.exam_subject.passing_marks


class GradeScale(models.Model):
    """School-specific grade scale for letter grade calculation."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='grade_scales',
    )
    grade_label = models.CharField(max_length=5, help_text="e.g. 'A+', 'A', 'B'")
    min_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    max_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    gpa_points = models.DecimalField(
        max_digits=3, decimal_places=1, default=0,
    )
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'grade_label')
        ordering = ['-min_percentage']

    def __str__(self):
        return f"{self.grade_label} ({self.min_percentage}%-{self.max_percentage}%)"


# ===========================================
# Question Paper Builder Models
# ===========================================


class QuestionType(models.TextChoices):
    """Question types for exam papers."""
    MCQ = 'MCQ', 'Multiple Choice'
    SHORT = 'SHORT', 'Short Answer'
    LONG = 'LONG', 'Long Answer'
    ESSAY = 'ESSAY', 'Essay'
    TRUE_FALSE = 'TRUE_FALSE', 'True/False'
    MATCHING = 'MATCHING', 'Matching'
    FILL_BLANK = 'FILL_BLANK', 'Fill in the Blanks'


class DifficultyLevel(models.TextChoices):
    """Difficulty levels for questions."""
    EASY = 'EASY', 'Easy'
    MEDIUM = 'MEDIUM', 'Medium'
    HARD = 'HARD', 'Hard'


BLOOM_LEVELS = [
    ('remember', 'Remember'),
    ('understand', 'Understand'),
    ('apply', 'Apply'),
    ('analyze', 'Analyze'),
    ('evaluate', 'Evaluate'),
    ('create', 'Create'),
]


class Question(models.Model):
    """Question bank for exam papers."""

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='questions',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='questions',
    )
    exam_type = models.ForeignKey(
        ExamType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='questions',
        help_text="Optional: Link to exam type (e.g., Mid-Term, Final)"
    )
    question_text = models.TextField(
        help_text="The question text (supports HTML from rich editor)"
    )
    question_image_url = models.URLField(
        max_length=500,
        blank=True,
        null=True,
        help_text="Optional: URL for diagrams, charts, or images"
    )
    question_type = models.CharField(
        max_length=20,
        choices=QuestionType.choices,
        default=QuestionType.SHORT,
    )
    difficulty_level = models.CharField(
        max_length=10,
        choices=DifficultyLevel.choices,
        default=DifficultyLevel.MEDIUM,
    )
    embedding = VectorField(dimensions=1536, null=True, blank=True)
    bloom_level = models.CharField(
        max_length=20,
        choices=BLOOM_LEVELS,
        null=True,
        blank=True,
    )
    marks = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=1.00,
        help_text="Default marks for this question"
    )
    # MCQ-specific fields
    option_a = models.TextField(blank=True, default='')
    option_b = models.TextField(blank=True, default='')
    option_c = models.TextField(blank=True, default='')
    option_d = models.TextField(blank=True, default='')
    correct_answer = models.CharField(
        max_length=250,
        blank=True,
        help_text="For MCQ: A/B/C/D. For others: answer key text"
    )
    answer_text = models.TextField(
        blank=True,
        default='',
        help_text='Long-form expected answer/model answer for subjective questions',
    )
    type_data = models.JSONField(
        blank=True,
        default=dict,
        help_text='Type-specific payload, e.g. matching pairs, blanks, rubrics',
    )
    # Curriculum links
    tested_topics = models.ManyToManyField(
        'lms.Topic',
        blank=True,
        related_name='test_questions',
        help_text='Curriculum topics this question tests'
    )

    source_content_block = models.ForeignKey(
        'lms.ContentBlock',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_questions',
    )
    paper_use_count = models.IntegerField(default=0)
    last_used_in = models.ForeignKey(
        'ExamPaper',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='last_used_questions',
    )
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_ai_generated = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_questions',
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    
    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_questions',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'subject']),
            models.Index(fields=['school', 'is_active']),
            models.Index(fields=['difficulty_level']),
            models.Index(fields=['question_type']),
            models.Index(fields=['school', 'subject', 'question_type', 'difficulty_level']),
            models.Index(fields=['school', 'subject', 'is_active']),
        ]

    def __str__(self):
        preview = self.question_text[:50] + '...' if len(self.question_text) > 50 else self.question_text
        return f"Q:{preview} ({self.subject.name})"

    def build_snapshot(self):
        """Return a JSON-safe snapshot of question content for paper rendering/export."""
        topics = self.tested_topics.select_related('chapter', 'chapter__book').all()
        return {
            'question_id': self.id,
            'subject_id': self.subject_id,
            'question_text': self.question_text,
            'question_image_url': self.question_image_url,
            'question_type': self.question_type,
            'difficulty_level': self.difficulty_level,
            'marks': str(self.marks),
            'option_a': self.option_a,
            'option_b': self.option_b,
            'option_c': self.option_c,
            'option_d': self.option_d,
            'correct_answer': self.correct_answer,
            'answer_text': self.answer_text,
            'type_data': self.type_data or {},
            'tested_topics': [topic.id for topic in topics],
            'tested_topics_details': [
                {
                    'id': topic.id,
                    'title': topic.title,
                    'chapter_number': topic.chapter.chapter_number,
                    'topic_number': topic.topic_number,
                    'chapter_title': topic.chapter.title,
                    'book_title': topic.chapter.book.title,
                }
                for topic in topics
            ],
        }


class QuestionRevision(models.Model):
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='revisions',
    )
    question_text = models.TextField()
    snapshot = models.JSONField()
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='question_revisions',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-changed_at', '-id']

    def __str__(self):
        return f"Revision {self.id} for question {self.question_id}"


class ExamPaper(models.Model):
    """A complete exam paper with multiple questions."""

    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        READY = 'READY', 'Ready'
        PUBLISHED = 'PUBLISHED', 'Published'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='exam_papers',
    )
    exam = models.ForeignKey(
        Exam,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_papers',
        help_text="Optional: Link to exam lifecycle"
    )
    exam_subject = models.ForeignKey(
        ExamSubject,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exam_papers',
        help_text="Link to specific exam subject"
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='exam_papers',
    )
    subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.CASCADE,
        related_name='exam_papers',
    )
    paper_title = models.CharField(
        max_length=250,
        help_text="e.g., 'Physics Mid-Term Exam 2026'"
    )
    instructions = models.TextField(
        blank=True,
        help_text="General instructions for students"
    )
    structure = models.JSONField(
        blank=True,
        default=list,
        help_text='List of paper section dicts used for rendering/choices.',
    )
    render_options = models.JSONField(
        blank=True,
        default=dict,
        help_text='Paper render options (e.g., answer_lines).',
    )
    total_marks = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=100.00,
    )
    duration_minutes = models.PositiveIntegerField(
        default=60,
        help_text="Duration in minutes"
    )
    questions = models.ManyToManyField(
        Question,
        through='PaperQuestion',
        related_name='exam_papers',
    )
    # Curriculum alignment
    lesson_plans = models.ManyToManyField(
        'lms.LessonPlan',
        blank=True,
        related_name='exam_papers',
        help_text='Lesson plans whose content is tested in this paper'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_papers',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'class_obj']),
            models.Index(fields=['school', 'subject']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"{self.paper_title} ({self.class_obj.name})"

    @property
    def question_count(self):
        """Total number of questions in the paper."""
        return self.paper_questions.count()

    @property
    def calculated_total_marks(self):
        """Sum of marks from all questions."""
        from django.db.models import Sum
        result = self.paper_questions.aggregate(
            total=Sum('marks_override')
        )
        return result['total'] or 0

    @property
    def structure_marks_total(self):
        """Sum of slots_counted * marks_per_question from structure sections."""
        total = Decimal('0')
        sections = self.structure if isinstance(self.structure, list) else []
        for section in sections:
            if not isinstance(section, dict):
                continue
            if str(section.get('type', 'question_group')).lower() == 'divider':
                continue
            slots_counted_raw = section.get('slots_counted', section.get('slots_shown', 0))
            marks_raw = section.get('marks_per_question', 0)
            try:
                slots_counted = int(slots_counted_raw)
            except (TypeError, ValueError):
                slots_counted = 0
            try:
                marks_per_question = Decimal(str(marks_raw))
            except Exception:
                marks_per_question = Decimal('0')
            total += Decimal(slots_counted) * marks_per_question
        return total

    @property
    def covered_topics(self):
        """Get all unique topics tested via questions in this paper."""
        from lms.models import Topic
        question_ids = self.paper_questions.values_list('question_id', flat=True)
        return Topic.objects.filter(
            test_questions__id__in=question_ids
        ).select_related('chapter', 'chapter__book').distinct()
    
    @property
    def question_topics_summary(self):
        """Summary: {topic_id: question_count} for this paper."""
        from django.db.models import Count, Q
        from lms.models import Topic, models as lms_models
        topics_qs = self.covered_topics.annotate(
            question_count=Count('test_questions', filter=Q(
                test_questions__paper_assignments__exam_paper=self
            ))
        )
        return {
            t.id: {
                'title': f"{t.chapter.chapter_number}.{t.topic_number}: {t.title}",
                'question_count': t.question_count
            }
            for t in topics_qs
        }


class PaperQuestion(models.Model):
    """Through model for ordering questions in an exam paper."""

    exam_paper = models.ForeignKey(
        ExamPaper,
        on_delete=models.CASCADE,
        related_name='paper_questions',
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='paper_assignments',
    )
    question_order = models.PositiveIntegerField(
        help_text="Display order in the paper (1, 2, 3...)"
    )
    section_key = models.CharField(max_length=50, blank=True, default='')
    marks_override = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Override default marks for this specific paper"
    )
    question_snapshot = models.JSONField(
        blank=True,
        default=dict,
        help_text='Frozen copy of the question at the time it was attached or saved into the paper.',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('exam_paper', 'question')
        ordering = ['question_order']
        indexes = [
            models.Index(fields=['exam_paper', 'question_order']),
        ]

    def __str__(self):
        return f"{self.exam_paper.paper_title} - Q{self.question_order}"

    def get_marks(self):
        """Return override marks or default question marks."""
        return self.marks_override if self.marks_override is not None else self.question.marks

    def build_question_snapshot(self):
        """Build a snapshot payload from the linked question."""
        def _decimal_str(value):
            if value is None:
                return None
            return f"{Decimal(value):.2f}"

        snapshot = self.question.build_snapshot()
        snapshot.update({
            'question_order': self.question_order,
            'marks_override': _decimal_str(self.marks_override),
            'effective_marks': _decimal_str(self.get_marks()),
        })
        return snapshot

    def sync_question_snapshot(self, save=True):
        """Refresh the stored question snapshot from the current linked question."""
        self.question_snapshot = self.build_question_snapshot()
        if save:
            self.save(update_fields=['question_snapshot'])
        return self.question_snapshot

    def get_question_data(self):
        """Return snapshot data when available, else live question data."""
        if self.question_snapshot:
            return self.question_snapshot
        return self.build_question_snapshot()


class StudentResponse(models.Model):
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='question_responses',
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='student_responses',
    )
    exam_paper = models.ForeignKey(
        ExamPaper,
        on_delete=models.CASCADE,
        related_name='student_responses',
    )
    response_text = models.TextField(blank=True)
    marks_awarded = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    is_correct = models.BooleanField(null=True, blank=True)
    time_taken_seconds = models.IntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('student', 'question', 'exam_paper')
        ordering = ['-submitted_at', '-id']
        indexes = [
            models.Index(fields=['exam_paper', 'student']),
            models.Index(fields=['question', 'submitted_at']),
        ]

    def __str__(self):
        return f"Response {self.id} for question {self.question_id}"


class QuestionStats(models.Model):
    question = models.OneToOneField(
        Question,
        on_delete=models.CASCADE,
        related_name='stats',
    )
    attempt_count = models.IntegerField(default=0)
    correct_count = models.IntegerField(default=0)
    avg_time_seconds = models.FloatField(null=True, blank=True)
    real_difficulty = models.FloatField(null=True, blank=True)
    last_computed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['question_id']

    def __str__(self):
        return f"Stats for question {self.question_id}"


class PaperUpload(models.Model):
    """Stores uploaded images of handwritten papers for OCR processing."""

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PROCESSING = 'PROCESSING', 'Processing'
        EXTRACTED = 'EXTRACTED', 'Extracted'
        REVIEWED = 'REVIEWED', 'Reviewed'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        FAILED = 'FAILED', 'Failed'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='paper_uploads',
    )
    exam_paper = models.ForeignKey(
        ExamPaper,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploads',
        help_text="Linked after confirmation"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paper_uploads',
    )
    image_url = models.URLField(
        max_length=500,
        help_text="Supabase storage URL"
    )
    context_class = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paper_uploads',
        help_text="Uploader's optional class context; final selection always happens in the UI.",
    )
    context_subject = models.ForeignKey(
        'academics.Subject',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paper_uploads',
        help_text="Uploader's optional subject context; final selection always happens in the UI.",
    )
    ai_extracted_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Structured questions extracted by AI"
    )
    extraction_confidence = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Overall confidence score (0-100)"
    )
    extraction_notes = models.TextField(
        blank=True,
        help_text="AI notes about extraction quality"
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['uploaded_by', 'status']),
        ]

    def __str__(self):
        return f"Upload by {self.uploaded_by} - {self.status}"


class PaperFeedback(models.Model):
    """Tracks corrections made to OCR extractions for learning loop."""

    paper_upload = models.ForeignKey(
        PaperUpload,
        on_delete=models.CASCADE,
        related_name='feedback',
    )
    ai_extracted_json = models.JSONField(
        help_text="Original AI extraction"
    )
    user_confirmed_json = models.JSONField(
        help_text="User's corrected version"
    )
    accuracy_metrics = models.JSONField(
        null=True,
        blank=True,
        help_text="Calculated accuracy scores"
    )
    correction_notes = models.TextField(
        blank=True,
        help_text="Optional notes about corrections"
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['paper_upload']),
        ]

    def __str__(self):
        return f"Feedback for Upload #{self.paper_upload.id}"


class StudentTermAssessment(models.Model):
    """
    Teacher-entered skills/behaviour ratings and remarks for a student,
    scoped to an academic year. Feeds the Skills Assessment, Behaviour
    Evaluation, and Remarks sections of the comprehensive student report.
    """

    class Rating(models.IntegerChoices):
        NEEDS_IMPROVEMENT = 1, 'Needs Improvement'
        FAIR = 2, 'Fair'
        GOOD = 3, 'Good'
        VERY_GOOD = 4, 'Very Good'
        EXCELLENT = 5, 'Excellent'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_term_assessments',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='term_assessments',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        related_name='student_term_assessments',
    )
    term = models.ForeignKey(
        'academic_sessions.Term',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='student_term_assessments',
        help_text='Optional finer scope; left blank for a whole-year assessment',
    )

    # Skills
    listening = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    speaking = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    writing = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    reading = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    participation = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    confidence = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    social_skills = models.IntegerField(choices=Rating.choices, null=True, blank=True)

    # Behaviour
    discipline = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    respect = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    teamwork = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    class_participation = models.IntegerField(choices=Rating.choices, null=True, blank=True)
    responsibility = models.IntegerField(choices=Rating.choices, null=True, blank=True)

    teacher_remark = models.TextField(blank=True)
    principal_remark = models.TextField(blank=True)

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('student', 'academic_year', 'term')
        ordering = ['-updated_at']
        verbose_name = 'Student Term Assessment'
        verbose_name_plural = 'Student Term Assessments'

    def __str__(self):
        return f"Assessment for {self.student.name} - {self.academic_year}"
