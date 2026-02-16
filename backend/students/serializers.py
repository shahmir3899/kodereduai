"""
Student and Class serializers.
"""

from rest_framework import serializers
from .models import Class, Student, StudentDocument


# ── Class ─────────────────────────────────────────────────────

class ClassSerializer(serializers.ModelSerializer):
    student_count = serializers.IntegerField(read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = Class
        fields = [
            'id', 'school', 'school_name', 'name',
            'section', 'grade_level', 'is_active', 'student_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ClassCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Class
        fields = ['school', 'name', 'section', 'grade_level']

    def validate(self, attrs):
        # On update (PATCH), school isn't in attrs — use instance's school
        school = attrs.get('school') or (self.instance.school if self.instance else None)
        name = attrs.get('name') or (self.instance.name if self.instance else None)

        if school and name:
            qs = Class.objects.filter(school=school, name=name)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'name': f"A class named '{name}' already exists in this school."
                })

        return attrs


# ── Student ───────────────────────────────────────────────────

class StudentSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    has_user_account = serializers.SerializerMethodField()
    user_username = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name',
            'roll_number', 'name',
            'admission_number', 'admission_date', 'date_of_birth',
            'gender', 'blood_group', 'address', 'previous_school',
            'parent_phone', 'parent_name',
            'guardian_name', 'guardian_relation', 'guardian_phone',
            'guardian_email', 'guardian_occupation', 'guardian_address',
            'emergency_contact',
            'is_active', 'status', 'status_date', 'status_reason',
            'has_user_account', 'user_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_has_user_account(self, obj):
        return hasattr(obj, 'user_profile') and obj.user_profile is not None

    def get_user_username(self, obj):
        if hasattr(obj, 'user_profile') and obj.user_profile:
            return obj.user_profile.user.username
        return None


class StudentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = [
            'school', 'class_obj', 'roll_number',
            'name', 'parent_phone', 'parent_name',
            'admission_number', 'admission_date', 'date_of_birth',
            'gender', 'blood_group', 'address', 'previous_school',
            'guardian_name', 'guardian_relation', 'guardian_phone',
            'guardian_email', 'guardian_occupation', 'guardian_address',
            'emergency_contact',
        ]

    def validate(self, attrs):
        school = attrs.get('school')
        class_obj = attrs.get('class_obj')
        roll_number = attrs.get('roll_number')

        if class_obj.school_id != school.id:
            raise serializers.ValidationError({
                'class_obj': "The selected class does not belong to this school."
            })

        if Student.objects.filter(
            school=school,
            class_obj=class_obj,
            roll_number=roll_number
        ).exists():
            raise serializers.ValidationError({
                'roll_number': f"Roll number '{roll_number}' already exists in this class."
            })

        return attrs


class StudentBulkCreateSerializer(serializers.Serializer):
    school_id = serializers.IntegerField()
    class_id = serializers.IntegerField()
    students = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
        max_length=100
    )

    def validate_school_id(self, value):
        from schools.models import School
        if not School.objects.filter(id=value).exists():
            raise serializers.ValidationError("School not found.")
        return value

    def validate_class_id(self, value):
        if not Class.objects.filter(id=value).exists():
            raise serializers.ValidationError("Class not found.")
        return value

    def validate(self, attrs):
        school_id = attrs.get('school_id')
        class_id = attrs.get('class_id')

        class_obj = Class.objects.filter(id=class_id).first()
        if class_obj and class_obj.school_id != school_id:
            raise serializers.ValidationError({
                'class_id': "The selected class does not belong to this school."
            })
        return attrs

    def validate_students(self, value):
        errors = []
        for i, student in enumerate(value):
            if 'roll_number' not in student:
                errors.append(f"Student {i+1}: roll_number is required")
            if 'name' not in student:
                errors.append(f"Student {i+1}: name is required")

        if errors:
            raise serializers.ValidationError(errors)

        return value

    def create(self, validated_data):
        school_id = validated_data['school_id']
        class_id = validated_data['class_id']
        students_data = validated_data['students']

        created = []
        updated = []
        errors = []

        for student_data in students_data:
            try:
                student, was_created = Student.objects.update_or_create(
                    school_id=school_id,
                    class_obj_id=class_id,
                    roll_number=student_data['roll_number'],
                    defaults={
                        'name': student_data['name'],
                        'parent_phone': student_data.get('parent_phone', ''),
                        'parent_name': student_data.get('parent_name', ''),
                    }
                )
                if was_created:
                    created.append(student)
                else:
                    updated.append(student)
            except Exception as e:
                errors.append({
                    'roll_number': student_data.get('roll_number'),
                    'error': str(e)
                })

        return {'created': created, 'updated': updated, 'errors': errors}


# ── Student Document ──────────────────────────────────────────

class StudentDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(
        source='uploaded_by.username', read_only=True, default=None,
    )

    class Meta:
        model = StudentDocument
        fields = [
            'id', 'school', 'student', 'document_type', 'title',
            'file_url', 'uploaded_by', 'uploaded_by_name', 'created_at',
        ]
        read_only_fields = ['id', 'uploaded_by', 'created_at']


# ── Student Profile Summary ──────────────────────────────────

class StudentProfileSummarySerializer(serializers.Serializer):
    """Aggregated student stats for the profile overview tab."""
    student = StudentSerializer()
    attendance_rate = serializers.FloatField()
    total_present = serializers.IntegerField()
    total_absent = serializers.IntegerField()
    total_days = serializers.IntegerField()
    fee_total_due = serializers.DecimalField(max_digits=12, decimal_places=2)
    fee_total_paid = serializers.DecimalField(max_digits=12, decimal_places=2)
    fee_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    exam_average = serializers.FloatField(allow_null=True)
    enrollment_status = serializers.CharField(allow_null=True)
