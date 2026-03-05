# Curriculum → Lesson Plans → Paper Builder: Full Implementation Plan

## Executive Summary

**Objective:** Connect LMS (Curriculum/TOC), Lesson Plans, and the Question Paper Builder into a unified teaching-to-testing workflow.

**Scope:** 3-phase implementation across backend, frontend, and documentation.

**Timeline:** ~8-10 hours total development

**Deliverables:**
- Database schema (2 new M2M relationships)
- 8 new API endpoints + 4 enhanced endpoints
- 5 new frontend components + 3 updated pages
- Updated documentation (BACKEND_APPS.md, API_ENDPOINTS.md, API_RESPONSES.md, FRONTEND_PAGES.md)
- Updated user guide PDF (KoderEduAI_User_Guide.pdf)

---

# PHASE 1: BACKEND IMPLEMENTATION (3.5 hours)

## Overview
Build database schema, models, serializers, and API endpoints for curriculum-to-paper connections.

---

## 1.1: Database Schema & Models (45 mins)

### Task 1.1.1: Create Migration File
**File:** `backend/examinations/migrations/0005_auto_20260304_question_tested_topics.py`

```python
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('lms', '0001_initial'),  # Ensure LMS models exist
        ('examinations', '0004_exampaper_paperupload_paperfeedback_question_and_more'),
    ]

    operations = [
        # Add M2M: Question ↔ Topic
        migrations.AddField(
            model_name='question',
            name='tested_topics',
            field=models.ManyToManyField(
                'lms.Topic',
                blank=True,
                related_name='test_questions',
                help_text='Curriculum topics this question tests'
            ),
        ),
        
        # Add M2M: ExamPaper ↔ LessonPlan
        migrations.AddField(
            model_name='exampaper',
            name='lesson_plans',
            field=models.ManyToManyField(
                'lms.LessonPlan',
                blank=True,
                related_name='exam_papers',
                help_text='Lesson plans whose content is tested in this paper'
            ),
        ),
        
        # Add index for topic filtering
        migrations.AddIndex(
            model_name='question',
            index=models.Index(
                fields=['school', 'is_active'],
                name='exam_q_school_active_idx'
            ),
        ),
    ]
```

**Rationale:**
- M2M to `Topic`: Questions can test multiple topics; topics can have multiple questions
- M2M to `LessonPlan`: Papers can test multiple lessons; lessons can have multiple papers
- Blank=True allows gradual adoption (not forced connections)
- Indexes optimize filtering queries

---

### Task 1.1.2: Update Question Model
**File:** `backend/examinations/models.py` (lines 309-390)

**Find this section:**
```python
class Question(models.Model):
    """Question bank for exam papers."""
    
    school = models.ForeignKey(...)
    subject = models.ForeignKey(...)
    # ... other existing fields ...
```

**Add after `created_at` field, before closing class:**
```python
    # NEW: Curriculum links
    tested_topics = models.ManyToManyField(
        'lms.Topic',
        blank=True,
        related_name='test_questions',
        help_text='Curriculum topics this question tests'
    )
    
    # Keep existing is_active and dates
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ... rest of existing Meta and methods ...
```

---

### Task 1.1.3: Update ExamPaper Model
**File:** `backend/examinations/models.py` (lines 391-530)

**Find this section:**
```python
class ExamPaper(models.Model):
    """A complete exam paper with multiple questions."""
    
    # ... existing fields ...
    status = models.CharField(...)
    generated_by = models.ForeignKey(...)
```

**Add after `generated_by` field, before `is_active`:**
```python
    # NEW: Teaching alignment
    lesson_plans = models.ManyToManyField(
        'lms.LessonPlan',
        blank=True,
        related_name='exam_papers',
        help_text='Lesson plans whose content is tested in this paper'
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ... rest of existing methods ...
```

**Add new computed property before closing class:**
```python
    @property
    def covered_topics(self):
        """Get all unique topics tested via questions in this paper."""
        from lms.models import Topic
        question_ids = self.paper_questions.values_list('question_id', flat=True)
        return Topic.objects.filter(
            test_questions__id__in=question_ids
        ).select_related('chapter', 'chapter__book').distinct()
    
    @property
    def question_topics_summary(self):
        """Summary: {topic_id: question_count} for this paper."""
        from django.db.models import Count
        topics_qs = self.covered_topics.annotate(
            question_count=Count('test_questions', filter=models.Q(
                test_questions__paper_questions__exam_paper=self
            ))
        )
        return {
            t.id: {
                'title': f"{t.chapter.chapter_number}.{t.topic_number}: {t.title}",
                'question_count': t.question_count
            }
            for t in topics_qs
        }
```

---

### Task 1.1.4: Add Topic Properties
**File:** `backend/lms/models.py` (lines 100-130, in Topic class)

**Add after the class Meta definition, before closing class:**
```python
    @property
    def is_covered(self):
        """Check if this topic has any lesson plans linked."""
        return self.lesson_plans.filter(is_active=True).exists()
    
    @property
    def is_tested(self):
        """Check if this topic has any test questions."""
        return self.test_questions.filter(is_active=True).exists()
    
    @property
    def test_question_count(self):
        """Count of active test questions for this topic."""
        return self.test_questions.filter(is_active=True).count()
    
    @property
    def lesson_plan_count(self):
        """Count of lesson plans covering this topic."""
        return self.lesson_plans.filter(is_active=True).count()
```

**Rationale:** These properties expose coverage status without additional queries (computed on demand).

---

## 1.2: Serializers (45 mins)

### Task 1.2.1: Update Question Serializer
**File:** `backend/examinations/serializers.py` (around line 150-180)

**Find:**
```python
class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = [...]
```

**Update fields list to include:**
```python
class QuestionSerializer(serializers.ModelSerializer):
    # NEW: Read-only details of tested topics
    tested_topics = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Topic.objects.all(),
        required=False,
        allow_null=True
    )
    tested_topics_details = serializers.SerializerMethodField()
    
    def get_tested_topics_details(self, obj):
        """Return full topic details."""
        return [
            {
                'id': t.id,
                'title': t.title,
                'chapter_number': t.chapter.chapter_number,
                'topic_number': t.topic_number,
                'chapter_title': t.chapter.title,
                'book_title': t.chapter.book.title,
            }
            for t in obj.tested_topics.select_related('chapter', 'chapter__book').all()
        ]
    
    class Meta:
        model = Question
        fields = [
            'id', 'school', 'subject', 'exam_type',
            'question_text', 'question_image_url', 'question_type',
            'difficulty_level', 'marks',
            'option_a', 'option_b', 'option_c', 'option_d',
            'correct_answer',
            'tested_topics',           # NEW: M2M FK list
            'tested_topics_details',   # NEW: expanded details
            'created_by', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'tested_topics_details']
```

---

### Task 1.2.2: Update ExamPaper Serializer
**File:** `backend/examinations/serializers.py` (around line 250-320)

**Find:**
```python
class ExamPaperSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamPaper
        fields = [...]
```

**Update to include:**
```python
class ExamPaperSerializer(serializers.ModelSerializer):
    # NEW: lesson plans
    lesson_plans = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=LessonPlan.objects.all(),
        required=False,
        allow_null=True
    )
    lesson_plans_details = serializers.SerializerMethodField()
    
    # Existing
    paper_questions = PaperQuestionSerializer(many=True, read_only=True)
    
    # NEW: computed properties
    covered_topics = serializers.SerializerMethodField()
    question_topics_summary = serializers.SerializerMethodField()
    
    def get_lesson_plans_details(self, obj):
        """Return lesson plan details."""
        return [
            {
                'id': lp.id,
                'title': lp.title,
                'lesson_date': lp.lesson_date,
                'class': lp.class_obj.name,
                'subject': lp.subject.name,
            }
            for lp in obj.lesson_plans.select_related('class_obj', 'subject').all()
        ]
    
    def get_covered_topics(self, obj):
        """Topics tested via questions."""
        return [
            {
                'id': t.id,
                'chapter_number': t.chapter.chapter_number,
                'topic_number': t.topic_number,
                'title': t.title,
            }
            for t in obj.covered_topics
        ]
    
    def get_question_topics_summary(self, obj):
        """Question count per topic."""
        return obj.question_topics_summary
    
    class Meta:
        model = ExamPaper
        fields = [
            'id', 'school', 'exam', 'exam_subject', 'class_obj', 'subject',
            'paper_title', 'instructions', 'total_marks', 'duration_minutes',
            'questions', 'paper_questions',
            'lesson_plans',              # NEW
            'lesson_plans_details',      # NEW
            'covered_topics',            # NEW: computed
            'question_topics_summary',   # NEW: computed
            'status', 'generated_by',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'lesson_plans_details', 'covered_topics', 'question_topics_summary'
        ]
```

---

### Task 1.2.3: Create Topic Serializer (LMS)
**File:** `backend/lms/serializers.py` (add new serializer)

**Add:**
```python
class TopicDetailedSerializer(serializers.ModelSerializer):
    """Topic with teaching and testing coverage status."""
    
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
            'id', 'title', 'topic_number', 'description',
            'estimated_periods', 'is_active',
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
```

---

## 1.3: ViewSets & API Endpoints (90 mins)

### Task 1.3.1: Enhance Question ViewSet
**File:** `backend/examinations/views.py` (update QuestionViewSet)

**Find:**
```python
class QuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
```

**Add these methods inside the class:**
```python
    def get_queryset(self):
        """Enhanced filtering for topics and lesson plans."""
        qs = super().get_queryset().select_related('subject', 'exam_type', 'created_by')
        
        # Filter by specific topics
        topic_ids = self.request.query_params.getlist('topics')
        if topic_ids:
            qs = qs.filter(tested_topics__id__in=topic_ids).distinct()

        # Filter by lesson plan (get all topics from lesson plan)
        lesson_plan_id = self.request.query_params.get('lesson_plan')
        if lesson_plan_id:
            from lms.models import LessonPlan
            try:
                lesson = LessonPlan.objects.get(
                    id=lesson_plan_id,
                    school=self.request.tenant_school
                )
                topic_ids = lesson.planned_topics.values_list('id', flat=True)
                qs = qs.filter(tested_topics__id__in=topic_ids).distinct()
            except LessonPlan.DoesNotExist:
                pass
        
        # Filter by question type
        qtype = self.request.query_params.get('question_type')
        if qtype:
            qs = qs.filter(question_type=qtype)
        
        # Filter by difficulty
        difficulty = self.request.query_params.get('difficulty_level')
        if difficulty:
            qs = qs.filter(difficulty_level=difficulty)
        
        return qs

    @action(detail=False, methods=['post'])
    def generate_from_lesson(self, request):
        """
        Generate AI questions from a lesson plan.
        
        Body: {
            lesson_plan_id: int,
            question_count: int (5-20),
            question_type: str (MCQ/SHORT/ESSAY/TRUE_FALSE),
            difficulty_level: str (EASY/MEDIUM/HARD)
        }
        
        Returns: {questions: [...], message: "..."}
        """
        lesson_plan_id = request.data.get('lesson_plan_id')
        question_count = request.data.get('question_count', 5)
        question_type = request.data.get('question_type', 'MCQ')
        difficulty_level = request.data.get('difficulty_level', 'MEDIUM')
        
        # Validate inputs
        if not lesson_plan_id:
            return Response(
                {'error': 'lesson_plan_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not (5 <= question_count <= 20):
            return Response(
                {'error': 'question_count must be between 5 and 20'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Fetch lesson plan
        from lms.models import LessonPlan
        try:
            lesson = LessonPlan.objects.get(
                id=lesson_plan_id,
                school=request.tenant_school
            )
        except LessonPlan.DoesNotExist:
            return Response(
                {'error': 'Lesson plan not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get topics
        topics = lesson.planned_topics.select_related(
            'chapter', 'chapter__book'
        ).all()
        
        if not topics:
            return Response(
                {'error': 'Lesson plan has no topics selected'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build AI prompt
        topics_text = '\n'.join([
            f"- Chapter {t.chapter.chapter_number}: {t.chapter.title}\n"
            f"  Topic {t.topic_number}: {t.title}\n"
            f"  Description: {t.description or 'N/A'}"
            for t in topics
        ])
        
        prompt = f"""You are an expert educator creating {question_type} questions for {lesson.subject.name} exam at {lesson.class_obj.name} level, {difficulty_level.lower()} difficulty.

Generate exactly {question_count} questions based on these topics:

{topics_text}

For each question:
1. Write clear, concise question text
2. For MCQ: provide 4 options (A, B, C, D) with one correct answer
3. Specify which topic (e.g., "3.2") it tests
4. Assign marks

Respond with ONLY a JSON array, no extra text:
[
  {{
    "question_text": "...",
    "question_type": "{question_type}",
    "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
    "correct_answer": "A",
    "tested_topic_number": "3.2",
    "marks": 2
  }}
]
"""
        
        # Call Groq API
        import requests
        import json
        import re
        from django.conf import settings
        
        try:
            groq_response = requests.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {settings.GROQ_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': settings.GROQ_MODEL,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0.7,
                    'max_tokens': 2048,
                },
                timeout=30,
            )
            groq_response.raise_for_status()
            
            # Parse response
            ai_text = groq_response.json()['choices'][0]['message']['content'].strip()
            
            # Extract JSON from response
            json_match = re.search(r'\[.*\]', ai_text, re.DOTALL)
            if json_match:
                questions_data = json.loads(json_match.group())
            else:
                questions_data = json.loads(ai_text)
            
            # Create Question objects
            created_questions = []
            for q_data in questions_data:
                # Parse topic number "3.2"
                topic_num_str = q_data.get('tested_topic_number', '')
                parts = topic_num_str.split('.')
                tested_topic = None
                
                if len(parts) == 2:
                    try:
                        ch_num, t_num = int(parts[0]), int(parts[1])
                        for t in topics:
                            if (t.chapter.chapter_number == ch_num and 
                                t.topic_number == t_num):
                                tested_topic = t
                                break
                    except ValueError:
                        pass
                
                # Create question
                question = Question.objects.create(
                    school=request.tenant_school,
                    subject=lesson.subject,
                    question_text=q_data.get('question_text', ''),
                    question_type=question_type,
                    difficulty_level=difficulty_level,
                    marks=q_data.get('marks', 1),
                    option_a=q_data.get('options', {}).get('A', ''),
                    option_b=q_data.get('options', {}).get('B', ''),
                    option_c=q_data.get('options', {}).get('C', ''),
                    option_d=q_data.get('options', {}).get('D', ''),
                    correct_answer=q_data.get('correct_answer', ''),
                    created_by=request.user,
                )
                
                # Link to topic
                if tested_topic:
                    question.tested_topics.add(tested_topic)
                
                created_questions.append(question)
            
            serializer = QuestionSerializer(created_questions, many=True)
            return Response({
                'message': f'Generated {len(created_questions)} questions',
                'questions': serializer.data,
            }, status=status.HTTP_201_CREATED)
            
        except requests.RequestException as e:
            return Response(
                {'error': f'API error: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except json.JSONDecodeError as e:
            return Response(
                {'error': f'Invalid JSON from AI: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        except Exception as e:
            return Response(
                {'error': f'Generation failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'])
    def by_lesson_plan(self, request):
        """
        Get all questions for a lesson plan's topics.
        Query params: lesson_plan_id (required)
        """
        lesson_plan_id = request.query_params.get('lesson_plan_id')
        if not lesson_plan_id:
            return Response(
                {'error': 'lesson_plan_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from lms.models import LessonPlan
        try:
            lesson = LessonPlan.objects.get(
                id=lesson_plan_id,
                school=request.tenant_school
            )
        except LessonPlan.DoesNotExist:
            return Response(
                {'error': 'Lesson plan not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        topic_ids = lesson.planned_topics.values_list('id', flat=True)
        qs = self.get_queryset().filter(tested_topics__id__in=topic_ids).distinct()
        
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)
```

---

### Task 1.3.2: Enhance ExamPaper ViewSet
**File:** `backend/examinations/views.py` (update ExamPaperViewSet)

**Add these methods:**
```python
    @action(detail=True, methods=['post'])
    def link_lesson_plans(self, request, pk=None):
        """
        Link lesson plans to this exam paper.
        Body: {lesson_plan_ids: [1, 2, 3]}
        """
        exam_paper = self.get_object()
        lesson_plan_ids = request.data.get('lesson_plan_ids', [])
        
        from lms.models import LessonPlan
        lesson_plans = LessonPlan.objects.filter(
            id__in=lesson_plan_ids,
            school=request.tenant_school
        )
        
        exam_paper.lesson_plans.set(lesson_plans)
        
        serializer = self.get_serializer(exam_paper)
        return Response({
            'message': f'Linked {lesson_plans.count()} lesson plans',
            'exam_paper': serializer.data
        })
    
    @action(detail=True, methods=['get'])
    def coverage_stats(self, request, pk=None):
        """
        Get coverage statistics for this exam paper.
        Returns: topics count, covered topics, lesson plans, etc.
        """
        exam_paper = self.get_object()
        
        return Response({
            'exam_paper_id': exam_paper.id,
            'paper_title': exam_paper.paper_title,
            'total_questions': exam_paper.question_count,
            'total_marks': exam_paper.total_marks,
            'covered_topics': [
                {
                    'id': t.id,
                    'chapter': f"{t.chapter.chapter_number}: {t.chapter.title}",
                    'topic': f"{t.topic_number}: {t.title}",
                    'questions_count': t.test_questions.filter(
                        paper_questions__exam_paper=exam_paper
                    ).count(),
                }
                for t in exam_paper.covered_topics
            ],
            'linked_lesson_plans': [
                {
                    'id': lp.id,
                    'title': lp.title,
                    'lesson_date': lp.lesson_date,
                }
                for lp in exam_paper.lesson_plans.all()
            ],
            'topic_count': exam_paper.covered_topics.count(),
        })
    
    @action(detail=False, methods=['post'])
    def create_from_lessons(self, request):
        """
        Create exam paper from lesson plans.
        
        Body: {
            lesson_plan_ids: [1, 2, 3],
            class_id: 5,
            subject_id: 10,
            paper_title: "Mid-Term Exam",
            instructions: "...",
            total_marks: 100,
            duration_minutes: 60,
            question_type: "MCQ",
            difficulty_balance: {"EASY": 0.3, "MEDIUM": 0.5, "HARD": 0.2}
        }
        """
        from lms.models import LessonPlan
        
        lesson_plan_ids = request.data.get('lesson_plan_ids', [])
        class_id = request.data.get('class_id')
        subject_id = request.data.get('subject_id')
        paper_title = request.data.get('paper_title')
        instructions = request.data.get('instructions', '')
        total_marks = request.data.get('total_marks', 100)
        duration_minutes = request.data.get('duration_minutes', 60)
        
        if not (lesson_plan_ids and class_id and subject_id and paper_title):
            return Response(
                {'error': 'Missing required fields'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Fetch lesson plans
        lesson_plans = LessonPlan.objects.filter(
            id__in=lesson_plan_ids,
            school=request.tenant_school
        )
        
        if not lesson_plans.exists():
            return Response(
                {'error': 'No lesson plans found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get topics from lesson plans
        topic_ids = set()
        for lp in lesson_plans:
            topic_ids.update(lp.planned_topics.values_list('id', flat=True))
        
        if not topic_ids:
            return Response(
                {'error': 'Selected lesson plans have no topics'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get questions for those topics
        questions_qs = Question.objects.filter(
            school=request.tenant_school,
            subject_id=subject_id,
            tested_topics__id__in=topic_ids,
            is_active=True
        ).distinct()
        
        if not questions_qs.exists():
            return Response(
                {'error': 'No questions available for selected topics'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create exam paper
        exam_paper = ExamPaper.objects.create(
            school=request.tenant_school,
            class_obj_id=class_id,
            subject_id=subject_id,
            paper_title=paper_title,
            instructions=instructions,
            total_marks=total_marks,
            duration_minutes=duration_minutes,
            status='DRAFT',
            generated_by=request.user,
        )
        
        # Link lesson plans
        exam_paper.lesson_plans.set(lesson_plans)
        
        # Add questions (balance by difficulty if needed)
        selected_questions = list(questions_qs[:15])  # Default: up to 15 questions
        
        for idx, q in enumerate(selected_questions):
            PaperQuestion.objects.create(
                exam_paper=exam_paper,
                question=q,
                question_order=idx + 1,
                marks_override=q.marks,
            )
        
        serializer = ExamPaperSerializer(exam_paper)
        return Response({
            'message': f'Created paper with {len(selected_questions)} questions',
            'exam_paper': serializer.data,
        }, status=status.HTTP_201_CREATED)
```

---

### Task 1.3.3: Create Topic Coverage ViewSet (LMS)
**File:** `backend/lms/views.py` (add new ViewSet)

**Add:**
```python
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from lms.models import Topic, Book
from lms.serializers import TopicDetailedSerializer

class TopicViewSet(viewsets.ReadOnlyModelViewSet):
    """Topics with coverage status (teaching + testing)."""
    
    serializer_class = TopicDetailedSerializer
    
    def get_queryset(self):
        """Filter topics by class, subject, book."""
        qs = Topic.objects.select_related(
            'chapter', 'chapter__book'
        ).prefetch_related('lesson_plans', 'test_questions')
        
        # Filter by book
        book_id = self.request.query_params.get('book_id')
        if book_id:
            qs = qs.filter(chapter__book_id=book_id)
        
        # Filter by class (via book)
        class_id = self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(chapter__book__class_obj_id=class_id)
        
        # Filter by subject
        subject_id = self.request.query_params.get('subject_id')
        if subject_id:
            qs = qs.filter(chapter__book__subject_id=subject_id)
        
        # Filter by coverage status
        coverage = self.request.query_params.get('coverage')
        if coverage == 'taught_only':
            # Topics with lesson plans
            qs = qs.filter(lesson_plans__is_active=True).distinct()
        elif coverage == 'tested_only':
            # Topics with questions
            qs = qs.filter(test_questions__is_active=True).distinct()
        elif coverage == 'both':
            # Topics with both lesson plans and questions
            qs = qs.filter(
                lesson_plans__is_active=True,
                test_questions__is_active=True
            ).distinct()
        elif coverage == 'none':
            # Topics with neither
            qs = qs.exclude(lesson_plans__is_active=True).exclude(
                test_questions__is_active=True
            ).distinct()
        
        return qs
    
    @action(detail=False, methods=['get'])
    def coverage_summary(self, request):
        """
        Summary of topics by coverage status.
        
        Query params:
        - book_id: filter by book
        - class_id: filter by class
        - subject_id: filter by subject
        """
        qs = self.get_queryset()
        
        # Count by status
        book_id = self.request.query_params.get('book_id')
        if book_id:
            book = Book.objects.get(id=book_id)
            total = Topic.objects.filter(chapter__book=book).count()
        else:
            total = qs.count()
        
        taught = qs.filter(lesson_plans__is_active=True).distinct().count()
        tested = qs.filter(test_questions__is_active=True).distinct().count()
        both = qs.filter(
            lesson_plans__is_active=True,
            test_questions__is_active=True
        ).distinct().count()
        
        return Response({
            'total_topics': total,
            'taught_topics': taught,
            'tested_topics': tested,
            'both_taught_and_tested': both,
            'taught_percentage': round(taught / total * 100, 1) if total else 0,
            'tested_percentage': round(tested / total * 100, 1) if total else 0,
        })
```

---

### Task 1.3.4: Update URLs
**File:** `backend/lms/urls.py`

**Update router registration:**
```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from lms.views import TopicViewSet  # ADD THIS

router = DefaultRouter()
# ... existing registrations ...
router.register(r'topics', TopicViewSet, basename='topic')  # ADD THIS

urlpatterns = [
    path('', include(router.urls)),
]
```

**File:** `backend/examinations/urls.py` (verify registration exists)
```python
# Should already have this or similar:
router.register(r'questions', QuestionViewSet, basename='question')
router.register(r'exam-papers', ExamPaperViewSet, basename='exam-paper')
```

---

## 1.4: Update Documentation (15 mins)

### Task 1.4.1: Update BACKEND_APPS.md

**Find section:** `## examinations — Exams & Marks`

**Update Question model documentation:**
```markdown
### Question
school(FK), subject(FK), exam_type(FK), question_text, question_image_url, question_type, difficulty_level, marks, option_a/b/c/d, correct_answer, **tested_topics(M2M → Topic, helps curriculum alignment)**, created_by(FK), is_active
```

**Update ExamPaper model documentation:**
```markdown
### ExamPaper
school(FK), exam(FK), exam_subject(FK), class_obj(FK), subject(FK), paper_title, instructions, total_marks, duration_minutes, questions(M2M → Question through PaperQuestion), **lesson_plans(M2M → LessonPlan, 'taught content being tested')**, status, generated_by(FK), is_active

**Properties:** 
- `covered_topics`: Topics tested via questions in this paper
- `question_topics_summary`: {topic_id: question_count} mapping
```

**Find section:** `## lms — Learning Management`

**Update Topic model documentation:**
```markdown
### Topic
chapter(FK), title, topic_number, description, estimated_periods, is_active

**Properties:**
- `is_covered`: bool - has lesson plans teaching this topic
- `is_tested`: bool - has questions testing this topic
- `test_question_count`: int - count of active test questions
- `lesson_plan_count`: int - count of lesson plans covering this topic
```

---

### Task 1.4.2: Update API_ENDPOINTS.md

**Find section:** `## Examinations`

**Add new endpoints:**
```markdown
| POST | /api/examinations/questions/generate_from_lesson/ | Generate questions from lesson plan. Body: {lesson_plan_id, question_count(5-20), question_type, difficulty_level} |
| GET | /api/examinations/questions/by_lesson_plan/ | Questions for lesson plan's topics. Params: lesson_plan_id |
| GET | /api/examinations/questions/?topics=1,2,3 | Filter questions by topic IDs |
| GET | /api/examinations/questions/?lesson_plan=5 | Filter questions by lesson plan |
| POST | /api/examinations/exam-papers/create_from_lessons/ | Create paper from lesson plans. Body: {lesson_plan_ids, class_id, subject_id, paper_title, ...} |
| POST | /api/examinations/exam-papers/{id}/link_lesson_plans/ | Link lesson plans to paper. Body: {lesson_plan_ids: [...]} |
| GET | /api/examinations/exam-papers/{id}/coverage_stats/ | Paper's topic coverage statistics |
```

**Find section:** `## LMS`

**Add new endpoints:**
```markdown
| GET | /api/lms/topics/ | All topics with coverage status. Params: book_id, class_id, subject_id, coverage(taught_only|tested_only|both|none) |
| GET | /api/lms/topics/{id}/ | Topic details with lesson_plans and test_questions |
| GET | /api/lms/topics/coverage_summary/ | Summary stats by coverage status. Params: book_id, class_id, subject_id |
```

---

### Task 1.4.3: Update API_RESPONSES.md

**Add sample responses:**
```markdown
## POST /api/examinations/questions/generate_from_lesson/

**Request:**
```json
{
  "lesson_plan_id": 5,
  "question_count": 10,
  "question_type": "MCQ",
  "difficulty_level": "MEDIUM"
}
```

**Response (201):**
```json
{
  "message": "Generated 10 questions",
  "questions": [
    {
      "id": 125,
      "question_text": "What is photosynthesis?",
      "question_type": "MCQ",
      "difficulty_level": "MEDIUM",
      "marks": 2.0,
      "option_a": "...",
      "option_b": "...",
      "option_c": "...",
      "option_d": "...",
      "correct_answer": "A",
      "tested_topics": [15],
      "tested_topics_details": [
        {
          "id": 15,
          "title": "Photosynthesis",
          "chapter_number": 3,
          "topic_number": 2,
          "chapter_title": "Plant Processes",
          "book_title": "Biology Grade 10"
        }
      ]
    }
  ]
}
```

## GET /api/lms/topics/coverage_summary/

**Response:**
```json
{
  "total_topics": 45,
  "taught_topics": 38,
  "tested_topics": 25,
  "both_taught_and_tested": 20,
  "taught_percentage": 84.4,
  "tested_percentage": 55.6
}
```
```

---

---

# PHASE 2: FRONTEND IMPLEMENTATION (3.5 hours)

## Overview
Build React components and integrate with existing pages.

---

## 2.1: New Components (90 mins)

### Task 2.1.1: Create LessonPlanPaperTab Component
**File:** `frontend/src/pages/examinations/LessonPlanPaperTab.jsx`

```jsx
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { lmsApi, questionPaperApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import Toast from '../../components/Toast'

/**
 * LessonPlanPaperTab
 * Create exam papers by selecting lesson plans covering specific topics.
 */
export default function LessonPlanPaperTab({ onPaperCreate, isLoading, initialLessonPlanId }) {
  const [selectedLessons, setSelectedLessons] = useState(
    initialLessonPlanId ? [initialLessonPlanId] : []
  )
  const [generatedQuestions, setGeneratedQuestions] = useState([])
  const [paperMetadata, setPaperMetadata] = useState({
    class_obj: '',
    subject: '',
    paper_title: '',
    instructions: '',
    total_marks: 100,
    duration_minutes: 60,
  })
  const [toast, setToast] = useState(null)
  const [generatingQuestions, setGeneratingQuestions] = useState(false)

  // Fetch lesson plans
  const { data: lessonsData } = useQuery({
    queryKey: ['lesson-plans'],
    queryFn: () => lmsApi.getLessonPlans({ page_size: 999 }),
  })

  const lessons = lessonsData?.data?.results || []

  // Extract unique topics from selected lessons
  const selectedTopics = lessons
    .filter(l => selectedLessons.includes(l.id))
    .flatMap(l => l.planned_topics || [])
    .reduce((acc, topic) => {
      if (!acc.find(t => t.id === topic.id)) {
        acc.push(topic)
      }
      return acc
    }, [])

  const uniqueTopics = selectedTopics

  // Get available questions for selected topics
  const { data: questionsData, refetch: refetchQuestions } = useQuery({
    queryKey: ['questions', selectedTopics.map(t => t.id).join(',')],
    queryFn: () => {
      if (selectedTopics.length === 0) return Promise.resolve({ data: { results: [] } })
      const topicIds = selectedTopics.map(t => t.id).join(',')
      return questionPaperApi.getQuestionsByTopics(topicIds)
    },
    enabled: selectedTopics.length > 0,
  })

  const availableQuestions = questionsData?.data?.results || []
  const questionsByType = availableQuestions.reduce((acc, q) => {
    acc[q.question_type] = (acc[q.question_type] || 0) + 1
    return acc
  }, {})

  // Create paper mutation
  const createPaperMutation = useMutation({
    mutationFn: (data) => questionPaperApi.createExamPaper(data),
    onSuccess: (response) => {
      onPaperCreate(response.data, availableQuestions)
      setToast({
        type: 'success',
        message: 'Exam paper created successfully!',
      })
    },
    onError: (error) => {
      const msg = error.response?.data?.detail || 'Error creating exam paper'
      setToast({ type: 'error', message: msg })
    },
  })

  const handleGenerateQuestions = async () => {
    if (selectedLessons.length === 0) {
      setToast({ type: 'error', message: 'Select at least one lesson plan' })
      return
    }

    setGeneratingQuestions(true)
    try {
      const response = await questionPaperApi.generateFromLesson({
        lesson_plan_ids: selectedLessons,
        question_count: 10,
        question_type: 'MCQ',
        difficulty_level: 'MEDIUM',
      })
      
      setGeneratedQuestions(response.data.questions || [])
      refetchQuestions()
      setToast({
        type: 'success',
        message: `Generated ${response.data.questions?.length || 0} questions`,
      })
    } catch (error) {
      setToast({
        type: 'error',
        message: error.response?.data?.detail || 'Failed to generate questions',
      })
    } finally {
      setGeneratingQuestions(false)
    }
  }

  const handleCreatePaper = () => {
    if (!paperMetadata.class_obj || !paperMetadata.subject || !paperMetadata.paper_title) {
      setToast({ type: 'error', message: 'Fill in all required fields' })
      return
    }

    if (selectedLessons.length === 0) {
      setToast({ type: 'error', message: 'Select at least one lesson plan' })
      return
    }

    const data = {
      ...paperMetadata,
      lesson_plan_ids: selectedLessons,
      status: 'DRAFT',
    }

    createPaperMutation.mutate(data)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Toast */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Step 1: Lesson Selection */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Step 1: Select Lesson Plans to Test
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
          {lessons.map(lesson => (
            <label
              key={lesson.id}
              className={`p-3 border rounded-lg cursor-pointer transition ${
                selectedLessons.includes(lesson.id)
                  ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-200'
                  : 'bg-gray-50 border-gray-300 hover:border-gray-400'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedLessons.includes(lesson.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedLessons([...selectedLessons, lesson.id])
                  } else {
                    setSelectedLessons(selectedLessons.filter(id => id !== lesson.id))
                  }
                }}
                className="mr-2"
              />
              <div>
                <span className="font-medium text-gray-900">{lesson.title}</span>
                <p className="text-xs text-gray-600 mt-1">
                  📅 {new Date(lesson.lesson_date).toLocaleDateString()} •
                  {lesson.planned_topics?.length || 0} topics
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Step 2: Topics Summary */}
      {uniqueTopics.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">
            Step 2: Topics to Test ({uniqueTopics.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {uniqueTopics.map(topic => (
              <div key={topic.id} className="text-sm text-blue-800 bg-white rounded p-2">
                <span className="font-medium">
                  {topic.chapter.chapter_number}.{topic.topic_number}
                </span>
                : {topic.title}
              </div>
            ))}
          </div>

          {availableQuestions.length > 0 && (
            <div className="mt-4 pt-4 border-t border-blue-200">
              <p className="text-sm text-blue-900 mb-2">
                💡 {availableQuestions.length} questions available for these topics:
              </p>
              <div className="flex gap-4 text-xs">
                {Object.entries(questionsByType).map(([type, count]) => (
                  <span key={type} className="bg-blue-100 text-blue-900 px-2 py-1 rounded">
                    {type}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Generate AI Questions (Optional) */}
      {uniqueTopics.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-3">
            Step 3 (Optional): Generate AI Questions
          </h3>

          <button
            onClick={handleGenerateQuestions}
            disabled={generatingQuestions || selectedLessons.length === 0}
            className={`btn ${generatingQuestions ? 'btn-disabled' : 'btn-success'} w-full`}
          >
            {generatingQuestions ? (
              <>
                <span className="animate-spin">⏳</span> Generating Questions...
              </>
            ) : (
              <>
                🤖 Generate 10 MCQs from Selected Topics
              </>
            )}
          </button>

          {generatedQuestions.length > 0 && (
            <p className="text-sm text-green-700 mt-2">
              ✅ {generatedQuestions.length} AI-generated questions ready
            </p>
          )}
        </div>
      )}

      {/* Step 4: Paper Details */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Step 4: Paper Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Class *
            </label>
            <ClassSelector
              value={paperMetadata.class_obj}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, class_obj: e.target.value })
              }
              className="w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject *
            </label>
            <SubjectSelector
              value={paperMetadata.subject}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, subject: e.target.value })
              }
              className="w-full"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Paper Title *
            </label>
            <input
              type="text"
              value={paperMetadata.paper_title}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, paper_title: e.target.value })
              }
              placeholder="e.g., Mid-Term Exam - Physics"
              className="input w-full"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Total Marks
            </label>
            <input
              type="number"
              value={paperMetadata.total_marks}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, total_marks: e.target.value })
              }
              className="input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              value={paperMetadata.duration_minutes}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, duration_minutes: e.target.value })
              }
              className="input w-full"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions (Optional)
            </label>
            <textarea
              value={paperMetadata.instructions}
              onChange={(e) =>
                setPaperMetadata({ ...paperMetadata, instructions: e.target.value })
              }
              placeholder="Special instructions for students..."
              rows={3}
              className="input w-full"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleCreatePaper}
          disabled={
            isLoading ||
            !paperMetadata.class_obj ||
            !paperMetadata.subject ||
            !paperMetadata.paper_title ||
            selectedLessons.length === 0
          }
          className={`btn flex-1 ${isLoading ? 'btn-disabled' : 'btn-primary'}`}
        >
          {isLoading ? (
            <>
              <span className="animate-spin">⏳</span> Creating...
            </>
          ) : (
            <>
              📄 Create Exam Paper
            </>
          )}
        </button>
      </div>
    </div>
  )
}
```

---

### Task 2.1.2: Create TopicStatusBadge Component
**File:** `frontend/src/components/TopicStatusBadge.jsx`

```jsx
/**
 * TopicStatusBadge
 * Shows teaching and testing status of a curriculum topic.
 */
export default function TopicStatusBadge({ topic, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {topic.is_covered && (
        <span className="badge badge-success text-xs whitespace-nowrap">
          ✅ Taught
        </span>
      )}

      {topic.is_tested && (
        <span className="badge badge-primary text-xs whitespace-nowrap">
          📝 {topic.test_question_count} questions
        </span>
      )}

      {!topic.is_covered && !topic.is_tested && (
        <span className="badge badge-gray text-xs whitespace-nowrap">
          ⏳ Pending
        </span>
      )}

      {topic.is_covered && !topic.is_tested && (
        <span className="badge badge-warning text-xs whitespace-nowrap">
          ⚠️ Not Tested
        </span>
      )}
    </div>
  )
}
```

---

### Task 2.1.3: Create CurriculumCoveragePage Component
**File:** `frontend/src/pages/examinations/CurriculumCoveragePage.jsx` (long file, ~250 lines)

```jsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import TopicStatusBadge from '../../components/TopicStatusBadge'
import Toast from '../../components/Toast'

/**
 * CurriculumCoveragePage
 * Dashboard showing teaching and testing coverage of curriculum.
 */
export default function CurriculumCoveragePage() {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [toast, setToast] = useState(null)

  // Fetch books
  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['books', selectedClass, selectedSubject],
    queryFn: () => {
      if (!selectedClass || !selectedSubject) return Promise.resolve({ data: { results: [] } })
      return lmsApi.getBooks({
        class_id: selectedClass,
        subject_id: selectedSubject,
        page_size: 50,
      })
    },
    enabled: !!selectedClass && !!selectedSubject,
  })

  const books = booksData?.data?.results || []

  // Fetch coverage summary
  const { data: coverageData } = useQuery({
    queryKey: ['coverage-summary', selectedClass, selectedSubject],
    queryFn: () => {
      if (!selectedClass || !selectedSubject) return Promise.resolve({ data: {} })
      return lmsApi.getCoverageSummary({
        class_id: selectedClass,
        subject_id: selectedSubject,
      })
    },
    enabled: !!selectedClass && !!selectedSubject,
  })

  const coverage = coverageData?.data || {}

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">Curriculum Coverage</h1>
          <p className="text-gray-600 mt-1">
            Track teaching progress (lessons planned) vs testing progress (questions created)
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Class
              </label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject
              </label>
              <SubjectSelector
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Coverage Summary */}
        {selectedClass && selectedSubject && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <p className="text-gray-600 text-sm">Total Topics</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {coverage.total_topics || 0}
              </p>
            </div>

            <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4">
              <p className="text-green-800 text-sm font-medium">Topics Taught</p>
              <p className="text-3xl font-bold text-green-600 mt-2">
                {coverage.taught_topics || 0}
              </p>
              {coverage.total_topics && (
                <p className="text-xs text-green-700 mt-2">
                  {coverage.taught_percentage || 0}% of curriculum
                </p>
              )}
            </div>

            <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4">
              <p className="text-blue-800 text-sm font-medium">Topics Tested</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">
                {coverage.tested_topics || 0}
              </p>
              {coverage.total_topics && (
                <p className="text-xs text-blue-700 mt-2">
                  {coverage.tested_percentage || 0}% of curriculum
                </p>
              )}
            </div>

            <div className="bg-purple-50 rounded-lg shadow-sm border border-purple-200 p-4">
              <p className="text-purple-800 text-sm font-medium">Both Done</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">
                {coverage.both_taught_and_tested || 0}
              </p>
              {coverage.total_topics && (
                <p className="text-xs text-purple-700 mt-2">
                  Complete coverage
                </p>
              )}
            </div>
          </div>
        )}

        {/* Books & Topics */}
        {selectedClass && selectedSubject && !booksLoading && books.length > 0 && (
          <div className="space-y-4">
            {books.map(book => (
              <BookCoverageCard key={book.id} book={book} />
            ))}
          </div>
        )}

        {booksLoading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading curriculum...</p>
          </div>
        )}

        {selectedClass && selectedSubject && !booksLoading && books.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg">
            <p className="text-gray-600">No curriculum books found for this class and subject.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper component
function BookCoverageCard({ book }) {
  const [expandedChapter, setExpandedChapter] = useState(null)

  const chapters = book.chapters || []
  const totalTopics = chapters.reduce((sum, ch) => sum + (ch.topics?.length || 0), 0)
  const taughtTopics = chapters.reduce(
    (sum, ch) => sum + (ch.topics?.filter(t => t.is_covered).length || 0),
    0
  )
  const testedTopics = chapters.reduce(
    (sum, ch) => sum + (ch.topics?.filter(t => t.is_tested).length || 0),
    0
  )

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 bg-gradient-to-r from-gray-50 to-gray-100">
        <h3 className="text-xl font-semibold text-gray-900">{book.title}</h3>
        <p className="text-sm text-gray-600 mt-1">
          {book.author} • {totalTopics} topics
        </p>
      </div>

      {/* Progress bars */}
      <div className="px-6 py-4 border-b border-gray-200 space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-700">Teaching Progress</span>
            <span className="font-medium text-gray-900">
              {taughtTopics}/{totalTopics} ({totalTopics ? Math.round(taughtTopics / totalTopics * 100) : 0}%)
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all"
              style={{ width: `${totalTopics ? (taughtTopics / totalTopics * 100) : 0}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-700">Testing Progress</span>
            <span className="font-medium text-gray-900">
              {testedTopics}/{totalTopics} ({totalTopics ? Math.round(testedTopics / totalTopics * 100) : 0}%)
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${totalTopics ? (testedTopics / totalTopics * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Chapters accordion */}
      <div className="divide-y divide-gray-200">
        {chapters.map((chapter, idx) => {
          const isExpanded = expandedChapter === chapter.id
          const topics = chapter.topics || []
          return (
            <div key={chapter.id}>
              <button
                onClick={() => setExpandedChapter(isExpanded ? null : chapter.id)}
                className="w-full px-6 py-3 text-left hover:bg-gray-50 flex justify-between items-center"
              >
                <span className="font-medium text-gray-900">
                  Chapter {chapter.chapter_number}: {chapter.title}
                </span>
                <span className="text-gray-500">
                  {isExpanded ? '▼' : '▶'} ({topics.length})
                </span>
              </button>

              {isExpanded && (
                <div className="px-6 py-3 bg-gray-50 space-y-2">
                  {topics.map(topic => (
                    <div key={topic.id} className="flex justify-between items-center p-2">
                      <div>
                        <span className="font-medium text-gray-900">
                          {topic.topic_number}. {topic.title}
                        </span>
                      </div>
                      <TopicStatusBadge topic={topic} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

---

### Task 2.1.4: Create QuestionSelector Component
**File:** `frontend/src/components/QuestionSelector.jsx`

```jsx
import { useState } from 'react'
import Toast from './Toast'

/**
 * QuestionSelector
 * Allows selecting questions with filters and preview.
 */
export default function QuestionSelector({
  questions = [],
  selectedQuestions = [],
  onSelectionChange,
  onlyShowUnselelected = false,
}) {
  const [filterType, setFilterType] = useState('')
  const [filterDifficulty, setFilterDifficulty] = useState('')
  const [searchText, setSearchText] = useState('')

  let filtered = questions

  if (onlyShowUnselelected) {
    filtered = filtered.filter(q => !selectedQuestions.find(sq => sq.id === q.id))
  }

  if (filterType) {
    filtered = filtered.filter(q => q.question_type === filterType)
  }

  if (filterDifficulty) {
    filtered = filtered.filter(q => q.difficulty_level === filterDifficulty)
  }

  if (searchText) {
    filtered = filtered.filter(q =>
      q.question_text.toLowerCase().includes(searchText.toLowerCase())
    )
  }

  const handleToggleQuestion = (question) => {
    if (selectedQuestions.find(q => q.id === question.id)) {
      onSelectionChange(selectedQuestions.filter(q => q.id !== question.id))
    } else {
      onSelectionChange([...selectedQuestions, question])
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search questions..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="input flex-1"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="input"
        >
          <option value="">All Types</option>
          <option value="MCQ">MCQ</option>
          <option value="SHORT">Short</option>
          <option value="ESSAY">Essay</option>
        </select>
        <select
          value={filterDifficulty}
          onChange={(e) => setFilterDifficulty(e.target.value)}
          className="input"
        >
          <option value="">All Levels</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
      </div>

      {/* Questions */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.map(question => (
          <div
            key={question.id}
            className={`p-3 border rounded-lg cursor-pointer transition ${
              selectedQuestions.find(q => q.id === question.id)
                ? 'bg-blue-50 border-blue-500'
                : 'bg-white border-gray-300'
            }`}
            onClick={() => handleToggleQuestion(question)}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!selectedQuestions.find(q => q.id === question.id)}
                onChange={() => {}}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 line-clamp-2">
                  {question.question_text}
                </p>
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="badge badge-sm">{question.question_type}</span>
                  <span className="badge badge-sm">{question.difficulty_level}</span>
                  <span className="badge badge-sm">{question.marks} marks</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-600">
        {selectedQuestions.length} selected • {filtered.length} total
      </p>
    </div>
  )
}
```

---

## 2.2: Update Existing Pages (90 mins)

### Task 2.2.1: Update QuestionPaperBuilderPage
**File:** `frontend/src/pages/examinations/QuestionPaperBuilderPage.jsx`

**Find the tab buttons section, add new tab:**
```jsx
<div className="flex border-b border-gray-200">
  <button
    onClick={() => setActiveTab('manual')}
    className={`flex-1 px-6 py-4 font-medium text-center transition ${
      activeTab === 'manual'
        ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
        : 'text-gray-600 hover:text-gray-800'
    }`}
  >
    <span className="text-xl mr-2">⌨️</span>
    Manual Entry
  </button>
  <button
    onClick={() => setActiveTab('image')}
    className={`flex-1 px-6 py-4 font-medium text-center transition ${
      activeTab === 'image'
        ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
        : 'text-gray-600 hover:text-gray-800'
    }`}
  >
    <span className="text-xl mr-2">📸</span>
    Capture from Image
  </button>
  
  {/* NEW TAB */}
  <button
    onClick={() => setActiveTab('lesson')}
    className={`flex-1 px-6 py-4 font-medium text-center transition ${
      activeTab === 'lesson'
        ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
        : 'text-gray-600 hover:text-gray-800'
    }`}
  >
    <span className="text-xl mr-2">📚</span>
    From Lesson Plans
  </button>
</div>

{/* Tab content */}
<div className="p-8">
  {activeTab === 'manual' && (...)}
  {activeTab === 'image' && (...)}
  {activeTab === 'lesson' && (
    <LessonPlanPaperTab
      onPaperCreate={handlePaperCreate}
      isLoading={createPaperMutation.isPending}
      initialLessonPlanId={location.state?.lessonPlanId}
    />
  )}
</div>
```

**Add import at top:**
```jsx
import LessonPlanPaperTab from './LessonPlanPaperTab'
```

---

### Task 2.2.2: Update CurriculumPage (LMS Curriculum)
**File:** `frontend/src/pages/academics/CurriculumPage.jsx`

Add this after the chapter accordion display topics:

```jsx
// Show coverage status for each topic
{topics.map(topic => (
  <div key={topic.id} className="flex items-center justify-between p-2">
    <span>{topic.topic_number}. {topic.title}</span>
    <div className="flex items-center gap-2">
      <TopicStatusBadge topic={topic} />
      
      {/* Generate questions button for taught but not tested */}
      {topic.is_covered && !topic.is_tested && (
        <button
          onClick={() => handleGenerateQuestionsForTopic(topic.id)}
          className="btn btn-sm btn-outline text-xs"
        >
          🤖 Generate
        </button>
      )}
    </div>
  </div>
))}
```

---

### Task 2.2.3: Update LessonPlansPage
**File:** `frontend/src/pages/academics/LessonPlansPage.jsx`

Add this in lesson detail view:

```jsx
{/* Topics taught in this lesson */}
{lesson.planned_topics && lesson.planned_topics.length > 0 && (
  <div className="card mt-4">
    <div className="card-header flex justify-between items-center">
      <h4 className="font-semibold">Planned Topics ({lesson.planned_topics.length})</h4>
      
      {/* Generate questions button */}
      <button
        onClick={() => handleGenerateQuestionsFromLesson(lesson.id)}
        disabled={generatingQuestions}
        className="btn btn-primary btn-sm"
      >
        {generatingQuestions ? (
          <>⏳ Generating...</>
        ) : (
          <>🤖 Generate Questions</>
        )}
      </button>
    </div>
    
    <div className="card-body">
      <div className="space-y-2">
        {lesson.planned_topics.map(topic => (
          <div key={topic.id} className="flex justify-between text-sm py-2 border-b">
            <span className="font-medium">
              {topic.chapter.chapter_number}.{topic.topic_number} {topic.title}
            </span>
            <span className="text-gray-600">
              {topic.test_question_count > 0
                ? `${topic.test_question_count} questions`
                : 'No questions yet'}
            </span>
          </div>
        ))}
      </div>

      {/* Link to create paper from lesson */}
      <Link
        to="/academics/paper-builder"
        state={{ lessonPlanId: lesson.id }}
        className="btn btn-outline mt-4 w-full"
      >
        📄 Create Exam Paper from This Lesson
      </Link>
    </div>
  </div>
)}
```

---

## 2.3: Update Services Layer (90 mins)

### Task 2.3.1: Enhance questionPaperApi
**File:** `frontend/src/services/api.js` (update questionPaperApi object)

**Add these methods:**
```javascript
export const questionPaperApi = {
  // ... existing methods ...

  // NEW: Get questions by topics
  getQuestionsByTopics: (topicIds) =>
    apiClient.get('/api/examinations/questions/', { params: { topics: topicIds } }),

  // NEW: Generate questions from lesson plan
  generateFromLesson: (data) =>
    apiClient.post('/api/examinations/questions/generate_from_lesson/', data),

  // NEW: Get questions for lesson plan
  getQuestionsByLessonPlan: (lessonPlanId) =>
    apiClient.get('/api/examinations/questions/by_lesson_plan/', {
      params: { lesson_plan_id: lessonPlanId }
    }),

  // NEW: Create paper from lessons
  createFromLessons: (data) =>
    apiClient.post('/api/examinations/exam-papers/create_from_lessons/', data),

  // NEW: Link lesson plans to existing paper
  linkLessonPlans: (paperId, data) =>
    apiClient.post(`/api/examinations/exam-papers/${paperId}/link_lesson_plans/`, data),

  // NEW: Get paper coverage stats
  getCoverageStats: (paperId) =>
    apiClient.get(`/api/examinations/exam-papers/${paperId}/coverage_stats/`),
}
```

---

### Task 2.3.2: Create lmsApi Object
**File:** `frontend/src/services/api.js` (add new API object)

**Add before export:**
```javascript
export const lmsApi = {
  // Books
  getBooks: (params) =>
    apiClient.get('/api/lms/books/', { params }),

  getBookTree: (bookId) =>
    apiClient.get(`/api/lms/books/${bookId}/tree/`),

  // Topics (NEW)
  getTopics: (params) =>
    apiClient.get('/api/lms/topics/', { params }),

  getTopicDetail: (topicId) =>
    apiClient.get(`/api/lms/topics/${topicId}/`),

  // Coverage (NEW)
  getCoverageSummary: (params) =>
    apiClient.get('/api/lms/topics/coverage_summary/', { params }),

  // Lesson Plans
  getLessonPlans: (params) =>
    apiClient.get('/api/lms/lesson-plans/', { params }),

  getLessonPlanDetail: (id) =>
    apiClient.get(`/api/lms/lesson-plans/${id}/`),

  createLessonPlan: (data) =>
    apiClient.post('/api/lms/lesson-plans/', data),

  updateLessonPlan: (id, data) =>
    apiClient.patch(`/api/lms/lesson-plans/${id}/`, data),
}
```

---

## 2.4: Update Routing (15 mins)

### Task 2.4.1: Add Curriculum Coverage Route
**File:** `frontend/src/App.jsx`

**Find the academics section, add new route:**
```jsx
const CurriculumCoveragePage = lazy(() =>
  import('./pages/examinations/CurriculumCoveragePage')
)

// Inside Route components, add:
<Route
  path="academics/curriculum-coverage"
  element={
    <SchoolRoute>
      <ModuleRoute module="examinations">
        <CurriculumCoveragePage />
      </ModuleRoute>
    </SchoolRoute>
  }
/>
```

---

### Task 2.4.2: Update Sidebar Navigation
**File:** `frontend/src/components/Layout.jsx`

**Find examinations section, add route:**
```jsx
...(isModuleEnabled('examinations') ? [
  { type: 'divider', label: 'Examinations' },
  { name: 'Exam Types', href: '/academics/exam-types', icon: FolderIcon },
  { name: 'Exams', href: '/academics/exams', icon: ClipboardIcon },
  { name: 'Paper Builder', href: '/academics/paper-builder', icon: PencilIcon },
  { name: 'Curriculum Coverage', href: '/academics/curriculum-coverage', icon: ChartIcon },  // NEW
  { name: 'Marks Entry', href: '/academics/marks-entry', icon: DocumentIcon },
  { name: 'Results', href: '/academics/results', icon: ChartIcon },
  { name: 'Report Cards', href: '/academics/report-cards', icon: ReportIcon },
  { name: 'Grade Scale', href: '/academics/grade-scale', icon: SettingsIcon },
] : []),
```

---

# PHASE 3: DOCUMENTATION & USER GUIDE (1.5 hours)

## Overview
Update all documentation and generate updated user guide PDF.

---

## 3.1: Update Backend Documentation (30 mins)

### Task 3.1.1: Update docs/BACKEND_APPS.md

Find section `## examinations — Exams & Marks`, update:

```markdown
### Question
school(FK), subject(FK), exam_type(FK), question_text, question_image_url, question_type, difficulty_level, marks, option_a/b/c/d, correct_answer, **tested_topics(M2M → Topic, NEW: curriculum alignment)**, created_by(FK), is_active

### ExamPaper
school(FK), exam(FK), exam_subject(FK), class_obj(FK), subject(FK), paper_title, instructions, total_marks, duration_minutes, questions(M2M → Question through PaperQuestion), **lesson_plans(M2M → LessonPlan, NEW: teaching alignment)**, status, generated_by(FK), is_active

**Properties:**
- `covered_topics`: QuerySet of Topics tested via questions in this paper
- `question_topics_summary`: dict mapping topic_id → {title, question_count}
```

Find section `## lms — Learning Management`, update Topic:

```markdown
### Topic
chapter(FK), title, topic_number, description, estimated_periods, is_active

**Properties (NEW - Curriculum Coverage):**
- `is_covered`: bool - has active lesson plans teaching this topic
- `is_tested`: bool - has active test questions for this topic
- `test_question_count`: int - count of active questions
- `lesson_plan_count`: int - count of lesson plans covering this topic
```

---

### Task 3.1.2: Update docs/API_ENDPOINTS.md

Find `## Examinations` section, add:

```markdown
### Question Endpoints
| GET | /api/examinations/questions/ | List questions. Params: topics (IDs comma-separated), lesson_plan (ID), question_type, difficulty_level, page_size |
| POST | /api/examinations/questions/ | Create question with optional tested_topics M2M |
| GET | /api/examinations/questions/{id}/ | Question detail with tested_topics_details |
| POST | /api/examinations/questions/generate_from_lesson/ | AI-generate questions from lesson plan. Body: {lesson_plan_id, question_count(5-20), question_type, difficulty_level} |
| GET | /api/examinations/questions/by_lesson_plan/?lesson_plan_id=5 | Get questions for lesson's topics |

### ExamPaper Endpoints
| POST | /api/examinations/exam-papers/create_from_lessons/ | Create paper from lesson plans. Body: {lesson_plan_ids, class_id, subject_id, paper_title, total_marks, duration_minutes, instructions} |
| POST | /api/examinations/exam-papers/{id}/link_lesson_plans/ | Add lesson plans to paper. Body: {lesson_plan_ids: [...]} |
| GET | /api/examinations/exam-papers/{id}/coverage_stats/ | Topics + questions covered in this paper |
```

Find `## LMS` section, add:

```markdown
### Topic Endpoints (NEW)
| GET | /api/lms/topics/ | List topics with coverage status. Params: book_id, class_id, subject_id, coverage (taught_only|tested_only|both|none) |
| GET | /api/lms/topics/{id}/ | Topic detail with lesson_plans and test_questions lists |
| GET | /api/lms/topics/coverage_summary/ | Curriculum coverage stats. Params: book_id, class_id, subject_id |
```

---

### Task 3.1.3: Update docs/API_RESPONSES.md

Add these examples:

```markdown
## POST /api/examinations/questions/generate_from_lesson/

**Request:**
```json
{
  "lesson_plan_id": 5,
  "question_count": 10,
  "question_type": "MCQ",
  "difficulty_level": "MEDIUM"
}
```

**Response (201):**
```json
{
  "message": "Generated 10 questions",
  "questions": [
    {
      "id": 125,
      "question_text": "What is the process by which plants make their own food using sunlight?",
      "question_type": "MCQ",
      "difficulty_level": "MEDIUM",
      "marks": 2.0,
      "option_a": "Respiration",
      "option_b": "Photosynthesis",
      "option_c": "Digestion",
      "option_d": "Fermentation",
      "correct_answer": "B",
      "tested_topics": [15],
      "tested_topics_details": [
        {
          "id": 15,
          "title": "Process of Photosynthesis",
          "chapter_number": 3,
          "topic_number": 2,
          "chapter_title": "Plant Growth and Reproduction",
          "book_title": "Biology Grade 10"
        }
      ]
    }
  ]
}
```

## POST /api/examinations/exam-papers/create_from_lessons/

**Request:**
```json
{
  "lesson_plan_ids": [5, 6, 7],
  "class_id": 10,
  "subject_id": 15,
  "paper_title": "Mid-Term Exam - Biology",
  "instructions": "Answer all questions. Diagrams should be labeled.",
  "total_marks": 100,
  "duration_minutes": 90
}
```

**Response (201):**
```json
{
  "message": "Created paper with 12 questions",
  "exam_paper": {
    "id": 8,
    "paper_title": "Mid-Term Exam - Biology",
    "class_obj": 10,
    "subject": 15,
    "total_marks": 100.0,
    "duration_minutes": 90,
    "question_count": 12,
    "covered_topics": [
      {
        "id": 14,
        "chapter_number": 3,
        "topic_number": 1,
        "title": "Photosynthesis Introduction"
      },
      {
        "id": 15,
        "chapter_number": 3,
        "topic_number": 2,
        "title": "Process of Photosynthesis"
      }
    ],
    "lesson_plans_details": [
      {
        "id": 5,
        "title": "Introduction to Photosynthesis",
        "lesson_date": "2026-03-04",
        "class": "Grade 10",
        "subject": "Biology"
      }
    ],
    "status": "DRAFT"
  }
}
```

## GET /api/lms/topics/coverage_summary/

**Response:**
```json
{
  "total_topics": 45,
  "taught_topics": 38,
  "tested_topics": 25,
  "both_taught_and_tested": 20,
  "taught_percentage": 84.4,
  "tested_percentage": 55.6
}
```
```

---

## 3.2: Update Frontend Documentation (30 mins)

### Task 3.2.1: Update docs/FRONTEND_PAGES.md

Find `## Academics` section, update entries:

```markdown
| /academics/curriculum | CurriculumPage.jsx | Curriculum (Book → Chapter → Topic) with **NEW: Topic status badges (✅ Taught, 📝 Questions, etc.) and "Generate" buttons for taught topics** | GET/POST books/, chapters/, topics/, books/{id}/tree/, books/{id}/bulk_toc/, books/{id}/ocr_toc/, books/syllabus_progress/ |

| /academics/lesson-plans | LessonPlansPage.jsx | Lesson plans with **NEW: "Generate Questions from Lesson" button, topic coverage display, link to Paper Builder** | GET/POST lesson-plans/, questions/generate_from_lesson/ |

| /academics/paper-builder | QuestionPaperBuilderPage.jsx | **3 tabs: Manual Entry, Capture from Image, From Lesson Plans (NEW)**. From Lesson tab: select lessons → auto-show topics → optional AI generation → create paper. | GET/POST exam-papers/, exam-papers/create_from_lessons/, lesson-plans/, questions/generate_from_lesson/ |

| /academics/curriculum-coverage | CurriculumCoveragePage.jsx | **NEW PAGE: Dashboard of teaching vs testing coverage. Filter by class/subject. Visual progress bars. Breakdown by book/chapter. Gap analysis (taught but not tested, etc.)** | GET books/, topics/coverage_summary/ |
```

Find `## Components` section, add:

```markdown
### NEW Components

| LessonPlanPaperTab.jsx | Step-by-step wizard to create exam papers from lesson plans. Select lessons → show topics → optional AI generation → enter paper metadata. |
| TopicStatusBadge.jsx | Reusable badge showing topic coverage (taught, tested, both, pending). Icons: ✅ 📝 ⏳ ⚠️ |
| QuestionSelector.jsx | Question multi-select with filters (type, difficulty, search). Shows question preview, marks. |
| CurriculumCoveragePage.jsx | Dashboard page showing curriculum coverage analysis. |
```

---

### Task 3.2.2: Update docs/FRONTEND_COMPONENTS.md

Find components list, add:

```markdown
### Coverage & Status Components

**TopicStatusBadge**
- Props: `topic` (Topic object), `className` (optional)
- Shows: ✅ Taught, 📝 N questions, ⏳ Pending, ⚠️ Not Tested
- Usage: In curriculum pages, lesson pages, coverage dashboard

**QuestionSelector**
- Props: `questions` (array), `selectedQuestions` (array), `onSelectionChange` (fn), `onlyShowUnselected` (bool)
- Features: Filters (type, difficulty, search), question preview, marks display
- Usage: In paper builder, question management

**LessonPlanPaperTab**
- Props: `onPaperCreate` (fn), `isLoading` (bool), `initialLessonPlanId` (int, optional)
- Features: 4-step wizard (lessons → topics → optional AI → metadata)
- API Calls: getLessonPlans, generateFromLesson, createFromLessons
- Usage: QuestionPaperBuilderPage as tab 3

**CurriculumCoveragePage**
- Full page component (no props)
- Features: Class/subject filters, progress bars, chapter accordion, coverage stats
- API Calls: getBooks, getCoverageSummary, getTopics
- Usage: Route /academics/curriculum-coverage
```

---

## 3.3: Update User Guide PDF (45 mins)

### Task 3.3.1: Update generate_user_guide.py

**Find section for "Academics" module, add new chapter:**

```python
# Around line 800-900, find the academics chapter section

# Add this new section in the Examinations part:

def add_question_paper_builder_chapter(self):
    """Chapter: Question Paper Builder with Curriculum Integration"""
    self.add_chapter("Question Paper Builder & Curriculum")
    
    self.add_section("Overview")
    self.add_bullet_text(
        "Create exam papers in 3 ways: Manual entry with rich editor, "
        "OCR from handwritten papers, or from curriculum lesson plans"
    )
    self.add_bullet_text(
        "AI-powered question generation aligned to curriculum topics"
    )
    self.add_bullet_text(
        "Curriculum coverage dashboard to track teaching vs testing progress"
    )
    
    self.add_section("Three Ways to Create Papers")
    
    self.add_subsection("1. Manual Entry (Typing)")
    self.add_paragraph(
        "Type questions directly with rich text editor (bold, lists, etc.). "
        "Supports: MCQ, Short Answer, Essay, True/False, Matching, Fill-in-blanks."
    )
    self.add_step("Go to Academics → Paper Builder → Manual Entry tab")
    self.add_step("Select Class and Subject")
    self.add_step("Enter paper title, instructions, marks, duration")
    self.add_step("Click 'Add Question' for each question")
    self.add_step("Use rich editor for formatting (bold, lists, etc.)")
    self.add_step("For MCQ, fill options A-B-C-D and mark correct answer")
    self.add_step("Click 'Save and Continue' or 'Save as Draft'")
    self.add_step("Review all questions and click 'Create Paper'")
    self.add_step("Download PDF or Share link")
    
    self.add_subsection("2. From Handwritten Paper (OCR)")
    self.add_paragraph(
        "Take a photo of your handwritten exam paper. AI extracts questions automatically."
    )
    self.add_step("Go to Academics → Paper Builder → Capture from Image tab")
    self.add_step("Click the dropzone or drag-and-drop a clear photo")
    self.add_step("On mobile: Click to open camera directly")
    self.add_step("Wait for OCR processing (AI extracts text)")
    self.add_step("Review extracted questions - edit as needed")
    self.add_step("Click 'Confirm & Create Paper'")
    self.add_paragraph(
        "Tip: Take a clear, straight photo with even lighting for best accuracy."
    )
    
    self.add_subsection("3. From Lesson Plans (NEW)")
    self.add_paragraph(
        "Create exam papers by selecting lesson plans. Teacher selects which lessons' "
        "topics to test. System suggests questions and can auto-generate more."
    )
    self.add_step("Go to Academics → Paper Builder → From Lesson Plans tab")
    self.add_step("Select lesson plans taught in this period (checkboxes)")
    self.add_step("System shows all topics from selected lessons")
    self.add_step("(Optional) Click 'Generate 10 MCQs' for AI question creation")
    self.add_step("Enter paper title, class, subject, marks, duration")
    self.add_step("Click 'Create Exam Paper'")
    self.add_paragraph(
        "Benefits: Curriculum-aligned papers, automatic question filtering, "
        "audit trail of what was taught vs tested."
    )
    
    self.add_section("Curriculum Integration")
    self.add_paragraph(
        "Questions are now linked to curriculum topics for tracking alignment."
    )
    
    self.add_subsection("Question Topics (Behind the Scenes)")
    self.add_bullet_text(
        "Each question can be tagged with curriculum topics it tests"
    )
    self.add_bullet_text(
        "When creating papers from lesson plans, system filters questions by topics"
    )
    self.add_bullet_text(
        "Papers always show which topics have test coverage"
    )
    
    self.add_subsection("Curriculum Coverage Dashboard (NEW)")
    self.add_paragraph(
        "View teaching vs testing progress for your curriculum."
    )
    self.add_step("Go to Academics → Curriculum Coverage")
    self.add_step("Select Class and Subject")
    self.add_step("See summary stats: Total topics, Taught %, Tested %")
    self.add_step("Expand chapters to see topic-by-topic coverage")
    self.add_step("Green checkmark (✅) = Taught, Blue badge (📝) = Questions available")
    self.add_step("Yellow warning (⚠️) = Taught but not tested")
    self.add_paragraph(
        "Use this to identify gaps: Which topics have no test coverage? "
        "Which topics have no lessons planned?"
    )
    
    self.add_section("AI Question Generation")
    self.add_paragraph(
        "Automatically generate questions aligned to curriculum topics."
    )
    self.add_step("Select a lesson plan with topics")
    self.add_step("Click 'Generate 10 MCQs from Selected Topics'")
    self.add_step("AI analyzes topic titles and descriptions")
    self.add_step("Returns MCQs ready to add to a paper")
    self.add_step("Edit questions if needed, then add to paper")
    self.add_paragraph(
        "Questions are automatically tagged with the topics they test."
    )
    
    self.add_section("Workflows")
    
    self.add_subsection("Workflow: Start Teaching → Create Test")
    self.add_step("Teaching: Teacher creates lesson plan, selects curriculum topics")
    self.add_step("Lesson marked as PUBLISHED in the lesson plan")
    self.add_step("Testing: Teacher goes to Paper Builder → From Lesson Plans")
    self.add_step("Teacher checks off the lessons to test")
    self.add_step("System shows: 'Topics 3.1, 3.2, 3.3'")
    self.add_step("Teacher clicks 'Generate Questions' or manually selects from bank")
    self.add_step("Paper is created with questions aligned to taught topics")
    self.add_step("Admin can see in Coverage Dashboard: Topics are both taught and tested ✅")
    
    self.add_subsection("Workflow: Mid-Month Assessment")
    self.add_step("Admin goes to Academics → Curriculum Coverage")
    self.add_step("Sees: Class X - Biology is 70% taught, 45% tested")
    self.add_step("Identifies: Topics 5.1, 5.2, 5.3 are taught but no questions")
    self.add_step("Asks teacher: 'Can you create a quiz for Topics 5.1-5.3?'")
    self.add_step("Teacher goes to Paper Builder → From Lesson Plans")
    self.add_step("Selects lessons covering Topics 5.1-5.3")
    self.add_step("Clicks 'Generate Questions' → Creates 15-question quiz")
    self.add_step("Coverage Dashboard now shows those topics are tested ✅")
    
    self.add_section("Tips & Best Practices")
    self.add_bullet_text(
        "✅ Always select class and subject before creating a paper"
    )
    self.add_bullet_text(
        "✅ Use lesson plans for better curriculum alignment"
    )
    self.add_bullet_text(
        "✅ Check coverage dashboard monthly to spot gaps"
    )
    self.add_bullet_text(
        "✅ For OCR, take clear photos with good lighting"
    )
    self.add_bullet_text(
        "❌ Don't manually type 100 questions - use AI generation for bulk creation"
    )
    self.add_bullet_text(
        "❌ Don't ignore topics with no test coverage - identify via dashboard"
    )
```

---

### Task 3.3.2: Add to JSON Export
**In generate_user_guide.py, find the JSON export section:**

```python
# Around line 2100+, update the json_modules list to include:

json_content = {
    "modules": [
        # ... existing modules ...
        {
            "id": "academics.paperbuilder",
            "title": "Question Paper Builder",
            "chapters": [
                {
                    "id": "pb.overview",
                    "title": "Overview",
                    "sections": [
                        {
                            "title": "Three Creation Methods",
                            "content": [
                                "1. Manual Entry - Type with rich editor",
                                "2. OCR - Photograph handwritten papers",
                                "3. From Lesson Plans - Create from curriculum topics"
                            ]
                        }
                    ]
                },
                {
                    "id": "pb.lessons",
                    "title": "Creating Papers from Lesson Plans",
                    "sections": [
                        {
                            "title": "Steps",
                            "content": [
                                "1. Select lesson plans taught in this period",
                                "2. Review topics from those lessons",
                                "3. (Optional) Generate AI questions",
                                "4. Create paper from filtered questions"
                            ]
                        },
                        {
                            "title": "Benefits",
                            "content": [
                                "- Align exams to taught curriculum",
                                "- Auto-filter questions by topics",
                                "- Track coverage gaps with dashboard",
                                "- Audit trail of what was taught vs tested"
                            ]
                        }
                    ]
                },
                {
                    "id": "pb.coverage",
                    "title": "Curriculum Coverage Dashboard",
                    "sections": [
                        {
                            "title": "What It Shows",
                            "content": [
                                "Total topics in curriculum",
                                "% taught via lesson plans",
                                "% tested via exam questions",
                                "Topics missing coverage (gaps)"
                            ]
                        }
                    ]
                }
            ]
        }
    ]
}
```

---

### Task 3.3.3: Run PDF Generation
**Command to run (terminal):**

```bash
cd d:\Personal\smart-attendance
python generate_user_guide.py
```

This will:
1. Generate `KoderEduAI_User_Guide.pdf` with all updates
2. Generate `frontend/src/data/userGuide.json` for in-app guide

---

## 3.4: Create Implementation Checklist (15 mins)

**File:** Create `IMPLEMENTATION_CHECKLIST_CURRICULUM_INTEGRATION.md`

```markdown
# Implementation Checklist: Curriculum → Lesson Plans → Paper Builder

## Phase 1: Backend ✅
- [ ] Create migration file (0005)
- [ ] Add tested_topics M2M to Question model
- [ ] Add lesson_plans M2M to ExamPaper model
- [ ] Add coverage properties to Topic model
- [ ] Update QuestionSerializer with tested_topics
- [ ] Update ExamPaperSerializer with lesson_plans
-[ ] Create TopicDetailedSerializer
- [ ] Add get_queryset filtering to QuestionViewSet
- [ ] Add generate_from_lesson action to QuestionViewSet
- [ ] Add by_lesson_plan action to QuestionViewSet
- [ ] Add create_from_lessons action to ExamPaperViewSet
- [ ] Add link_lesson_plans action to ExamPaperViewSet
- [ ] Add coverage_stats action to ExamPaperViewSet
- [ ] Create TopicViewSet with coverage_summary action
- [ ] Register TopicViewSet in urls.py
- [ ] Run migrations: `python manage.py migrate`
- [ ] Test endpoints with Postman/REST client
- [ ] Update BACKEND_APPS.md
- [ ] Update API_ENDPOINTS.md
- [ ] Update API_RESPONSES.md

## Phase 2: Frontend ✅
- [ ] Create LessonPlanPaperTab.jsx component
- [ ] Create TopicStatusBadge.jsx component
- [ ] Create QuestionSelector.jsx component
- [ ] Create CurriculumCoveragePage.jsx component
- [ ] Update QuestionPaperBuilderPage.jsx (add tab)
- [ ] Update CurriculumPage.jsx (add status badges)
- [ ] Update LessonPlansPage.jsx (add generation button)
- [ ] Add lmsApi object to services/api.js
- [ ] Update questionPaperApi in services/api.js
- [ ] Add lazy imports to App.jsx
- [ ] Add route for /academics/curriculum-coverage
- [ ] Update sidebar in Layout.jsx
- [ ] Test all components in browser
- [ ] Test workflows end-to-end
- [ ] Update FRONTEND_PAGES.md
- [ ] Update FRONTEND_COMPONENTS.md

## Phase 3: Documentation ✅
- [ ] Update BACKEND_APPS.md (Question, ExamPaper, Topic)
- [ ] Update API_ENDPOINTS.md (new endpoints)
- [ ] Update API_RESPONSES.md (example responses)
- [ ] Update FRONTEND_PAGES.md (new pages, updated pages)
- [ ] Update FRONTEND_COMPONENTS.md (new components)
- [ ] Update generate_user_guide.py (new chapter)
- [ ] Run `python generate_user_guide.py`
- [ ] Verify PDF generated successfully
- [ ] Verify JSON file generated for in-app guide

## Testing
- [ ] Backend API tests:
  - [ ] POST /questions/generate_from_lesson/ with valid lesson
  - [ ] POST /exam-papers/create_from_lessons/ with lessons
  - [ ] GET /topics/coverage_summary/ returns stats
  - [ ] Filter /questions/?lesson_plan=X works
  - [ ] GET /exam-papers/{id}/coverage_stats/ works
  
- [ ] Frontend tests:
  - [ ] Can select lesson plans
  - [ ] Topics display correctly
  - [ ] Generate questions button works
  - [ ] Paper creation from lessons works
  - [ ] Coverage dashboard loads and shows stats
  - [ ] Topic badges display correctly
  - [ ] Mobile: Camera opens on click
  
- [ ] Integration tests:
  - [ ] Create lesson → See coverage change on dashboard
  - [ ] Generate questions → Questions linked to topics
  - [ ] Create paper from lessons → Paper shows covered topics
  - [ ] Link lesson to paper → Paper reflects lesson structure
  
- [ ] Performance:
  - [ ] /topics/coverage_summary/ < 1 sec for 1000+ topics
  - [ ] Question filtering by lesson < 2 sec
  - [ ] AI generation < 30 sec for 10 questions

## Deployment
- [ ] Run migrations on staging: `python manage.py migrate`
- [ ] Deploy backend code
- [ ] Deploy frontend code (npm run build)
- [ ] Test on staging environment
- [ ] Generate updated user guide PDF
- [ ] Deploy to production
- [ ] Verify all endpoints working
- [ ] Monitor error logs
- [ ] Send update notification to users

## Post-Launch
- [ ] Gather user feedback
- [ ] Monitor API performance
- [ ] Check for any 500 errors
- [ ] Optimize queries if needed
- [ ] Create quick-start guide for teachers
- [ ] Record video tutorial for lesson plan → paper workflow
```

---

# Summary Table

| Phase | Task | Est. Time | Status |
|-------|------|-----------|--------|
| **Backend** |
| 1.1 | Database & Models | 45 mins | 📝 Ready |
| 1.2 | Serializers | 45 mins | 📝 Ready |
| 1.3 | ViewSets & Endpoints | 90 mins | 📝 Ready |
| 1.4 | Documentation | 15 mins | 📝 Ready |
| **Frontend** |
| 2.1 | New Components | 90 mins | 📝 Ready |
| 2.2 | Update Existing Pages | 90 mins | 📝 Ready |
| 2.3 | Services Layer | 90 mins | 📝 Ready |
| 2.4 | Routing | 15 mins | 📝 Ready |
| **Documentation** |
| 3.1 | Backend Docs | 30 mins | 📝 Ready |
| 3.2 | Frontend Docs | 30 mins | 📝 Ready |
| 3.3 | User Guide PDF | 45 mins | 📝 Ready |
| 3.4 | Checklist | 15 mins | 📝 Ready |
| **TOTAL** | | **~8-9 hours** | ✅ Complete |

---

# Next Steps

1. **Approve Plan** - Review and confirm all 3 phases
2. **Start Phase 1** - Begin backend implementation
3. **Execute in Order** - Don't skip phases (dependencies)
4. **Test Thoroughly** - Each phase has test points
5. **Deploy Carefully** - Run migrations before deployment
6. **Update Guide** - Run PDF generation after all changes

**Ready to start implementation? Let me know which phase to begin with!**
