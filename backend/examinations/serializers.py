from rest_framework import serializers
from decimal import Decimal
from core.mixins import ensure_tenant_school_id
from core.permissions import get_effective_role, get_teacher_combined_scope
from lms.models import Topic
from .models import (
    ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale,
    Question, ExamPaper, PaperQuestion, StudentResponse, QuestionStats, PaperUpload, PaperFeedback,
    StudentTermAssessment,
)


def _coerce_int(value, default=0, min_value=0):
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        coerced = default
    return max(min_value, coerced)


def _coerce_decimal(value, default='0'):
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(str(default))


def _coerce_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {'true', '1', 'yes', 'y', 'on'}:
            return True
        if lowered in {'false', '0', 'no', 'n', 'off'}:
            return False
    return bool(value)


class PaperStructureValidationMixin:
    """Shared normalization for ExamPaper structure/render options payloads."""

    def _normalize_structure(self, structure):
        if structure is None:
            return None
        if not isinstance(structure, list):
            raise serializers.ValidationError({'structure': 'structure must be a list of section objects.'})

        normalized = []
        for index, section in enumerate(structure):
            if not isinstance(section, dict):
                raise serializers.ValidationError({'structure': [f'Item at index {index} must be an object.']})

            key = str(section.get('key', '')).strip()
            if not key:
                raise serializers.ValidationError({'structure': [f'Item at index {index} requires key.']})

            entry_type = str(section.get('type', 'question_group') or 'question_group').strip().lower()
            if entry_type == 'divider':
                # A plain print-layout separator (e.g. "Section A") -- no marks/slots/
                # questions attach to it, so it's exempt from the question_type/slots checks.
                normalized.append({
                    'key': key,
                    'type': 'divider',
                    'title': str(section.get('title', '') or ''),
                })
                continue

            question_type = str(section.get('question_type', '')).strip().upper()
            if not question_type:
                raise serializers.ValidationError({'structure': [f'Item at index {index} requires question_type.']})

            slots_shown = _coerce_int(section.get('slots_shown', 0), default=0, min_value=0)
            slots_counted = _coerce_int(
                section.get('slots_counted', slots_shown),
                default=slots_shown,
                min_value=0,
            )
            marks_per_question = _coerce_decimal(section.get('marks_per_question', '0'), default='0')

            normalized.append({
                'key': key,
                'type': 'question_group',
                'title': str(section.get('title', '') or ''),
                'instruction': str(section.get('instruction', '') or ''),
                'question_type': question_type,
                'slots_shown': slots_shown,
                'slots_counted': slots_counted,
                'marks_per_question': str(marks_per_question),
            })

        return normalized

    def _normalize_render_options(self, render_options):
        if render_options is None:
            return None
        if not isinstance(render_options, dict):
            raise serializers.ValidationError({'render_options': 'render_options must be an object.'})

        normalized = dict(render_options)
        if 'answer_lines' in normalized:
            normalized['answer_lines'] = _coerce_bool(normalized.get('answer_lines'))
        return normalized


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
        return data


class BulkTestEntrySerializer(serializers.Serializer):
    subject_id = serializers.IntegerField()
    name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    exam_date = serializers.DateField()
    total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, min_value=Decimal('0.01'), default=Decimal('100.00'))
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)

    def validate(self, data):
        if data.get('start_time') and data.get('end_time') and data['start_time'] > data['end_time']:
            raise serializers.ValidationError(
                {'end_time': 'End time must be on or after start time.'}
            )
        return data


class BulkTestRequestSerializer(serializers.Serializer):
    academic_year = serializers.IntegerField()
    term = serializers.IntegerField(required=False, allow_null=True)
    exam_type = serializers.IntegerField()
    class_obj = serializers.IntegerField()
    tests = BulkTestEntrySerializer(many=True, min_length=1)

    def validate(self, data):
        seen_subject_ids = set()
        duplicates = []
        for row in data['tests']:
            subject_id = row['subject_id']
            if subject_id in seen_subject_ids:
                duplicates.append(subject_id)
            seen_subject_ids.add(subject_id)
        if duplicates:
            raise serializers.ValidationError({
                'tests': f'Duplicate subject selections are not allowed: {sorted(set(duplicates))}.'
            })
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
            'total_marks', 'passing_marks', 'exam_date', 'start_time', 'end_time',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class ExamSubjectCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamSubject
        fields = ['exam', 'subject', 'total_marks', 'passing_marks', 'exam_date', 'start_time', 'end_time']

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
    date_sheet = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        help_text="List of {class_id, subject_id, exam_date, start_time, end_time} entries",
    )

    def validate(self, data):
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] > data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be on or after start date.'}
                )
        return data


class DateSheetEntrySerializer(serializers.Serializer):
    exam_subject_id = serializers.IntegerField()
    exam_date = serializers.DateField(allow_null=True, required=False)
    start_time = serializers.TimeField(allow_null=True, required=False)
    end_time = serializers.TimeField(allow_null=True, required=False)


class DateSheetUpdateSerializer(serializers.Serializer):
    """Bulk-update exam_date/start_time/end_time on ExamSubjects."""
    date_sheet = serializers.ListField(
        child=DateSheetEntrySerializer(),
        help_text="List of {exam_subject_id, exam_date, start_time, end_time} entries",
    )


# ===========================================
# Question Paper Builder Serializers
# ===========================================


class QuestionSerializer(serializers.ModelSerializer):
    """Serializer for Question model."""
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    exam_type_name = serializers.CharField(source='exam_type.name', read_only=True, allow_null=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, allow_null=True)
    tested_topics = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    real_difficulty = serializers.FloatField(source='stats.real_difficulty', read_only=True, allow_null=True)
    
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
            'question_text', 'question_image_url', 'question_type', 'difficulty_level', 'bloom_level',
            'marks', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
            'answer_text', 'type_data', 'tested_topics',
            'source_content_block', 'paper_use_count', 'last_used_in', 'last_used_at',
            'is_ai_generated', 'verified_by', 'verified_at',
            'tested_topics_details', 'real_difficulty',
            'created_by', 'created_by_name', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_by', 'created_by_name', 'created_at', 'updated_at', 'tested_topics_details', 'real_difficulty']


class StudentResponseSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    question_text = serializers.CharField(source='question.question_text', read_only=True)

    class Meta:
        model = StudentResponse
        fields = [
            'id', 'student', 'student_name', 'question', 'question_text', 'exam_paper',
            'response_text', 'marks_awarded', 'is_correct', 'time_taken_seconds', 'submitted_at',
        ]
        read_only_fields = ['id', 'submitted_at', 'student_name', 'question_text']


class StudentResponseEntrySerializer(serializers.Serializer):
    question = serializers.IntegerField()
    response_text = serializers.CharField(required=False, allow_blank=True, default='')
    marks_awarded = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    is_correct = serializers.BooleanField(required=False, allow_null=True)
    time_taken_seconds = serializers.IntegerField(required=False, allow_null=True, min_value=0)


class StudentResponseBulkSubmitSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    exam_paper = serializers.IntegerField()
    responses = StudentResponseEntrySerializer(many=True, min_length=1)

    def validate(self, attrs):
        from students.models import Student

        try:
            exam_paper = ExamPaper.objects.select_related('school').get(id=attrs['exam_paper'])
        except ExamPaper.DoesNotExist as exc:
            raise serializers.ValidationError({'exam_paper': 'Exam paper not found.'}) from exc

        try:
            student = Student.objects.get(id=attrs['student'])
        except Student.DoesNotExist as exc:
            raise serializers.ValidationError({'student': 'Student not found.'}) from exc

        if student.school_id != exam_paper.school_id:
            raise serializers.ValidationError({'student': 'Student must belong to the same school as the exam paper.'})

        question_ids = [entry['question'] for entry in attrs['responses']]
        if len(question_ids) != len(set(question_ids)):
            raise serializers.ValidationError({'responses': 'Duplicate question IDs are not allowed in a single submission.'})

        paper_question_ids = set(exam_paper.paper_questions.values_list('question_id', flat=True))
        invalid_question_ids = [question_id for question_id in question_ids if question_id not in paper_question_ids]
        if invalid_question_ids:
            raise serializers.ValidationError({'responses': f'Questions not linked to this paper: {sorted(invalid_question_ids)}.'})

        attrs['exam_paper_obj'] = exam_paper
        attrs['student_obj'] = student
        return attrs


class QuestionCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating questions."""
    tested_topics = serializers.PrimaryKeyRelatedField(
        many=True,
        required=False,
        queryset=Topic.objects.filter(is_active=True).select_related('chapter__book'),
    )

    class Meta:
        model = Question
        fields = [
            'subject', 'exam_type', 'question_text', 'question_image_url',
            'question_type', 'difficulty_level', 'bloom_level', 'marks',
            'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
            'answer_text', 'type_data', 'tested_topics',
            'source_content_block', 'is_ai_generated', 'verified_by', 'verified_at',
        ]

    def validate(self, data):
        errors = {}

        question_type = str(
            data.get('question_type') or getattr(self.instance, 'question_type', 'SHORT')
        ).upper()
        subject = data.get('subject') or getattr(self.instance, 'subject', None)
        type_data = data.get('type_data', getattr(self.instance, 'type_data', {})) or {}
        answer_text = data.get('answer_text', getattr(self.instance, 'answer_text', ''))
        correct_answer = data.get('correct_answer', getattr(self.instance, 'correct_answer', ''))

        if not isinstance(type_data, dict):
            errors['type_data'] = 'type_data must be a JSON object.'

        if question_type == 'MCQ':
            option_a = data.get('option_a', getattr(self.instance, 'option_a', ''))
            option_b = data.get('option_b', getattr(self.instance, 'option_b', ''))
            option_c = data.get('option_c', getattr(self.instance, 'option_c', ''))
            option_d = data.get('option_d', getattr(self.instance, 'option_d', ''))
            if not (str(option_a).strip() and str(option_b).strip()):
                errors['option_a'] = 'MCQ requires at least options A and B.'
            if str(correct_answer).strip() and str(correct_answer).strip().upper() not in {'A', 'B', 'C', 'D'}:
                errors['correct_answer'] = 'MCQ correct_answer must be one of A/B/C/D.'
            answer_key = str(correct_answer).strip().upper()
            option_map = {'A': option_a, 'B': option_b, 'C': option_c, 'D': option_d}
            if answer_key in option_map and not str(option_map[answer_key]).strip():
                errors['correct_answer'] = f'MCQ correct_answer {answer_key} requires option {answer_key} text.'

        elif question_type == 'TRUE_FALSE':
            if str(correct_answer).strip().lower() not in {'true', 'false'}:
                errors['correct_answer'] = 'TRUE_FALSE correct_answer must be TRUE or FALSE.'

        elif question_type == 'FILL_BLANK':
            accepted_answers = type_data.get('accepted_answers') if isinstance(type_data, dict) else None
            has_answers = isinstance(accepted_answers, list) and len(accepted_answers) > 0
            if not has_answers and not str(correct_answer).strip() and not str(answer_text).strip():
                errors['type_data'] = 'FILL_BLANK requires type_data.accepted_answers or correct_answer/answer_text.'

        elif question_type in {'SHORT', 'LONG', 'ESSAY'}:
            if not str(answer_text).strip() and not str(correct_answer).strip():
                errors['answer_text'] = f'{question_type} requires answer_text or correct_answer.'

        elif question_type == 'MATCHING':
            left_items = type_data.get('left_items') if isinstance(type_data, dict) else None
            right_items = type_data.get('right_items') if isinstance(type_data, dict) else None
            pairs = type_data.get('pairs') if isinstance(type_data, dict) else None
            if not isinstance(left_items, list) or len(left_items) < 2:
                errors['type_data'] = 'MATCHING requires type_data.left_items with at least two entries.'
            elif not isinstance(right_items, list) or len(right_items) < 2:
                errors['type_data'] = 'MATCHING requires type_data.right_items with at least two entries.'
            elif not isinstance(pairs, list) or len(pairs) < 2:
                errors['type_data'] = 'MATCHING requires type_data.pairs with at least two mappings.'

        topics = data.get('tested_topics', None)
        if topics is None and self.instance:
            topics = self.instance.tested_topics.select_related('chapter__book').all()
        if subject and topics:
            invalid_topic_ids = [
                topic.id for topic in topics
                if topic.chapter.book.subject_id != subject.id
            ]
            if invalid_topic_ids:
                errors['tested_topics'] = (
                    'All tested_topics must belong to the same subject as the question. '
                    f'Invalid topic IDs: {invalid_topic_ids}'
                )

        request = self.context.get('request')
        if request and get_effective_role(request) == 'TEACHER' and subject:
            school_id = ensure_tenant_school_id(request) or request.user.school_id
            scope = get_teacher_combined_scope(request, school_id=school_id)
            allowed_subject_ids = {
                subj_id
                for subj_ids in scope.get('class_subject_map', {}).values()
                for subj_id in subj_ids
            }
            if subject.id not in allowed_subject_ids:
                errors['subject'] = 'You can only create or edit questions for your assigned subjects.'

        if errors:
            raise serializers.ValidationError(errors)

        return data


class PaperQuestionSerializer(serializers.ModelSerializer):
    """Serializer for PaperQuestion through model."""
    question_text = serializers.SerializerMethodField()
    question_type = serializers.SerializerMethodField()
    option_a = serializers.SerializerMethodField()
    option_b = serializers.SerializerMethodField()
    option_c = serializers.SerializerMethodField()
    option_d = serializers.SerializerMethodField()
    question_image_url = serializers.SerializerMethodField()
    answer_text = serializers.SerializerMethodField()
    correct_answer = serializers.SerializerMethodField()
    difficulty_level = serializers.SerializerMethodField()
    type_data = serializers.SerializerMethodField()
    question_snapshot = serializers.JSONField(read_only=True)
    marks = serializers.SerializerMethodField()

    class Meta:
        model = PaperQuestion
        fields = [
            'id', 'question', 'question_order', 'section_key', 'marks_override', 'marks',
            'question_text', 'question_type', 'option_a', 'option_b',
            'option_c', 'option_d', 'question_image_url', 'answer_text',
            'correct_answer', 'difficulty_level', 'type_data',
            'question_snapshot', 'created_at',
        ]

    def get_marks(self, obj):
        """Return override marks or default question marks."""
        return obj.get_marks()

    def _snapshot_value(self, obj, key, fallback=''):
        return obj.get_question_data().get(key, fallback)

    def get_question_text(self, obj):
        return self._snapshot_value(obj, 'question_text')

    def get_question_type(self, obj):
        return self._snapshot_value(obj, 'question_type')

    def get_option_a(self, obj):
        return self._snapshot_value(obj, 'option_a')

    def get_option_b(self, obj):
        return self._snapshot_value(obj, 'option_b')

    def get_option_c(self, obj):
        return self._snapshot_value(obj, 'option_c')

    def get_option_d(self, obj):
        return self._snapshot_value(obj, 'option_d')

    def get_question_image_url(self, obj):
        return self._snapshot_value(obj, 'question_image_url', None)

    def get_answer_text(self, obj):
        return self._snapshot_value(obj, 'answer_text')

    def get_correct_answer(self, obj):
        return self._snapshot_value(obj, 'correct_answer')

    def get_difficulty_level(self, obj):
        return self._snapshot_value(obj, 'difficulty_level')

    def get_type_data(self, obj):
        return self._snapshot_value(obj, 'type_data', {})


class ExamPaperSerializer(serializers.ModelSerializer):
    """Serializer for ExamPaper with nested questions."""
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    exam_name = serializers.CharField(source='exam.name', read_only=True, allow_null=True)
    generated_by_name = serializers.CharField(source='generated_by.username', read_only=True, allow_null=True)
    paper_questions = PaperQuestionSerializer(many=True, read_only=True)
    question_count = serializers.IntegerField(read_only=True)
    calculated_total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    structure_marks_total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    
    # NEW: Curriculum alignment - read-only expanded details
    lesson_plans_details = serializers.SerializerMethodField()
    covered_topics = serializers.SerializerMethodField()
    question_topics_summary = serializers.SerializerMethodField()
    overused_questions = serializers.SerializerMethodField()
    
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

    def get_overused_questions(self, obj):
        return [
            {
                'question_id': paper_question.question_id,
                'paper_use_count': paper_question.question.paper_use_count,
            }
            for paper_question in obj.paper_questions.select_related('question').all()
            if paper_question.question.paper_use_count > 3
        ]

    class Meta:
        model = ExamPaper
        fields = [
            'id', 'school', 'exam', 'exam_name', 'exam_subject',
            'class_obj', 'class_name', 'subject', 'subject_name',
            'paper_title', 'instructions', 'structure', 'render_options', 'total_marks', 'duration_minutes',
            'paper_questions', 'question_count', 'calculated_total_marks',
            'structure_marks_total',
            'lesson_plans_details', 'covered_topics', 'question_topics_summary', 'overused_questions',
            'status', 'generated_by', 'generated_by_name',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'generated_by', 'generated_by_name', 'created_at', 'updated_at', 
                           'lesson_plans_details', 'covered_topics', 'question_topics_summary', 'overused_questions']


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


class ExamPaperDraftEnsureSerializer(PaperStructureValidationMixin, serializers.ModelSerializer):
    """Serializer for creating or refreshing server-backed draft papers."""

    class Meta:
        model = ExamPaper
        fields = [
            'exam', 'exam_subject', 'class_obj', 'subject',
            'paper_title', 'instructions', 'structure', 'render_options', 'total_marks',
            'duration_minutes', 'status',
        ]

    def validate(self, data):
        exam_subject = data.get('exam_subject') or getattr(self.instance, 'exam_subject', None)
        exam = data.get('exam') or getattr(self.instance, 'exam', None)
        if exam_subject and exam and exam_subject.exam != exam:
            raise serializers.ValidationError('ExamSubject must belong to the specified Exam.')
        if 'structure' in data:
            data['structure'] = self._normalize_structure(data.get('structure'))
        if 'render_options' in data:
            data['render_options'] = self._normalize_render_options(data.get('render_options'))
        return data


class ExamPaperDraftAutosaveSerializer(PaperStructureValidationMixin, serializers.Serializer):
    """Serializer for autosaving editable paper metadata and manual questions."""

    exam = serializers.PrimaryKeyRelatedField(
        queryset=Exam.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    exam_subject = serializers.PrimaryKeyRelatedField(
        queryset=ExamSubject.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    class_obj = serializers.PrimaryKeyRelatedField(
        queryset=ExamPaper._meta.get_field('class_obj').remote_field.model.objects.all(),
        required=False,
    )
    subject = serializers.PrimaryKeyRelatedField(
        queryset=Question._meta.get_field('subject').remote_field.model.objects.filter(is_active=True),
        required=False,
    )
    paper_title = serializers.CharField(required=False, allow_blank=False)
    instructions = serializers.CharField(required=False, allow_blank=True)
    structure = serializers.JSONField(required=False)
    render_options = serializers.JSONField(required=False)
    total_marks = serializers.DecimalField(max_digits=6, decimal_places=2, required=False)
    duration_minutes = serializers.IntegerField(min_value=1, required=False)
    manual_questions = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        help_text='Full list of manual draft questions to upsert into the paper and question bank.',
    )

    def validate(self, data):
        exam_subject = data.get('exam_subject')
        exam = data.get('exam')
        if exam_subject and exam and exam_subject.exam != exam:
            raise serializers.ValidationError('ExamSubject must belong to the specified Exam.')

        if 'structure' in data:
            data['structure'] = self._normalize_structure(data.get('structure'))
        if 'render_options' in data:
            data['render_options'] = self._normalize_render_options(data.get('render_options'))

        manual_questions = data.get('manual_questions')
        if manual_questions is not None:
            normalized_questions = []
            for item in manual_questions:
                if not isinstance(item, dict):
                    raise serializers.ValidationError({'manual_questions': 'Each manual question must be an object.'})
                normalized = dict(item)
                section_key = normalized.get('section_key', '')
                if section_key is None:
                    section_key = ''
                normalized['section_key'] = str(section_key)[:50]
                normalized_questions.append(normalized)
            data['manual_questions'] = normalized_questions

        return data


class PaperUploadSerializer(serializers.ModelSerializer):
    """Serializer for PaperUpload."""
    uploaded_by_name = serializers.CharField(source='uploaded_by.username', read_only=True, allow_null=True)
    exam_paper_title = serializers.CharField(source='exam_paper.paper_title', read_only=True, allow_null=True)
    context_class_name = serializers.CharField(source='context_class.name', read_only=True, allow_null=True)
    context_subject_name = serializers.CharField(source='context_subject.name', read_only=True, allow_null=True)

    class Meta:
        model = PaperUpload
        fields = [
            'id', 'school', 'exam_paper', 'exam_paper_title',
            'uploaded_by', 'uploaded_by_name', 'image_url',
            'context_class', 'context_class_name', 'context_subject', 'context_subject_name',
            'ai_extracted_json', 'extraction_confidence', 'extraction_notes',
            'status', 'error_message', 'created_at', 'processed_at',
        ]
        read_only_fields = [
            'id', 'school', 'uploaded_by', 'context_class', 'context_subject',
            'ai_extracted_json', 'extraction_confidence', 'extraction_notes', 'status',
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


class StudentTermAssessmentSerializer(serializers.ModelSerializer):
    """Skills/behaviour ratings + remarks for one student's academic year — feeds the report PDF."""
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StudentTermAssessment
        fields = [
            'id', 'student', 'academic_year', 'month', 'term',
            'listening', 'speaking', 'writing', 'reading',
            'participation', 'confidence', 'social_skills',
            'discipline', 'respect', 'teamwork', 'class_participation', 'responsibility',
            'teacher_remark', 'principal_remark',
            'updated_by', 'updated_by_name', 'updated_at',
        ]
        read_only_fields = ['id', 'updated_by', 'updated_by_name', 'updated_at']

    def get_updated_by_name(self, obj):
        if obj.updated_by:
            return obj.updated_by.get_full_name() or obj.updated_by.username
        return None
