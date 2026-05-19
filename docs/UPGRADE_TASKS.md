# Curriculum System Upgrade Tasks
> Agent: Read this file before starting. After completing each task, mark it `[x]` and add a one-line note of what was done. Do NOT skip tasks within a phase. Complete Phase 1 fully before moving to Phase 2.
>
> Backend execution status (updated 2026-05-25): Phases 1-4 are fully completed and validated.

---

## Reference Files
- `CURRICULUM_LESSONPLAN_QBANK_PAPERBUILDER_TECHNICAL_REFERENCE.md` — existing system schema, APIs, and data flow
- This file — upgrade task list and acceptance criteria

---

## PHASE 1 — Foundation (Do First)
> Goal: Promote content from opaque JSON into queryable relational nodes. Everything in Phase 2+ depends on this.

---

### Task 1.1 — Create `ContentBlock` Model
**App:** `lms`
**File:** `lms/models.py`

Create a new Django model `ContentBlock` with the following fields:

```python
class ContentBlock(Model):
    # Hierarchy — at least one FK must be set
    chapter     = FK(Chapter, null=True, blank=True, related_name='content_blocks_rel')
    topic       = FK(Topic,   null=True, blank=True, related_name='content_blocks_rel')
    subtopic    = FK(SubTopic,null=True, blank=True, related_name='content_blocks_rel')

    block_type = CharField(max_length=30, choices=[
        ('text',         'Text Paragraph'),
        ('definition',   'Definition'),
        ('example',      'Worked Example'),
        ('exercise',     'Exercise'),
        ('formula',      'Formula / Equation'),
        ('diagram_desc', 'Diagram Description'),
        ('summary',      'Summary'),
        ('key_point',    'Key Point'),
    ])

    content_text  = TextField()
    content_rich  = JSONField(null=True, blank=True)   # for tables, math, formatted content
    sequence_order = PositiveIntegerField(default=0)
    difficulty_level = IntegerField(null=True, blank=True)  # 1–5
    estimated_minutes = IntegerField(null=True, blank=True)

    is_ai_generated = BooleanField(default=False)
    is_active       = BooleanField(default=True)
    created_at      = DateTimeField(auto_now_add=True)
    updated_at      = DateTimeField(auto_now=True)

    class Meta:
        ordering = ['sequence_order']
```

**Acceptance criteria:**
- [x] Model created and migration generated (`makemigrations lms`)
- [x] Migration applies cleanly (`migrate`)
- [x] `__str__` returns `f"{self.block_type} | {self.content_text[:60]}"`
- [x] Admin registered for `ContentBlock` with list_filter on `block_type`, `is_active`

**Status:** [x] Done — Added `ContentBlock` model, registered admin, and applied migration `lms.0009_contentblock`.

---

### Task 1.2 — Add `source_content_block` FK to `Question`
**App:** `examinations`
**File:** `examinations/models.py`

Add to the existing `Question` model:
```python
source_content_block = FK(
    'lms.ContentBlock',
    null=True, blank=True,
    on_delete=SET_NULL,
    related_name='generated_questions'
)
is_ai_generated = BooleanField(default=False)
verified_by     = FK(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name='verified_questions')
verified_at     = DateTimeField(null=True, blank=True)
```

**Acceptance criteria:**
- [x] Fields added and migration generated
- [x] Migration applies cleanly
- [x] Existing question records unaffected (all new fields nullable)
- [x] `source_content_block` visible in Question admin detail view

**Status:** [x] Done — Added `Question` source/AI/verification fields, updated Question admin, and applied migration `examinations.0017_question_is_ai_generated_and_more`.

---

### Task 1.3 — Add `bloom_level` to `Question`
**App:** `examinations`
**File:** `examinations/models.py`

Add to existing `Question` model:
```python
BLOOM_LEVELS = [
    ('remember',   'Remember'),
    ('understand', 'Understand'),
    ('apply',      'Apply'),
    ('analyze',    'Analyze'),
    ('evaluate',   'Evaluate'),
    ('create',     'Create'),
]
bloom_level = CharField(max_length=20, choices=BLOOM_LEVELS, null=True, blank=True)
```

**Acceptance criteria:**
- [x] Field added, migration generated and applied
- [x] `bloom_level` exposed in Question serializer (read + write)
- [x] `bloom_level` added as filter param in `QuestionViewSet` (alongside existing `difficulty_level`)
- [x] Existing questions unaffected (nullable)

**Status:** [x] Done — Added nullable `Question.bloom_level`, enabled serializer read/write, added `bloom_level` query filtering, and applied migration `examinations.0018_question_bloom_level`.

---

### Task 1.4 — Add `SubTopic` Content Fields
**App:** `lms`
**File:** `lms/models.py`

Add to existing `SubTopic` model (it currently only has title/number/description):
```python
content_text   = TextField(blank=True)
content_blocks_json = JSONField(null=True, blank=True)   # legacy compat
content_schema_version = CharField(max_length=10, default='1.0')
estimated_minutes = IntegerField(null=True, blank=True)
```

**Acceptance criteria:**
- [x] Fields added, migration generated and applied
- [x] SubTopic serializer updated to include new fields
- [x] Existing SubTopic records unaffected

**Status:** [x] Done — Added nullable/defaulted SubTopic content fields, exposed them in `SubTopicSerializer`, and applied migration `lms.0010_subtopic_content_blocks_json_and_more`.

---

### Task 1.5 — Create `ContentBlockSerializer` and CRUD API
**App:** `lms`
**Files:** `lms/serializers.py`, `lms/views.py`, `lms/urls.py`

Create:
- `ContentBlockSerializer` — all fields, read/write
- `ContentBlockViewSet` — standard ModelViewSet
- Filter params: `chapter_id`, `topic_id`, `subtopic_id`, `block_type`, `is_active`
- Register at `/api/lms/content-blocks/`

**Acceptance criteria:**
- [x] `GET /api/lms/content-blocks/?topic_id=X` returns blocks for that topic in sequence order
- [x] `POST /api/lms/content-blocks/` creates a block
- [x] `PATCH /api/lms/content-blocks/{id}/` updates a block
- [x] `DELETE /api/lms/content-blocks/{id}/` soft-deletes (sets `is_active=False`)
- [x] School-scoped filtering enforced (tenant isolation matches rest of system)

**Status:** [x] Done — Added `ContentBlockSerializer`, tenant-aware `ContentBlockViewSet`, soft-delete behavior, and registered `/api/lms/content-blocks/`.

---

### Task 1.6 — Migration Script: Explode Existing JSON into ContentBlock Rows
**File:** `lms/management/commands/migrate_content_blocks.py`

Write a Django management command that:
1. Iterates all `Chapter` objects with non-empty `content_blocks` JSON
2. Parses the JSON array
3. Creates `ContentBlock` records linked to that chapter, preserving sequence order
4. Does the same for all `Topic` objects
5. Skips records already migrated (idempotent — safe to run twice)
6. Logs counts: created, skipped, errors

```bash
# Usage
python manage.py migrate_content_blocks --dry-run   # preview
python manage.py migrate_content_blocks              # execute
```

**Acceptance criteria:**
- [x] Command exists and runs without error on empty DB
- [x] `--dry-run` flag prints counts without writing
- [x] Running twice produces no duplicates
- [x] Final log prints: `Created: X | Skipped: Y | Errors: Z`

**Status:** [x] Done — Added idempotent `migrate_content_blocks` management command with dry-run support and validated repeated execution output.

---

## PHASE 2 — AI Readiness
> Goal: Add semantic search, tagging, and AI job tracking. Requires Phase 1 complete.

---

### Task 2.1 — Enable pgvector and Add Embedding Fields
**Files:** `lms/models.py`, `examinations/models.py`, Django settings

Steps:
1. Enable pgvector in PostgreSQL: `CREATE EXTENSION IF NOT EXISTS vector;`
2. Install `pgvector` Python package: `pip install pgvector`
3. Add to `ContentBlock`:
   ```python
   from pgvector.django import VectorField
   embedding = VectorField(dimensions=1536, null=True, blank=True)
   ```
4. Add same `embedding` field to `examinations.Question`
5. Add same `embedding` field to `lms.Topic`

**Acceptance criteria:**
- [x] pgvector extension enabled in DB
- [x] `embedding` field on `ContentBlock`, `Question`, `Topic` — migrations applied
- [x] Fields nullable so existing records unaffected

**Status:** [x] Done — Installed `pgvector`, enabled the PostgreSQL `vector` extension, added nullable embedding fields to `ContentBlock`, `Topic`, and `Question`, and applied migrations.

---

### Task 2.2 — Celery Task: Generate and Store Embeddings
**File:** `lms/tasks.py`, `examinations/tasks.py`

Create async Celery tasks:

```python
@shared_task
def embed_content_block(block_id):
    # 1. Fetch ContentBlock
    # 2. Call embedding API (OpenAI text-embedding-3-small or equivalent)
    # 3. Store result in block.embedding
    # 4. Save

@shared_task
def embed_question(question_id):
    # Same pattern for Question model

@shared_task
def embed_all_content_blocks():
    # Batch task — embeds all blocks where embedding is None
    # Process in chunks of 50, log progress
```

Wire up signals:
- After `ContentBlock.save()` → trigger `embed_content_block.delay(instance.id)`
- After `Question.save()` → trigger `embed_question.delay(instance.id)`

**Acceptance criteria:**
- [x] Tasks defined and importable
- [x] Signal wiring works — saving a ContentBlock queues embedding task
- [x] `embed_all_content_blocks` batch task runs without error
- [x] Embedding stored correctly in DB (verify with `ContentBlock.objects.filter(embedding__isnull=False).count()`)

**Status:** [x] Done — Added reusable embedding generation, `embed_content_block` / `embed_question` / `embed_all_content_blocks` tasks, wired post-save signals, and validated signal plus batch execution end to end.

---

### Task 2.3 — Semantic Search API Endpoint
**File:** `lms/views.py`, `examinations/views.py`

Add endpoint: `GET /api/lms/content-blocks/semantic_search/?q=photosynthesis&limit=10`

Logic:
1. Embed the query string using same embedding model
2. Use pgvector cosine similarity to find nearest `ContentBlock` records
3. Return top N results with `similarity_score`, block content, and hierarchy path (topic > chapter > book)

Add same for questions: `GET /api/examinations/questions/semantic_search/?q=...`

**Acceptance criteria:**
- [x] Endpoint returns results ranked by semantic similarity
- [x] Response includes `similarity_score` field
- [x] Response includes `chapter_title`, `topic_title` for context
- [x] Falls back gracefully if no embeddings exist yet (returns empty list, no crash)

**Status:** [x] Done — Added pgvector-backed `semantic_search` endpoints for content blocks and questions, validated ranked responses with context fields, and confirmed empty-result fallback behavior.

---

### Task 2.4 — Tag and Knowledge Graph Models
**App:** `lms`
**File:** `lms/models.py`

```python
class Tag(Model):
    name     = CharField(max_length=100, unique=True)
    tag_type = CharField(max_length=20, choices=[
        ('concept',   'Concept'),
        ('skill',     'Skill'),
        ('keyword',   'Keyword'),
        ('standard',  'Curriculum Standard'),
    ])
    subject  = FK(Subject, null=True, blank=True)
    school   = FK(School,  null=True, blank=True)   # null = global tag

class ContentBlockTag(Model):
    content_block = FK(ContentBlock, on_delete=CASCADE)
    tag           = FK(Tag, on_delete=CASCADE)
    class Meta:
        unique_together = ('content_block', 'tag')

class QuestionTag(Model):
    question = FK('examinations.Question', on_delete=CASCADE)
    tag      = FK(Tag, on_delete=CASCADE)
    class Meta:
        unique_together = ('question', 'tag')
```

Expose via APIs:
- `GET/POST /api/lms/tags/`
- `POST /api/lms/content-blocks/{id}/add_tag/`
- `POST /api/examinations/questions/{id}/add_tag/`
- Filter questions by tag: `GET /api/examinations/questions/?tag_id=X`

**Acceptance criteria:**
- [x] Models created, migrations applied
- [x] Tag CRUD API works
- [x] Can add/remove tags from ContentBlock and Question
- [x] Question filter by `tag_id` returns correct results

**Status:** [x] Done — Added tag and link models, exposed LMS tag CRUD, implemented content/question add-remove tag actions, and validated `tag_id` question filtering.

---

### Task 2.5 — AI Job Audit Trail
**App:** `core` or `lms`
**File:** `models.py`

```python
class AIJob(Model):
    JOB_TYPES = [
        ('generate_questions',  'Generate Questions'),
        ('generate_lesson',     'Generate Lesson Plan'),
        ('suggest_toc',         'Suggest TOC'),
        ('embed_content',       'Embed Content'),
        ('classify_bloom',      'Classify Bloom Level'),
    ]
    job_type     = CharField(max_length=40, choices=JOB_TYPES)
    triggered_by = FK(settings.AUTH_USER_MODEL, null=True, on_delete=SET_NULL)
    school       = FK(School, null=True, on_delete=SET_NULL)
    input_data   = JSONField()
    output_data  = JSONField(null=True, blank=True)
    model_used   = CharField(max_length=100)
    tokens_used  = IntegerField(null=True, blank=True)
    status       = CharField(max_length=20, choices=[
        ('pending','Pending'), ('success','Success'), ('failed','Failed')
    ], default='pending')
    accepted     = BooleanField(null=True, blank=True)  # did user accept the output?
    error_message = TextField(blank=True)
    created_at   = DateTimeField(auto_now_add=True)
    completed_at = DateTimeField(null=True, blank=True)
```

Wire into every existing LLM call:
- `POST /api/lms/generate-lesson-plan/` → create AIJob before call, update after
- `POST /api/examinations/questions/generate_from_lesson/` → same pattern

**Acceptance criteria:**
- [x] Model created, migration applied
- [x] Every LLM API call creates and updates an AIJob record
- [x] Admin view shows jobs filterable by `job_type`, `status`, `school`
- [x] `accepted` field updated when teacher uses or dismisses AI output

**Status:** [x] Done — Added `core.AIJob`, wired lesson/question AI flows into job lifecycle tracking, exposed feedback updates for `accepted`, and registered filterable admin support.

---

## PHASE 3 — Intelligence Layer
> Goal: Structured learning objectives, curriculum standard alignment, content versioning. Requires Phase 2 complete.

---

### Task 3.1 — `LearningObjective` Model
**App:** `lms`

```python
class LearningObjective(Model):
    topic        = FK(Topic, related_name='objectives')
    statement    = TextField()          # "Students will be able to..."
    bloom_level  = CharField(max_length=20, choices=BLOOM_LEVELS)
    is_ai_generated = BooleanField(default=False)
    is_active    = BooleanField(default=True)
    created_at   = DateTimeField(auto_now_add=True)

class LessonPlanObjective(Model):
    lesson_plan = FK(LessonPlan)
    objective   = FK(LearningObjective)
    class Meta:
        unique_together = ('lesson_plan', 'objective')
```

Migrate existing `LessonPlan.objectives` TextField → seed `LearningObjective` rows per topic.

**Acceptance criteria:**
- [x] Models and migrations done
- [x] API: `GET /api/lms/topics/{id}/objectives/`
- [x] API: `POST /api/lms/lesson-plans/{id}/link_objectives/`
- [x] LessonPlan serializer returns linked objectives list

**Status:** [x] Done — Added relational learning objectives plus lesson-plan links, seeded from legacy objective text during migration, and validated the new topic and lesson-plan objective APIs.

---

### Task 3.2 — `CurriculumStandard` and SLO Alignment
**App:** `lms`

```python
class CurriculumStandard(Model):
    name    = CharField(max_length=100)   # "SNC 2021", "Cambridge IGCSE"
    country = CharField(max_length=50, default='Pakistan')
    board   = CharField(max_length=100)

class StandardObjective(Model):    # Student Learning Outcome
    standard  = FK(CurriculumStandard)
    subject   = FK(Subject)
    grade     = FK('students.Class')
    code      = CharField(max_length=30)   # e.g. "Bio-9-3.2.1"
    statement = TextField()

class TopicStandardAlignment(Model):
    topic     = FK(Topic)
    objective = FK(StandardObjective)
    class Meta:
        unique_together = ('topic', 'objective')
```

**Acceptance criteria:**
- [x] Models and migrations done
- [x] Admin interface for managing standards and SLOs
- [x] API: `GET /api/lms/topics/{id}/standards/`
- [x] Paper coverage report includes SLO coverage count

**Status:** [x] Done — Added curriculum standard/SLO alignment models plus admin, exposed topic standards API, extended paper coverage stats with `slo_coverage_count`, and applied migration `lms.0014_curriculumstandard_standardobjective_and_more`.

---

### Task 3.3 — Content Versioning (`ContentRevision`)
**App:** `lms`

```python
class ContentRevision(Model):
    content_block = FK(ContentBlock, related_name='revisions')
    content_text  = TextField()
    content_rich  = JSONField(null=True)
    changed_by    = FK(settings.AUTH_USER_MODEL, on_delete=SET_NULL, null=True)
    changed_at    = DateTimeField(auto_now_add=True)
    revision_note = TextField(blank=True)
```

Wire via `post_save` signal on `ContentBlock` — snapshot previous version before overwrite.

Same pattern for `Question`:
```python
class QuestionRevision(Model):
    question      = FK('examinations.Question', related_name='revisions')
    question_text = TextField()
    snapshot      = JSONField()     # full question state at that point
    changed_by    = FK(settings.AUTH_USER_MODEL, null=True, on_delete=SET_NULL)
    changed_at    = DateTimeField(auto_now_add=True)
```

**Acceptance criteria:**
- [x] Models and migrations done
- [x] Editing a ContentBlock creates a revision record automatically
- [x] API: `GET /api/lms/content-blocks/{id}/revisions/` returns history
- [x] API: `POST /api/lms/content-blocks/{id}/restore/?revision_id=X` restores a version

**Status:** [x] Done — Added `ContentRevision` and `QuestionRevision` models with automatic snapshot signals, exposed content block revision history and restore actions, and applied migrations `lms.0015_contentrevision` and `examinations.0020_questionrevision`.

---

## PHASE 4 — Feedback Loop
> Goal: Close the loop between assessment results and content/question intelligence. Requires Phase 3 complete.

---

### Task 4.1 — `StudentResponse` and `QuestionStats` Models
**App:** `examinations`

```python
class StudentResponse(Model):
    student       = FK('students.Student')
    question      = FK(Question)
    exam_paper    = FK(ExamPaper)
    response_text = TextField(blank=True)
    marks_awarded = DecimalField(max_digits=6, decimal_places=2, null=True)
    is_correct    = BooleanField(null=True)
    time_taken_seconds = IntegerField(null=True)
    submitted_at  = DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = ('student', 'question', 'exam_paper')

class QuestionStats(Model):
    question          = OneToOneField(Question, related_name='stats')
    attempt_count     = IntegerField(default=0)
    correct_count     = IntegerField(default=0)
    avg_time_seconds  = FloatField(null=True)
    real_difficulty   = FloatField(null=True)   # computed from attempt data
    last_computed_at  = DateTimeField(null=True)
```

Add Celery task `recompute_question_stats(question_id)` — recalculates `real_difficulty` after each new response batch.

**Acceptance criteria:**
- [x] Models and migrations done
- [x] `POST /api/examinations/student-responses/` — bulk submit responses for a paper
- [x] Celery task updates `QuestionStats` after response submission
- [x] `real_difficulty` visible in Question serializer (read-only)

**Status:** [x] Done — Added `StudentResponse` and `QuestionStats`, exposed bulk response submission at `/api/examinations/student-responses/`, recomputed stats via Celery, surfaced `real_difficulty` in question reads, and applied migration `examinations.0021_questionstats_studentresponse`.

---

### Task 4.2 — Question Reuse Tracking
**App:** `examinations`
**File:** `examinations/models.py`

Add to existing `Question` model:
```python
paper_use_count = IntegerField(default=0)
last_used_in    = FK(ExamPaper, null=True, blank=True, on_delete=SET_NULL, related_name='last_used_questions')
last_used_at    = DateTimeField(null=True, blank=True)
```

Wire via `post_save` on `PaperQuestion` — increment count and update `last_used_at`.

Add to Paper Builder API response a warning field:
```json
{ "overused_questions": [{ "question_id": 12, "paper_use_count": 4 }] }
```

**Acceptance criteria:**
- [x] Fields added, migration applied
- [x] Attaching a question to a paper increments `paper_use_count`
- [x] `GET /api/examinations/exam-papers/{id}/` includes `overused_questions` list (count > 3)
- [x] Question list API supports `ordering=paper_use_count`

**Status:** [x] Done — Added question reuse-tracking fields, updated them on `PaperQuestion` creation, exposed `overused_questions` on exam paper reads, enabled `ordering=paper_use_count`, and applied migration `examinations.0022_question_last_used_at_question_last_used_in_and_more`.

---

## Agent Rules
1. Work one task at a time. Do not jump phases.
2. Mark each sub-checklist item `[x]` as you complete it.
3. Mark the task `Status: [x] Done — <one line summary>` when fully complete.
4. If a task cannot be completed, mark `Status: [!] Blocked — <reason>` and move to next.
5. Do not modify the existing schema in ways that break current functionality — all new fields must be nullable or have defaults.
6. Run `makemigrations` and `migrate` after every model change.
7. Never delete existing fields — only add.
