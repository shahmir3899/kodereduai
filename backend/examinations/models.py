from django.db import models
from django.conf import settings


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
        unique_together = ('school', 'exam_type', 'class_obj', 'term')
        ordering = ['-start_date']
        indexes = [
            models.Index(fields=['school', 'academic_year']),
            models.Index(fields=['school', 'class_obj']),
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
    ESSAY = 'ESSAY', 'Essay'
    TRUE_FALSE = 'TRUE_FALSE', 'True/False'
    MATCHING = 'MATCHING', 'Matching'
    FILL_BLANK = 'FILL_BLANK', 'Fill in the Blanks'


class DifficultyLevel(models.TextChoices):
    """Difficulty levels for questions."""
    EASY = 'EASY', 'Easy'
    MEDIUM = 'MEDIUM', 'Medium'
    HARD = 'HARD', 'Hard'


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
    # Curriculum links
    tested_topics = models.ManyToManyField(
        'lms.Topic',
        blank=True,
        related_name='test_questions',
        help_text='Curriculum topics this question tests'
    )
    
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
        ]

    def __str__(self):
        preview = self.question_text[:50] + '...' if len(self.question_text) > 50 else self.question_text
        return f"Q:{preview} ({self.subject.name})"


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
                test_questions__paper_questions__exam_paper=self
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
    marks_override = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Override default marks for this specific paper"
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
