from rest_framework import serializers
from students.models import Class
from .models import AcademicYear, Term, StudentEnrollment, SessionClass, SchoolCalendarEntry


# ── AcademicYear ──────────────────────────────────────────────

class AcademicYearSerializer(serializers.ModelSerializer):
    terms_count = serializers.IntegerField(read_only=True, default=0)
    enrollment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = AcademicYear
        fields = [
            'id', 'school', 'name', 'start_date', 'end_date',
            'is_current', 'is_active', 'terms_count', 'enrollment_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class AcademicYearCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicYear
        fields = ['name', 'start_date', 'end_date', 'is_current']

    def validate(self, data):
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] >= data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be after start date.'}
                )
        school_id = self.context.get('school_id')
        name = data.get('name')
        if school_id and name:
            qs = AcademicYear.objects.filter(school_id=school_id, name=name)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'name': 'An academic year with this name already exists.'}
                )
        return data


# ── Term ──────────────────────────────────────────────────────

class TermSerializer(serializers.ModelSerializer):
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True,
    )

    class Meta:
        model = Term
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'name', 'term_type', 'order', 'start_date', 'end_date',
            'is_current', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class TermCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = ['academic_year', 'name', 'term_type', 'order', 'start_date', 'end_date', 'is_current']

    def validate(self, data):
        school_id = self.context.get('school_id')
        academic_year = data.get('academic_year') or getattr(self.instance, 'academic_year', None)
        name = data.get('name', getattr(self.instance, 'name', ''))
        order = data.get('order', getattr(self.instance, 'order', None))
        start_date = data.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = data.get('end_date', getattr(self.instance, 'end_date', None))

        if isinstance(name, str):
            name = name.strip()
            if 'name' in data:
                data['name'] = name

        errors = {}

        if start_date and end_date and start_date >= end_date:
            errors['end_date'] = 'End date must be after start date.'

        if academic_year and start_date and start_date < academic_year.start_date:
            errors['start_date'] = 'Term start date cannot be before the academic year start date.'
        if academic_year and end_date and end_date > academic_year.end_date:
            errors['end_date'] = 'Term end date cannot be after the academic year end date.'

        if not name:
            errors['name'] = 'Name is required.'

        # Ensure academic_year belongs to the same school
        if school_id and academic_year and academic_year.school_id != int(school_id):
            errors['academic_year'] = 'Academic year does not belong to this school.'

        if school_id and academic_year and name:
            qs = Term.objects.filter(
                school_id=school_id,
                academic_year=academic_year,
                name__iexact=name,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                errors['name'] = 'A term with this name already exists for this academic year.'

        if school_id and academic_year and order is not None:
            order_qs = Term.objects.filter(
                school_id=school_id,
                academic_year=academic_year,
                order=order,
            )
            if self.instance:
                order_qs = order_qs.exclude(pk=self.instance.pk)
            if order_qs.exists():
                errors['order'] = 'A term with this order already exists for this academic year.'

        if school_id and academic_year and start_date and end_date:
            overlap_qs = Term.objects.filter(
                school_id=school_id,
                academic_year=academic_year,
                start_date__lt=end_date,
                end_date__gt=start_date,
            )
            if self.instance:
                overlap_qs = overlap_qs.exclude(pk=self.instance.pk)
            if overlap_qs.exists():
                errors['non_field_errors'] = [
                    'Term date range overlaps with an existing term in this academic year.'
                ]

        if errors:
            raise serializers.ValidationError(errors)

        return data


class TermImportSerializer(serializers.Serializer):
    source_academic_year_id = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
        source='source_academic_year',
    )
    target_academic_year_id = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
        source='target_academic_year',
    )
    conflict_mode = serializers.ChoiceField(
        choices=[('skip', 'skip'), ('update', 'update')],
        default='skip',
    )
    include_inactive = serializers.BooleanField(default=False)

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        source_year = attrs['source_academic_year']
        target_year = attrs['target_academic_year']

        if source_year.id == target_year.id:
            raise serializers.ValidationError(
                {'target_academic_year_id': 'Source and target academic year must be different.'}
            )

        if school_id:
            school_id = int(school_id)
            if source_year.school_id != school_id:
                raise serializers.ValidationError(
                    {'source_academic_year_id': 'Source academic year does not belong to this school.'}
                )
            if target_year.school_id != school_id:
                raise serializers.ValidationError(
                    {'target_academic_year_id': 'Target academic year does not belong to this school.'}
                )

        return attrs


# ── SchoolCalendarEntry ─────────────────────────────────────

class SchoolCalendarEntrySerializer(serializers.ModelSerializer):
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True)
    class_ids = serializers.PrimaryKeyRelatedField(source='classes', many=True, read_only=True)
    class_names = serializers.SerializerMethodField()

    class Meta:
        model = SchoolCalendarEntry
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'name', 'description', 'entry_kind', 'off_day_type',
            'scope', 'class_ids', 'class_names',
            'start_date', 'end_date', 'color', 'is_active',
            'created_by', 'updated_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'academic_year_name', 'class_names',
            'created_by', 'updated_by', 'created_at', 'updated_at',
        ]

    def get_class_names(self, obj):
        names = []
        for class_obj in obj.classes.all().order_by('grade_level', 'name', 'section'):
            if class_obj.section:
                names.append(f"{class_obj.name} - {class_obj.section}")
            else:
                names.append(class_obj.name)
        return names


class SchoolCalendarEntryCreateSerializer(serializers.ModelSerializer):
    class_ids = serializers.PrimaryKeyRelatedField(
        source='classes',
        queryset=Class.objects.all(),
        many=True,
        required=False,
    )

    class Meta:
        model = SchoolCalendarEntry
        fields = [
            'academic_year', 'name', 'description',
            'entry_kind', 'off_day_type',
            'scope', 'class_ids',
            'start_date', 'end_date', 'color', 'is_active',
        ]

    def validate(self, data):
        school_id = self.context.get('school_id')
        school_id = int(school_id) if school_id else None

        academic_year = data.get('academic_year') or getattr(self.instance, 'academic_year', None)
        entry_kind = data.get('entry_kind', getattr(self.instance, 'entry_kind', None))
        scope = data.get('scope', getattr(self.instance, 'scope', SchoolCalendarEntry.Scope.SCHOOL))
        classes = data.get('classes')
        start_date = data.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = data.get('end_date', getattr(self.instance, 'end_date', None))
        off_day_type = data.get('off_day_type', getattr(self.instance, 'off_day_type', ''))

        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError({'end_date': 'End date must be on or after start date.'})

        if school_id and academic_year and academic_year.school_id != school_id:
            raise serializers.ValidationError({'academic_year': 'Academic year does not belong to this school.'})

        if entry_kind == SchoolCalendarEntry.EntryKind.EVENT:
            data['off_day_type'] = ''
        elif entry_kind == SchoolCalendarEntry.EntryKind.OFF_DAY and not off_day_type:
            data['off_day_type'] = SchoolCalendarEntry.OffDayType.OTHER

        if scope == SchoolCalendarEntry.Scope.CLASS:
            effective_classes = classes
            if effective_classes is None and self.instance:
                effective_classes = self.instance.classes.all()
            if not effective_classes:
                raise serializers.ValidationError({'class_ids': 'At least one class is required for class-scoped entries.'})

            invalid_class = None
            for class_obj in effective_classes:
                if school_id and class_obj.school_id != school_id:
                    invalid_class = class_obj
                    break
            if invalid_class:
                raise serializers.ValidationError({'class_ids': 'All selected classes must belong to the active school.'})
        elif classes is not None and len(classes) > 0:
            raise serializers.ValidationError({'class_ids': 'Class IDs can only be provided for class-scoped entries.'})

        return data

    def create(self, validated_data):
        classes = validated_data.pop('classes', [])
        instance = super().create(validated_data)
        if instance.scope == SchoolCalendarEntry.Scope.CLASS:
            instance.classes.set(classes)
        else:
            instance.classes.clear()
        return instance

    def update(self, instance, validated_data):
        classes = validated_data.pop('classes', None)
        instance = super().update(instance, validated_data)
        if instance.scope == SchoolCalendarEntry.Scope.CLASS:
            if classes is not None:
                instance.classes.set(classes)
        else:
            instance.classes.clear()
        return instance


# ── SessionClass ─────────────────────────────────────────────

class SessionClassSerializer(serializers.ModelSerializer):
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True)
    class_obj_name = serializers.CharField(source='class_obj.name', read_only=True, default='')
    label = serializers.CharField(read_only=True)
    enrollment_count = serializers.IntegerField(read_only=True, default=0)
    unassigned_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = SessionClass
        fields = [
            'id', 'school', 'academic_year', 'academic_year_name',
            'class_obj', 'class_obj_name',
            'display_name', 'section', 'grade_level', 'label',
            'enrollment_count', 'unassigned_count',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at', 'label']


class SessionClassCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionClass
        fields = ['academic_year', 'class_obj', 'display_name', 'section', 'grade_level', 'is_active']

    def validate(self, data):
        school_id = self.context.get('school_id')
        school_id = int(school_id) if school_id else None
        academic_year = data.get('academic_year') or getattr(self.instance, 'academic_year', None)
        class_obj = data.get('class_obj', getattr(self.instance, 'class_obj', None))
        display_name = (data.get('display_name') if 'display_name' in data else getattr(self.instance, 'display_name', '')) or ''
        section = (data.get('section') if 'section' in data else getattr(self.instance, 'section', '')) or ''

        # Normalize section to keep uniqueness checks consistent.
        data['section'] = section.strip()

        if school_id and academic_year and academic_year.school_id != int(school_id):
            raise serializers.ValidationError({'academic_year': 'Academic year does not belong to this school.'})
        if school_id and class_obj and class_obj.school_id != int(school_id):
            raise serializers.ValidationError({'class_obj': 'Class does not belong to this school.'})
        if class_obj and (class_obj.section or '').strip() and class_obj.id != getattr(self.instance, 'class_obj_id', None):
            raise serializers.ValidationError({
                'class_obj': 'Session classes can only link to section-free master classes.'
            })

        if school_id and academic_year and display_name:
            dup_name_qs = SessionClass.objects.filter(
                school_id=school_id,
                academic_year=academic_year,
                display_name=display_name,
                section=data['section'],
            )
            if self.instance:
                dup_name_qs = dup_name_qs.exclude(pk=self.instance.pk)
            if dup_name_qs.exists():
                raise serializers.ValidationError({
                    'display_name': 'A session class with this name and section already exists for this academic year.'
                })
        return data


class SessionClassInitializeSerializer(serializers.Serializer):
    academic_year = serializers.PrimaryKeyRelatedField(queryset=AcademicYear.objects.all())
    source_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(), required=False, allow_null=True,
    )
    include_inactive_master_classes = serializers.BooleanField(default=False)

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        academic_year = attrs['academic_year']
        source_year = attrs.get('source_academic_year')

        if school_id:
            school_id = int(school_id)
            if academic_year.school_id != school_id:
                raise serializers.ValidationError({'academic_year': 'Academic year does not belong to this school.'})
            if source_year and source_year.school_id != school_id:
                raise serializers.ValidationError({'source_academic_year': 'Source academic year does not belong to this school.'})

        if source_year and source_year.id == academic_year.id:
            raise serializers.ValidationError('Source and target academic year must be different.')

        return attrs


# ── StudentEnrollment ─────────────────────────────────────────

class StudentEnrollmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    class_name = serializers.SerializerMethodField()
    session_class_label = serializers.CharField(source='session_class.label', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True,
    )

    class Meta:
        model = StudentEnrollment
        fields = [
            'id', 'school', 'student', 'student_name',
            'academic_year', 'academic_year_name',
            'session_class', 'session_class_label',
            'class_obj', 'class_name', 'roll_number', 'status',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def get_class_name(self, obj):
        if obj.session_class_id:
            return obj.session_class.label
        if obj.class_obj.section:
            return f"{obj.class_obj.name} - {obj.class_obj.section}"
        return obj.class_obj.name


class StudentEnrollmentCreateSerializer(serializers.ModelSerializer):
    session_class = serializers.PrimaryKeyRelatedField(
        queryset=SessionClass.objects.all(), required=False, allow_null=True,
    )

    class Meta:
        model = StudentEnrollment
        fields = ['student', 'academic_year', 'session_class', 'class_obj', 'roll_number', 'status']

    def validate(self, data):
        school_id = self.context.get('school_id')
        student = data.get('student')
        academic_year = data.get('academic_year')
        session_class = data.get('session_class')
        class_obj = data.get('class_obj')

        if session_class and not class_obj:
            if session_class.class_obj_id:
                data['class_obj'] = session_class.class_obj
                class_obj = session_class.class_obj
            else:
                raise serializers.ValidationError(
                    {'session_class': 'Selected session class is not linked to a master class.'}
                )

        if not class_obj:
            raise serializers.ValidationError({'class_obj': 'Class is required.'})

        if school_id and student and student.school_id != int(school_id):
            raise serializers.ValidationError(
                {'student': 'Student does not belong to this school.'}
            )
        if school_id and class_obj and class_obj.school_id != int(school_id):
            raise serializers.ValidationError(
                {'class_obj': 'Class does not belong to this school.'}
            )
        if school_id and session_class and session_class.school_id != int(school_id):
            raise serializers.ValidationError(
                {'session_class': 'Session class does not belong to this school.'}
            )
        if session_class and academic_year and session_class.academic_year_id != academic_year.id:
            raise serializers.ValidationError(
                {'session_class': 'Session class does not belong to the selected academic year.'}
            )
        if session_class and session_class.class_obj_id and class_obj and session_class.class_obj_id != class_obj.id:
            raise serializers.ValidationError(
                {'class_obj': 'Class must match the selected session class.'}
            )
        if school_id and student and academic_year:
            qs = StudentEnrollment.objects.filter(
                school_id=school_id, student=student, academic_year=academic_year,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'This student is already enrolled for this academic year.'
                )
        return data


class BulkPromoteSerializer(serializers.Serializer):
    source_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    target_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    promotions = serializers.ListField(
        child=serializers.DictField(),
        help_text="List of {student_id, target_class_id|target_session_class_id, new_roll_number, action}",
    )

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        source_year = attrs['source_academic_year']
        target_year = attrs['target_academic_year']
        promotions = attrs['promotions']

        if source_year.id == target_year.id:
            raise serializers.ValidationError('Source and target academic year must be different.')

        if school_id:
            school_id = int(school_id)
            if source_year.school_id != school_id:
                raise serializers.ValidationError({'source_academic_year': 'Source academic year does not belong to this school.'})
            if target_year.school_id != school_id:
                raise serializers.ValidationError({'target_academic_year': 'Target academic year does not belong to this school.'})

        normalized_promotions = []
        seen_students = set()
        seen_target_rolls = set()
        for idx, promotion in enumerate(promotions):
            student_id = promotion.get('student_id')
            target_class_id = promotion.get('target_class_id')
            target_session_class_id = promotion.get('target_session_class_id')
            action = str(promotion.get('action', 'PROMOTE')).upper()
            new_roll_number = promotion.get('new_roll_number', '')

            if not student_id:
                raise serializers.ValidationError({
                    'promotions': f'Promotion item {idx + 1} is missing student_id.'
                })

            if action == 'GRADUATED':
                action = 'GRADUATE'

            if action not in {'PROMOTE', 'REPEAT', 'GRADUATE'}:
                raise serializers.ValidationError({
                    'promotions': f'Promotion item {idx + 1} has invalid action.'
                })

            if action != 'GRADUATE' and not target_class_id and not target_session_class_id:
                raise serializers.ValidationError({
                    'promotions': f'Promotion item {idx + 1} requires a target class or target session class.'
                })

            student_id = int(student_id)
            if student_id in seen_students:
                raise serializers.ValidationError({
                    'promotions': f'Student {student_id} appears multiple times in one bulk request.'
                })
            seen_students.add(student_id)

            normalized_roll = str(new_roll_number or '').strip()
            if action != 'GRADUATE' and normalized_roll:
                target_key = (
                    f'session:{int(target_session_class_id)}'
                    if target_session_class_id
                    else f'class:{int(target_class_id)}'
                )
                roll_key = (target_key, normalized_roll)
                if roll_key in seen_target_rolls:
                    raise serializers.ValidationError({
                        'promotions': f'Duplicate target roll {normalized_roll} in promotion item {idx + 1}.'
                    })
                seen_target_rolls.add(roll_key)

            normalized_promotions.append({
                'student_id': student_id,
                'target_class_id': int(target_class_id) if target_class_id else None,
                'target_session_class_id': int(target_session_class_id) if target_session_class_id else None,
                'new_roll_number': normalized_roll,
                'action': action,
            })

        attrs['promotions'] = normalized_promotions
        return attrs


class BulkReversePromotionSerializer(serializers.Serializer):
    source_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    target_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    student_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        help_text="List of student IDs to reverse from target year back to source year.",
    )

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        source_year = attrs['source_academic_year']
        target_year = attrs['target_academic_year']

        if source_year.id == target_year.id:
            raise serializers.ValidationError('Source and target academic year must be different.')

        if school_id:
            school_id = int(school_id)
            if source_year.school_id != school_id:
                raise serializers.ValidationError({'source_academic_year': 'Source academic year does not belong to this school.'})
            if target_year.school_id != school_id:
                raise serializers.ValidationError({'target_academic_year': 'Target academic year does not belong to this school.'})

        attrs['student_ids'] = list(dict.fromkeys(attrs['student_ids']))
        return attrs


class PromotionTargetPreviewSerializer(serializers.Serializer):
    source_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    target_academic_year = serializers.PrimaryKeyRelatedField(
        queryset=AcademicYear.objects.all(),
    )
    source_session_class = serializers.PrimaryKeyRelatedField(
        queryset=SessionClass.objects.all(), required=False, allow_null=True,
    )
    source_class = serializers.PrimaryKeyRelatedField(
        queryset=Class.objects.all(), required=False, allow_null=True,
    )

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        source_year = attrs['source_academic_year']
        target_year = attrs['target_academic_year']
        source_session_class = attrs.get('source_session_class')
        source_class = attrs.get('source_class')

        if not source_session_class and not source_class:
            raise serializers.ValidationError({'source_session_class': 'Source session class or source class is required.'})

        if school_id:
            school_id = int(school_id)
            if source_year.school_id != school_id:
                raise serializers.ValidationError({'source_academic_year': 'Source academic year does not belong to this school.'})
            if target_year.school_id != school_id:
                raise serializers.ValidationError({'target_academic_year': 'Target academic year does not belong to this school.'})
            if source_class and source_class.school_id != school_id:
                raise serializers.ValidationError({'source_class': 'Source class does not belong to this school.'})
            if source_session_class and source_session_class.school_id != school_id:
                raise serializers.ValidationError({'source_session_class': 'Source session class does not belong to this school.'})

        if source_year.id == target_year.id:
            raise serializers.ValidationError('Source and target academic year must be different.')

        if source_session_class and source_session_class.academic_year_id != source_year.id:
            raise serializers.ValidationError({'source_session_class': 'Source session class does not belong to the selected source academic year.'})

        if source_session_class and source_class and source_session_class.class_obj_id and source_session_class.class_obj_id != source_class.id:
            raise serializers.ValidationError({'source_class': 'Source class must match the selected source session class.'})

        if source_session_class and not source_class:
            attrs['source_class'] = source_session_class.class_obj

        return attrs


class PromotionTargetApplySerializer(PromotionTargetPreviewSerializer):
    create_if_missing = serializers.BooleanField(default=True)
    reactivate_if_inactive = serializers.BooleanField(default=True)
