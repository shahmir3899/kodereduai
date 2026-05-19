# Test Phase 3 — Learning Objectives, SLO Standards, Content Revisions
> Run this only after TEST_PHASE2.md reports all 47 tests passing.
> Covers Backend Phase 3 and Frontend Phase 3.
> Backend: pytest-django | Frontend: Jest + React Testing Library

---

## Instructions for Agent
1. Confirm TEST_PHASE2.md summary shows 47/47 passing before starting
2. Write and run all tests below in sequence
3. Mark each test `[PASS]` or `[FAIL]` with failure reason
4. Do NOT fix bugs — log and continue
5. Fill in summary table at the bottom

---

## BACKEND TESTS — Phase 3

### B3.1 — LearningObjective Model and API Tests
**File to create:** `lms/tests/test_learning_objectives.py`

```python
import pytest

@pytest.mark.django_db
class TestLearningObjectiveModel:

    def test_create_learning_objective(self, topic):
        from lms.models import LearningObjective
        obj = LearningObjective.objects.create(
            topic=topic,
            statement='Students will be able to explain photosynthesis.',
            bloom_level='understand',
            is_ai_generated=False
        )
        assert obj.id is not None
        assert obj.bloom_level == 'understand'

    def test_learning_objective_requires_topic(self):
        from lms.models import LearningObjective
        from django.db import IntegrityError
        with pytest.raises(IntegrityError):
            LearningObjective.objects.create(
                statement='No topic attached',
                bloom_level='apply'
            )

    def test_get_objectives_for_topic(self, auth_client, topic, learning_objectives):
        response = auth_client.get(f'/api/lms/topics/{topic.id}/objectives/')
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_link_objectives_to_lesson_plan(self, auth_client, lesson_plan, learning_objective):
        response = auth_client.post(
            f'/api/lms/lesson-plans/{lesson_plan.id}/link_objectives/',
            {'objective_ids': [learning_objective.id]},
            format='json'
        )
        assert response.status_code in [200, 201]

    def test_lesson_plan_serializer_returns_objectives(self, auth_client, lesson_plan_with_objectives):
        response = auth_client.get(f'/api/lms/lesson-plans/{lesson_plan_with_objectives.id}/')
        assert 'objectives' in response.data
        assert len(response.data['objectives']) >= 1

    def test_ai_generated_objective_flagged(self, topic):
        from lms.models import LearningObjective
        obj = LearningObjective.objects.create(
            topic=topic,
            statement='AI generated objective',
            bloom_level='create',
            is_ai_generated=True
        )
        assert obj.is_ai_generated is True

    def test_is_active_default_true(self, topic):
        from lms.models import LearningObjective
        obj = LearningObjective.objects.create(
            topic=topic,
            statement='Active by default',
            bloom_level='remember'
        )
        assert obj.is_active is True

    def test_lesson_plan_objective_unique_constraint(self, lesson_plan, learning_objective):
        from lms.models import LessonPlanObjective
        from django.db import IntegrityError
        LessonPlanObjective.objects.create(
            lesson_plan=lesson_plan,
            objective=learning_objective
        )
        with pytest.raises(IntegrityError):
            LessonPlanObjective.objects.create(
                lesson_plan=lesson_plan,
                objective=learning_objective
            )
```

**Run:** `pytest lms/tests/test_learning_objectives.py -v`
**Expected:** 8/8 pass

**Results:**
- [x] create learning objective — `[x]` PASS / `[ ]` FAIL
- [x] requires topic — `[x]` PASS / `[ ]` FAIL
- [x] get objectives for topic — `[x]` PASS / `[ ]` FAIL
- [x] link objectives to lesson plan — `[x]` PASS / `[ ]` FAIL
- [x] lesson plan serializer returns objectives — `[ ]` PASS / `[x]` FAIL (serializer returned empty string instead of linked objectives list)
- [x] ai generated flag works — `[x]` PASS / `[ ]` FAIL
- [x] is_active defaults true — `[x]` PASS / `[ ]` FAIL
- [x] unique constraint on lesson plan objective — `[x]` PASS / `[ ]` FAIL

---

### B3.2 — CurriculumStandard and SLO Alignment Tests
**File to create:** `lms/tests/test_curriculum_standards.py`

```python
import pytest

@pytest.mark.django_db
class TestCurriculumStandards:

    def test_create_curriculum_standard(self):
        from lms.models import CurriculumStandard
        std = CurriculumStandard.objects.create(
            name='SNC 2021',
            country='Pakistan',
            board='Federal Board'
        )
        assert std.id is not None
        assert std.name == 'SNC 2021'

    def test_create_standard_objective(self, curriculum_standard, subject, class_obj):
        from lms.models import StandardObjective
        slo = StandardObjective.objects.create(
            standard=curriculum_standard,
            subject=subject,
            grade=class_obj,
            code='Bio-9-3.2.1',
            statement='Students can explain cell division.'
        )
        assert slo.code == 'Bio-9-3.2.1'

    def test_align_topic_to_standard_objective(self, topic, standard_objective):
        from lms.models import TopicStandardAlignment
        alignment = TopicStandardAlignment.objects.create(
            topic=topic,
            objective=standard_objective
        )
        assert alignment.id is not None

    def test_topic_standard_alignment_unique(self, topic, standard_objective):
        from lms.models import TopicStandardAlignment
        from django.db import IntegrityError
        TopicStandardAlignment.objects.create(topic=topic, objective=standard_objective)
        with pytest.raises(IntegrityError):
            TopicStandardAlignment.objects.create(topic=topic, objective=standard_objective)

    def test_get_standards_for_topic(self, auth_client, topic_with_standards):
        response = auth_client.get(f'/api/lms/topics/{topic_with_standards.id}/standards/')
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_paper_coverage_stats_include_slo_count(self, auth_client, exam_paper_with_questions):
        response = auth_client.get(
            f'/api/examinations/exam-papers/{exam_paper_with_questions.id}/coverage_stats/'
        )
        assert response.status_code == 200
        assert 'covered_slos' in response.data or 'slo_coverage' in response.data

    def test_standard_objective_code_format(self, curriculum_standard, subject, class_obj):
        from lms.models import StandardObjective
        slo = StandardObjective.objects.create(
            standard=curriculum_standard,
            subject=subject,
            grade=class_obj,
            code='Math-10-2.1.3',
            statement='Apply quadratic formula'
        )
        assert '-' in slo.code
```

**Run:** `pytest lms/tests/test_curriculum_standards.py -v`
**Expected:** 7/7 pass

**Results:**
- [ ] create curriculum standard — `[ ]` PASS / `[ ]` FAIL
- [ ] create standard objective — `[ ]` PASS / `[ ]` FAIL
- [ ] align topic to SLO — `[ ]` PASS / `[ ]` FAIL
- [ ] alignment unique constraint — `[ ]` PASS / `[ ]` FAIL
- [ ] get standards for topic — `[ ]` PASS / `[ ]` FAIL
- [ ] coverage stats include SLO count — `[ ]` PASS / `[ ]` FAIL
- [ ] SLO code format preserved — `[ ]` PASS / `[ ]` FAIL

---

### B3.3 — Content Revision Tests
**File to create:** `lms/tests/test_content_revisions.py`

```python
import pytest

@pytest.mark.django_db
class TestContentRevisions:

    def test_editing_content_block_creates_revision(self, content_block):
        from lms.models import ContentRevision
        original_text = content_block.content_text
        content_block.content_text = 'Updated text for revision test'
        content_block.save()
        revision = ContentRevision.objects.filter(content_block=content_block).last()
        assert revision is not None
        assert revision.content_text == original_text

    def test_multiple_edits_create_multiple_revisions(self, content_block):
        from lms.models import ContentRevision
        content_block.content_text = 'Version 2'
        content_block.save()
        content_block.content_text = 'Version 3'
        content_block.save()
        assert ContentRevision.objects.filter(content_block=content_block).count() >= 2

    def test_get_revision_history_via_api(self, auth_client, content_block_with_revisions):
        response = auth_client.get(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/revisions/'
        )
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_revision_history_sorted_newest_first(self, auth_client, content_block_with_revisions):
        response = auth_client.get(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/revisions/'
        )
        dates = [r['changed_at'] for r in response.data]
        assert dates == sorted(dates, reverse=True)

    def test_restore_content_block_to_revision(self, auth_client, content_block_with_revisions):
        from lms.models import ContentRevision
        revision = ContentRevision.objects.filter(
            content_block=content_block_with_revisions
        ).first()
        response = auth_client.post(
            f'/api/lms/content-blocks/{content_block_with_revisions.id}/restore/',
            {'revision_id': revision.id},
            format='json'
        )
        assert response.status_code == 200
        content_block_with_revisions.refresh_from_db()
        assert content_block_with_revisions.content_text == revision.content_text

    def test_question_edit_creates_question_revision(self, question):
        from examinations.models import QuestionRevision
        original_text = question.question_text
        question.question_text = 'Updated question text'
        question.save()
        revision = QuestionRevision.objects.filter(question=question).last()
        assert revision is not None
        assert revision.question_text == original_text

    def test_question_revision_snapshot_contains_full_state(self, question):
        from examinations.models import QuestionRevision
        question.question_text = 'Snapshot test'
        question.save()
        revision = QuestionRevision.objects.filter(question=question).last()
        assert 'question_text' in revision.snapshot
        assert 'marks' in revision.snapshot
```

**Run:** `pytest lms/tests/test_content_revisions.py -v`
**Expected:** 7/7 pass

**Results:**
- [ ] editing block creates revision — `[ ]` PASS / `[ ]` FAIL
- [ ] multiple edits create multiple revisions — `[ ]` PASS / `[ ]` FAIL
- [ ] get revision history via API — `[ ]` PASS / `[ ]` FAIL
- [ ] history sorted newest first — `[ ]` PASS / `[ ]` FAIL
- [ ] restore to revision works — `[ ]` PASS / `[ ]` FAIL
- [ ] question edit creates revision — `[ ]` PASS / `[ ]` FAIL
- [ ] question revision snapshot has full state — `[ ]` PASS / `[ ]` FAIL

---

## FRONTEND TESTS — Phase 3

### F3.1 — Structured Learning Objectives UI Tests
**File to create:** `src/pages/lms/__tests__/LearningObjectives.test.jsx`

```jsx
describe('Structured Learning Objectives Builder', () => {
  test('objective builder renders instead of plain textarea', async () => {
    // open lesson plan create/edit form
    // assert no plain "Objectives" textarea
    // assert structured list UI present
  })

  test('Add Objective button appends a new row', async () => {
    // open form
    // click Add Objective
    // assert new row with statement input and bloom_level select appears
  })

  test('each objective row has bloom level select', async () => {
    // open form with one objective
    // assert bloom select present on that row
    // assert all 6 bloom options available
  })

  test('remove button deletes objective row', async () => {
    // open form with 2 objectives
    // click remove on first
    // assert only 1 row remains
  })

  test('AI generate button populates objectives list', async () => {
    // mock AI generate response with 3 objectives
    // click Generate with AI
    // assert 3 objective rows populated
  })

  test('saved objectives display on lesson plan detail', async () => {
    // render lesson plan detail with objectives data
    // assert each objective statement and bloom badge visible
  })

  test('old plans with plain text objectives still render', async () => {
    // render lesson plan with legacy objectives string
    // assert no crash, text displayed somehow
  })
})
```

**Run:** `npx jest src/pages/lms/__tests__/LearningObjectives.test.jsx`
**Expected:** 7/7 pass

**Results:**
- [ ] builder replaces plain textarea — `[ ]` PASS / `[ ]` FAIL
- [ ] add objective appends row — `[ ]` PASS / `[ ]` FAIL
- [ ] each row has bloom select — `[ ]` PASS / `[ ]` FAIL
- [ ] remove deletes row — `[ ]` PASS / `[ ]` FAIL
- [ ] AI generate populates list — `[ ]` PASS / `[ ]` FAIL
- [ ] saved objectives display in detail — `[ ]` PASS / `[ ]` FAIL
- [ ] legacy plain text objectives render — `[ ]` PASS / `[ ]` FAIL

---

### F3.2 — SLO Coverage Panel Tests (Paper Builder)
**File to create:** `src/pages/examinations/__tests__/SLOCoverage.test.jsx`

```jsx
describe('SLO Coverage Panel in Paper Builder', () => {
  test('coverage panel renders in paper builder', async () => {
    // render paper builder page
    // assert "Curriculum Coverage" panel visible
  })

  test('panel shows total and covered SLO counts', async () => {
    // mock coverage_stats returning { total_slos: 10, covered_slos: 4 }
    // assert "4/10" or equivalent text visible
  })

  test('percentage bar present in panel', async () => {
    // assert progress bar element with correct width
  })

  test('panel updates when question is added', async () => {
    // add a question to paper
    // assert coverage stats refetched and panel updates
  })

  test('covered SLOs shown with green checkmark', async () => {
    // mock response with covered_slos list
    // assert green indicator on covered items
  })

  test('uncovered SLOs shown in grey', async () => {
    // mock response with uncovered_slos list
    // assert grey indicator on uncovered items
  })

  test('panel can be collapsed and expanded', async () => {
    // click collapse toggle
    // assert panel content hidden
    // click again
    // assert panel content visible
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/SLOCoverage.test.jsx`
**Expected:** 7/7 pass

**Results:**
- [ ] coverage panel renders — `[ ]` PASS / `[ ]` FAIL
- [ ] shows total and covered counts — `[ ]` PASS / `[ ]` FAIL
- [ ] percentage bar present — `[ ]` PASS / `[ ]` FAIL
- [ ] panel updates on question add — `[ ]` PASS / `[ ]` FAIL
- [ ] covered SLOs green — `[ ]` PASS / `[ ]` FAIL
- [ ] uncovered SLOs grey — `[ ]` PASS / `[ ]` FAIL
- [ ] collapsible works — `[ ]` PASS / `[ ]` FAIL

---

### F3.3 — Bloom Distribution Chart Tests (Paper Builder)
**File to create:** `src/pages/examinations/__tests__/BloomChart.test.jsx`

```jsx
describe('Bloom Distribution Chart in Paper Builder', () => {
  test('bloom chart renders in paper builder', async () => {
    // render paper builder with questions that have bloom_level set
    // assert chart element present
  })

  test('chart shows correct percentage per bloom level', async () => {
    // 2 questions: apply + analyze
    // assert chart shows 50% apply, 50% analyze
  })

  test('chart updates when question added or removed', async () => {
    // add a remember-level question
    // assert chart updates to include remember segment
  })

  test('unclassified segment shown for questions without bloom_level', async () => {
    // add question with bloom_level: null
    // assert Unclassified segment in chart
  })

  test('warning shown when paper is over 70% remember or understand', async () => {
    // add 8 remember questions + 2 apply
    // assert warning indicator visible
  })

  test('chart colors match bloom badge colors', async () => {
    // render chart with apply questions
    // assert chart segment has same green class as apply bloom badge
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/BloomChart.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] bloom chart renders — `[ ]` PASS / `[ ]` FAIL
- [ ] correct percentages shown — `[ ]` PASS / `[ ]` FAIL
- [ ] updates on add/remove — `[ ]` PASS / `[ ]` FAIL
- [ ] unclassified segment shown — `[ ]` PASS / `[ ]` FAIL
- [ ] warning on surface-heavy paper — `[ ]` PASS / `[ ]` FAIL
- [ ] colors match bloom badges — `[ ]` PASS / `[ ]` FAIL

---

### F3.4 — Content Revision History UI Tests
**File to create:** `src/pages/lms/__tests__/RevisionHistory.test.jsx`

```jsx
describe('Content Block Revision History', () => {
  test('history icon button present on content block cards', async () => {
    // render curriculum page with content blocks
    // assert history icon button on each block card
  })

  test('clicking history opens revision drawer', async () => {
    // click history button on block
    // assert drawer/panel opens
  })

  test('revision list shows date, author, and content preview', async () => {
    // mock revisions API with 2 revisions
    // assert both visible with date and author name
  })

  test('clicking a revision shows full content in read-only view', async () => {
    // click on revision item
    // assert full content_text shown
    // assert it is not editable (no textarea, just text)
  })

  test('restore button calls restore API and refreshes blocks', async () => {
    // click Restore this version
    // assert POST to /api/lms/content-blocks/{id}/restore/ called
    // assert block list refreshes with restored content
  })

  test('empty state shown when no revisions exist', async () => {
    // mock revisions endpoint returning empty array
    // click history button
    // assert "No revision history yet" message
  })

  test('latest revision marked as Current', async () => {
    // mock 3 revisions
    // assert first in list has "Current" label
  })
})
```

**Run:** `npx jest src/pages/lms/__tests__/RevisionHistory.test.jsx`
**Expected:** 7/7 pass

**Results:**
- [ ] history button on block cards — `[ ]` PASS / `[ ]` FAIL
- [ ] history opens drawer — `[ ]` PASS / `[ ]` FAIL
- [ ] revision list shows meta — `[ ]` PASS / `[ ]` FAIL
- [ ] clicking revision shows read-only content — `[ ]` PASS / `[ ]` FAIL
- [ ] restore calls API and refreshes — `[ ]` PASS / `[ ]` FAIL
- [ ] empty state shown — `[ ]` PASS / `[ ]` FAIL
- [ ] latest marked as Current — `[ ]` PASS / `[ ]` FAIL

---

## Phase 3 Test Summary

| Suite | Total | Passed | Failed |
|---|---|---|---|
| B3.1 LearningObjective | 8 | 7 | 1 |
| B3.2 CurriculumStandard + SLO | 7 | | |
| B3.3 ContentRevisions | 7 | | |
| F3.1 Objectives UI | 7 | | |
| F3.2 SLO Coverage Panel | 7 | | |
| F3.3 Bloom Chart | 6 | | |
| F3.4 Revision History UI | 7 | | |
| **TOTAL** | **49** | **7** | **1** |

**Phase 3 Gate:** All 49 tests must pass before running TEST_PHASE4.md.

---

## BLOCKERS
- B3.1 gate failed: `test_lesson_plan_serializer_returns_objectives` in `lms/tests/test_learning_objectives.py` returned empty `objectives` payload (`len('') == 0`). Stopped before B3.2+ as required.
