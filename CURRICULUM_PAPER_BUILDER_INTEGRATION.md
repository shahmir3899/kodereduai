# Curriculum → Lesson Plans → Paper Builder Integration Plan

## Overview

Connect the **LMS curriculum system** (Books/TOC → Chapters → Topics) with **Lesson Plans** and the **Question Paper Builder** to create a complete teaching-to-testing workflow.

---

## Current State

### ✅ Already Connected:
- **Book → Chapter → Topic** (hierarchical TOC structure)
- **LessonPlan → Topics** (M2M via `planned_topics`)
- **ExamPaper → Exam** (optional FK for lifecycle integration)

### ❌ Missing Connections:
- **Question → Topics** (questions don't link to curriculum topics)
- **ExamPaper → LessonPlans** (papers don't link to what was taught)
- **AI Question Generation** (no automated question creation from topics)

---

## Proposed Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CURRICULUM (LMS)                           │
│  Book → Chapter → Topic                                           │
│  (TOC imported via paste or OCR)                                  │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ↓
┌────────────────────────────────────────────────────────────────────┐
│                  LESSON PLANS (Teaching)                           │
│  LessonPlan.planned_topics (M2M → Topic)                           │
│  - Teacher selects topics to cover                                 │
│  - Tracks: "This lesson covers Topics 2.1, 2.2, 2.3"               │
└────────────────┬───────────────────────────────────────────────────┘
                 │
                 ↓
┌────────────────────────────────────────────────────────────────────┐
│            QUESTION BANK (Paper Builder)                           │
│  Question.tested_topics (M2M → Topic) ← NEW!                       │
│  - Questions tagged with topics they test                          │
│  - Filter questions: "Show MCQs for Topics 2.1-2.3"                │
└────────────────┬───────────────────────────────────────────────────┘
                 │
                 ↓
┌────────────────────────────────────────────────────────────────────┐
│               EXAM PAPERS (Testing)                                │
│  ExamPaper.lesson_plans (M2M → LessonPlan) ← NEW!                  │
│  ExamPaper.covered_topics (computed from questions)                │
│  - Papers linked to lesson plans                                   │
│  - Auto-select questions from taught topics                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Benefits of This Integration

### 1. **Topic-Based Question Filtering** 🎯
**Teacher workflow:**
- Views lesson plan: "I taught Topics 3.1, 3.2, 3.3"
- Creates exam paper: "Show me all MCQs for Topics 3.1-3.3"
- Questions automatically filtered by curriculum coverage

### 2. **AI Question Generation from Topics** 🤖
**Automated creation:**
- Button: "Generate Questions from Lesson Plan"
- Groq AI creates questions based on:
  - Topic titles (e.g., "3.2 Photosynthesis")
  - Topic descriptions
  - Difficulty level selection
- Questions auto-tagged with source topics

### 3. **Curriculum Coverage Dashboard** 📊
**Visual tracking:**
```
Chemistry - Class 10
├── Chapter 1: Acids & Bases
│   ├── 1.1 Introduction ✅ Taught ✅ Tested
│   ├── 1.2 pH Scale ✅ Taught ❌ Not Tested
│   └── 1.3 Neutralization ❌ Not Taught ❌ Not Tested
├── Chapter 2: Metals
│   ├── 2.1 Properties ✅ Taught ✅ Tested
│   └── 2.2 Reactivity ✅ Taught ⚠️ Partially Tested
```

### 4. **Smart Paper Creation** 🧠
**Workflow:**
1. Select lesson plans: "Mid-term covers lessons from Sept-Oct"
2. System extracts all `planned_topics` from those lesson plans
3. Filter question bank by those topics
4. Balance questions by difficulty + marks
5. Generate paper blueprint

### 5. **Teaching Alignment** ✅
**Admin insights:**
- "Which topics are taught but never tested?"
- "Which topics are tested but never formally taught?"
- "Teacher X covers 85% of curriculum, tests 70%"

---

## Implementation Plan

### Phase 1: Database Schema Changes (30 mins)

#### 1.1 Add Question → Topics M2M
```python
# backend/examinations/models.py

class Question(models.Model):
    # ... existing fields ...
    
    # NEW: Link questions to curriculum topics
    tested_topics = models.ManyToManyField(
        'lms.Topic',
        blank=True,
        related_name='test_questions',
        help_text='Curriculum topics this question tests'
    )
```

#### 1.2 Add ExamPaper → LessonPlans M2M
```python
# backend/examinations/models.py

class ExamPaper(models.Model):
    # ... existing fields ...
    
    # NEW: Link to lesson plans this paper tests
    lesson_plans = models.ManyToManyField(
        'lms.LessonPlan',
        blank=True,
        related_name='exam_papers',
        help_text='Lesson plans whose content is tested in this paper'
    )
    
    @property
    def covered_topics(self):
        """Get all topics tested in this paper via questions."""
        from lms.models import Topic
        question_ids = self.paper_questions.values_list('question_id', flat=True)
        return Topic.objects.filter(test_questions__id__in=question_ids).distinct()
```

#### 1.3 Add helper property to Topic
```python
# backend/lms/models.py

class Topic(models.Model):
    # ... existing fields ...
    
    @property
    def is_tested(self):
        """Check if this topic has any test questions."""
        return self.test_questions.filter(is_active=True).exists()
    
    @property
    def test_question_count(self):
        """Count of test questions for this topic."""
        return self.test_questions.filter(is_active=True).count()
```

**Migration:**
```bash
cd backend
python manage.py makemigrations examinations lms
python manage.py migrate
```

---

### Phase 2: API Enhancements (1 hour)

#### 2.1 Update Question Serializer
```python
# backend/examinations/serializers.py

class QuestionSerializer(serializers.ModelSerializer):
    tested_topics = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Topic.objects.all(),
        required=False
    )
    tested_topics_details = serializers.SerializerMethodField()
    
    def get_tested_topics_details(self, obj):
        return [
            {
                'id': t.id,
                'title': t.title,
                'chapter': t.chapter.title,
                'chapter_number': t.chapter.chapter_number,
                'topic_number': t.topic_number,
            }
            for t in obj.tested_topics.select_related('chapter').all()
        ]
```

#### 2.2 Add Question Filtering by Topics
```python
# backend/examinations/views.py

class QuestionViewSet(viewsets.ModelViewSet):
    # ... existing code ...
    
    def get_queryset(self):
        qs = super().get_queryset()
        
        # Filter by topics
        topic_ids = self.request.query_params.getlist('topics')
        if topic_ids:
            qs = qs.filter(tested_topics__id__in=topic_ids).distinct()
        
        # Filter by lesson plan (get topics from lesson plan)
        lesson_plan_id = self.request.query_params.get('lesson_plan')
        if lesson_plan_id:
            from lms.models import LessonPlan
            try:
                lesson = LessonPlan.objects.get(id=lesson_plan_id, school=self.request.tenant_school)
                topic_ids = lesson.planned_topics.values_list('id', flat=True)
                qs = qs.filter(tested_topics__id__in=topic_ids).distinct()
            except LessonPlan.DoesNotExist:
                pass
        
        return qs
```

#### 2.3 Add AI Question Generation Endpoint
```python
# backend/examinations/views.py

from lms.models import LessonPlan
import requests

class QuestionViewSet(viewsets.ModelViewSet):
    # ... existing code ...
    
    @action(detail=False, methods=['post'])
    def generate_from_lesson(self, request):
        """
        Generate questions from a lesson plan using AI.
        
        Body: {
            lesson_plan_id: int,
            question_count: int (default 5),
            question_type: str (MCQ/SHORT/ESSAY),
            difficulty_level: str (EASY/MEDIUM/HARD)
        }
        """
        lesson_plan_id = request.data.get('lesson_plan_id')
        question_count = request.data.get('question_count', 5)
        question_type = request.data.get('question_type', 'MCQ')
        difficulty_level = request.data.get('difficulty_level', 'MEDIUM')
        
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
        
        # Get topics from lesson plan
        topics = lesson.planned_topics.select_related('chapter', 'chapter__book').all()
        if not topics:
            return Response(
                {'error': 'Lesson plan has no topics selected'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build AI prompt
        topics_text = '\n'.join([
            f"- Chapter {t.chapter.chapter_number}: {t.chapter.title}"
            f"\n  Topic {t.topic_number}: {t.title}"
            f"\n  Description: {t.description or 'N/A'}"
            for t in topics
        ])
        
        prompt = f"""You are an expert educator creating {question_type} questions for a {lesson.subject.name} exam ({lesson.class_obj.name} level).

Generate {question_count} {difficulty_level.lower()} difficulty {question_type} questions based on these topics:

{topics_text}

For each question, provide:
1. Question text (clear and concise)
2. For MCQ: 4 options (A, B, C, D) with correct answer
3. Which topic it tests (use topic number like "3.2")
4. Marks (1-5 based on difficulty)

Format output as JSON array:
[
  {{
    "question_text": "...",
    "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
    "correct_answer": "A",
    "tested_topic_number": "3.2",
    "marks": 2,
    "difficulty_level": "MEDIUM"
  }}
]"""
        
        # Call Groq API
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
                },
                timeout=30,
            )
            groq_response.raise_for_status()
            
            ai_text = groq_response.json()['choices'][0]['message']['content']
            
            # Parse JSON from AI response
            import json
            import re
            json_match = re.search(r'\[.*\]', ai_text, re.DOTALL)
            if json_match:
                questions_data = json.loads(json_match.group())
            else:
                questions_data = json.loads(ai_text)
            
            # Create Question objects
            created_questions = []
            for q_data in questions_data:
                # Find matching topic
                tested_topic = None
                topic_number_str = q_data.get('tested_topic_number', '')
                for t in topics:
                    if f"{t.chapter.chapter_number}.{t.topic_number}" == topic_number_str:
                        tested_topic = t
                        break
                
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
                'message': f'Successfully generated {len(created_questions)} questions',
                'questions': serializer.data,
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response(
                {'error': f'AI generation failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
```

#### 2.4 Update LMS Book/Topic API
```python
# backend/lms/serializers.py

class TopicSerializer(serializers.ModelSerializer):
    is_covered = serializers.BooleanField(read_only=True)
    is_tested = serializers.BooleanField(read_only=True)
    test_question_count = serializers.IntegerField(read_only=True)
    
    class Meta:
        model = Topic
        fields = [
            'id', 'title', 'topic_number', 'description',
            'estimated_periods', 'is_active',
            'is_covered',  # has lesson plans
            'is_tested',  # has test questions
            'test_question_count',  # count of questions
        ]
```

---

### Phase 3: Frontend UI Integration (2 hours)

#### 3.1 Curriculum Page - Show Test Status
File: `/academics/curriculum` (CurriculumPage.jsx)

```jsx
// In topic list, show teaching and testing status:
<div className="topic-item flex items-center justify-between">
  <div>
    <span className="font-medium">{topic.topic_number}. {topic.title}</span>
  </div>
  
  <div className="flex items-center gap-2">
    {/* Taught badge */}
    {topic.is_covered && (
      <span className="badge badge-success text-xs">
        ✅ Taught
      </span>
    )}
    
    {/* Tested badge */}
    {topic.is_tested && (
      <span className="badge badge-primary text-xs">
        📝 {topic.test_question_count} questions
      </span>
    )}
    
    {/* Generate questions button */}
    {topic.is_covered && !topic.is_tested && (
      <button
        onClick={() => handleGenerateQuestions([topic.id])}
        className="btn btn-sm btn-outline"
      >
        🤖 Generate Questions
      </button>
    )}
  </div>
</div>
```

#### 3.2 Lesson Plans Page - Link to Questions
File: `/academics/lesson-plans` (LessonPlansPage.jsx)

```jsx
// In lesson plan detail view:
<div className="card mt-4">
  <div className="card-header flex justify-between items-center">
    <h4 className="font-semibold">Planned Topics ({lesson.planned_topics.length})</h4>
    
    <button
      onClick={() => handleGenerateQuestionsFromLesson(lesson.id)}
      className="btn btn-primary btn-sm"
    >
      🤖 Generate {questionCount} Questions
    </button>
  </div>
  
  <div className="card-body">
    {/* Show topics */}
    {lesson.planned_topics.map(topic => (
      <div key={topic.id} className="flex justify-between py-2 border-b">
        <span>{topic.chapter.chapter_number}.{topic.topic_number} {topic.title}</span>
        <span className="text-sm text-gray-600">
          {topic.test_question_count > 0 
            ? `${topic.test_question_count} questions available`
            : 'No questions yet'}
        </span>
      </div>
    ))}
    
    {/* Link to create paper */}
    <div className="mt-4">
      <Link
        to="/academics/paper-builder"
        state={{ lessonPlanId: lesson.id }}
        className="btn btn-outline"
      >
        📄 Create Exam Paper from This Lesson
      </Link>
    </div>
  </div>
</div>
```

#### 3.3 Paper Builder - Topic Filter
File: `/academics/paper-builder` (QuestionPaperBuilderPage.jsx)

**Add new tab: "From Lesson Plans"**

```jsx
const [activeTab, setActiveTab] = useState('manual') // 'manual' | 'image' | 'lesson'

// ... existing tabs ...

{activeTab === 'lesson' && (
  <LessonPlanPaperTab
    onPaperCreate={handlePaperCreate}
    isLoading={createPaperMutation.isPending}
    initialLessonPlanId={location.state?.lessonPlanId}
  />
)}
```

**New Component: LessonPlanPaperTab.jsx**

```jsx
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi, lmsApi } from '../../services/api'

export default function LessonPlanPaperTab({ onPaperCreate, initialLessonPlanId }) {
  const [selectedLessons, setSelectedLessons] = useState([])
  const [generatedQuestions, setGeneratedQuestions] = useState([])
  const [loading, setLoading] = useState(false)
  
  // Fetch lesson plans
  const { data: lessonsData } = useQuery({
    queryKey: ['lesson-plans'],
    queryFn: () => lmsApi.getLessonPlans({ page_size: 999 }),
  })
  
  const lessons = lessonsData?.data?.results || []
  
  // Get all topics from selected lessons
  const selectedTopics = lessons
    .filter(l => selectedLessons.includes(l.id))
    .flatMap(l => l.planned_topics || [])
  
  const handleGenerateQuestions = async () => {
    if (selectedLessons.length === 0) return
    
    setLoading(true)
    try {
      // Call API to generate questions
      const response = await questionPaperApi.generateFromLessons({
        lesson_plan_ids: selectedLessons,
        question_count: 10,
        question_type: 'MCQ',
        difficulty_level: 'MEDIUM',
      })
      
      setGeneratedQuestions(response.data.questions)
    } catch (error) {
      console.error('Failed to generate questions:', error)
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Lesson Plan Selector */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold text-lg mb-3">Select Lesson Plans</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {lessons.map(lesson => (
            <label key={lesson.id} className="flex items-center gap-2 p-2 border rounded hover:bg-gray-50">
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
              />
              <div>
                <span className="font-medium">{lesson.title}</span>
                <span className="text-sm text-gray-600 block">
                  {lesson.planned_topics?.length || 0} topics • {lesson.lesson_date}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>
      
      {/* Topics Summary */}
      {selectedTopics.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-900 mb-2">
            Topics to Test ({selectedTopics.length})
          </h4>
          <div className="max-h-48 overflow-y-auto">
            {selectedTopics.map(topic => (
              <div key={topic.id} className="text-sm text-blue-800 py-1">
                • {topic.chapter.chapter_number}.{topic.topic_number}: {topic.title}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Generate Button */}
      <button
        onClick={handleGenerateQuestions}
        disabled={selectedLessons.length === 0 || loading}
        className="btn btn-primary w-full"
      >
        {loading ? (
          <>
            <span className="animate-spin">⏳</span> Generating Questions...
          </>
        ) : (
          <>
            🤖 Generate AI Questions from Selected Topics
          </>
        )}
      </button>
      
      {/* Generated Questions Review */}
      {generatedQuestions.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold text-lg mb-3">
            Generated Questions ({generatedQuestions.length})
          </h3>
          {/* Question review UI here */}
        </div>
      )}
    </div>
  )
}
```

#### 3.4 Add Topic Tags to Manual Entry Tab
File: `ManualEntryPaperTab.jsx`

```jsx
// Add topic selector for each question:
<div className="form-group">
  <label>Which Topics Does This Question Test? (Optional)</label>
  <SearchableSelect
    isMulti
    options={availableTopics}  // from curriculum API
    value={question.tested_topics}
    onChange={(topics) => updateQuestion({ tested_topics: topics })}
    placeholder="Select topics..."
  />
  <p className="text-xs text-gray-500 mt-1">
    Link this question to curriculum topics for better tracking
  </p>
</div>
```

---

### Phase 4: Curriculum Coverage Dashboard (1 hour)

#### 4.1 New Page: Curriculum Coverage
File: `/academics/curriculum-coverage` (CurriculumCoveragePage.jsx)

```jsx
export default function CurriculumCoveragePage() {
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  
  const { data: booksData } = useQuery({
    queryKey: ['books', selectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooks({ class_id: selectedClass, subject_id: selectedSubject }),
    enabled: !!selectedClass && !!selectedSubject,
  })
  
  const books = booksData?.data?.results || []
  
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Curriculum Coverage Analysis</h1>
        
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <ClassSelector value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} />
            <SubjectSelector value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} />
          </div>
        </div>
        
        {/* Coverage Cards */}
        {books.map(book => (
          <div key={book.id} className="bg-white rounded-lg shadow-sm p-6 mb-4">
            <h2 className="text-xl font-semibold mb-4">{book.title}</h2>
            
            {book.chapters?.map(chapter => (
              <div key={chapter.id} className="ml-4 mb-4">
                <h3 className="font-medium text-lg mb-2">
                  Chapter {chapter.chapter_number}: {chapter.title}
                </h3>
                
                <div className="grid grid-cols-1 gap-2 ml-4">
                  {chapter.topics?.map(topic => {
                    const status = getTopicStatus(topic)  // taught/tested/neither
                    
                    return (
                      <div key={topic.id} className={`flex items-center justify-between p-3 rounded border ${
                        status === 'complete' ? 'bg-green-50 border-green-200' :
                        status === 'taught' ? 'bg-yellow-50 border-yellow-200' :
                        'bg-gray-50 border-gray-200'
                      }`}>
                        <span>
                          {topic.topic_number}. {topic.title}
                        </span>
                        
                        <div className="flex items-center gap-2">
                          {topic.is_covered && (
                            <span className="badge badge-success text-xs">✅ Taught</span>
                          )}
                          {topic.is_tested && (
                            <span className="badge badge-primary text-xs">
                              📝 {topic.test_question_count} questions
                            </span>
                          )}
                          {!topic.is_covered && !topic.is_tested && (
                            <span className="badge badge-gray text-xs">⏳ Pending</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            
            {/* Progress Summary */}
            <div className="mt-6 pt-6 border-t">
              <CoverageProgressBar book={book} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CoverageProgressBar({ book }) {
  const total = book.total_topics || 0
  const taught = book.taught_topics || 0
  const tested = book.tested_topics || 0
  
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Teaching Progress:</span>
        <span className="font-medium">{taught}/{total} topics ({Math.round(taught/total*100)}%)</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${taught/total*100}%` }} />
      </div>
      
      <div className="flex justify-between text-sm mt-4">
        <span>Testing Progress:</span>
        <span className="font-medium">{tested}/{total} topics ({Math.round(tested/total*100)}%)</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${tested/total*100}%` }} />
      </div>
    </div>
  )
}
```

---

## API Endpoints Summary (New)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/examinations/questions/?topics=1,2,3` | Filter questions by topic IDs |
| GET | `/api/examinations/questions/?lesson_plan=5` | Questions for topics in lesson plan |
| POST | `/api/examinations/questions/generate_from_lesson/` | AI generate questions from lesson plan |
| GET | `/api/lms/books/{id}/coverage_stats/` | Teaching vs testing coverage stats |
| GET | `/api/lms/topics/{id}/test_questions/` | All questions testing this topic |

---

## Database Changes Summary

```sql
-- New M2M table: Question ↔ Topic
CREATE TABLE examinations_question_tested_topics (
    id SERIAL PRIMARY KEY,
    question_id INT REFERENCES examinations_question(id) ON DELETE CASCADE,
    topic_id INT REFERENCES lms_topic(id) ON DELETE CASCADE,
    UNIQUE(question_id, topic_id)
);

-- New M2M table: ExamPaper ↔ LessonPlan  
CREATE TABLE examinations_exampaper_lesson_plans (
    id SERIAL PRIMARY KEY,
    exampaper_id INT REFERENCES examinations_exampaper(id) ON DELETE CASCADE,
    lessonplan_id INT REFERENCES lms_lessonplan(id) ON DELETE CASCADE,
    UNIQUE(exampaper_id, lessonplan_id)
);
```

---

## Documentation Updates Required

### BACKEND_APPS.md
```markdown
### Question (updated)
school(FK), subject(FK), exam_type(FK), question_text, question_image_url, question_type, difficulty_level, marks, option_a/b/c/d, correct_answer, **tested_topics(M2M → Topic)**, created_by(FK), is_active

### ExamPaper (updated)
school(FK), exam(FK), exam_subject(FK), class_obj(FK), subject(FK), paper_title, instructions, total_marks, duration_minutes, questions(M2M → Question), **lesson_plans(M2M → LessonPlan)**, status, generated_by(FK), is_active

### Topic (updated)
chapter(FK), title, topic_number, description, estimated_periods, is_active
**Properties:** is_covered (has lesson plans), is_tested (has test questions), test_question_count
```

### API_ENDPOINTS.md
```markdown
## Examinations (Questions)
| GET | /api/examinations/questions/?topics=1,2,3 | Filter questions by topic IDs |
| GET | /api/examinations/questions/?lesson_plan=5 | Questions testing topics from this lesson |
| POST | /api/examinations/questions/generate_from_lesson/ | AI generate questions. Body: {lesson_plan_id, question_count, question_type, difficulty_level} |

## LMS (Coverage)
| GET | /api/lms/books/{id}/coverage_stats/ | Teaching vs testing progress for this book |
| GET | /api/lms/topics/?show_coverage=true | Topics with is_covered, is_tested, test_question_count fields |
```

### FRONTEND_PAGES.md
```markdown
| /academics/curriculum | CurriculumPage.jsx | Now shows teaching ✅ and testing 📝 status per topic. Button: "Generate Questions" for taught topics |
| /academics/lesson-plans | LessonPlansPage.jsx | Now shows question count per topic. Button: "Generate Questions from Lesson" |
| /academics/paper-builder | QuestionPaperBuilderPage.jsx | New tab: "From Lesson Plans" for AI question generation |
| /academics/curriculum-coverage | CurriculumCoveragePage.jsx | NEW: Visual dashboard showing teaching vs testing progress |
```

---

## Workflow Example: Complete Teaching-to-Testing Cycle

### Week 1: Teacher Teaches
1. Teacher creates lesson plan: "Introduction to Photosynthesis"
2. Selects topics from curriculum:
   - Topic 3.1: Light Reactions
   - Topic 3.2: Dark Reactions
   - Topic 3.3: Factors Affecting
3. Marks lesson as PUBLISHED

### Week 2: Create Questions
4. Teacher views lesson plan
5. Clicks "Generate 10 MCQs from This Lesson"
6. AI generates questions tagged to Topics 3.1, 3.2, 3.3
7. Teacher reviews and edits questions
8. Questions saved to question bank

### Week 3: Create Exam Paper
9. Teacher goes to Paper Builder
10. Selects "From Lesson Plans" tab
11. Selects all 4 lessons from this month
12. System shows: "15 topics covered, 42 questions available"
13. Clicks "Generate Paper"
14. System creates paper with questions from those topics
15. Teacher reviews and adjusts
16. Generates PDF for printing

### Dashboard View
17. Admin views "Curriculum Coverage"
18. Sees: "Class 10 Biology: 65% taught, 45% tested"
19. Identifies gaps: "Topics 4.1-4.3 taught but not tested"

---

## Migration Path for Existing Data

### Step 1: Run migrations
```bash
python manage.py migrate
```

### Step 2: No data migration needed
- New M2M fields start empty (optional connections)
- Existing questions remain untagged
- Teachers gradually tag questions over time

### Step 3: Gradual adoption
- Teachers can continue using paper builder as before
- New features available but not mandatory
- Curriculum coverage shows gaps → drive adoption

---

## Summary: Why This Integration Matters

### Before (Disconnected):
- ❌ Teachers plan lessons → no link to exams
- ❌ Create questions → no curriculum alignment
- ❌ Build papers → manually select questions
- ❌ No visibility into coverage gaps

### After (Connected):
- ✅ Lesson plans link to curriculum topics
- ✅ Questions tagged to topics they test
- ✅ Papers auto-filter by taught topics
- ✅ AI generates questions from lessons
- ✅ Dashboard shows teaching vs testing gaps
- ✅ Complete audit trail: taught → tested

---

## Implementation Timeline

| Phase | Task | Time | Priority |
|-------|------|------|----------|
| 1 | Database schema + migrations | 30 mins | HIGH |
| 2 | API updates + serializers | 1 hour | HIGH |
| 3 | Frontend UI (basic linking) | 2 hours | HIGH |
| 4 | AI question generation | 1 hour | MEDIUM |
| 5 | Coverage dashboard | 1 hour | MEDIUM |
| **Total** | **Full implementation** | **5.5 hours** | |

---

## Ready to Implement?

Would you like me to implement:
- ✅ **Option 1: Full implementation** (Phases 1-5, ~5.5 hours)
- ⚡ **Option 2: Core only** (Phases 1-3, ~3.5 hours - manual linking + basic UI)
- 🚀 **Option 3: MVP** (Phase 1-2, ~1.5 hours - just the database + API, UI later)

Let me know which you prefer!
