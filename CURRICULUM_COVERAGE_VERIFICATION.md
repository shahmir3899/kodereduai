# Curriculum Coverage Dashboard - Verification Report

## Overview
The Curriculum Coverage Dashboard enables administrators to visualize taught vs. tested topics across a school's curriculum. It provides filtering by class, subject, and coverage status to identify curriculum gaps.

---

## Architecture & Data Flow

### Frontend Flow
```
User selects Class + Subject
           ↓
CurriculumCoveragePage state updates (classId, subjectId)
           ↓
useQuery hook enabled (both classId & subjectId required)
           ↓
API call: GET /api/lms/topics/?class_id={id}&subject_id={id}&page_size=999
           ↓
Backend returns Topic list with coverage properties
           ↓
Frontend calculates metrics (taught_count, tested_count)
           ↓
Topics rendered in table with TopicStatusBadge components
```

### Filtering Flow
```
User changes Coverage Filter dropdown
           ↓
setCoverage() updates state
           ↓
Query key changes → useQuery refetches
           ↓
API call includes coverage parameter:
   - '' (empty) → All topics
   - 'taught_only' → Topics with lesson plans
   - 'tested_only' → Topics with questions
   - 'both' → Topics with both
   - 'uncovered' → Topics with neither
           ↓
Backend filters queryset accordingly
           ↓
Updated topic list returned
```

---

## Frontend Implementation Details

### CurriculumCoveragePage.jsx

**State Management:**
- `classId`: Selected class ID (string)
- `subjectId`: Selected subject ID (string)
- `coverage`: Coverage filter value (string | '')

**Query Dependencies:**
- Query key: `['curriculumCoverageTopics', classId, subjectId, coverage]`
- Query enabled only when: `Boolean(classId && subjectId)`
- This ensures API calls only happen with both filters

**API Parameters:**
```javascript
{
  page_size: 999,                           // Get all topics
  ...(classId && { class_id: classId }),    // Optional
  ...(subjectId && { subject_id: subjectId }),  // Optional
  ...(coverage && { coverage })             // Optional
}
```

**Metrics Calculation:**
```javascript
const taughtCount = topics.filter((t) => t.is_covered).length
const testedCount = topics.filter((t) => t.is_tested).length
```

**Conditional Rendering Logic:**
1. No class or subject selected → "Select class and subject..."
2. Loading → "Loading topics..."
3. No results → "No topics found for selected filters."
4. With results → Display metrics cards + topic table

### TopicStatusBadge.jsx

**Badge Logic (Priority-based):**
| Condition | Badge | Color |
|-----------|-------|-------|
| `is_covered && is_tested` | Taught & Tested | Green (bg-green-100, text-green-700) |
| `is_covered && !is_tested` | Taught only | Amber (bg-amber-100, text-amber-700) |
| `!is_covered && is_tested` | Tested only | Blue (bg-blue-100, text-blue-700) |
| `!is_covered && !is_tested` | Not covered | Gray (bg-gray-100, text-gray-600) |
| `!topic` | (null) | - |

---

## Backend Implementation Details

### Topic Model (backend/lms/models.py)

**Coverage Properties (all read-only):**
```python
@property
def is_covered(self):
    """Check if topic is covered by published lesson plans."""
    return self.lesson_plans.filter(is_active=True).exists()

@property
def is_tested(self):
    """Check if topic has active test questions."""
    return self.test_questions.filter(is_active=True).exists()

@property
def test_question_count(self):
    """Count of test questions for this topic."""
    return self.test_questions.filter(is_active=True).count()

@property
def lesson_plan_count(self):
    """Count of lesson plans covering this topic."""
    return self.lesson_plans.filter(is_active=True).count()
```

### TopicDetailedSerializer (backend/lms/serializers.py)

**Serialized Fields:**
```python
fields = [
    'id', 'title', 'topic_number', 'description',
    'estimated_periods', 'is_active',
    'is_covered',          # boolean (computed)
    'is_tested',           # boolean (computed)
    'test_question_count', # integer (computed)
    'lesson_plan_count',   # integer (computed)
    'lesson_plans',        # list of related lesson plans
    'test_questions',      # list of related questions
    'created_at', 'updated_at'
]
```

### TopicViewSet Filtering (backend/lms/views.py)

**Filter Sequence:**
```python
queryset = Topic.objects.all()

# 1. Filter by class (if provided)
class_id = request.query_params.get('class_id')
if class_id:
    queryset = queryset.filter(chapter__book__class_obj_id=class_id)

# 2. Filter by subject (if provided)
subject_id = request.query_params.get('subject_id')
if subject_id:
    queryset = queryset.filter(chapter__book__subject_id=subject_id)

# 3. Filter by coverage status (if provided)
coverage = request.query_params.get('coverage')

if coverage == 'taught_only':
    # Topics with active lesson plans
    queryset = queryset.filter(lesson_plans__is_active=True).distinct()

elif coverage == 'tested_only':
    # Topics with active questions
    queryset = queryset.filter(test_questions__is_active=True).distinct()

elif coverage == 'both':
    # Topics with both lesson plans AND questions
    queryset = queryset.filter(
        lesson_plans__is_active=True,
        test_questions__is_active=True
    ).distinct()

elif coverage == 'uncovered':
    # Topics with neither lesson plans nor questions
    queryset = queryset.exclude(
        Q(lesson_plans__is_active=True) | Q(test_questions__is_active=True)
    ).distinct()

return queryset
```

---

## Display Components

### Metrics Cards (when class & subject selected)
```
┌─────────────────────────────────────────────────┐
│  Total Topics │   Taught   │    Tested          │
│      N        │    M       │     K              │
└─────────────────────────────────────────────────┘
```

M = `count(topics where is_covered=true)`
K = `count(topics where is_tested=true)`
N = Total count

### Topic Table
```
┌──────────────────────────────────────────────────────────────┐
│ Topic              │ Status          │ Lesson Plans │ Questions│
├──────────────────────────────────────────────────────────────┤
│ 1.1 Introduction   │ Taught & Tested │     2        │    5     │
│ 1.2 Linear Eqn     │ Taught only     │     1        │    0     │
│ 1.3 Quadratic      │ Tested only     │     0        │    3     │
│ 1.4 Polynomials    │ Not covered     │     0        │    0     │
└──────────────────────────────────────────────────────────────┘
```

---

## Integration Verification Checklist

### ✅ Filter UI & State
- [x] Class selector renders and updates state
- [x] Subject selector renders and updates state
- [x] Coverage dropdown shows all 5 options
- [x] State changes trigger query dependency update

### ✅ API Integration
- [x] Query only runs when both class & subject are set
- [x] API endpoint: `/api/lms/topics/` exists
- [x] Parameters correctly passed:
  - `class_id` (integer)
  - `subject_id` (integer)
  - `coverage` (string: '', 'taught_only', 'tested_only', 'both', 'uncovered')
  - `page_size` (999)
- [x] Backend filters apply correctly for each coverage type

### ✅ Data Display
- [x] Metrics cards calculate taught_count and tested_count
- [x] Topic table renders with all required columns
- [x] Topic numbers and titles display correctly
- [x] Lesson plan counts show (from `topic.lesson_plan_count`)
- [x] Question counts show (from `topic.test_question_count`)

### ✅ Badge Logic
- [x] Badge renders for each topic based on status
- [x] Correct colors for each status:
  - Green for "Taught & Tested"
  - Amber for "Taught only"
  - Blue for "Tested only"
  - Gray for "Not covered"

### ✅ Edge Cases
- [x] Empty state: "Select class and subject..."
- [x] Loading state: "Loading topics..."
- [x] No results: "No topics found for selected filters."
- [x] Null topic in badge: Returns null
- [x] Coverage filter change triggers refetch

---

## Test Scenarios

### Scenario 1: View All Topics (No Filter)
**Setup:** Class 10, Subject Math, Coverage = "All topics"
**Expected Result:**
- All 10 topics for Class 10 Math appear
- Metrics show: Total=10, Taught=7, Tested=5
- Mix of all 4 badge colors in table

### Scenario 2: Filter Taught Only
**Setup:** Class 10, Subject Math, Coverage = "Taught only"
**Expected Result:**
- Only 7 topics appear (those with is_covered=true)
- Badges show only "Taught & Tested" or "Taught only"
- No "Tested only" or "Not covered" badges

### Scenario 3: Filter Tested Only
**Setup:** Class 10, Subject Chemistry, Coverage = "Tested only"
**Expected Result:**
- Only 5 topics appear (those with is_tested=true)
- Badges show only "Taught & Tested" or "Tested only"
- No "Taught only" or "Not covered" badges

### Scenario 4: Filter Both Taught & Tested
**Setup:** Class 11, Subject Physics, Coverage = "both"
**Expected Result:**
- Only 3 topics appear (those with is_covered=true AND is_tested=true)
- All badges show "Taught & Tested"

### Scenario 5: Filter Uncovered
**Setup:** Class 10, Subject English, Coverage = "uncovered"
**Expected Result:**
- Only 2 topics appear (those never taught AND never tested)
- All badges show "Not covered"
- Lesson plan counts and question counts all show 0

### Scenario 6: No Results
**Setup:** Class 12, Subject Latin (no data), Coverage = "all"
**Expected Result:**
- Message: "No topics found for selected filters."
- No table rendered
- Metrics cards still hidden

---

## Performance Considerations

1. **Page Size**: Set to 999 to load all topics at once
   - Safe for schools with <1000 topics per subject
   - Alternative: Implement pagination if needed

2. **Query Caching**: React Query caches results
   - Cache invalidation on filter change (handled by query key dependencies)
   - Users switching filters get instant results (no refetch to same data)

3. **Filtering Location**: Backend filters vs. frontend filters
   - ✅ Coverage filter done in backend (efficient)
   - ✅ Class/subject filter done in backend (efficient)
   - Alternative: Could be done in frontend if API returns all topics, but backend is better

4. **Related Data**: Lesson plans and questions shown (limited to 5 questions)
   - Keeps response size manageable
   - Frontend could paginate within topic details

---

## Known Limitations & Future Enhancements

### Current (v1)
- Single-level filtering (one class, one subject at a time)
- No export functionality
- No historical tracking of changes
- No bulk actions

### Potential Enhancements
- [ ] Multi-select class/subject
- [ ] Export to CSV/PDF
- [ ] Date range filtering
- [ ] Coverage trend graphs (taught/tested over time)
- [ ] Bulk topic tagging/linking
- [ ] Comparison view (multiple classes side-by-side)
- [ ] Topic-level actions (generate questions, create lesson plan links)

---

## Summary

✅ **Frontend Implementation**: Complete and validated
✅ **Backend Implementation**: Complete and validated
✅ **API Integration**: Proper request/response flow
✅ **Display Logic**: Correct filtering and rendering
✅ **Badge System**: Accurate status representation
✅ **Error Handling**: Empty states and loading states

**Status: READY FOR PRODUCTION USE**
