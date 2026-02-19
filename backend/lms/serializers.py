"""
LMS serializers for lesson plans, assignments, and submissions.
Uses Read + Create serializer pattern for each model.
"""

from rest_framework import serializers
from .models import (
    Book, Chapter, Topic,
    LessonPlan, LessonAttachment,
    Assignment, AssignmentAttachment, AssignmentSubmission,
)


# ---------------------------------------------------------------------------
# Curriculum: Book → Chapter → Topic
# ---------------------------------------------------------------------------

class TopicSerializer(serializers.ModelSerializer):
    is_covered = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = [
            'id', 'chapter', 'title', 'topic_number', 'description',
            'estimated_periods', 'is_active', 'is_covered',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_is_covered(self, obj):
        """Check if this topic has been used in any published lesson plan."""
        return obj.lesson_plans.filter(status='PUBLISHED').exists()


class ChapterReadSerializer(serializers.ModelSerializer):
    topics = TopicSerializer(many=True, read_only=True)
    topic_count = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = [
            'id', 'book', 'title', 'chapter_number', 'description',
            'is_active', 'topics', 'topic_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_topic_count(self, obj):
        return obj.topics.count()


class ChapterCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chapter
        fields = [
            'id', 'book', 'title', 'chapter_number',
            'description', 'is_active',
        ]
        read_only_fields = ['id']


class BookReadSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    chapters = ChapterReadSerializer(many=True, read_only=True)
    chapter_count = serializers.SerializerMethodField()
    is_rtl = serializers.BooleanField(read_only=True)
    language_display = serializers.CharField(
        source='get_language_display', read_only=True,
    )

    class Meta:
        model = Book
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name',
            'subject', 'subject_name',
            'title', 'author', 'publisher', 'edition',
            'language', 'language_display', 'is_rtl',
            'description', 'is_active',
            'chapters', 'chapter_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_chapter_count(self, obj):
        return obj.chapters.count()


class BookCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Book
        fields = [
            'id', 'school', 'class_obj', 'subject',
            'title', 'author', 'publisher', 'edition',
            'language', 'description', 'is_active',
        ]
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Lesson Attachments
# ---------------------------------------------------------------------------

class LessonAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonAttachment
        fields = [
            'id', 'lesson', 'file_url', 'file_name',
            'attachment_type', 'uploaded_at',
        ]
        read_only_fields = ['id', 'uploaded_at']


# ---------------------------------------------------------------------------
# Lesson Plans
# ---------------------------------------------------------------------------

class LessonPlanReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested details for display."""
    teacher_name = serializers.CharField(source='teacher.full_name', read_only=True)
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    attachments = LessonAttachmentSerializer(many=True, read_only=True)
    planned_topics = TopicSerializer(many=True, read_only=True)
    display_text = serializers.CharField(read_only=True)
    content_mode = serializers.CharField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)

    class Meta:
        model = LessonPlan
        fields = [
            'id', 'school', 'school_name',
            'academic_year', 'academic_year_name',
            'class_obj', 'class_name',
            'subject', 'subject_name',
            'teacher', 'teacher_name',
            'title', 'description', 'objectives',
            'lesson_date', 'duration_minutes',
            'materials_needed', 'teaching_methods',
            'planned_topics', 'display_text',
            'content_mode', 'ai_generated',
            'status', 'status_display',
            'is_active', 'attachments',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class LessonPlanCreateSerializer(serializers.ModelSerializer):
    """Write serializer with flat FK fields for creation/update."""
    planned_topic_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
    )

    class Meta:
        model = LessonPlan
        fields = [
            'id', 'school', 'academic_year',
            'class_obj', 'subject', 'teacher',
            'title', 'description', 'objectives',
            'lesson_date', 'duration_minutes',
            'materials_needed', 'teaching_methods',
            'content_mode', 'ai_generated',
            'planned_topic_ids',
            'status', 'is_active',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        topic_ids = validated_data.pop('planned_topic_ids', [])
        instance = super().create(validated_data)
        if topic_ids:
            instance.planned_topics.set(topic_ids)
            instance.content_mode = 'TOPICS'
            instance.save(update_fields=['content_mode'])
            instance.compute_display_text()
        return instance

    def update(self, instance, validated_data):
        topic_ids = validated_data.pop('planned_topic_ids', None)
        instance = super().update(instance, validated_data)
        if topic_ids is not None:
            instance.planned_topics.set(topic_ids)
            instance.compute_display_text()
        return instance


# ---------------------------------------------------------------------------
# Assignment Attachments
# ---------------------------------------------------------------------------

class AssignmentAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssignmentAttachment
        fields = [
            'id', 'assignment', 'file_url', 'file_name',
            'attachment_type', 'uploaded_at',
        ]
        read_only_fields = ['id', 'uploaded_at']


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------

class AssignmentReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested details and computed submission_count."""
    teacher_name = serializers.CharField(source='teacher.full_name', read_only=True)
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    assignment_type_display = serializers.CharField(
        source='get_assignment_type_display', read_only=True,
    )
    attachments = AssignmentAttachmentSerializer(many=True, read_only=True)
    submission_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id', 'school', 'school_name',
            'academic_year', 'academic_year_name',
            'class_obj', 'class_name',
            'subject', 'subject_name',
            'teacher', 'teacher_name',
            'title', 'description', 'instructions',
            'assignment_type', 'assignment_type_display',
            'due_date', 'total_marks', 'attachments_allowed',
            'status', 'status_display',
            'is_active', 'attachments', 'submission_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AssignmentCreateSerializer(serializers.ModelSerializer):
    """Write serializer with flat FK fields for creation/update."""

    class Meta:
        model = Assignment
        fields = [
            'id', 'school', 'academic_year',
            'class_obj', 'subject', 'teacher',
            'title', 'description', 'instructions',
            'assignment_type', 'due_date', 'total_marks',
            'attachments_allowed', 'status', 'is_active',
        ]
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Assignment Submissions
# ---------------------------------------------------------------------------

class AssignmentSubmissionReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student details."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll = serializers.CharField(source='student.roll_number', read_only=True)
    assignment_title = serializers.CharField(source='assignment.title', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    graded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AssignmentSubmission
        fields = [
            'id', 'assignment', 'assignment_title',
            'student', 'student_name', 'student_roll',
            'school',
            'submission_text', 'file_url', 'file_name',
            'submitted_at',
            'status', 'status_display',
            'marks_obtained', 'feedback',
            'graded_by', 'graded_by_name', 'graded_at',
        ]
        read_only_fields = [
            'id', 'submitted_at', 'graded_by', 'graded_by_name', 'graded_at',
        ]

    def get_graded_by_name(self, obj):
        return obj.graded_by.full_name if obj.graded_by else None


class AssignmentSubmissionCreateSerializer(serializers.ModelSerializer):
    """Write serializer for students creating submissions."""

    class Meta:
        model = AssignmentSubmission
        fields = [
            'id', 'assignment', 'student', 'school',
            'submission_text', 'file_url', 'file_name',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        assignment = attrs.get('assignment')
        student = attrs.get('student')

        # Ensure the assignment is published
        if assignment and assignment.status != Assignment.Status.PUBLISHED:
            raise serializers.ValidationError({
                'assignment': 'Can only submit to published assignments.',
            })

        # Ensure the assignment is not closed
        if assignment and assignment.status == Assignment.Status.CLOSED:
            raise serializers.ValidationError({
                'assignment': 'This assignment is closed and no longer accepts submissions.',
            })

        # Ensure the student belongs to the same class as the assignment
        if assignment and student and student.class_obj_id != assignment.class_obj_id:
            raise serializers.ValidationError({
                'student': 'Student does not belong to the class this assignment is for.',
            })

        # Ensure the student belongs to the same school
        if assignment and student and student.school_id != assignment.school_id:
            raise serializers.ValidationError({
                'student': 'Student does not belong to the same school as this assignment.',
            })

        return attrs
