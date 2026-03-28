from rest_framework import serializers
from .models import (
    ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale,
    Question, ExamPaper, PaperQuestion, PaperUpload, PaperFeedback
)


# ── ExamType ──────────────────────────────────────────────────

class ExamTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamType
        fields = [
            'id', 'school', 'name', 'weight',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class ExamTypeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamType
        fields = ['name', 'weight']

    def validate_name(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = ExamType.objects.filter(school_id=school_id, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('An exam type with this name already exists.')
        return value


# ── Exam ──────────────────────────────────────────────────────

class ExamSerializer(serializers.ModelSerializer):
    exam_type_name = serializers.CharField(source='exam_type.name', read_only=True)
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True)
    term_name = serializers.CharField(source='term.name', read_only=True, default=None)
    subjects_count = serializers.IntegerField(read_only=True, default=0)
    exam_group = serializers.PrimaryKeyRelatedField(read_only=True)
    exam_group_name = serializers.CharField(source='exam_group.name', read_only=True, default=None)

    class Meta:
        model = Exam
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'term', 'term_name', 'exam_type', 'exam_type_name',
            'class_obj', 'class_name', 'exam_group', 'exam_group_name',
            'name', 'start_date', 'end_date', 'status', 'subjects_count',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class ExamCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exam
        fields = [
            'academic_year', 'term', 'exam_type', 'class_obj',
            'name', 'start_date', 'end_date', 'status',
        ]

    def validate(self, data):
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] > data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be on or after start date.'}
                )
        # Check unique_together (school, exam_type, class_obj, term)
        school_id = self.context.get('school_id')
        exam_type = data.get('exam_type')
        class_obj = data.get('class_obj')
        term = data.get('term')
        if school_id and exam_type and class_obj and term:
            qs = Exam.objects.filter(
                school_id=school_id, exam_type=exam_type,
                class_obj=class_obj, term=term,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'An exam already exists for this type, class, and term.'
                )
        return data


# ── ExamSubject ───────────────────────────────────────────────

class ExamSubjectSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    subject_code = serializers.CharField(source='subject.code', read_only=True)
    exam_name = serializers.CharField(source='exam.name', read_only=True)

    class Meta:
        model = ExamSubject
        fields = [
            'id', 'school', 'exam', 'exam_name',
            'subject', 'subject_name', 'subject_code',
            'total_marks', 'passing_marks', 'exam_date',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class ExamSubjectCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamSubject
        fields = ['exam', 'subject', 'total_marks', 'passing_marks', 'exam_date']

    def validate(self, data):
        if data.get('passing_marks') and data.get('total_marks'):
            if data['passing_marks'] > data['total_marks']:
                raise serializers.ValidationError(
                    {'passing_marks': 'Passing marks cannot exceed total marks.'}
                )
        school_id = self.context.get('school_id')
        exam = data.get('exam')
        subject = data.get('subject')
        if school_id and exam and subject:
            qs = ExamSubject.objects.filter(
                school_id=school_id, exam=exam, subject=subject,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'This subject is already added to the exam.'
                )
        return data


# ── StudentMark ───────────────────────────────────────────────

class StudentMarkSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(source='student.roll_number', read_only=True)
    subject_name = serializers.CharField(source='exam_subject.subject.name', read_only=True)
    total_marks = serializers.DecimalField(
        source='exam_subject.total_marks', read_only=True,
        max_digits=6, decimal_places=2,
    )
    passing_marks = serializers.DecimalField(
        source='exam_subject.passing_marks', read_only=True,
        max_digits=6, decimal_places=2,
    )
    percentage = serializers.FloatField(read_only=True)
    is_pass = serializers.BooleanField(read_only=True)

    class Meta:
        model = StudentMark
        fields = [
            'id', 'school', 'exam_subject', 'student', 'enrollment',
            'student_name', 'student_roll_number',
            'subject_name', 'total_marks', 'passing_marks',
            'marks_obtained', 'is_absent', 'remarks',
            'percentage', 'is_pass',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class StudentMarkCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentMark
        fields = ['exam_subject', 'student', 'marks_obtained', 'is_absent', 'remarks']

    def validate(self, data):
        exam_subject = data.get('exam_subject')
        marks = data.get('marks_obtained')
        if marks is not None and exam_subject:
            if marks < 0:
                raise serializers.ValidationError(
                    {'marks_obtained': 'Marks cannot be negative.'}
                )
            if marks > exam_subject.total_marks:
                raise serializers.ValidationError(
                    {'marks_obtained': f'Marks cannot exceed total marks ({exam_subject.total_marks}).'}
                )
        # Check unique_together (school, exam_subject, student)
        school_id = self.context.get('school_id')
        student = data.get('student')
        if school_id and exam_subject and student and not self.instance:
            if StudentMark.objects.filter(
                school_id=school_id, exam_subject=exam_subject, student=student,
            ).exists():
                raise serializers.ValidationError(
                    'A mark already exists for this student and exam subject.'
                )
        return data

    def _resolve_enrollment(self, exam_subject, student):
        from academic_sessions.models import StudentEnrollment

        return StudentEnrollment.objects.filter(
            school_id=exam_subject.school_id,
            student=student,
            academic_year_id=exam_subject.exam.academic_year_id,
            class_obj_id=exam_subject.exam.class_obj_id,
        ).order_by('-is_active', '-created_at').first()

    def create(self, validated_data):
        exam_subject = validated_data['exam_subject']
        student = validated_data['student']
        enrollment = self._resolve_enrollment(exam_subject, student)
        if enrollment:
            validated_data['enrollment'] = enrollment
        return super().create(validated_data)

    def update(self, instance, validated_data):
        exam_subject = validated_data.get('exam_subject', instance.exam_subject)
        student = validated_data.get('student', instance.student)
        enrollment = self._resolve_enrollment(exam_subject, student)
        instance.enrollment = enrollment
        return super().update(instance, validated_data)


class StudentMarkBulkEntrySerializer(serializers.Serializer):
    exam_subject_id = serializers.IntegerField()
    marks = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of {student_id, marks_obtained, is_absent, remarks}",
    )


# ── GradeScale ────────────────────────────────────────────────

class GradeScaleSerializer(serializers.ModelSerializer):
    class Meta:
        model = GradeScale
        fields = [
            'id', 'school', 'grade_label',
            'min_percentage', 'max_percentage', 'gpa_points',
            'order', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class GradeScaleCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = GradeScale
        fields = ['grade_label', 'min_percentage', 'max_percentage', 'gpa_points', 'order']

    def validate_grade_label(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = GradeScale.objects.filter(school_id=school_id, grade_label=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('A grade with this label already exists.')
        return value

    def validate(self, data):
        if data.get('min_percentage') is not None and data.get('max_percentage') is not None:
            if data['min_percentage'] > data['max_percentage']:
                raise serializers.ValidationError(
                    {'min_percentage': 'Min percentage cannot exceed max percentage.'}
                )
        return data


# ── ExamGroup ────────────────────────────────────────────────

class ExamGroupSerializer(serializers.ModelSerializer):
    exam_type_name = serializers.CharField(source='exam_type.name', read_only=True)
    exam_type_weight = serializers.DecimalField(
        source='exam_type.weight', read_only=True, max_digits=5, decimal_places=2,
    )
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True)
    term_name = serializers.CharField(source='term.name', read_only=True, default=None)
    classes_count = serializers.IntegerField(read_only=True, default=0)
    exams = ExamSerializer(many=True, read_only=True, source='_prefetched_active_exams')

    class Meta:
        model = ExamGroup
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'term', 'term_name', 'exam_type', 'exam_type_name', 'exam_type_weight',
            'name', 'description', 'start_date', 'end_date',
            'classes_count', 'exams',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class ExamGroupCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamGroup
        fields = ['academic_year', 'term', 'exam_type', 'name', 'description', 'start_date', 'end_date']

    def validate(self, data):
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] > data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be on or after start date.'}
                )
        school_id = self.context.get('school_id')
        if school_id:
            qs = ExamGroup.objects.filter(
                school_id=school_id, name=data['name'],
                academic_year=data['academic_year'],
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'An exam group with this name already exists for this academic year.'
                )
        return data


class ExamGroupWizardCreateSerializer(serializers.Serializer):
    """Accepts group details + class IDs for the wizard-create action."""
    academic_year = serializers.IntegerField()
    term = serializers.IntegerField(required=False, allow_null=True)
    exam_type = serializers.IntegerField()
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    class_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1,
    )
    default_total_marks = serializers.DecimalField(
        max_digits=6, decimal_places=2, default=100.00, required=False,
    )
    default_passing_marks = serializers.DecimalField(
        max_digits=6, decimal_places=2, default=33.00, required=False,
    )
    date_sheet = serializers.DictField(
        child=serializers.DateField(), required=False, default=dict,
    )

    def validate(self, data):
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] > data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be on or after start date.'}
                )
        return data


class DateSheetUpdateSerializer(serializers.Serializer):
    """Bulk-update exam_date on ExamSubjects."""
    date_sheet = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of {exam_subject_id, exam_date} entries",
    )


# ===========================================
# Question Paper Builder Serializers
# ===========================================


class QuestionSerializer(serializers.ModelSerializer):
    """Serializer for Question model."""
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    exam_type_name = serializers.CharField(source='exam_type.name', read_only=True, allow_null=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, allow_null=True)
    
    # NEW: Curriculum topics - read-only expanded details + write support via list of IDs
    tested_topics_details = serializers.SerializerMethodField()
    
    def get_tested_topics_details(self, obj):
        """Return full topic details."""
        return [
            {
                'id': t.id,
                'title': t.title,
                'chapter_number': t.chapter.chapter_number,
                'topic_number': t.topic_number,
                'chapter_title': t.chapter.title,
                'book_title': t.chapter.book.title,
            }
            for t in obj.tested_topics.select_related('chapter', 'chapter__book').all()
        ]

    class Meta:
        model = Question
        fields = [
            'id', 'school', 'subject', 'subject_name', 'exam_type', 'exam_type_name',
            'question_text', 'question_image_url', 'question_type', 'difficulty_level',
            'marks', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
            'tested_topics_details',
            'created_by', 'created_by_name', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_by', 'created_by_name', 'created_at', 'updated_at', 'tested_topics_details']


class QuestionCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating questions."""

    class Meta:
        model = Question
        fields = [
            'subject', 'exam_type', 'question_text', 'question_image_url',
            'question_type', 'difficulty_level', 'marks',
            'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
        ]

    def validate(self, data):
        # If MCQ, ensure options are provided
        if data.get('question_type') == 'MCQ':
            if not all([data.get('option_a'), data.get('option_b')]):
                raise serializers.ValidationError(
                    'MCQ questions must have at least options A and B.'
                )
        return data


class PaperQuestionSerializer(serializers.ModelSerializer):
    """Serializer for PaperQuestion through model."""
    question_text = serializers.CharField(source='question.question_text', read_only=True)
    question_type = serializers.CharField(source='question.question_type', read_only=True)
    option_a = serializers.CharField(source='question.option_a', read_only=True)
    option_b = serializers.CharField(source='question.option_b', read_only=True)
    option_c = serializers.CharField(source='question.option_c', read_only=True)
    option_d = serializers.CharField(source='question.option_d', read_only=True)
    question_image_url = serializers.URLField(source='question.question_image_url', read_only=True, allow_null=True)
    marks = serializers.SerializerMethodField()

    class Meta:
        model = PaperQuestion
        fields = [
            'id', 'question', 'question_order', 'marks_override', 'marks',
            'question_text', 'question_type', 'option_a', 'option_b',
            'option_c', 'option_d', 'question_image_url', 'created_at',
        ]

    def get_marks(self, obj):
        """Return override marks or default question marks."""
        return obj.get_marks()


class ExamPaperSerializer(serializers.ModelSerializer):
    """Serializer for ExamPaper with nested questions."""
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    exam_name = serializers.CharField(source='exam.name', read_only=True, allow_null=True)
    generated_by_name = serializers.CharField(source='generated_by.username', read_only=True, allow_null=True)
    paper_questions = PaperQuestionSerializer(many=True, read_only=True)
    question_count = serializers.IntegerField(read_only=True)
    calculated_total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    
    # NEW: Curriculum alignment - read-only expanded details
    lesson_plans_details = serializers.SerializerMethodField()
    covered_topics = serializers.SerializerMethodField()
    question_topics_summary = serializers.SerializerMethodField()
    
    def get_lesson_plans_details(self, obj):
        """Return lesson plan details."""
        return [
            {
                'id': lp.id,
                'title': lp.title,
                'lesson_date': lp.lesson_date,
                'class': lp.class_obj.name,
                'subject': lp.subject.name,
            }
            for lp in obj.lesson_plans.select_related('class_obj', 'subject').all()
        ]
    
    def get_covered_topics(self, obj):
        """Topics tested via questions."""
        return [
            {
                'id': t.id,
                'chapter_number': t.chapter.chapter_number,
                'topic_number': t.topic_number,
                'title': t.title,
            }
            for t in obj.covered_topics
        ]
    
    def get_question_topics_summary(self, obj):
        """Question count per topic."""
        return obj.question_topics_summary

    class Meta:
        model = ExamPaper
        fields = [
            'id', 'school', 'exam', 'exam_name', 'exam_subject',
            'class_obj', 'class_name', 'subject', 'subject_name',
            'paper_title', 'instructions', 'total_marks', 'duration_minutes',
            'paper_questions', 'question_count', 'calculated_total_marks',
            'lesson_plans_details', 'covered_topics', 'question_topics_summary',
            'status', 'generated_by', 'generated_by_name',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'generated_by', 'generated_by_name', 'created_at', 'updated_at', 
                           'lesson_plans_details', 'covered_topics', 'question_topics_summary']


class ExamPaperCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating exam papers."""
    questions_data = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
        help_text="List of {question_id, question_order, marks_override}"
    )

    class Meta:
        model = ExamPaper
        fields = [
            'exam', 'exam_subject', 'class_obj', 'subject',
            'paper_title', 'instructions', 'total_marks',
            'duration_minutes', 'status', 'questions_data',
        ]

    def validate(self, data):
        # Ensure class and subject are consistent
        class_obj = data.get('class_obj')
        subject = data.get('subject')
        
        # If exam_subject is provided, validate it matches exam
        exam_subject = data.get('exam_subject')
        exam = data.get('exam')
        if exam_subject and exam:
            if exam_subject.exam != exam:
                raise serializers.ValidationError(
                    'ExamSubject must belong to the specified Exam.'
                )
        
        return data

    def create(self, validated_data):
        questions_data = validated_data.pop('questions_data', [])
        exam_paper = ExamPaper.objects.create(**validated_data)
        
        # Create PaperQuestion entries
        for q_data in questions_data:
            PaperQuestion.objects.create(
                exam_paper=exam_paper,
                question_id=q_data['question_id'],
                question_order=q_data.get('question_order', 1),
                marks_override=q_data.get('marks_override'),
            )
        
        return exam_paper

    def update(self, instance, validated_data):
        questions_data = validated_data.pop('questions_data', None)
        
        # Update basic fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        
        # Update questions if provided
        if questions_data is not None:
            # Clear existing questions
            instance.paper_questions.all().delete()
            # Create new ones
            for q_data in questions_data:
                PaperQuestion.objects.create(
                    exam_paper=instance,
                    question_id=q_data['question_id'],
                    question_order=q_data.get('question_order', 1),
                    marks_override=q_data.get('marks_override'),
                )
        
        return instance


class PaperUploadSerializer(serializers.ModelSerializer):
    """Serializer for PaperUpload."""
    uploaded_by_name = serializers.CharField(source='uploaded_by.username', read_only=True, allow_null=True)
    exam_paper_title = serializers.CharField(source='exam_paper.paper_title', read_only=True, allow_null=True)

    class Meta:
        model = PaperUpload
        fields = [
            'id', 'school', 'exam_paper', 'exam_paper_title',
            'uploaded_by', 'uploaded_by_name', 'image_url',
            'ai_extracted_json', 'extraction_confidence', 'extraction_notes',
            'status', 'error_message', 'created_at', 'processed_at',
        ]
        read_only_fields = [
            'id', 'school', 'uploaded_by', 'ai_extracted_json',
            'extraction_confidence', 'extraction_notes', 'status',
            'error_message', 'created_at', 'processed_at',
        ]


class PaperUploadCreateSerializer(serializers.Serializer):
    """Serializer for uploading paper image."""
    image = serializers.ImageField(required=True)
    class_obj = serializers.IntegerField(required=False, help_text="Class ID for context")
    subject = serializers.IntegerField(required=False, help_text="Subject ID for context")


class PaperFeedbackSerializer(serializers.ModelSerializer):
    """Serializer for PaperFeedback."""
    confirmed_by_name = serializers.CharField(source='confirmed_by.username', read_only=True, allow_null=True)

    class Meta:
        model = PaperFeedback
        fields = [
            'id', 'paper_upload', 'ai_extracted_json', 'user_confirmed_json',
            'accuracy_metrics', 'correction_notes', 'confirmed_by',
            'confirmed_by_name', 'created_at',
        ]
        read_only_fields = ['id', 'confirmed_by', 'created_at']


class QuestionReviewSerializer(serializers.Serializer):
    """Serializer for AI grammar/spelling review."""
    questions = serializers.ListField(
        child=serializers.CharField(),
        help_text="List of question texts to review"
    )


class QuestionReviewResponseSerializer(serializers.Serializer):
    """Response serializer for question review."""
    question_text = serializers.CharField()
    has_errors = serializers.BooleanField()
    suggestions = serializers.ListField(child=serializers.CharField())
    corrected_text = serializers.CharField()
    clarity_score = serializers.IntegerField()
