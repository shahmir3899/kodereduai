from rest_framework import serializers
from .models import AcademicYear, Term, StudentEnrollment


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
        if data.get('start_date') and data.get('end_date'):
            if data['start_date'] >= data['end_date']:
                raise serializers.ValidationError(
                    {'end_date': 'End date must be after start date.'}
                )
        school_id = self.context.get('school_id')
        academic_year = data.get('academic_year')
        name = data.get('name')
        # Ensure academic_year belongs to the same school
        if school_id and academic_year and academic_year.school_id != int(school_id):
            raise serializers.ValidationError(
                {'academic_year': 'Academic year does not belong to this school.'}
            )
        if school_id and academic_year and name:
            qs = Term.objects.filter(
                school_id=school_id, academic_year=academic_year, name=name,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'name': 'A term with this name already exists for this academic year.'}
                )
        return data


# ── StudentEnrollment ─────────────────────────────────────────

class StudentEnrollmentSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True,
    )

    class Meta:
        model = StudentEnrollment
        fields = [
            'id', 'school', 'student', 'student_name',
            'academic_year', 'academic_year_name',
            'class_obj', 'class_name', 'roll_number', 'status',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']


class StudentEnrollmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentEnrollment
        fields = ['student', 'academic_year', 'class_obj', 'roll_number', 'status']

    def validate(self, data):
        school_id = self.context.get('school_id')
        student = data.get('student')
        academic_year = data.get('academic_year')
        if school_id and student and student.school_id != int(school_id):
            raise serializers.ValidationError(
                {'student': 'Student does not belong to this school.'}
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
        help_text="List of {student_id, target_class_id, new_roll_number}",
    )
