# Frontend Alignment Upgrade Tasks
> Agent: Read this file alongside `UPGRADE_TASKS.md` (backend) and `CURRICULUM_LESSONPLAN_QBANK_PAPERBUILDER_TECHNICAL_REFERENCE.md` (system reference).
> 
> **Execution order: Complete Backend Phase N → then complete Frontend Phase N → then move to Backend Phase N+1.**
>
> Backend prerequisite status (updated 2026-05-25): Backend Phases 1-4 are complete; frontend implementation can proceed phase-by-phase from this file.
> 
> After completing each task, mark checklist items `[x]` and update Status line.

---

## Stack Reference
- **Framework:** React (JSX)
- **Styling:** Tailwind CSS — custom utility classes, no external UI library
- **Server state:** React Query (`useQuery`, `useMutation`, `useQueryClient`)
- **App state:** React Context (auth, academic year, toasts, background tasks)
- **Local state:** `useState`, `useMemo`, `useCallback`, `useEffect`
- **Structure:** Mixed — Curriculum monolithic, Lesson Plans modular, Question Bank large container, Paper Builder tab-based orchestrator

---

## FRONTEND PHASE 1 — Surface New Backend Models
> Aligns with: Backend Phase 1 (ContentBlock, bloom_level, source_content_block, SubTopic content)
> 
> Goal: Every field and model added in Backend Phase 1 is visible, editable, and usable in the UI.

---

### Task F1.1 — ContentBlock List View in Curriculum Page
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 1.1 (ContentBlock model + API at `/api/lms/content-blocks/`)

When a teacher expands a Topic row in the curriculum tree, show its content blocks below it as a collapsible sub-section.

**UI behavior:**
- Expand/collapse toggle on Topic row: "Content Blocks (N)"
- Fetch: `GET /api/lms/content-blocks/?topic_id={id}` via React Query
- Display each block as a card showing:
  - `block_type` — pill/badge (color-coded: definition=blue, example=green, exercise=orange, summary=purple, etc.)
  - `content_text` — truncated to 2 lines, expand on click
  - `sequence_order` — small grey number
  - `estimated_minutes` — if set, show "~N min"
  - Edit and Delete icon buttons

**Empty state:** "No content blocks yet. Add the first one." with an Add button.

**Acceptance criteria:**
- [x] Content blocks load and display when topic is expanded
- [x] Block type badges are color-coded consistently
- [x] Empty state renders correctly
- [x] Loading skeleton shown while fetching
- [x] Collapsing topic hides blocks without re-fetching (React Query cache)

**Status:** [x] Done — Added topic-level Content Blocks subsection in Curriculum tree with React Query fetch, color-coded cards, and loading/empty/error states.

---

### Task F1.2 — ContentBlock Add / Edit Modal
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 1.5 (ContentBlock CRUD API)

Add a modal for creating and editing content blocks, opened from the Add/Edit buttons in Task F1.1.

**Form fields:**
- `block_type` — select dropdown with all 8 types
- `content_text` — textarea (required), min 3 rows
- `content_rich` — optional JSON textarea (collapsed by default, expandable for advanced users)
- `sequence_order` — number input (default: auto last+1)
- `difficulty_level` — select 1–5 (optional)
- `estimated_minutes` — number input (optional)

**API calls:**
- Create: `POST /api/lms/content-blocks/`
- Edit: `PATCH /api/lms/content-blocks/{id}/`
- On success: invalidate `['content-blocks', topic_id]` React Query key

**Acceptance criteria:**
- [x] Modal opens for both add and edit
- [x] Edit pre-populates all fields correctly
- [x] `block_type` is required — form blocks submission without it
- [x] Success toast shown on save
- [x] Query invalidated and list refreshes after save
- [x] Delete triggers confirmation dialog then `DELETE /api/lms/content-blocks/{id}/`

**Status:** [x] Done — Added Content Block add/edit modal with required validation, JSON advanced editor, topic-scoped React Query invalidation, and confirmed delete flow.

---

### Task F1.3 — Bloom Level Field in Question Modal
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 1.3 (bloom_level field on Question)

Add `bloom_level` to the Question add/edit modal and to question card display.

**In the modal (add/edit form):**
- Add a `Bloom's Level` select field after `difficulty_level`
- Options: Remember | Understand | Apply | Analyze | Evaluate | Create
- Optional field (not required)
- Position: between Difficulty and Marks fields

**On the question card:**
- Show a small Bloom badge alongside the difficulty badge
- Color coding: Remember=grey, Understand=blue, Apply=green, Analyze=yellow, Evaluate=orange, Create=red
- Only show if `bloom_level` is set (don't show empty badge)

**In the filter bar:**
- Add `Bloom Level` filter dropdown alongside existing `Question Type` and `Difficulty` filters
- Sends `?bloom_level=apply` query param to `GET /api/examinations/questions/`

**Acceptance criteria:**
- [x] Bloom field appears in add and edit modal
- [x] Edit modal pre-populates bloom_level from existing question data
- [x] Bloom badge appears on question cards where set
- [x] Filter dropdown works and updates question list correctly
- [x] Clearing bloom filter resets list to unfiltered state

**Status:** [x] Done — Added bloom_level support end-to-end in question modal payload, card badge rendering, and list filtering with query param.

---

### Task F1.4 — Source Content Block Preview on Question Card
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 1.2 (source_content_block FK on Question)

When a question has a `source_content_block` set, show a small source indicator on the question card.

**UI behavior:**
- Small "Source" link/chip at the bottom of the question card
- Text: "From: {chapter_title} › {topic_title}"
- On hover: tooltip showing first 100 chars of the content block text
- On click: opens a read-only modal showing the full content block

**In the add/edit modal:**
- Add an optional "Source Content Block" picker field
- Search input: fetches `GET /api/lms/content-blocks/?topic_id=X` based on selected topic context
- Displayed as a searchable dropdown showing block_type + first 60 chars of content_text

**Acceptance criteria:**
- [x] Source chip appears on cards where source_content_block is set
- [x] Tooltip shows content block preview on hover
- [x] Click opens read-only content block modal
- [x] Source picker in modal allows linking a block to a question
- [x] Cards without source block show no chip (no empty UI element)

**Status:** [x] Done — Added source content block linking in question modal, source chip with hover preview, and read-only source detail modal on card click.

---

### Task F1.5 — AI Generated Badge and Verification Flow on Questions
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 1.2 (is_ai_generated, verified_by, verified_at on Question)

**On question card:**
- Show a "AI" badge if `is_ai_generated === true`
- If `verified_by` is null: badge is amber — "AI · Unverified"
- If `verified_by` is set: badge is green — "AI · Verified"

**Verification action:**
- Unverified AI questions show a "Verify" button on the card
- Clicking sends `PATCH /api/examinations/questions/{id}/` with `{ verified_by: currentUserId, verified_at: now }`
- On success: badge updates to green without page reload

**Filter:**
- Add "Source" filter: All | Human | AI (Unverified) | AI (Verified)
- Maps to `?is_ai_generated=true&verified_by__isnull=true` etc.

**Acceptance criteria:**
- [x] AI badge renders correctly in both states (amber unverified, green verified)
- [x] Verify button visible only on unverified AI questions
- [x] Verify action works and updates badge immediately (optimistic update)
- [x] Source filter options work correctly
- [x] Human-created questions show no AI badge

**Status:** [x] Done — Added AI verification badges, optimistic verify action, and Source filter mapping to AI/Human query combinations.

---

### Task F1.6 — SubTopic Content Editor
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 1.4 (content_text and content fields on SubTopic)

Extend the existing SubTopic row/modal to include content editing.

**In SubTopic expand/detail view:**
- Show `content_text` as an editable textarea inline or in modal
- Show `estimated_minutes` as an editable number field
- Save button sends `PATCH /api/lms/subtopics/{id}/`

**Acceptance criteria:**
- [x] SubTopic detail view shows content_text and estimated_minutes
- [x] Inline or modal edit works and saves correctly
- [x] Success toast on save
- [x] Fields are optional — empty state handled gracefully

**Status:** [x] Done — Added sub-topic content section under each topic with modal editing for content_text and estimated_minutes via PATCH.

---

### Task F1.7 — Curriculum Page: Book Detail Shows Content Block Count
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 1.1 + 1.5

Update the Book card and Chapter/Topic rows to show content block counts as additional metadata.

**Book card:** Add "N Content Blocks" stat alongside existing chapter_count
**Chapter row:** Add small grey count "N blocks" badge
**Topic row:** Add "N blocks" badge (fetch from content-blocks API count or include in topic serializer)

**Acceptance criteria:**
- [x] Book card shows total content block count
- [x] Chapter and topic rows show per-item block counts
- [x] Counts update after adding/deleting blocks without full page reload

**Status:** [x] Done — Added live content block count badges at book, chapter, and topic levels using shared React Query topic caches.

---

## FRONTEND PHASE 2 — AI Readiness UI
> Aligns with: Backend Phase 2 (embeddings, semantic search, tags, AI job audit)
>
> Goal: Surface semantic search, tagging, and AI job feedback in the UI.

---

### Task F2.1 — Semantic Search Bar in Question Bank
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 2.3 (`/api/examinations/questions/semantic_search/`)

Replace or supplement the existing keyword search input with a semantic search capability.

**UI behavior:**
- Add a toggle next to the search bar: "Keyword | Semantic"
- In Semantic mode: search input sends to `/api/examinations/questions/semantic_search/?q=`
- Results show a `similarity_score` percentage bar on each card (subtle, small)
- Results sorted by relevance, not date
- Show a "Semantic Search" label on the results list header when active
- Debounce: 600ms before firing request

**Fallback:** If semantic search returns empty (no embeddings yet), show: "Semantic search is still indexing. Using keyword search instead." and fall back automatically.

**Acceptance criteria:**
- [x] Toggle switches between keyword and semantic mode
- [x] Semantic search fires to correct endpoint
- [x] Similarity score bar visible on result cards in semantic mode
- [x] Graceful fallback if embeddings not ready
- [x] Clearing search resets to full list

**Status:** [x] Done — Added Keyword/Semantic toggle with 600ms debounce, semantic endpoint query, similarity bars, and automatic fallback to keyword results when semantic index is empty.

---

### Task F2.2 — Semantic Search Bar in Curriculum Content Blocks
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 2.3 (`/api/lms/content-blocks/semantic_search/`)

Add a global content search bar at the top of the Curriculum page.

**UI behavior:**
- Search input: "Search book content..."
- Fires to `/api/lms/content-blocks/semantic_search/?q=`
- Results shown in a side panel or dropdown list
- Each result shows: block_type badge | content preview | Book › Chapter › Topic breadcrumb
- Click on result: expands and scrolls to that topic in the tree

**Acceptance criteria:**
- [x] Search input fires semantic search on typing (debounced 600ms)
- [x] Results panel shows with breadcrumb context
- [x] Clicking result navigates to correct location in curriculum tree
- [x] Empty state and loading state handled
- [x] Closing/clearing search returns to normal tree view

**Status:** [x] Done — Added debounced global semantic content search with contextual result panel and click-to-expand/scroll navigation in the curriculum tree.

---

### Task F2.3 — Tag Chips on Question Cards and Tag Picker in Modal
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 2.4 (Tag model + QuestionTag + APIs)

**On question card:**
- Show tag chips below question text
- Each chip: small pill with tag name, color by tag_type
- Max 3 visible, "+N more" overflow indicator

**In add/edit modal:**
- Add "Tags" field at the bottom of the form
- Searchable multi-select: fetches `GET /api/lms/tags/?subject_id=X`
- Allow creating a new tag inline if search returns no match
- On select: `POST /api/examinations/questions/{id}/add_tag/`
- On remove: corresponding delete call

**Filter bar:**
- Add Tag filter: searchable dropdown
- Sends `?tag_id=X` to question list API

**Acceptance criteria:**
- [x] Tag chips render on question cards
- [x] Overflow handled with "+N more" indicator
- [x] Tag picker in modal works with search and inline creation
- [x] Tag filter in filter bar works
- [x] Tags update on card immediately after saving modal

**Status:** [x] Done — Added color-coded question tag chips, searchable modal tag picker with inline tag creation, tag filter controls, and post-save tag persistence.

---

### Task F2.4 — Tag Chips on Content Blocks
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 2.4 (ContentBlockTag model)

Mirror Task F2.3 but for content blocks.

**On content block card:**
- Show tag chips
- Add/remove tags via icon button on the block card

**Acceptance criteria:**
- [x] Tag chips visible on content block cards
- [x] Add/remove tag works inline without opening full edit modal
- [x] Tag changes reflect immediately

**Status:** [x] Done — Added tag chips to content block cards and inline tag add/remove controls using content block tag actions.

---

### Task F2.5 — AI Job Feedback Flow
**Pages:** `QuestionsPage.jsx`, `LessonPlansPage.jsx`
**Trigger:** Backend Task 2.5 (AIJob model with accepted field)

When AI generates content (questions from lesson, lesson plan from AI), add an accept/reject feedback step.

**For AI-generated questions (QuestionsPage):**
- After `generate_from_lesson` response, show generated questions in a review modal
- Each question has: Accept ✓ | Reject ✗ buttons
- "Accept All" and "Reject All" bulk actions
- On Accept: saves question, sends `PATCH /api/core/ai-jobs/{id}/` with `{ accepted: true }`
- On Reject: discards, sends `{ accepted: false }`

**For AI-generated lesson plans (LessonPlansPage):**
- After AI generation, show result in a preview panel before saving
- "Use this plan" → accepted: true | "Regenerate" → accepted: false + retry

**Acceptance criteria:**
- [!] Blocked — No existing QuestionsPage AI generation response/review contract (`generate_from_lesson`) is currently available in frontend to attach an accept/reject modal flow safely without introducing a new generation workflow.
- [!] Blocked — No existing LessonPlansPage AI preview/regenerate save contract is currently wired on this page; AI generation is currently routed via wizard flow, so direct accept/reject feedback integration point is missing.
- [ ] Accept/Reject per question works
- [ ] Bulk accept/reject works
- [ ] AIJob.accepted field updated correctly via API
- [ ] Lesson plan AI preview has Use/Regenerate actions
- [ ] Accepted questions appear in question bank with AI + Unverified badge (from F1.5)

**Status:** [!] Blocked — Existing frontend AI generation/review contracts needed by this task are not present on `QuestionsPage` and `LessonPlansPage`.

---

### Task F2.6 — AI Job Status Indicator (Global)
**Component:** Shared/global — add to app header or sidebar
**Trigger:** Backend Task 2.5 (AIJob model)

Show a subtle global indicator when AI jobs are running.

**UI behavior:**
- Small spinner + "AI working..." label in the header when any job has `status: pending`
- Poll `GET /api/core/ai-jobs/?status=pending&limit=5` every 10 seconds via React Query
- On job completion: show a toast "AI finished: {job_type}"
- Clicking indicator opens a small dropdown showing last 5 job statuses

**Acceptance criteria:**
- [x] Indicator appears when pending AI jobs exist
- [x] Polling stops when no pending jobs (React Query refetchInterval: conditional)
- [x] Completion toast fires correctly
- [x] Dropdown shows last 5 jobs with status and type
- [x] Does not appear when no AI jobs exist

**Status:** [x] Done — Added global AI status indicator in header with conditional pending poll, completion toasts, and recent job dropdown.

---

## FRONTEND PHASE 3 — Intelligence UI
> Aligns with: Backend Phase 3 (LearningObjective, CurriculumStandard, ContentRevision)
>
> Goal: Structured objectives, SLO coverage, and content revision history in the UI.

---

### Task F3.1 — Structured Learning Objectives in Lesson Plans
**Page:** `LessonPlansPage.jsx`, `LessonPlanWizard.jsx`
**Trigger:** Backend Task 3.1 (LearningObjective model)

Replace the plain `objectives` textarea with a structured objective builder.

**UI behavior:**
- List of objective items, each with:
  - Statement text input ("Students will be able to...")
  - Bloom level select dropdown
  - Delete button
- "Add Objective" button appends a new empty row
- "Generate with AI" button: calls existing AI generate endpoint, populates objectives from response
- On save: sends array of objective objects to `POST /api/lms/lesson-plans/{id}/link_objectives/`

**Display in lesson plan card/detail:**
- Show objectives as a formatted list with Bloom badges

**Acceptance criteria:**
- [x] Objective builder replaces plain textarea
- [x] Add/remove objective rows works
- [x] Bloom level select on each row
- [x] AI generate populates objectives correctly
- [x] Saved objectives display on lesson plan detail view
- [x] Backwards compatible: existing plans with plain text objectives still render

**Status:** [x] Done — Replaced lesson plan objective textareas with structured objective rows in both pages, linked selected objective IDs on save, and rendered linked objective badges with Bloom labels while preserving plain-text objective compatibility.

---

### Task F3.2 — SLO Coverage Display in Paper Builder
**Page:** `QuestionPaperBuilderPage.jsx`
**Trigger:** Backend Task 3.2 (CurriculumStandard, SLO alignment)

Add a coverage panel in the Paper Builder showing SLO alignment as questions are added.

**UI behavior:**
- Sidebar panel: "Curriculum Coverage"
- Shows: total SLOs for this class/subject | covered by selected questions | percentage bar
- List of covered SLOs (green checkmark) and uncovered SLOs (grey)
- Updates live as questions are added/removed from the paper
- Fetch: `GET /api/examinations/exam-papers/{id}/coverage_stats/`

**Acceptance criteria:**
- [x] Coverage panel visible in Paper Builder
- [x] Updates when questions are added or removed
- [x] Covered/uncovered SLO list renders correctly
- [x] Percentage bar animates on update
- [x] Panel can be collapsed to save space

**Status:** [x] Done — Added a collapsible Curriculum Coverage sidebar in Paper Builder with live `coverage_stats` polling, covered/uncovered SLO lists from linked lesson-plan topic standards, and an animated coverage percentage bar.

---

### Task F3.3 — Bloom Distribution Chart in Paper Builder
**Page:** `QuestionPaperBuilderPage.jsx`
**Trigger:** Backend Task 1.3 (bloom_level on Question) + F1.3

Add a live Bloom's distribution visualization while building a paper.

**UI behavior:**
- Small horizontal stacked bar chart showing breakdown of Bloom levels across all questions in the current paper
- Updates as questions are added/removed
- Color matches bloom badges from F1.3
- Shows percentage per level on hover
- Warning indicator if paper is >70% Remember/Understand (surface-level heavy)

**Implementation:** Use Recharts (already in stack based on KoderKids ERP pattern). BarChart or simple percentage bars with Tailwind.

**Acceptance criteria:**
- [x] Chart appears in Paper Builder alongside coverage stats
- [x] Updates live as questions are added/removed
- [x] Colors match bloom badge color system from F1.3
- [x] Warning shows when paper is cognitively surface-level
- [x] Works correctly when some questions have no bloom_level set (show as "Unclassified")

**Status:** [x] Done — Added a live stacked Bloom distribution chart in Paper Builder sidebar using Recharts, including per-level counts, Unclassified handling, and a >70% surface-level warning.

---

### Task F3.4 — Content Block Revision History Viewer
**Page:** `CurriculumPage.jsx`
**Trigger:** Backend Task 3.3 (ContentRevision model)

Add a revision history panel for content blocks.

**UI behavior:**
- History icon button on each content block card
- Opens a side drawer showing revision list: date | changed_by | short diff preview
- Click a revision to see full content at that point (read-only)
- "Restore this version" button: calls `POST /api/lms/content-blocks/{id}/restore/?revision_id=X`
- Latest revision marked as "Current"

**Acceptance criteria:**
- [x] History button on content block cards
- [x] Revision list loads in drawer
- [x] Full revision content viewable
- [x] Restore works and refreshes content block list
- [x] Empty state if no revisions yet

**Status:** [x] Done — Added history button on content blocks, revision side drawer with loading/empty/error handling, full snapshot viewer, and restore action wired to revision restore API with content list refresh.

---

## FRONTEND PHASE 4 — Feedback Loop UI
> Aligns with: Backend Phase 4 (StudentResponse, QuestionStats, reuse tracking)
>
> Goal: Surface real difficulty, student response entry, and question reuse warnings.

---

### Task F4.1 — Real Difficulty Badge on Question Cards
**Page:** `QuestionsPage.jsx`
**Trigger:** Backend Task 4.1 (QuestionStats.real_difficulty)

Update the difficulty display to show both stated and real difficulty.

**UI behavior:**
- Current difficulty badge remains (manual label)
- If `stats.real_difficulty` is set: add a second badge "Real: Medium" based on computed value
- Tooltip on real difficulty badge: "Based on N student attempts"
- If real ≠ stated difficulty: show a small warning icon "Difficulty mismatch"

**Acceptance criteria:**
- [x] Real difficulty badge appears where stats exist
- [x] Tooltip shows attempt count
- [x] Mismatch warning icon renders when real ≠ stated
- [x] No badge shown if stats not yet computed (no empty UI)

**Status:** [x] Done — Added Real difficulty badge on question cards using `real_difficulty`, attempt-based tooltip text, mismatch warning indicator, and conditional rendering only when real stats exist.

---

### Task F4.2 — Question Reuse Warning in Paper Builder
**Page:** `QuestionPaperBuilderPage.jsx`
**Trigger:** Backend Task 4.2 (paper_use_count on Question)

Warn when overused questions are added to a paper.

**UI behavior:**
- When adding a question from the question bank picker, show a warning chip if `paper_use_count >= 3`: "Used in 3+ papers"
- In the paper question list, questions with high reuse show an amber warning badge
- `GET /api/examinations/exam-papers/{id}/` returns `overused_questions` — highlight these in the paper view

**Acceptance criteria:**
- [x] Warning chip visible in question bank picker for overused questions
- [x] Warning badge on paper question list for overused items
- [x] Warning does not block adding the question — it's informational only
- [x] Count shown accurately ("Used in 4 papers")

**Status:** [x] Done — Added overuse warning chips in the Question Bank picker and amber badges in manual paper question list using `paper_use_count` and draft `overused_questions` payload, without blocking question selection.

---

### Task F4.3 — Student Response Entry UI
**Page:** New page or modal — `StudentResponsePage.jsx` or within ExamPaper detail
**Trigger:** Backend Task 4.1 (StudentResponse model)

Basic UI for entering student responses after an exam.

**UI behavior:**
- Select ExamPaper → loads question list
- For each question: student name/ID selector + marks awarded input
- MCQ: show options, click correct/incorrect
- Subjective: marks input (0 to max marks)
- Submit all: `POST /api/examinations/student-responses/` bulk endpoint
- Progress indicator: "N of M students entered"

**Acceptance criteria:**
- [x] Paper and student selection works
- [x] Question list renders with appropriate input per type
- [x] Bulk submit works and shows success confirmation
- [x] Progress indicator updates as responses are entered
- [x] Validation: marks cannot exceed question's max marks

**Status:** [x] Done — Added `StudentResponsePage` with exam-paper question loading, class-scoped student selector, MCQ correct/incorrect controls, subjective marks entry with max-mark clamping, bulk submit to student-responses endpoint, and live entered-students progress.

---

## Agent Rules
1. Work one task at a time. Do not skip tasks within a phase.
2. Complete the corresponding **Backend Phase N** fully before starting **Frontend Phase N**.
3. Mark each checklist item `[x]` as you complete it.
4. Mark task `Status: [x] Done — <one line summary>` when complete.
5. Mark `Status: [!] Blocked — <reason>` if blocked, then move to next task.
6. Use React Query for all API calls — match the existing pattern in the codebase.
7. Use Tailwind CSS only — no new UI libraries.
8. All new UI elements must handle: loading state | empty state | error state.
9. Toast notifications on all create/update/delete actions — match existing toast pattern.
10. Do not refactor existing working components — only extend them.
