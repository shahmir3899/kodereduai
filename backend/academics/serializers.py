from rest_framework import serializers
from .models import Subject, ClassSubject, TimetableSlot, TimetableEntry


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


# ── ClassSubject ─────────────────────────────────────────────────────────────

class ClassSubjectSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
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


# ── TimetableSlot ────────────────────────────────────────────────────────────

class TimetableSlotSerializer(serializers.ModelSerializer):
    slot_type_display = serializers.CharField(
        source='get_slot_type_display', read_only=True
    )

    class Meta:
        model = TimetableSlot
        fields = [
            'id', 'school', 'name', 'slot_type', 'slot_type_display',
            'start_time', 'end_time', 'order', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class TimetableSlotCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimetableSlot
        fields = ['name', 'slot_type', 'start_time', 'end_time', 'order']

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
            'slot_start_time', 'slot_end_time',
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
