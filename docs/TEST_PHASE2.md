# Test Phase 2 — Embeddings, Semantic Search, Tags, AI Job Audit
> Run this only after TEST_PHASE1.md reports all 54 tests passing.
> Covers Backend Phase 2 and Frontend Phase 2.
> Backend: pytest-django | Frontend: Jest + React Testing Library

---

## Instructions for Agent
1. Confirm TEST_PHASE1.md summary shows 54/54 passing before starting
2. Write and run all tests below in sequence
3. Mark each test `[PASS]` or `[FAIL]` with failure reason
4. Do NOT fix bugs — log and continue
5. Fill in summary table at the bottom

---

## BACKEND TESTS — Phase 2

### B2.1 — pgvector and Embedding Field Tests
**File to create:** `lms/tests/test_embeddings.py`

```python
import pytest
from django.db import connection
from lms.models import ContentBlock, Topic
from examinations.models import Question

@pytest.mark.django_db
class TestEmbeddingFields:

    def test_pgvector_extension_is_enabled(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT extname FROM pg_extension WHERE extname = 'vector';")
            result = cursor.fetchone()
        assert result is not None, "pgvector extension not installed"

    def test_content_block_has_embedding_field(self):
        block = ContentBlock()
        assert hasattr(block, 'embedding')

    def test_question_has_embedding_field(self):
        question = Question()
        assert hasattr(question, 'embedding')

    def test_topic_has_embedding_field(self):
        topic = Topic()
        assert hasattr(topic, 'embedding')

    def test_embedding_is_nullable_by_default(self, topic):
        block = ContentBlock.objects.create(
            topic=topic, block_type='text',
            content_text='Test block', sequence_order=1
        )
        assert block.embedding is None

    def test_embedding_can_store_vector(self, topic):
        block = ContentBlock.objects.create(
            topic=topic, block_type='text',
            content_text='Test block', sequence_order=1
        )
        fake_embedding = [0.1] * 1536
        block.embedding = fake_embedding
        block.save()
        block.refresh_from_db()
        assert len(block.embedding) == 1536
```

**Run:** `pytest lms/tests/test_embeddings.py -v`
**Expected:** 6/6 pass

**Results:**
- [ ] pgvector extension enabled — `[ ]` PASS / `[ ]` FAIL
- [ ] content_block has embedding — `[ ]` PASS / `[ ]` FAIL
- [ ] question has embedding — `[ ]` PASS / `[ ]` FAIL
- [ ] topic has embedding — `[ ]` PASS / `[ ]` FAIL
- [ ] embedding nullable by default — `[ ]` PASS / `[ ]` FAIL
- [ ] embedding stores 1536-dim vector — `[ ]` PASS / `[ ]` FAIL

---

### B2.2 — Celery Embedding Task Tests
**File to create:** `lms/tests/test_embedding_tasks.py`

```python
import pytest
from unittest.mock import patch, MagicMock
from lms.tasks import embed_content_block, embed_all_content_blocks
from examinations.tasks import embed_question
from lms.models import ContentBlock

@pytest.mark.django_db
class TestEmbeddingTasks:

    @patch('lms.tasks.call_embedding_api')  # patch your actual embedding API call
    def test_embed_content_block_stores_vector(self, mock_embed, topic):
        mock_embed.return_value = [0.1] * 1536
        block = ContentBlock.objects.create(
            topic=topic, block_type='text',
            content_text='Photosynthesis process', sequence_order=1
        )
        embed_content_block(block.id)
        block.refresh_from_db()
        assert block.embedding is not None
        assert len(block.embedding) == 1536

    @patch('lms.tasks.call_embedding_api')
    def test_embed_all_content_blocks_skips_already_embedded(self, mock_embed, topic):
        fake_vec = [0.1] * 1536
        block_with = ContentBlock.objects.create(
            topic=topic, block_type='text', content_text='Has embedding',
            sequence_order=1, embedding=fake_vec
        )
        block_without = ContentBlock.objects.create(
            topic=topic, block_type='text', content_text='No embedding',
            sequence_order=2
        )
        mock_embed.return_value = fake_vec
        embed_all_content_blocks()
        assert mock_embed.call_count == 1  # only called for block_without

    def test_saving_content_block_queues_embedding_task(self, topic):
        with patch('lms.signals.embed_content_block.delay') as mock_task:
            ContentBlock.objects.create(
                topic=topic, block_type='text',
                content_text='New block triggers signal', sequence_order=1
            )
            mock_task.assert_called_once()

    @patch('examinations.tasks.call_embedding_api')
    def test_embed_question_stores_vector(self, mock_embed, question):
        mock_embed.return_value = [0.2] * 1536
        embed_question(question.id)
        question.refresh_from_db()
        assert question.embedding is not None
```

**Run:** `pytest lms/tests/test_embedding_tasks.py -v`
**Expected:** 4/4 pass

**Results:**
- [ ] embed_content_block stores vector — `[ ]` PASS / `[ ]` FAIL
- [ ] embed_all skips already embedded — `[ ]` PASS / `[ ]` FAIL
- [ ] saving block queues task via signal — `[ ]` PASS / `[ ]` FAIL
- [ ] embed_question stores vector — `[ ]` PASS / `[ ]` FAIL

---

### B2.3 — Semantic Search API Tests
**File to create:** `lms/tests/test_semantic_search.py`

```python
import pytest
from unittest.mock import patch

@pytest.mark.django_db
class TestSemanticSearchAPI:

    @patch('lms.views.call_embedding_api')
    def test_semantic_search_returns_results(self, mock_embed, auth_client, content_blocks_with_embeddings):
        mock_embed.return_value = [0.1] * 1536
        response = auth_client.get('/api/lms/content-blocks/semantic_search/?q=photosynthesis&limit=5')
        assert response.status_code == 200
        assert 'results' in response.data

    @patch('lms.views.call_embedding_api')
    def test_semantic_search_results_include_similarity_score(self, mock_embed, auth_client, content_blocks_with_embeddings):
        mock_embed.return_value = [0.1] * 1536
        response = auth_client.get('/api/lms/content-blocks/semantic_search/?q=osmosis')
        assert response.status_code == 200
        if response.data['results']:
            assert 'similarity_score' in response.data['results'][0]

    @patch('lms.views.call_embedding_api')
    def test_semantic_search_includes_breadcrumb_context(self, mock_embed, auth_client, content_blocks_with_embeddings):
        mock_embed.return_value = [0.1] * 1536
        response = auth_client.get('/api/lms/content-blocks/semantic_search/?q=cell')
        if response.data['results']:
            result = response.data['results'][0]
            assert 'chapter_title' in result
            assert 'topic_title' in result

    def test_semantic_search_returns_empty_gracefully_with_no_embeddings(self, auth_client, topic):
        # No embeddings set on any blocks
        response = auth_client.get('/api/lms/content-blocks/semantic_search/?q=anything')
        assert response.status_code == 200
        assert response.data['results'] == []

    @patch('examinations.views.call_embedding_api')
    def test_question_semantic_search_endpoint_exists(self, mock_embed, auth_client):
        mock_embed.return_value = [0.1] * 1536
        response = auth_client.get('/api/examinations/questions/semantic_search/?q=newton')
        assert response.status_code in [200, 404]  # 404 acceptable if no data; 500 is failure
```

**Run:** `pytest lms/tests/test_semantic_search.py -v`
**Expected:** 5/5 pass

**Results:**
- [ ] semantic search returns results — `[ ]` PASS / `[ ]` FAIL
- [ ] results include similarity_score — `[ ]` PASS / `[ ]` FAIL
- [ ] results include breadcrumb context — `[ ]` PASS / `[ ]` FAIL
- [ ] empty graceful with no embeddings — `[ ]` PASS / `[ ]` FAIL
- [ ] question semantic search endpoint exists — `[ ]` PASS / `[ ]` FAIL

---

### B2.4 — Tag Model and API Tests
**File to create:** `lms/tests/test_tags.py`

```python
import pytest

@pytest.mark.django_db
class TestTagModels:

    def test_create_global_tag(self):
        from lms.models import Tag
        tag = Tag.objects.create(name='Newton Laws', tag_type='concept')
        assert tag.id is not None
        assert tag.school is None  # global tag

    def test_create_school_scoped_tag(self, school):
        from lms.models import Tag
        tag = Tag.objects.create(name='School Concept', tag_type='concept', school=school)
        assert tag.school == school

    def test_add_tag_to_content_block(self, content_block, tag):
        from lms.models import ContentBlockTag
        cbt = ContentBlockTag.objects.create(content_block=content_block, tag=tag)
        assert cbt.id is not None

    def test_content_block_tag_unique_constraint(self, content_block, tag):
        from lms.models import ContentBlockTag
        from django.db import IntegrityError
        ContentBlockTag.objects.create(content_block=content_block, tag=tag)
        with pytest.raises(IntegrityError):
            ContentBlockTag.objects.create(content_block=content_block, tag=tag)

    def test_add_tag_to_question(self, question, tag):
        from lms.models import QuestionTag
        qt = QuestionTag.objects.create(question=question, tag=tag)
        assert qt.id is not None

    def test_tag_api_list(self, auth_client):
        response = auth_client.get('/api/lms/tags/')
        assert response.status_code == 200

    def test_add_tag_to_content_block_via_api(self, auth_client, content_block, tag):
        response = auth_client.post(
            f'/api/lms/content-blocks/{content_block.id}/add_tag/',
            {'tag_id': tag.id}, format='json'
        )
        assert response.status_code in [200, 201]

    def test_filter_questions_by_tag(self, auth_client, question, tag):
        from lms.models import QuestionTag
        QuestionTag.objects.create(question=question, tag=tag)
        response = auth_client.get(f'/api/examinations/questions/?tag_id={tag.id}')
        assert response.status_code == 200
        ids = [q['id'] for q in response.data.get('results', [])]
        assert question.id in ids
```

**Run:** `pytest lms/tests/test_tags.py -v`
**Expected:** 8/8 pass

**Results:**
- [ ] create global tag — `[ ]` PASS / `[ ]` FAIL
- [ ] create school-scoped tag — `[ ]` PASS / `[ ]` FAIL
- [ ] add tag to content block — `[ ]` PASS / `[ ]` FAIL
- [ ] unique constraint on content block tag — `[ ]` PASS / `[ ]` FAIL
- [ ] add tag to question — `[ ]` PASS / `[ ]` FAIL
- [ ] tag API list — `[ ]` PASS / `[ ]` FAIL
- [ ] add tag via API — `[ ]` PASS / `[ ]` FAIL
- [ ] filter questions by tag — `[ ]` PASS / `[ ]` FAIL

---

### B2.5 — AI Job Audit Trail Tests
**File to create:** `lms/tests/test_ai_job.py`

```python
import pytest
from django.utils import timezone

@pytest.mark.django_db
class TestAIJobModel:

    def test_create_ai_job(self, school, user):
        from lms.models import AIJob  # or core.models depending on placement
        job = AIJob.objects.create(
            job_type='generate_questions',
            triggered_by=user,
            school=school,
            input_data={'topic_id': 1},
            model_used='llama-3.1-70b',
            status='pending'
        )
        assert job.id is not None
        assert job.status == 'pending'
        assert job.accepted is None

    def test_ai_job_updated_on_lesson_plan_generation(self, auth_client, lesson_plan_payload):
        response = auth_client.post('/api/lms/generate-lesson-plan/', lesson_plan_payload, format='json')
        assert response.status_code in [200, 201]
        from lms.models import AIJob
        job = AIJob.objects.filter(job_type='generate_lesson').last()
        assert job is not None
        assert job.status in ['success', 'failed']

    def test_ai_job_updated_on_question_generation(self, auth_client, lesson_plan):
        response = auth_client.post(
            '/api/examinations/questions/generate_from_lesson/',
            {'lesson_plan_id': lesson_plan.id}, format='json'
        )
        assert response.status_code in [200, 201]
        from lms.models import AIJob
        job = AIJob.objects.filter(job_type='generate_questions').last()
        assert job is not None

    def test_accepted_field_can_be_updated(self, ai_job):
        ai_job.accepted = True
        ai_job.save()
        ai_job.refresh_from_db()
        assert ai_job.accepted is True

    def test_ai_job_admin_filterable(self):
        # Just verify the model fields exist for admin filtering
        from lms.models import AIJob
        assert hasattr(AIJob, 'job_type')
        assert hasattr(AIJob, 'status')
        assert hasattr(AIJob, 'school')
```

**Run:** `pytest lms/tests/test_ai_job.py -v`
**Expected:** 5/5 pass

**Results:**
- [ ] create ai job — `[ ]` PASS / `[ ]` FAIL
- [ ] job created on lesson plan generation — `[ ]` PASS / `[ ]` FAIL
- [ ] job created on question generation — `[ ]` PASS / `[ ]` FAIL
- [ ] accepted field updateable — `[ ]` PASS / `[ ]` FAIL
- [ ] admin fields exist — `[ ]` PASS / `[ ]` FAIL

---

## FRONTEND TESTS — Phase 2

### F2.1 — Semantic Search UI Tests
**File to create:** `src/pages/examinations/__tests__/SemanticSearch.test.jsx`

```jsx
describe('Semantic Search UI', () => {
  test('keyword/semantic toggle renders next to search bar', () => {
    // render QuestionsPage
    // assert toggle with 'Keyword' and 'Semantic' options present
  })

  test('switching to semantic mode fires to semantic_search endpoint', async () => {
    // click Semantic toggle
    // type in search bar
    // assert API call goes to /api/examinations/questions/semantic_search/?q=
  })

  test('similarity score bar visible on cards in semantic mode', async () => {
    // mock semantic search response with similarity_score
    // render results
    // assert score bar element present on each card
  })

  test('graceful fallback when no embeddings', async () => {
    // mock semantic search returns empty
    // assert fallback message "Semantic search is still indexing" shown
    // assert keyword search used as fallback
  })

  test('search debounced — API not called on every keystroke', async () => {
    // type 5 chars quickly
    // assert API called only once (after debounce delay)
  })

  test('clearing search resets to full list', async () => {
    // search for something, then clear input
    // assert full question list loaded
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/SemanticSearch.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] toggle renders — `[ ]` PASS / `[ ]` FAIL
- [ ] semantic mode fires correct endpoint — `[ ]` PASS / `[ ]` FAIL
- [ ] similarity score bar visible — `[ ]` PASS / `[ ]` FAIL
- [ ] graceful fallback — `[ ]` PASS / `[ ]` FAIL
- [ ] search is debounced — `[ ]` PASS / `[ ]` FAIL
- [ ] clearing search resets list — `[ ]` PASS / `[ ]` FAIL

---

### F2.2 — Tag UI Tests
**File to create:** `src/pages/examinations/__tests__/TagUI.test.jsx`

```jsx
describe('Tag Chips and Picker UI', () => {
  test('tag chips render on question card when tags exist', () => {
    // render card with tags: [{id:1, name:'Newton', tag_type:'concept'}]
    // assert chip with 'Newton' text visible
  })

  test('overflow shows +N more for more than 3 tags', () => {
    // render card with 5 tags
    // assert 3 chips visible and '+2 more' indicator
  })

  test('tag picker renders in add question modal', async () => {
    // open add question modal
    // assert Tags field present
    // assert searchable multi-select input
  })

  test('tag search fires API with subject filter', async () => {
    // open modal, type in tag search
    // assert GET /api/lms/tags/?subject_id=X called
  })

  test('tag filter in filter bar sends correct query param', async () => {
    // select tag from filter dropdown
    // assert ?tag_id=X in API request
  })

  test('tags update on card after modal save', async () => {
    // open modal, add tag, save
    // assert new tag chip appears on card
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/TagUI.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] tag chips render — `[ ]` PASS / `[ ]` FAIL
- [ ] overflow indicator — `[ ]` PASS / `[ ]` FAIL
- [ ] tag picker in modal — `[ ]` PASS / `[ ]` FAIL
- [ ] tag search fires with subject filter — `[ ]` PASS / `[ ]` FAIL
- [ ] tag filter sends query param — `[ ]` PASS / `[ ]` FAIL
- [ ] tags update after save — `[ ]` PASS / `[ ]` FAIL

---

### F2.3 — AI Job Feedback UI Tests
**File to create:** `src/pages/examinations/__tests__/AIJobFeedback.test.jsx`

```jsx
describe('AI Job Feedback Flow', () => {
  test('review modal appears after generate_from_lesson', async () => {
    // trigger generate questions from lesson
    // assert review modal opens with generated questions listed
  })

  test('accept button saves question and sends accepted: true', async () => {
    // in review modal, click accept on first question
    // assert question saved
    // assert PATCH to ai-jobs with accepted: true
  })

  test('reject button discards question and sends accepted: false', async () => {
    // click reject on question
    // assert question not saved
    // assert PATCH with accepted: false
  })

  test('accept all button accepts every question', async () => {
    // click Accept All
    // assert all questions saved
    // assert AI job updated
  })

  test('accepted questions appear with AI Unverified badge', async () => {
    // accept a generated question
    // find it in question bank
    // assert amber AI badge present
  })

  test('AI job status indicator shows spinner when jobs pending', async () => {
    // mock GET /api/core/ai-jobs/?status=pending returning 1 job
    // assert spinner/indicator visible in header
  })

  test('indicator hidden when no pending jobs', async () => {
    // mock pending jobs endpoint returning empty
    // assert no spinner in header
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/AIJobFeedback.test.jsx`
**Expected:** 7/7 pass

**Results:**
- [ ] review modal appears — `[ ]` PASS / `[ ]` FAIL
- [ ] accept sends accepted: true — `[ ]` PASS / `[ ]` FAIL
- [ ] reject sends accepted: false — `[ ]` PASS / `[ ]` FAIL
- [ ] accept all works — `[ ]` PASS / `[ ]` FAIL
- [ ] accepted questions have AI badge — `[ ]` PASS / `[ ]` FAIL
- [ ] spinner shows when pending — `[ ]` PASS / `[ ]` FAIL
- [ ] indicator hidden when no pending — `[ ]` PASS / `[ ]` FAIL

---

## Phase 2 Test Summary

| Suite | Total | Passed | Failed |
|---|---|---|---|
| B2.1 pgvector + Embeddings | 6 | | |
| B2.2 Celery Embedding Tasks | 4 | | |
| B2.3 Semantic Search API | 5 | | |
| B2.4 Tags | 8 | | |
| B2.5 AI Job Audit | 5 | | |
| F2.1 Semantic Search UI | 6 | | |
| F2.2 Tag UI | 6 | | |
| F2.3 AI Job Feedback UI | 7 | | |
| **TOTAL** | **47** | | |

**Phase 2 Gate:** All 47 tests must pass before running TEST_PHASE3.md.

---

## BLOCKERS
- None logged yet.
