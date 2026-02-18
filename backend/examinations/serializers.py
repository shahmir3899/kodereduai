from rest_framework import serializers
from .models import ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale


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
            'id', 'school', 'exam_subject', 'student',
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
    exams = ExamSerializer(many=True, read_only=True, source='active_exams')

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
