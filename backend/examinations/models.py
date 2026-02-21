from django.db import models


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
