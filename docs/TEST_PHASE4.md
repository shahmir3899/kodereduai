# Test Phase 4 — Student Responses, QuestionStats, Reuse Tracking
> Run this only after TEST_PHASE3.md reports all 49 tests passing.
> Covers Backend Phase 4 and Frontend Phase 4.
> Backend: pytest-django | Frontend: Jest + React Testing Library
> This is the final test phase. A full system summary is at the bottom.

---

## Instructions for Agent
1. Confirm TEST_PHASE3.md summary shows 49/49 passing before starting
2. Write and run all tests below in sequence
3. Mark each test `[PASS]` or `[FAIL]` with failure reason
4. Do NOT fix bugs — log and continue
5. Fill in Phase 4 summary AND the complete system summary at the bottom

---

## BACKEND TESTS — Phase 4

### B4.1 — StudentResponse Model and API Tests
**File to create:** `examinations/tests/test_student_responses.py`

```python
import pytest
from decimal import Decimal

@pytest.mark.django_db
class TestStudentResponseModel:

    def test_create_student_response(self, student, question, exam_paper):
        from examinations.models import StudentResponse
        response = StudentResponse.objects.create(
            student=student,
            question=question,
            exam_paper=exam_paper,
            marks_awarded=Decimal('3.5'),
            is_correct=True
        )
        assert response.id is not None
        assert response.marks_awarded == Decimal('3.5')

    def test_unique_constraint_per_student_question_paper(self, student, question, exam_paper):
        from examinations.models import StudentResponse
        from django.db import IntegrityError
        StudentResponse.objects.create(
            student=student, question=question, exam_paper=exam_paper, marks_awarded=2
        )
        with pytest.raises(IntegrityError):
            StudentResponse.objects.create(
                student=student, question=question, exam_paper=exam_paper, marks_awarded=3
            )

    def test_is_correct_nullable(self, student, question, exam_paper):
        from examinations.models import StudentResponse
        response = StudentResponse.objects.create(
            student=student, question=question,
            exam_paper=exam_paper, marks_awarded=0
        )
        assert response.is_correct is None

    def test_time_taken_nullable(self, student, question, exam_paper):
        from examinations.models import StudentResponse
        response = StudentResponse.objects.create(
            student=student, question=question,
            exam_paper=exam_paper, marks_awarded=1
        )
        assert response.time_taken_seconds is None

    def test_bulk_submit_student_responses_via_api(self, auth_client, student, exam_paper_with_questions):
        questions = exam_paper_with_questions.questions.all()
        payload = [
            {
                'student': student.id,
                'question': q.id,
                'exam_paper': exam_paper_with_questions.id,
                'marks_awarded': 2,
            }
            for q in questions[:3]
        ]
        response = auth_client.post(
            '/api/examinations/student-responses/',
            payload, format='json'
        )
        assert response.status_code in [200, 201]

    def test_marks_awarded_cannot_exceed_question_max(self, auth_client, student, question, exam_paper):
        # question.marks = 5
        payload = {
            'student': student.id,
            'question': question.id,
            'exam_paper': exam_paper.id,
            'marks_awarded': 999
        }
        response = auth_client.post('/api/examinations/student-responses/', [payload], format='json')
        assert response.status_code == 400
```

**Run:** `pytest examinations/tests/test_student_responses.py -v`
**Expected:** 6/6 pass

**Results:**
- [ ] create student response — `[ ]` PASS / `[ ]` FAIL
- [ ] unique constraint per student/question/paper — `[ ]` PASS / `[ ]` FAIL
- [ ] is_correct nullable — `[ ]` PASS / `[ ]` FAIL
- [ ] time_taken nullable — `[ ]` PASS / `[ ]` FAIL
- [ ] bulk submit via API — `[ ]` PASS / `[ ]` FAIL
- [ ] marks cannot exceed question max — `[ ]` PASS / `[ ]` FAIL

---

### B4.2 — QuestionStats Computation Tests
**File to create:** `examinations/tests/test_question_stats.py`

```python
import pytest
from decimal import Decimal

@pytest.mark.django_db
class TestQuestionStats:

    def test_question_stats_created_for_question(self, question):
        from examinations.models import QuestionStats
        stats, created = QuestionStats.objects.get_or_create(question=question)
        assert stats is not None

    def test_recompute_updates_attempt_count(self, question, student_responses_x3):
        from examinations.tasks import recompute_question_stats
        from examinations.models import QuestionStats
        recompute_question_stats(question.id)
        stats = QuestionStats.objects.get(question=question)
        assert stats.attempt_count == 3

    def test_recompute_updates_correct_count(self, question, student_responses_mixed):
        # 2 correct, 1 incorrect
        from examinations.tasks import recompute_question_stats
        from examinations.models import QuestionStats
        recompute_question_stats(question.id)
        stats = QuestionStats.objects.get(question=question)
        assert stats.correct_count == 2

    def test_real_difficulty_computed_from_responses(self, question, student_responses_mixed):
        from examinations.tasks import recompute_question_stats
        from examinations.models import QuestionStats
        recompute_question_stats(question.id)
        stats = QuestionStats.objects.get(question=question)
        assert stats.real_difficulty is not None
        assert 0.0 <= stats.real_difficulty <= 1.0  # normalized score

    def test_real_difficulty_in_question_serializer(self, auth_client, question_with_stats):
        response = auth_client.get(f'/api/examinations/questions/{question_with_stats.id}/')
        assert 'real_difficulty' in response.data or 'stats' in response.data

    def test_recompute_task_called_after_bulk_response_submit(self, auth_client, student, exam_paper_with_questions):
        from unittest.mock import patch
        with patch('examinations.views.recompute_question_stats.delay') as mock_task:
            questions = exam_paper_with_questions.questions.all()
            payload = [
                {'student': student.id, 'question': q.id,
                 'exam_paper': exam_paper_with_questions.id, 'marks_awarded': 1}
                for q in questions[:2]
            ]
            auth_client.post('/api/examinations/student-responses/', payload, format='json')
            assert mock_task.called
```

**Run:** `pytest examinations/tests/test_question_stats.py -v`
**Expected:** 6/6 pass

**Results:**
- [ ] stats object created for question — `[ ]` PASS / `[ ]` FAIL
- [ ] recompute updates attempt count — `[ ]` PASS / `[ ]` FAIL
- [ ] recompute updates correct count — `[ ]` PASS / `[ ]` FAIL
- [ ] real_difficulty computed correctly — `[ ]` PASS / `[ ]` FAIL
- [ ] real_difficulty in serializer — `[ ]` PASS / `[ ]` FAIL
- [ ] recompute task called after submission — `[ ]` PASS / `[ ]` FAIL

---

### B4.3 — Question Reuse Tracking Tests
**File to create:** `examinations/tests/test_question_reuse.py`

```python
import pytest

@pytest.mark.django_db
class TestQuestionReuseTracking:

    def test_paper_use_count_defaults_to_zero(self, question):
        assert question.paper_use_count == 0

    def test_attaching_question_to_paper_increments_count(self, question, exam_paper):
        from examinations.models import PaperQuestion
        PaperQuestion.objects.create(
            exam_paper=exam_paper, question=question, question_order=1
        )
        question.refresh_from_db()
        assert question.paper_use_count == 1

    def test_attaching_to_multiple_papers_increments_correctly(self, question, exam_papers_x3):
        from examinations.models import PaperQuestion
        for i, paper in enumerate(exam_papers_x3):
            PaperQuestion.objects.create(
                exam_paper=paper, question=question, question_order=1
            )
        question.refresh_from_db()
        assert question.paper_use_count == 3

    def test_last_used_in_updated_on_attach(self, question, exam_paper):
        from examinations.models import PaperQuestion
        PaperQuestion.objects.create(
            exam_paper=exam_paper, question=question, question_order=1
        )
        question.refresh_from_db()
        assert question.last_used_in == exam_paper

    def test_last_used_at_updated_on_attach(self, question, exam_paper):
        from examinations.models import PaperQuestion
        from django.utils import timezone
        before = timezone.now()
        PaperQuestion.objects.create(
            exam_paper=exam_paper, question=question, question_order=1
        )
        question.refresh_from_db()
        assert question.last_used_at is not None
        assert question.last_used_at >= before

    def test_overused_questions_in_paper_api_response(self, auth_client, exam_paper_with_overused_questions):
        response = auth_client.get(
            f'/api/examinations/exam-papers/{exam_paper_with_overused_questions.id}/'
        )
        assert response.status_code == 200
        assert 'overused_questions' in response.data

    def test_overused_questions_threshold_is_3(self, auth_client, exam_paper_with_overused_questions, overused_question):
        response = auth_client.get(
            f'/api/examinations/exam-papers/{exam_paper_with_overused_questions.id}/'
        )
        overused_ids = [q['question_id'] for q in response.data['overused_questions']]
        assert overused_question.id in overused_ids

    def test_question_list_supports_ordering_by_use_count(self, auth_client):
        response = auth_client.get('/api/examinations/questions/?ordering=paper_use_count')
        assert response.status_code == 200
```

**Run:** `pytest examinations/tests/test_question_reuse.py -v`
**Expected:** 8/8 pass

**Results:**
- [ ] paper_use_count defaults to zero — `[ ]` PASS / `[ ]` FAIL
- [ ] attaching to paper increments count — `[ ]` PASS / `[ ]` FAIL
- [ ] multiple papers increments correctly — `[ ]` PASS / `[ ]` FAIL
- [ ] last_used_in updated on attach — `[ ]` PASS / `[ ]` FAIL
- [ ] last_used_at updated on attach — `[ ]` PASS / `[ ]` FAIL
- [ ] overused_questions in paper API response — `[ ]` PASS / `[ ]` FAIL
- [ ] threshold is 3 — `[ ]` PASS / `[ ]` FAIL
- [ ] ordering by use count works — `[ ]` PASS / `[ ]` FAIL

---

## FRONTEND TESTS — Phase 4

### F4.1 — Real Difficulty Badge Tests
**File to create:** `src/pages/examinations/__tests__/RealDifficulty.test.jsx`

```jsx
describe('Real Difficulty Badge on Question Cards', () => {
  test('real difficulty badge shown when stats exist', () => {
    // render question card with stats: { real_difficulty: 0.6 }
    // assert "Real: Medium" badge visible
  })

  test('no real difficulty badge when stats not computed', () => {
    // render question card with stats: null
    // assert no real difficulty badge in DOM
  })

  test('real difficulty badge shows correct label for score ranges', () => {
    // 0.0-0.33 → Easy, 0.34-0.66 → Medium, 0.67-1.0 → Hard
    const cases = [
      { score: 0.2, expected: 'Easy' },
      { score: 0.5, expected: 'Medium' },
      { score: 0.8, expected: 'Hard' },
    ]
    // render each and assert label
  })

  test('mismatch warning icon when real differs from stated', () => {
    // stated: easy, real_difficulty: 0.8 (Hard)
    // assert warning icon visible
    // assert tooltip or title explains mismatch
  })

  test('no mismatch icon when real matches stated difficulty', () => {
    // stated: medium, real_difficulty: 0.5 (Medium)
    // assert no warning icon
  })

  test('tooltip on real difficulty badge shows attempt count', () => {
    // render card with stats: { real_difficulty: 0.4, attempt_count: 47 }
    // hover over badge
    // assert tooltip text contains "47"
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/RealDifficulty.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] real difficulty badge shown — `[ ]` PASS / `[ ]` FAIL
- [ ] no badge when stats null — `[ ]` PASS / `[ ]` FAIL
- [ ] correct label per score range — `[ ]` PASS / `[ ]` FAIL
- [ ] mismatch warning icon shown — `[ ]` PASS / `[ ]` FAIL
- [ ] no mismatch when scores align — `[ ]` PASS / `[ ]` FAIL
- [ ] tooltip shows attempt count — `[ ]` PASS / `[ ]` FAIL

---

### F4.2 — Question Reuse Warning Tests (Paper Builder)
**File to create:** `src/pages/examinations/__tests__/ReuseWarning.test.jsx`

```jsx
describe('Question Reuse Warnings in Paper Builder', () => {
  test('warning chip shows in picker for questions used 3+ times', async () => {
    // mock question list with paper_use_count: 4
    // open question bank picker in paper builder
    // assert "Used in 4 papers" chip visible on that question
  })

  test('no warning chip for questions used fewer than 3 times', async () => {
    // mock question with paper_use_count: 2
    // assert no warning chip
  })

  test('overused badge on paper question list', async () => {
    // mock exam paper response with overused_questions: [{ question_id: 5, paper_use_count: 4 }]
    // render paper question list
    // assert amber warning badge on question 5
  })

  test('warning is informational and does not block adding question', async () => {
    // click add on overused question
    // assert question added to paper successfully
    // assert warning badge still shows (not removed on add)
  })

  test('use count displayed accurately in warning', async () => {
    // paper_use_count: 7
    // assert chip says "Used in 7 papers"
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/ReuseWarning.test.jsx`
**Expected:** 5/5 pass

**Results:**
- [ ] warning chip for 3+ uses — `[ ]` PASS / `[ ]` FAIL
- [ ] no chip for fewer than 3 — `[ ]` PASS / `[ ]` FAIL
- [ ] overused badge on paper list — `[ ]` PASS / `[ ]` FAIL
- [ ] warning does not block adding — `[ ]` PASS / `[ ]` FAIL
- [ ] count displayed accurately — `[ ]` PASS / `[ ]` FAIL

---

### F4.3 — Student Response Entry UI Tests
**File to create:** `src/pages/examinations/__tests__/StudentResponseUI.test.jsx`

```jsx
describe('Student Response Entry UI', () => {
  test('exam paper selector loads available papers', async () => {
    // render student response page or modal
    // assert paper select dropdown populated
  })

  test('selecting paper loads question list', async () => {
    // select exam paper
    // assert questions for that paper listed
  })

  test('MCQ question shows option buttons not free text', async () => {
    // render MCQ question in response form
    // assert option A B C D buttons or selects present
    // assert no freeform textarea
  })

  test('subjective question shows marks input', async () => {
    // render short answer question in response form
    // assert marks input field present with max value = question.marks
  })

  test('marks input validation prevents exceeding max marks', async () => {
    // question.marks = 5
    // type 10 in marks input
    // assert validation error shown
    // assert submit blocked
  })

  test('progress indicator updates as responses entered', async () => {
    // enter response for 1 of 3 students
    // assert indicator shows "1 of 3 students entered"
  })

  test('bulk submit calls correct API endpoint', async () => {
    // fill responses for all questions
    // click submit
    // assert POST to /api/examinations/student-responses/ called
    // assert payload is array of response objects
  })

  test('success confirmation shown after submission', async () => {
    // submit responses
    // assert success message or toast
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/StudentResponseUI.test.jsx`
**Expected:** 8/8 pass

**Results:**
- [ ] paper selector loads papers — `[ ]` PASS / `[ ]` FAIL
- [ ] selecting paper loads questions — `[ ]` PASS / `[ ]` FAIL
- [ ] MCQ shows option buttons — `[ ]` PASS / `[ ]` FAIL
- [ ] subjective shows marks input — `[ ]` PASS / `[ ]` FAIL
- [ ] marks validation prevents exceeding max — `[ ]` PASS / `[ ]` FAIL
- [ ] progress indicator updates — `[ ]` PASS / `[ ]` FAIL
- [ ] bulk submit calls correct API — `[ ]` PASS / `[ ]` FAIL
- [ ] success confirmation shown — `[ ]` PASS / `[ ]` FAIL

---

## Phase 4 Test Summary

| Suite | Total | Passed | Failed |
|---|---|---|---|
| B4.1 StudentResponse | 6 | | |
| B4.2 QuestionStats | 6 | | |
| B4.3 Reuse Tracking | 8 | | |
| F4.1 Real Difficulty Badge | 6 | | |
| F4.2 Reuse Warning UI | 5 | | |
| F4.3 Student Response UI | 8 | | |
| **TOTAL** | **39** | | |

---

## COMPLETE SYSTEM TEST SUMMARY
> Agent fills this in after all 4 phases are tested.

| Phase | Total Tests | Passed | Failed | Status |
|---|---|---|---|---|
| Phase 1 — ContentBlock, Bloom, AI Fields | 54 | | | |
| Phase 2 — Embeddings, Search, Tags, AIJob | 47 | | | |
| Phase 3 — Objectives, SLO, Revisions | 49 | | | |
| Phase 4 — Responses, Stats, Reuse | 39 | | | |
| **GRAND TOTAL** | **189** | | | |

**System is ready for bug-fix pass when:** Grand Total shows 189/189 passing.

**If failures exist:** Create a file `BUG_REPORT.md` listing each failed test, the error message, and which backend task or frontend task it corresponds to. This becomes the input for the next agent session focused on fixes.

---

## BLOCKERS
- None logged yet.
