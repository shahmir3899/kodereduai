# Test Phase 1 — ContentBlock, Bloom Level, Source Block, AI Fields
> Run this after Backend Phase 1 and Frontend Phase 1 are both complete.
> All tests in this file must pass before moving to TEST_PHASE2.md.
> Backend: pytest-django | Frontend: Jest + React Testing Library

---

## Instructions for Agent
1. Read `UPGRADE_TASKS.md` — confirm all Phase 1 backend tasks are marked `[x] Done`
2. Read `FRONTEND_UPGRADE_TASKS.md` — confirm all Phase 1 frontend tasks are marked `[x] Done`
3. If any task is incomplete or `[!] Blocked`, note it in the BLOCKERS section at the bottom of this file before running tests
4. Write and run all tests below in order
5. Mark each test `[PASS]` or `[FAIL]` with a one-line failure reason if applicable
6. Do NOT fix bugs here — log failures and continue. Bug fixing is a separate session.
7. At the end, write a summary: Total | Passed | Failed | Blocked

---

## BACKEND TESTS — Phase 1

### B1.1 — ContentBlock Model Tests
**File to create:** `lms/tests/test_content_block_model.py`

```python
import pytest
from django.core.exceptions import ValidationError
from lms.models import ContentBlock, Chapter, Topic, SubTopic

@pytest.mark.django_db
class TestContentBlockModel:

    def test_create_content_block_linked_to_chapter(self, chapter):
        block = ContentBlock.objects.create(
            chapter=chapter,
            block_type='text',
            content_text='This is a paragraph.',
            sequence_order=1
        )
        assert block.id is not None
        assert block.block_type == 'text'
        assert block.is_active is True

    def test_create_content_block_linked_to_topic(self, topic):
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='definition',
            content_text='A definition block.',
            sequence_order=1
        )
        assert block.topic == topic
        assert block.chapter is None

    def test_str_representation(self, topic):
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='example',
            content_text='This is a worked example with enough text to test truncation behavior.',
            sequence_order=1
        )
        assert 'example' in str(block)
        assert len(str(block)) <= 80  # block_type + separator + 60 chars

    def test_default_ordering_by_sequence(self, topic):
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Third', sequence_order=3)
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='First', sequence_order=1)
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Second', sequence_order=2)
        blocks = list(ContentBlock.objects.filter(topic=topic))
        assert blocks[0].content_text == 'First'
        assert blocks[1].content_text == 'Second'
        assert blocks[2].content_text == 'Third'

    def test_soft_delete_sets_inactive(self, topic):
        block = ContentBlock.objects.create(
            topic=topic, block_type='text', content_text='To be deleted', sequence_order=1
        )
        block.is_active = False
        block.save()
        assert ContentBlock.objects.filter(id=block.id, is_active=True).count() == 0

    def test_all_block_types_are_valid(self, topic):
        valid_types = ['text', 'definition', 'example', 'exercise',
                       'formula', 'diagram_desc', 'summary', 'key_point']
        for bt in valid_types:
            block = ContentBlock.objects.create(
                topic=topic, block_type=bt,
                content_text=f'Block of type {bt}', sequence_order=1
            )
            assert block.block_type == bt

    def test_content_rich_accepts_json(self, topic):
        rich = {'format': 'table', 'rows': [['a', 'b'], ['c', 'd']]}
        block = ContentBlock.objects.create(
            topic=topic, block_type='text',
            content_text='Table block', content_rich=rich, sequence_order=1
        )
        assert block.content_rich['format'] == 'table'
```

**Run:** `pytest lms/tests/test_content_block_model.py -v`
**Expected:** 7/7 pass

**Results:**
- [ ] test_create_content_block_linked_to_chapter — `[ ]` PASS / `[ ]` FAIL
- [ ] test_create_content_block_linked_to_topic — `[ ]` PASS / `[ ]` FAIL
- [ ] test_str_representation — `[ ]` PASS / `[ ]` FAIL
- [ ] test_default_ordering_by_sequence — `[ ]` PASS / `[ ]` FAIL
- [ ] test_soft_delete_sets_inactive — `[ ]` PASS / `[ ]` FAIL
- [ ] test_all_block_types_are_valid — `[ ]` PASS / `[ ]` FAIL
- [ ] test_content_rich_accepts_json — `[ ]` PASS / `[ ]` FAIL

---

### B1.2 — ContentBlock API Tests
**File to create:** `lms/tests/test_content_block_api.py`

```python
import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from lms.models import ContentBlock

@pytest.mark.django_db
class TestContentBlockAPI:

    def test_list_blocks_by_topic(self, auth_client, topic):
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Block A', sequence_order=1)
        ContentBlock.objects.create(topic=topic, block_type='definition', content_text='Block B', sequence_order=2)
        response = auth_client.get(f'/api/lms/content-blocks/?topic_id={topic.id}')
        assert response.status_code == 200
        assert len(response.data['results']) == 2

    def test_list_blocks_returns_correct_order(self, auth_client, topic):
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Second', sequence_order=2)
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='First', sequence_order=1)
        response = auth_client.get(f'/api/lms/content-blocks/?topic_id={topic.id}')
        assert response.data['results'][0]['content_text'] == 'First'

    def test_create_content_block(self, auth_client, topic):
        payload = {
            'topic': topic.id,
            'block_type': 'definition',
            'content_text': 'Photosynthesis is the process...',
            'sequence_order': 1
        }
        response = auth_client.post('/api/lms/content-blocks/', payload, format='json')
        assert response.status_code == 201
        assert response.data['block_type'] == 'definition'

    def test_update_content_block(self, auth_client, topic):
        block = ContentBlock.objects.create(
            topic=topic, block_type='text', content_text='Old text', sequence_order=1
        )
        response = auth_client.patch(
            f'/api/lms/content-blocks/{block.id}/',
            {'content_text': 'Updated text'}, format='json'
        )
        assert response.status_code == 200
        assert response.data['content_text'] == 'Updated text'

    def test_delete_soft_deletes_block(self, auth_client, topic):
        block = ContentBlock.objects.create(
            topic=topic, block_type='text', content_text='To delete', sequence_order=1
        )
        response = auth_client.delete(f'/api/lms/content-blocks/{block.id}/')
        assert response.status_code in [200, 204]
        block.refresh_from_db()
        assert block.is_active is False

    def test_list_excludes_inactive_blocks(self, auth_client, topic):
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Active', sequence_order=1, is_active=True)
        ContentBlock.objects.create(topic=topic, block_type='text', content_text='Inactive', sequence_order=2, is_active=False)
        response = auth_client.get(f'/api/lms/content-blocks/?topic_id={topic.id}')
        assert len(response.data['results']) == 1

    def test_tenant_isolation(self, auth_client_school_b, topic_school_a):
        # Client from school B cannot see school A's blocks
        ContentBlock.objects.create(topic=topic_school_a, block_type='text', content_text='School A block', sequence_order=1)
        response = auth_client_school_b.get(f'/api/lms/content-blocks/?topic_id={topic_school_a.id}')
        assert len(response.data.get('results', [])) == 0

    def test_unauthenticated_request_rejected(self, topic):
        client = APIClient()
        response = client.get(f'/api/lms/content-blocks/?topic_id={topic.id}')
        assert response.status_code == 401
```

**Run:** `pytest lms/tests/test_content_block_api.py -v`
**Expected:** 8/8 pass

**Results:**
- [ ] test_list_blocks_by_topic — `[ ]` PASS / `[ ]` FAIL
- [ ] test_list_blocks_returns_correct_order — `[ ]` PASS / `[ ]` FAIL
- [ ] test_create_content_block — `[ ]` PASS / `[ ]` FAIL
- [ ] test_update_content_block — `[ ]` PASS / `[ ]` FAIL
- [ ] test_delete_soft_deletes_block — `[ ]` PASS / `[ ]` FAIL
- [ ] test_list_excludes_inactive_blocks — `[ ]` PASS / `[ ]` FAIL
- [ ] test_tenant_isolation — `[ ]` PASS / `[ ]` FAIL
- [ ] test_unauthenticated_request_rejected — `[ ]` PASS / `[ ]` FAIL

---

### B1.3 — Bloom Level Tests
**File to create:** `examinations/tests/test_bloom_level.py`

```python
import pytest

@pytest.mark.django_db
class TestBloomLevel:

    def test_bloom_level_field_exists_on_question(self, question):
        assert hasattr(question, 'bloom_level')

    def test_bloom_level_accepts_valid_values(self, question):
        valid = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']
        for level in valid:
            question.bloom_level = level
            question.save()
            question.refresh_from_db()
            assert question.bloom_level == level

    def test_bloom_level_nullable(self, question):
        question.bloom_level = None
        question.save()
        question.refresh_from_db()
        assert question.bloom_level is None

    def test_filter_questions_by_bloom_level(self, auth_client, subject, class_obj):
        # Setup questions with different bloom levels via API or factory
        response = auth_client.get(
            f'/api/examinations/questions/?bloom_level=apply&subject={subject.id}'
        )
        assert response.status_code == 200
        for q in response.data.get('results', []):
            assert q['bloom_level'] == 'apply'

    def test_bloom_level_in_question_serializer(self, auth_client, question):
        response = auth_client.get(f'/api/examinations/questions/{question.id}/')
        assert 'bloom_level' in response.data
```

**Run:** `pytest examinations/tests/test_bloom_level.py -v`
**Expected:** 5/5 pass

**Results:**
- [ ] test_bloom_level_field_exists — `[ ]` PASS / `[ ]` FAIL
- [ ] test_bloom_level_valid_values — `[ ]` PASS / `[ ]` FAIL
- [ ] test_bloom_level_nullable — `[ ]` PASS / `[ ]` FAIL
- [ ] test_filter_by_bloom_level — `[ ]` PASS / `[ ]` FAIL
- [ ] test_bloom_level_in_serializer — `[ ]` PASS / `[ ]` FAIL

---

### B1.4 — Source Content Block and AI Fields Tests
**File to create:** `examinations/tests/test_question_ai_fields.py`

```python
import pytest
from django.utils import timezone

@pytest.mark.django_db
class TestQuestionAIFields:

    def test_source_content_block_field_exists(self, question):
        assert hasattr(question, 'source_content_block')

    def test_source_content_block_nullable(self, question):
        assert question.source_content_block is None

    def test_link_question_to_content_block(self, question, content_block):
        question.source_content_block = content_block
        question.save()
        question.refresh_from_db()
        assert question.source_content_block == content_block

    def test_is_ai_generated_defaults_false(self, question):
        assert question.is_ai_generated is False

    def test_verified_by_nullable(self, question):
        assert question.verified_by is None
        assert question.verified_at is None

    def test_verify_question_via_api(self, auth_client, ai_question, user):
        response = auth_client.patch(
            f'/api/examinations/questions/{ai_question.id}/',
            {'verified_by': user.id, 'verified_at': timezone.now().isoformat()},
            format='json'
        )
        assert response.status_code == 200
        ai_question.refresh_from_db()
        assert ai_question.verified_by is not None

    def test_source_content_block_in_serializer(self, auth_client, question):
        response = auth_client.get(f'/api/examinations/questions/{question.id}/')
        assert 'source_content_block' in response.data
        assert 'is_ai_generated' in response.data
```

**Run:** `pytest examinations/tests/test_question_ai_fields.py -v`
**Expected:** 7/7 pass

**Results:**
- [ ] test_source_content_block_field_exists — `[ ]` PASS / `[ ]` FAIL
- [ ] test_source_content_block_nullable — `[ ]` PASS / `[ ]` FAIL
- [ ] test_link_question_to_content_block — `[ ]` PASS / `[ ]` FAIL
- [ ] test_is_ai_generated_defaults_false — `[ ]` PASS / `[ ]` FAIL
- [ ] test_verified_by_nullable — `[ ]` PASS / `[ ]` FAIL
- [ ] test_verify_question_via_api — `[ ]` PASS / `[ ]` FAIL
- [ ] test_source_content_block_in_serializer — `[ ]` PASS / `[ ]` FAIL

---

### B1.5 — Migration Script Test
**File to create:** `lms/tests/test_migrate_content_blocks.py`

```python
import pytest
from django.core.management import call_command
from io import StringIO
from lms.models import ContentBlock, Chapter

@pytest.mark.django_db
class TestMigrateContentBlocksCommand:

    def test_dry_run_produces_no_records(self, chapter_with_json_content):
        initial_count = ContentBlock.objects.count()
        out = StringIO()
        call_command('migrate_content_blocks', '--dry-run', stdout=out)
        assert ContentBlock.objects.count() == initial_count
        assert 'Created:' in out.getvalue()

    def test_command_creates_blocks_from_chapter_json(self, chapter_with_json_content):
        call_command('migrate_content_blocks')
        blocks = ContentBlock.objects.filter(chapter=chapter_with_json_content)
        assert blocks.count() > 0

    def test_command_is_idempotent(self, chapter_with_json_content):
        call_command('migrate_content_blocks')
        count_after_first = ContentBlock.objects.count()
        call_command('migrate_content_blocks')
        count_after_second = ContentBlock.objects.count()
        assert count_after_first == count_after_second

    def test_command_logs_summary(self, chapter_with_json_content):
        out = StringIO()
        call_command('migrate_content_blocks', stdout=out)
        output = out.getvalue()
        assert 'Created:' in output
        assert 'Skipped:' in output
        assert 'Errors:' in output
```

**Run:** `pytest lms/tests/test_migrate_content_blocks.py -v`
**Expected:** 4/4 pass

**Results:**
- [ ] test_dry_run_produces_no_records — `[ ]` PASS / `[ ]` FAIL
- [ ] test_command_creates_blocks_from_chapter_json — `[ ]` PASS / `[ ]` FAIL
- [ ] test_command_is_idempotent — `[ ]` PASS / `[ ]` FAIL
- [ ] test_command_logs_summary — `[ ]` PASS / `[ ]` FAIL

---

## FRONTEND TESTS — Phase 1

### F1.1 — ContentBlock List View Tests
**File to create:** `src/pages/lms/__tests__/ContentBlockList.test.jsx`

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { rest } from 'msw'
import { setupServer } from 'msw/node'
import CurriculumPage from '../CurriculumPage'

const mockBlocks = [
  { id: 1, block_type: 'definition', content_text: 'A definition block', sequence_order: 1, estimated_minutes: 5, is_active: true },
  { id: 2, block_type: 'example', content_text: 'A worked example block', sequence_order: 2, estimated_minutes: null, is_active: true },
]

const server = setupServer(
  rest.get('/api/lms/content-blocks/', (req, res, ctx) => {
    return res(ctx.json({ results: mockBlocks, count: 2 }))
  })
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('ContentBlock List View', () => {
  test('shows content block count on topic row', async () => {
    // render curriculum with a topic expanded
    // assert "Content Blocks (2)" text visible
  })

  test('renders content block cards with correct badge colors', async () => {
    // expand topic, wait for blocks to load
    // assert definition badge has blue color class
    // assert example badge has green color class
  })

  test('shows loading skeleton while fetching', async () => {
    server.use(rest.get('/api/lms/content-blocks/', (req, res, ctx) => res(ctx.delay(500), ctx.json({ results: [] }))))
    // render and immediately assert skeleton visible
  })

  test('shows empty state when no blocks exist', async () => {
    server.use(rest.get('/api/lms/content-blocks/', (req, res, ctx) => res(ctx.json({ results: [], count: 0 }))))
    // expand topic
    // assert "No content blocks yet" message visible
    // assert "Add the first one" button present
  })

  test('collapses and hides blocks without refetching', async () => {
    // expand topic, wait for blocks
    // collapse topic
    // assert blocks not visible
    // assert no new network request fired (spy on fetch)
  })
})
```

**Run:** `npx jest src/pages/lms/__tests__/ContentBlockList.test.jsx`
**Expected:** 5/5 pass

**Results:**
- [ ] shows content block count on topic row — `[ ]` PASS / `[ ]` FAIL
- [ ] renders block cards with correct badge colors — `[ ]` PASS / `[ ]` FAIL
- [ ] shows loading skeleton while fetching — `[ ]` PASS / `[ ]` FAIL
- [ ] shows empty state when no blocks — `[ ]` PASS / `[ ]` FAIL
- [ ] collapses without refetching — `[ ]` PASS / `[ ]` FAIL

---

### F1.2 — ContentBlock Add/Edit Modal Tests
**File to create:** `src/pages/lms/__tests__/ContentBlockModal.test.jsx`

```jsx
describe('ContentBlock Modal', () => {
  test('opens add modal with empty fields when Add button clicked', async () => {
    // click Add button on topic
    // assert modal visible
    // assert all fields empty
  })

  test('opens edit modal pre-populated with existing block data', async () => {
    // click edit on existing block
    // assert block_type select shows 'definition'
    // assert content_text textarea has correct value
  })

  test('blocks form submission when block_type not selected', async () => {
    // open add modal
    // fill content_text only
    // click save
    // assert validation error shown, API not called
  })

  test('calls POST on create and invalidates query', async () => {
    // open add modal, fill all fields, save
    // assert POST /api/lms/content-blocks/ called with correct payload
    // assert block list refetches (query invalidated)
  })

  test('calls PATCH on edit and shows success toast', async () => {
    // open edit modal, change content_text, save
    // assert PATCH called with updated text
    // assert success toast appears
  })

  test('delete shows confirmation dialog then calls DELETE', async () => {
    // click delete on block
    // assert confirmation dialog appears
    // confirm deletion
    // assert DELETE /api/lms/content-blocks/{id}/ called
  })
})
```

**Run:** `npx jest src/pages/lms/__tests__/ContentBlockModal.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] opens add modal empty — `[ ]` PASS / `[ ]` FAIL
- [ ] opens edit modal pre-populated — `[ ]` PASS / `[ ]` FAIL
- [ ] blocks submission without block_type — `[ ]` PASS / `[ ]` FAIL
- [ ] POST on create and query invalidated — `[ ]` PASS / `[ ]` FAIL
- [ ] PATCH on edit with toast — `[ ]` PASS / `[ ]` FAIL
- [ ] delete confirmation then DELETE call — `[ ]` PASS / `[ ]` FAIL

---

### F1.3 — Bloom Level UI Tests
**File to create:** `src/pages/examinations/__tests__/BloomLevel.test.jsx`

```jsx
describe('Bloom Level UI', () => {
  test('bloom_level select appears in add question modal', async () => {
    // open add question modal
    // assert "Bloom's Level" label and select present
  })

  test('bloom badge renders on question card when set', async () => {
    // render question card with bloom_level: 'apply'
    // assert badge with text 'Apply' visible
    // assert badge has green color class
  })

  test('no bloom badge rendered when bloom_level is null', async () => {
    // render question card with bloom_level: null
    // assert no bloom badge element in DOM
  })

  test('bloom level filter updates question list', async () => {
    // select 'Apply' in bloom filter dropdown
    // assert API called with ?bloom_level=apply
    // assert results updated
  })

  test('clearing bloom filter resets list', async () => {
    // select bloom filter, then clear it
    // assert API called without bloom_level param
  })

  test('edit modal pre-populates bloom_level from existing question', async () => {
    // open edit on question with bloom_level: 'analyze'
    // assert select shows 'Analyze'
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/BloomLevel.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] bloom select in add modal — `[ ]` PASS / `[ ]` FAIL
- [ ] bloom badge renders when set — `[ ]` PASS / `[ ]` FAIL
- [ ] no badge when null — `[ ]` PASS / `[ ]` FAIL
- [ ] filter updates list — `[ ]` PASS / `[ ]` FAIL
- [ ] clearing filter resets — `[ ]` PASS / `[ ]` FAIL
- [ ] edit pre-populates bloom_level — `[ ]` PASS / `[ ]` FAIL

---

### F1.4 — AI Badge and Verification Tests
**File to create:** `src/pages/examinations/__tests__/AIBadge.test.jsx`

```jsx
describe('AI Badge and Verification', () => {
  test('amber badge shown for unverified AI question', () => {
    // render card with is_ai_generated: true, verified_by: null
    // assert badge text contains 'AI' and 'Unverified'
    // assert badge has amber color class
  })

  test('green badge shown for verified AI question', () => {
    // render card with is_ai_generated: true, verified_by: { id: 1 }
    // assert badge has green color class
    // assert 'Verified' text present
  })

  test('no AI badge on human-created questions', () => {
    // render card with is_ai_generated: false
    // assert no AI badge in DOM
  })

  test('verify button visible only on unverified AI questions', () => {
    // render unverified AI card — assert Verify button present
    // render verified AI card — assert Verify button absent
    // render human card — assert Verify button absent
  })

  test('clicking verify calls PATCH and updates badge to green', async () => {
    // render unverified AI card
    // click Verify button
    // assert PATCH called with verified_by and verified_at
    // assert badge updates to green without page reload
  })

  test('source filter options work correctly', async () => {
    // select 'AI (Unverified)' filter
    // assert API called with ?is_ai_generated=true&verified_by__isnull=true
  })
})
```

**Run:** `npx jest src/pages/examinations/__tests__/AIBadge.test.jsx`
**Expected:** 6/6 pass

**Results:**
- [ ] amber badge for unverified AI — `[ ]` PASS / `[ ]` FAIL
- [ ] green badge for verified AI — `[ ]` PASS / `[ ]` FAIL
- [ ] no badge on human questions — `[ ]` PASS / `[ ]` FAIL
- [ ] verify button visibility logic — `[ ]` PASS / `[ ]` FAIL
- [ ] verify updates badge optimistically — `[ ]` PASS / `[ ]` FAIL
- [ ] source filter API params correct — `[ ]` PASS / `[ ]` FAIL

---

## Phase 1 Test Summary
> Agent fills this in after running all tests above.

| Suite | Total | Passed | Failed |
|---|---|---|---|
| B1.1 ContentBlock Model | 7 | | |
| B1.2 ContentBlock API | 8 | | |
| B1.3 Bloom Level | 5 | | |
| B1.4 AI Fields | 7 | | |
| B1.5 Migration Script | 4 | | |
| F1.1 ContentBlock List | 5 | | |
| F1.2 ContentBlock Modal | 6 | | |
| F1.3 Bloom Level UI | 6 | | |
| F1.4 AI Badge + Verify | 6 | | |
| **TOTAL** | **54** | | |

**Phase 1 Gate:** All 54 tests must pass before running TEST_PHASE2.md.
If any tests fail, log them in BLOCKERS below. Do not proceed to Phase 2 tests.

---

## BLOCKERS
> Agent logs any incomplete backend/frontend tasks or persistent test failures here.

- None logged yet.
