from rest_framework import serializers
from .models import Subject, ClassSubject, ClassTeacherAssignment, TimetableSlot, TimetableEntry


# ── Subject ──────────────────────────────────────────────────────────────────

class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = [
            'id', 'school', 'name', 'code', 'description',
            'is_elective', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class SubjectCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ['name', 'code', 'description', 'is_elective']

    def validate_code(self, value):
        value = value.upper()
        school_id = self.context.get('school_id')
        if school_id:
            qs = Subject.objects.filter(school_id=school_id, code=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'A subject with this code already exists in this school.'
                )
        return value


class SubjectBulkCreateSerializer(serializers.Serializer):
    subjects = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of {name, code, description?, is_elective?}",
    )


# ── ClassSubject ─────────────────────────────────────────────────────────────

class ClassSubjectSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    class_section = serializers.CharField(source='class_obj.section', read_only=True, default='')
    class_grade_level = serializers.IntegerField(source='class_obj.grade_level', read_only=True, default=0)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    subject_code = serializers.CharField(source='subject.code', read_only=True)
    teacher_name = serializers.SerializerMethodField()
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )

    class Meta:
        model = ClassSubject
        fields = [
            'id', 'school', 'class_obj', 'class_name',
            'class_section', 'class_grade_level',
            'subject', 'subject_name', 'subject_code',
            'teacher', 'teacher_name',
            'academic_year', 'academic_year_name',
            'periods_per_week', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def get_teacher_name(self, obj):
        return obj.teacher.full_name if obj.teacher else None


class ClassSubjectCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClassSubject
        fields = ['class_obj', 'subject', 'teacher', 'periods_per_week']

    def validate(self, data):
        school_id = self.context.get('school_id')
        if school_id:
            qs = ClassSubject.objects.filter(
                school_id=school_id,
                class_obj=data.get('class_obj'),
                subject=data.get('subject'),
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'This subject is already assigned to this class.'
                )
        return data


class ClassSubjectBulkAssignSerializer(serializers.Serializer):
    class_obj = serializers.PrimaryKeyRelatedField(queryset=ClassSubject.class_obj.field.related_model.objects.all())
    subjects = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), many=True)
    teacher = serializers.PrimaryKeyRelatedField(queryset=ClassSubject.teacher.field.related_model.objects.all(), required=False, allow_null=True)
    periods_per_week = serializers.IntegerField(default=1, min_value=1, max_value=20)


# ── ClassTeacherAssignment ──────────────────────────────────────────────────

class ClassTeacherAssignmentSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    # Derive section from session_class if available, else from master class
    class_section = serializers.SerializerMethodField()
    class_grade_level = serializers.IntegerField(source='class_obj.grade_level', read_only=True, default=0)
    teacher_name = serializers.SerializerMethodField()
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )
    session_class_display = serializers.SerializerMethodField()

    class Meta:
        model = ClassTeacherAssignment
        fields = [
            'id', 'school', 'class_obj', 'session_class',
            'class_name', 'class_section', 'class_grade_level',
            'teacher', 'teacher_name',
            'academic_year', 'academic_year_name',
            'session_class_display',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def get_class_section(self, obj):
        """Get section from session_class, fall back to master class section."""
        if obj.session_class and obj.session_class.section:
            return obj.session_class.section
        return obj.class_obj.section or ''

    def get_teacher_name(self, obj):
        return obj.teacher.full_name if obj.teacher else None

    def get_session_class_display(self, obj):
        """Display name of session class (helpful for UI)."""
        if obj.session_class:
            return f"{obj.session_class.display_name} ({obj.session_class.section})" if obj.session_class.section else obj.session_class.display_name
        return obj.class_obj.name


class ClassTeacherAssignmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClassTeacherAssignment
        fields = ['session_class', 'teacher', 'academic_year', 'is_active']

    def validate(self, data):
        school_id = self.context.get('school_id')
        session_class = data.get('session_class')
        teacher = data.get('teacher')
        academic_year = data.get('academic_year')

        if not session_class:
            raise serializers.ValidationError({'session_class': 'SessionClass is required.'})

        if school_id and session_class.school_id != school_id:
            raise serializers.ValidationError({'session_class': 'SessionClass does not belong to the active school.'})

        if academic_year and session_class.academic_year_id != academic_year.id:
            raise serializers.ValidationError(
                {'session_class': 'SessionClass must belong to the selected academic year.'}
            )

        if school_id and teacher and teacher.school_id != school_id:
            raise serializers.ValidationError({'teacher': 'Teacher does not belong to the active school.'})

        # Check for duplicate assignment to same session class
        qs = ClassTeacherAssignment.objects.filter(
            school_id=school_id,
            session_class=session_class,
            teacher=teacher,
            academic_year=academic_year,
        )
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                'This teacher is already assigned to this class section for the selected academic year. '
                'One teacher can be assigned to multiple sections, but not the same section twice.'
            )

        return data


class TimetableSlotSerializer(serializers.ModelSerializer):
    slot_type_display = serializers.CharField(
        source='get_slot_type_display', read_only=True
    )

    class Meta:
        model = TimetableSlot
        fields = [
            'id', 'school', 'name', 'slot_type', 'slot_type_display',
            'start_time', 'end_time', 'order', 'is_active',
            'applicable_days', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class TimetableSlotCreateSerializer(serializers.ModelSerializer):
    VALID_DAYS = {'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'}

    class Meta:
        model = TimetableSlot
        fields = ['name', 'slot_type', 'start_time', 'end_time', 'order', 'applicable_days']

    def validate_applicable_days(self, value):
        if value is not None:
            if not isinstance(value, list):
                raise serializers.ValidationError('applicable_days must be a list.')
            invalid = set(value) - self.VALID_DAYS
            if invalid:
                raise serializers.ValidationError(
                    f'Invalid day codes: {invalid}. Valid: {self.VALID_DAYS}'
                )
            if len(value) == 0:
                raise serializers.ValidationError(
                    'applicable_days must contain at least one day.'
                )
        return value

    def validate_order(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = TimetableSlot.objects.filter(school_id=school_id, order=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'A slot with this order already exists.'
                )
        return value

    def validate(self, data):
        if data.get('start_time') and data.get('end_time'):
            if data['start_time'] >= data['end_time']:
                raise serializers.ValidationError(
                    {'end_time': 'End time must be after start time.'}
                )
        return data


# ── TimetableEntry ───────────────────────────────────────────────────────────

class TimetableEntrySerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    slot_name = serializers.CharField(source='slot.name', read_only=True)
    slot_order = serializers.IntegerField(source='slot.order', read_only=True)
    slot_type = serializers.CharField(source='slot.slot_type', read_only=True)
    slot_start_time = serializers.TimeField(source='slot.start_time', read_only=True)
    slot_end_time = serializers.TimeField(source='slot.end_time', read_only=True)
    slot_applicable_days = serializers.JSONField(source='slot.applicable_days', read_only=True)
    subject_name = serializers.CharField(
        source='subject.name', read_only=True, default=None
    )
    subject_code = serializers.CharField(
        source='subject.code', read_only=True, default=None
    )
    teacher_name = serializers.SerializerMethodField()
    day_display = serializers.CharField(source='get_day_display', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )

    class Meta:
        model = TimetableEntry
        fields = [
            'id', 'school', 'class_obj', 'class_name',
            'day', 'day_display',
            'slot', 'slot_name', 'slot_order', 'slot_type',
            'slot_start_time', 'slot_end_time', 'slot_applicable_days',
            'subject', 'subject_name', 'subject_code',
            'teacher', 'teacher_name',
            'academic_year', 'academic_year_name',
            'room', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def get_teacher_name(self, obj):
        return obj.teacher.full_name if obj.teacher else None


class TimetableEntryCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimetableEntry
        fields = ['class_obj', 'day', 'slot', 'subject', 'teacher', 'room']

    def validate(self, data):
        school_id = self.context.get('school_id')

        # Check slot applicability for the given day
        slot = data.get('slot')
        day = data.get('day')
        if slot and day and not slot.is_applicable_for_day(day):
            raise serializers.ValidationError(
                f'Slot "{slot.name}" is not applicable on {day}. '
                f'Applicable days: {slot.applicable_days}'
            )

        # Check unique_together
        if school_id:
            qs = TimetableEntry.objects.filter(
                school_id=school_id,
                class_obj=data.get('class_obj'),
                day=data.get('day'),
                slot=data.get('slot'),
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'An entry already exists for this class, day, and slot.'
                )

        # Teacher conflict detection
        teacher = data.get('teacher')
        day = data.get('day')
        slot = data.get('slot')
        if teacher and day and slot and school_id:
            conflict = TimetableEntry.objects.filter(
                school_id=school_id,
                teacher=teacher,
                day=day,
                slot=slot,
            )
            if self.instance:
                conflict = conflict.exclude(pk=self.instance.pk)
            if conflict.exists():
                conflicting = conflict.first()
                raise serializers.ValidationError(
                    f'Teacher is already assigned to {conflicting.class_obj.name} '
                    f'at this time slot.'
                )
        return data


# ── AI Request Serializers ──────────────────────────────────────────────────

class AutoGenerateRequestSerializer(serializers.Serializer):
    class_id = serializers.IntegerField()


class ConflictResolutionRequestSerializer(serializers.Serializer):
    teacher = serializers.IntegerField()
    day = serializers.CharField(max_length=3)
    slot = serializers.IntegerField()
    class_id = serializers.IntegerField()
    subject = serializers.IntegerField(required=False)


class SubstituteRequestSerializer(serializers.Serializer):
    teacher = serializers.IntegerField()
    date = serializers.DateField()


# ── AI Chat Serializers ─────────────────────────────────────────────────────

class AcademicsAIChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        from .models import AcademicsAIChatMessage
        model = AcademicsAIChatMessage
        fields = ['id', 'role', 'content', 'created_at']
        read_only_fields = ['id', 'created_at']


class AcademicsAIChatInputSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=500)
