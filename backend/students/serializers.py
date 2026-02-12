"""
Student, Class, and Grade serializers.
"""

from rest_framework import serializers
from .models import Grade, Class, Student


# ── Grade ─────────────────────────────────────────────────────

class GradeSerializer(serializers.ModelSerializer):
    class_count = serializers.IntegerField(read_only=True, default=0)
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = Grade
        fields = [
            'id', 'school', 'school_name', 'name', 'numeric_level',
            'class_count', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class GradeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Grade
        fields = ['name', 'numeric_level']

    def validate(self, attrs):
        school_id = self.context.get('school_id')
        numeric_level = attrs.get('numeric_level')
        if school_id and numeric_level is not None:
            qs = Grade.objects.filter(school_id=school_id, numeric_level=numeric_level)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'numeric_level': 'A grade with this level already exists.'}
                )
        return attrs


# ── Class ─────────────────────────────────────────────────────

class ClassSerializer(serializers.ModelSerializer):
    student_count = serializers.IntegerField(read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    grade_name = serializers.CharField(source='grade.name', read_only=True, default=None)
    grade_numeric_level = serializers.IntegerField(
        source='grade.numeric_level', read_only=True, default=None,
    )

    class Meta:
        model = Class
        fields = [
            'id', 'school', 'school_name', 'name',
            'grade', 'grade_name', 'grade_numeric_level', 'section',
            'grade_level', 'is_active', 'student_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ClassCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Class
        fields = ['school', 'name', 'grade', 'section', 'grade_level']

    def validate(self, attrs):
        school = attrs.get('school')
        name = attrs.get('name')

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

    class Meta:
        model = Student
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name',
            'roll_number', 'name',
            'parent_phone', 'parent_name',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class StudentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = [
            'school', 'class_obj', 'roll_number',
            'name', 'parent_phone', 'parent_name'
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
