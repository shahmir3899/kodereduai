"""
Student and Class serializers.
"""

from rest_framework import serializers
from .models import Class, Student


class ClassSerializer(serializers.ModelSerializer):
    """
    Serializer for Class model.
    """
    student_count = serializers.IntegerField(read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = Class
        fields = [
            'id', 'school', 'school_name', 'name',
            'grade_level', 'is_active', 'student_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ClassCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating classes.
    """
    class Meta:
        model = Class
        fields = ['school', 'name', 'grade_level']

    def validate(self, attrs):
        """Ensure class name is unique within the school."""
        school = attrs.get('school')
        name = attrs.get('name')

        if Class.objects.filter(school=school, name=name).exists():
            raise serializers.ValidationError({
                'name': f"A class named '{name}' already exists in this school."
            })

        return attrs


class StudentSerializer(serializers.ModelSerializer):
    """
    Serializer for Student model.
    """
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
    """
    Serializer for creating students.
    """
    class Meta:
        model = Student
        fields = [
            'school', 'class_obj', 'roll_number',
            'name', 'parent_phone', 'parent_name'
        ]

    def validate(self, attrs):
        """Ensure roll number is unique within the class."""
        school = attrs.get('school')
        class_obj = attrs.get('class_obj')
        roll_number = attrs.get('roll_number')

        # Ensure class belongs to the school
        if class_obj.school_id != school.id:
            raise serializers.ValidationError({
                'class_obj': "The selected class does not belong to this school."
            })

        # Check for duplicate roll number
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
    """
    Serializer for bulk creating students.
    """
    school_id = serializers.IntegerField()
    class_id = serializers.IntegerField()
    students = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
        max_length=100
    )

    def validate_school_id(self, value):
        """Validate school exists."""
        from schools.models import School
        if not School.objects.filter(id=value).exists():
            raise serializers.ValidationError("School not found.")
        return value

    def validate_class_id(self, value):
        """Validate class exists."""
        if not Class.objects.filter(id=value).exists():
            raise serializers.ValidationError("Class not found.")
        return value

    def validate(self, attrs):
        """Validate class belongs to school."""
        school_id = attrs.get('school_id')
        class_id = attrs.get('class_id')

        class_obj = Class.objects.filter(id=class_id).first()
        if class_obj and class_obj.school_id != school_id:
            raise serializers.ValidationError({
                'class_id': "The selected class does not belong to this school."
            })
        return attrs

    def validate_students(self, value):
        """Validate each student in the list."""
        errors = []
        for i, student in enumerate(value):
            if 'roll_number' not in student:
                errors.append(f"Student {i+1}: roll_number is required")
            if 'name' not in student:
                errors.append(f"Student {i+1}: name is required")
            # parent_phone is now optional - can be added later by school admin

        if errors:
            raise serializers.ValidationError(errors)

        return value

    def create(self, validated_data):
        """Bulk create or update students (upsert by school + class + roll_number)."""
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
