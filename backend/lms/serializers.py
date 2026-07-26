"""
LMS serializers for lesson plans, assignments, and submissions.
Uses Read + Create serializer pattern for each model.
"""

from rest_framework import serializers
from core.models import AIJob
from .models import (
    Book, Chapter, Topic, SubTopic, ContentBlock, ContentRevision, Tag,
    LessonPlan, LearningObjective, LessonPlanObjective, CurriculumStandard, StandardObjective, TopicStandardAlignment, LessonAttachment,
    Assignment, AssignmentAttachment, AssignmentSubmission, TOCImportJob,
)

ALLOWED_CONTENT_BLOCK_TYPES = {'paragraph', 'list', 'note', 'exercise'}


def _validate_page_range(page_start, page_end):
    if page_start and page_end and page_start > page_end:
        raise serializers.ValidationError('page_start cannot be greater than page_end.')


def _validate_content_blocks(content_blocks):
    if content_blocks in (None, ''):
        return
    if not isinstance(content_blocks, list):
        raise serializers.ValidationError('content_blocks must be a list.')
    for idx, block in enumerate(content_blocks):
        if not isinstance(block, dict):
            raise serializers.ValidationError(f'content_blocks[{idx}] must be an object.')
        block_type = (block.get('type') or '').strip().lower()
        if block_type not in ALLOWED_CONTENT_BLOCK_TYPES:
            raise serializers.ValidationError(
                f"content_blocks[{idx}].type must be one of: {', '.join(sorted(ALLOWED_CONTENT_BLOCK_TYPES))}."
            )
        text = block.get('text', '')
        if text is not None and not isinstance(text, str):
            raise serializers.ValidationError(f'content_blocks[{idx}].text must be a string.')
        items = block.get('items')
        if items is not None and not isinstance(items, list):
            raise serializers.ValidationError(f'content_blocks[{idx}].items must be a list when provided.')


# ---------------------------------------------------------------------------
# Curriculum: Book → Chapter → Topic → SubTopic
# ---------------------------------------------------------------------------

class SubTopicSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubTopic
        fields = [
            'id', 'topic', 'title', 'subtopic_number',
            'description', 'content_text', 'content_blocks_json',
            'content_schema_version', 'estimated_minutes', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ContentBlockSerializer(serializers.ModelSerializer):
    revision_note = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = ContentBlock
        fields = [
            'id', 'chapter', 'topic', 'subtopic',
            'block_type', 'content_text', 'content_rich',
            'sequence_order', 'difficulty_level', 'estimated_minutes',
            'is_ai_generated', 'is_active', 'revision_note', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        validated_data.pop('revision_note', '')
        return super().create(validated_data)

    def update(self, instance, validated_data):
        revision_note = validated_data.pop('revision_note', '')
        request = self.context.get('request')
        if request and getattr(request.user, 'is_authenticated', False):
            instance._revision_changed_by = request.user
        instance._revision_note = revision_note
        return super().update(instance, validated_data)


class ContentRevisionSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source='changed_by.username', read_only=True)

    class Meta:
        model = ContentRevision
        fields = [
            'id', 'content_block', 'content_text', 'content_rich',
            'changed_by', 'changed_by_name', 'changed_at', 'revision_note',
        ]
        read_only_fields = fields


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ['id', 'name', 'tag_type', 'subject', 'school']
        read_only_fields = ['id']


class TopicSerializer(serializers.ModelSerializer):
    is_covered = serializers.SerializerMethodField()
    subtopics = SubTopicSerializer(many=True, read_only=True)

    class Meta:
        model = Topic
        fields = [
            'id', 'chapter', 'title', 'topic_number',
            'page_start', 'page_end', 'content_kind',
            'description', 'content_blocks', 'content_text',
            'content_blocks_schema_version', 'content_version', 'needs_migration',
            'estimated_periods', 'is_active', 'is_covered', 'subtopics',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_is_covered(self, obj):
        """Check if this topic has been used in any published lesson plan."""
        return obj.lesson_plans.filter(status='PUBLISHED').exists()

    def validate(self, attrs):
        instance = getattr(self, 'instance', None)
        page_start = attrs.get('page_start', getattr(instance, 'page_start', None))
        page_end = attrs.get('page_end', getattr(instance, 'page_end', None))
        content_blocks = attrs.get('content_blocks', getattr(instance, 'content_blocks', []))
        _validate_page_range(page_start, page_end)
        _validate_content_blocks(content_blocks)
        return attrs


class TopicDetailedSerializer(serializers.ModelSerializer):
    """Topic with teaching and testing coverage status."""

    subtopics = SubTopicSerializer(many=True, read_only=True)

    is_covered = serializers.BooleanField(read_only=True)
    is_tested = serializers.BooleanField(read_only=True)
    test_question_count = serializers.IntegerField(read_only=True)
    lesson_plan_count = serializers.IntegerField(read_only=True)
    
    # Linked resources
    lesson_plans = serializers.SerializerMethodField()
    test_questions = serializers.SerializerMethodField()
    
    def get_lesson_plans(self, obj):
        """Simplified lesson plan list."""
        return [
            {'id': lp.id, 'title': lp.title, 'lesson_date': lp.lesson_date}
            for lp in obj.lesson_plans.filter(is_active=True)
        ]
    
    def get_test_questions(self, obj):
        """Simplified question list."""
        return [
            {
                'id': q.id,
                'question_type': q.question_type,
                'difficulty_level': q.difficulty_level,
                'marks': q.marks,
            }
            for q in obj.test_questions.filter(is_active=True)[:5]  # Limit to 5
        ]
    
    class Meta:
        model = Topic
        fields = [
            'id', 'title', 'topic_number',
            'page_start', 'page_end', 'content_kind',
            'description', 'content_blocks', 'content_text',
            'content_blocks_schema_version', 'content_version', 'needs_migration',
            'estimated_periods', 'is_active', 'subtopics',
            'is_covered',          # NEW
            'is_tested',           # NEW
            'test_question_count', # NEW
            'lesson_plan_count',   # NEW
            'lesson_plans',        # NEW
            'test_questions',      # NEW
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'is_covered', 'is_tested', 'test_question_count',
            'lesson_plan_count', 'lesson_plans', 'test_questions',
            'created_at', 'updated_at'
        ]


class ChapterReadSerializer(serializers.ModelSerializer):
    topics = TopicSerializer(many=True, read_only=True)
    topic_count = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = [
            'id', 'book', 'title', 'chapter_number',
            'page_start', 'page_end',
            'description', 'content_blocks', 'content_text',
            'content_blocks_schema_version', 'content_version', 'needs_migration',
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
            'page_start', 'page_end',
            'description', 'content_blocks', 'content_text',
            'content_blocks_schema_version', 'content_version', 'needs_migration',
            'is_active',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        instance = getattr(self, 'instance', None)
        page_start = attrs.get('page_start', getattr(instance, 'page_start', None))
        page_end = attrs.get('page_end', getattr(instance, 'page_end', None))
        content_blocks = attrs.get('content_blocks', getattr(instance, 'content_blocks', []))
        _validate_page_range(page_start, page_end)
        _validate_content_blocks(content_blocks)
        return attrs


class ChapterSummarySerializer(serializers.ModelSerializer):
    topic_count = serializers.SerializerMethodField()

    class Meta:
        model = Chapter
        fields = [
            'id', 'title', 'chapter_number',
            'page_start', 'page_end',
            'topic_count',
        ]

    def get_topic_count(self, obj):
        return obj.topics.count()


class BookChapterOnlyReadSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    chapters = ChapterSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Book
        fields = [
            'id', 'class_obj', 'class_name',
            'subject', 'subject_name',
            'title', 'language',
            'chapters',
        ]


class SubTopicLessonPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubTopic
        fields = ['id', 'title', 'subtopic_number', 'description']


class TopicLessonPlanSerializer(serializers.ModelSerializer):
    subtopics = SubTopicLessonPlanSerializer(many=True, read_only=True)

    class Meta:
        model = Topic
        fields = [
            'id', 'title', 'topic_number',
            'page_start', 'page_end',
            'estimated_periods',
            'content_kind',
            'description',
            'subtopics',
        ]


class ChapterLessonPlanSerializer(serializers.ModelSerializer):
    topics = TopicLessonPlanSerializer(many=True, read_only=True)

    class Meta:
        model = Chapter
        fields = [
            'id', 'title', 'chapter_number',
            'page_start', 'page_end',
            'topics',
        ]


class BookLessonPlanReadSerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    chapters = ChapterLessonPlanSerializer(many=True, read_only=True)

    class Meta:
        model = Book
        fields = [
            'id', 'class_obj', 'class_name',
            'subject', 'subject_name',
            'title', 'language',
            'chapters',
        ]


class TopicExamExercisesSerializer(serializers.ModelSerializer):
    chapter_number = serializers.IntegerField(source='chapter.chapter_number', read_only=True)
    chapter_title = serializers.CharField(source='chapter.title', read_only=True)
    test_question_count = serializers.IntegerField(source='active_test_question_count', read_only=True)

    class Meta:
        model = Topic
        fields = [
            'id',
            'chapter', 'chapter_number', 'chapter_title',
            'title', 'topic_number',
            'page_start', 'page_end',
            'content_kind',
            'test_question_count',
        ]


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


class LearningObjectiveSerializer(serializers.ModelSerializer):
    topic_title = serializers.CharField(source='topic.title', read_only=True)

    class Meta:
        model = LearningObjective
        fields = [
            'id', 'topic', 'topic_title', 'statement', 'bloom_level',
            'is_ai_generated', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class StandardObjectiveSerializer(serializers.ModelSerializer):
    standard_name = serializers.CharField(source='standard.name', read_only=True)

    class Meta:
        model = StandardObjective
        fields = ['id', 'standard', 'standard_name', 'subject', 'grade', 'code', 'statement']
        read_only_fields = fields


# ---------------------------------------------------------------------------
# Lesson Plans
# ---------------------------------------------------------------------------

class LessonPlanReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested details for display."""
    teacher_name = serializers.CharField(source='teacher.full_name', read_only=True)
    class_name = serializers.SerializerMethodField()
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True, default=None,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    objectives = serializers.SerializerMethodField()
    objectives_text = serializers.CharField(source='objectives', read_only=True)
    attachments = LessonAttachmentSerializer(many=True, read_only=True)
    planned_topics = TopicSerializer(many=True, read_only=True)
    planned_subtopics = SubTopicSerializer(many=True, read_only=True)
    linked_objectives = serializers.SerializerMethodField()
    display_text = serializers.CharField(read_only=True)
    content_mode = serializers.CharField(read_only=True)
    ai_generated = serializers.BooleanField(read_only=True)
    custom_topics = serializers.ListField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = LessonPlan
        fields = [
            'id', 'school', 'school_name',
            'academic_year', 'academic_year_name',
            'class_obj', 'class_name',
            'subject', 'subject_name',
            'teacher', 'teacher_name',
            'title', 'description', 'objectives', 'objectives_text',
            'lesson_date', 'duration_minutes',
            'materials_needed', 'teaching_methods',
            'planned_topics', 'planned_subtopics', 'custom_topics',
            'linked_objectives', 'display_text',
            'content_mode', 'ai_generated',
            'status', 'status_display',
            'is_active', 'attachments',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_linked_objectives(self, obj):
        objectives = [link.objective for link in obj.lesson_objectives.all()]
        return LearningObjectiveSerializer(objectives, many=True).data

    def get_objectives(self, obj):
        return self.get_linked_objectives(obj)

    def get_class_name(self, obj):
        session_name = getattr(obj, 'session_display_name', None)
        if session_name:
            section = getattr(obj, 'session_display_section', None)
            return f"{session_name} - {section}" if section else session_name
        return obj.class_obj.name if obj.class_obj_id else None


class LessonPlanCreateSerializer(serializers.ModelSerializer):
    """Write serializer with flat FK fields for creation/update."""
    # Model field has blank=False but drafts often omit body text; allow API empty string.
    description = serializers.CharField(allow_blank=True, required=False, default='')
    planned_topic_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
    )
    planned_subtopic_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
    )
    ai_job_id = serializers.IntegerField(required=False, write_only=True)
    custom_topics = serializers.ListField(
        child=serializers.CharField(max_length=200, allow_blank=True),
        required=False,
        max_length=20,
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
            'planned_topic_ids', 'planned_subtopic_ids', 'custom_topics', 'ai_job_id',
            'status', 'is_active',
        ]
        read_only_fields = ['id']

    def validate_custom_topics(self, value):
        cleaned = [label.strip() for label in value if label.strip()]
        return cleaned

    def _merge_topic_ids_from_subtopics(self, topic_ids, subtopic_ids):
        tid_set = {int(x) for x in (topic_ids or []) if x is not None}
        if subtopic_ids:
            for parent_id in SubTopic.objects.filter(
                id__in=subtopic_ids,
            ).values_list('topic_id', flat=True):
                tid_set.add(int(parent_id))
        return list(tid_set)

    def create(self, validated_data):
        topic_ids = validated_data.pop('planned_topic_ids', []) or []
        subtopic_ids = validated_data.pop('planned_subtopic_ids', []) or []
        ai_job_id = validated_data.pop('ai_job_id', None)
        merged_topics = self._merge_topic_ids_from_subtopics(topic_ids, subtopic_ids)
        instance = super().create(validated_data)
        if merged_topics:
            instance.planned_topics.set(merged_topics)
        if subtopic_ids:
            instance.planned_subtopics.set(subtopic_ids)
        if merged_topics or subtopic_ids:
            instance.content_mode = 'TOPICS'
            instance.save(update_fields=['content_mode'])
        if merged_topics or subtopic_ids or instance.custom_topics:
            instance.compute_display_text()
        if ai_job_id and instance.ai_generated:
            AIJob.objects.filter(id=ai_job_id).update(accepted=True)
        return instance

    def update(self, instance, validated_data):
        topic_ids = validated_data.pop('planned_topic_ids', None)
        subtopic_ids = validated_data.pop('planned_subtopic_ids', None)
        ai_job_id = validated_data.pop('ai_job_id', None)
        custom_topics_changed = 'custom_topics' in validated_data
        instance = super().update(instance, validated_data)
        topics_changed = topic_ids is not None or subtopic_ids is not None
        if topics_changed:
            t_list = topic_ids if topic_ids is not None else list(
                instance.planned_topics.values_list('id', flat=True),
            )
            s_list = subtopic_ids if subtopic_ids is not None else list(
                instance.planned_subtopics.values_list('id', flat=True),
            )
            merged = self._merge_topic_ids_from_subtopics(t_list, s_list)
            instance.planned_topics.set(merged)
            instance.planned_subtopics.set(s_list or [])
        if topics_changed or custom_topics_changed:
            instance.compute_display_text()
        if ai_job_id and instance.ai_generated:
            AIJob.objects.filter(id=ai_job_id).update(accepted=True)
        return instance


class LessonPlanBulkCreateSerializer(serializers.Serializer):
    """
    Validate payload for POST /api/lms/lesson-plans/bulk_create/.
    Creates one LessonPlan per teaching day in [date_from, date_to], excluding
    school OFF days (calendar_rules) and optionally Saturdays.
    """

    BULK_MAX_DAYS = 35

    date_from = serializers.DateField()
    date_to = serializers.DateField()
    skip_saturday = serializers.BooleanField(default=True)
    on_conflict = serializers.ChoiceField(
        choices=('skip', 'error'),
        default='skip',
    )
    title_template = serializers.CharField(
        required=False, allow_blank=True, max_length=200, default='',
    )

    school = serializers.IntegerField()
    academic_year = serializers.IntegerField(required=False, allow_null=True)
    class_obj = serializers.IntegerField()
    subject = serializers.IntegerField()
    teacher = serializers.IntegerField()
    duration_minutes = serializers.IntegerField(default=45, min_value=1, max_value=600)
    content_mode = serializers.ChoiceField(
        choices=('TOPICS', 'FREEFORM'),
        default='FREEFORM',
    )
    planned_topic_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
    )
    planned_subtopic_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
    )
    custom_topics = serializers.ListField(
        child=serializers.CharField(max_length=200, allow_blank=True),
        required=False,
        default=list,
        max_length=20,
    )
    description = serializers.CharField(required=False, allow_blank=True, default='')
    objectives = serializers.CharField(required=False, allow_blank=True, default='')
    materials_needed = serializers.CharField(required=False, allow_blank=True, default='')
    teaching_methods = serializers.CharField(required=False, allow_blank=True, default='')
    ai_generated = serializers.BooleanField(default=False)

    def validate(self, attrs):
        d0, d1 = attrs['date_from'], attrs['date_to']
        if d1 < d0:
            raise serializers.ValidationError({
                'date_to': 'Must be on or after date_from.',
            })
        span = (d1 - d0).days + 1
        if span > self.BULK_MAX_DAYS:
            raise serializers.ValidationError({
                'date_to': f'Date range must not exceed {self.BULK_MAX_DAYS} days.',
            })
        return attrs


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
    class_name = serializers.SerializerMethodField()
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
            'requires_submission',
            'due_date', 'total_marks', 'attachments_allowed',
            'status', 'status_display',
            'is_active', 'attachments', 'submission_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_class_name(self, obj):
        session_name = getattr(obj, 'session_display_name', None)
        if session_name:
            section = getattr(obj, 'session_display_section', None)
            return f"{session_name} - {section}" if section else session_name
        return obj.class_obj.name if obj.class_obj_id else None


class AssignmentCreateSerializer(serializers.ModelSerializer):
    """Write serializer with flat FK fields for creation/update."""

    class Meta:
        model = Assignment
        fields = [
            'id', 'school', 'academic_year',
            'class_obj', 'subject', 'teacher',
            'title', 'description', 'instructions',
            'assignment_type', 'requires_submission',
            'due_date', 'total_marks',
            'attachments_allowed', 'status', 'is_active',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        from lms.models import Assignment as AssignmentModel
        assignment_type = attrs.get(
            'assignment_type',
            getattr(self.instance, 'assignment_type', AssignmentModel.AssignmentType.HOMEWORK),
        )

        # DIARY is always read-only — force requires_submission=False regardless of payload
        if assignment_type == AssignmentModel.AssignmentType.DIARY:
            attrs['requires_submission'] = False

        # due_date is required for submission-based types
        requires_submission = attrs.get(
            'requires_submission',
            getattr(self.instance, 'requires_submission', True),
        )
        due_date = attrs.get('due_date', getattr(self.instance, 'due_date', None))
        if requires_submission and not due_date:
            raise serializers.ValidationError({
                'due_date': 'Due date is required for submission-based assignments.',
            })

        return attrs


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

        # Ensure the assignment accepts submissions
        if assignment and not assignment.requires_submission:
            raise serializers.ValidationError({
                'assignment': 'This assignment does not accept submissions.',
            })

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


class TOCImportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = TOCImportJob
        fields = [
            'id', 'book', 'requested_by',
            'status', 'error_message', 'result_payload',
            'attempt_count', 'started_at', 'completed_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields
