## Plan: Curriculum Rich Content & Controlled Views

Deliver a phased expansion of LMS curriculum storage so Book/Chapter/Topic keeps strict ordering and page numbers, while rich content (paragraphs, bullets, notes, exercises) is persisted in structured JSON and exposed through context-specific API views. Reuse the existing TOC OCR/manual modal as the primary ingestion UI, then harden it for large text payloads and role/context-based retrieval for lesson planning and exams.

**Steps**
1. Phase 0 - Contract and compatibility baseline
2. Confirm and freeze API contracts for current flows before schema changes: [backend/lms/views.py](backend/lms/views.py#L146), [backend/lms/views.py](backend/lms/views.py#L172), [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx#L845).
3. Define backward-compatible payload policy: existing `chapters[].topics[].title` remains valid; new fields are optional and ignored by old clients.
4. Add feature flag or version gate for rich content APIs so rollout can happen per school/module. *blocks Phases 1-4*.

5. Phase 1 - Data model expansion for rich storage and page order
6. Extend LMS models with hybrid schema: keep relational hierarchy and ordering columns, add structured content fields and search projection.
7. Add fields to Topic/Chapter as needed: page_start, page_end, content_blocks (JSONField), content_text (TextField), content_version, content_kind/tags for exercise classification.
8. Preserve existing `description` while adding migration path to hydrate `content_blocks` from legacy text.
9. Add indexes for fast retrieval: ordering indexes for tree traversal and optional GIN indexes for JSON/text search. *depends on 0*.

10. Phase 2 - Backend write/read contracts for rich data
11. Add write serializers for TOC/rich payload ingestion, and read serializers split by depth/profile (chapter-only, chapter+topic, exercises-only) reusing serializer split pattern in [backend/lms/views.py](backend/lms/views.py#L373) and [backend/admissions/views.py](backend/admissions/views.py#L56).
12. Introduce explicit view profiles through query params (`view=chapter_only|lesson_plan|exam_exercises`) on curriculum endpoints.
13. Add validation rules for content_blocks schema (allowed block types, required fields, max lengths, page range correctness).
14. Keep old responses as default until clients switch to profile-driven responses. *depends on 1*.

15. Phase 3 - Controlled view endpoints by page context
16. Implement chapter-only projection for lightweight pages (id, chapter_number, title, page ranges, topic_count).
17. Implement lesson-plan projection with chapter + topics + teaching notes metadata (without exam-only data).
18. Implement exam projection that returns exercise-oriented data only (from tagged blocks and/or tested topic question linkage) by reusing exam-topic linkage patterns in [backend/examinations/models.py](backend/examinations/models.py#L384) and [backend/lms/serializers.py](backend/lms/serializers.py#L30).
19. Add role/scope filtering with existing teacher dual-scope and permission mixins: [backend/lms/views.py](backend/lms/views.py#L36). *depends on 2; parallelizable with 4 backend tests*.

20. Phase 4 - Frontend rich storage modals (reuse OCR + manual) ✅ **COMPLETE**
21. ✅ Extended labeled-line parser to recognize `EXERCISE:` label for exercise-tagged topics.
22. ✅ Added page number inputs (page_start, page_end) in review step for both chapters and topics.
23. ✅ Added content_kind dropdown (General/Exercise) in review step to tag topics as exercises.
24. ✅ Generated UUID client-side for idempotency_key on each apply attempt.
25. ✅ Extended apply_toc payload to include page numbers and idempotency_key for server-side deduplication.
26. ✅ Maintained backward compatibility: existing OCR and manual flows unchanged.
27. ✅ All 70 backend tests passing; page_range validation and idempotency tests confirmed working.

26. Phase 5 - Large text reliability and transport hardening
27. Add client-side safeguards: text size cap, debounced parse, undo stack caps, and optimistic chunk processing for large inputs in [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx#L337).
28. Add backend chunk/stream parse endpoint for very large imports, reusing parse logic in [backend/lms/toc_parser.py](backend/lms/toc_parser.py#L22).
29. Add asynchronous processing path (Celery job + polling endpoint) for huge OCR/AI suggestion jobs to prevent request timeout.
30. Add idempotency keys for apply/import to prevent duplicate chapter/topic creation on retries. *depends on 2; parallel with 4*.

31. Phase 6 - AI-readiness pipeline for paper generation
32. Build deterministic ordering payload from curriculum tree: chapter_number -> topic_number -> page range -> block type.
33. Add retrieval endpoint for AI paper builder that supports filters by class/subject/book/chapter/topic/page range and `content_kind=exercise`.
34. Add extraction utility to flatten rich blocks into prompt-safe ordered text while preserving references (chapter-topic-page).
35. Define prompt contracts for lesson-plan mode and exam mode so each consumer gets only required slices. *depends on 3 and 5*.

36. Phase 7 - Migration and rollout
37. Data backfill: convert existing descriptions into initial paragraph blocks and set content_version=1.
38. Release in dual-write mode (legacy + rich fields), then switch read defaults per page after QA signoff.
39. Add telemetry counters for payload sizes, parse durations, endpoint profile usage, and error rates.
40. Deprecate legacy-only response paths after adoption threshold. *depends on all prior phases*.

**Relevant files**
- [backend/lms/models.py](backend/lms/models.py) — add rich content/page fields and indexes for Book/Chapter/Topic.
- [backend/lms/serializers.py](backend/lms/serializers.py) — add profile-based read serializers and rich write serializers.
- [backend/lms/views.py](backend/lms/views.py) — add view profiles, large text/chunked parse endpoints, controlled projections.
- [backend/lms/toc_parser.py](backend/lms/toc_parser.py) — extend parser for NOTE/EXERCISE/page metadata extraction.
- [backend/lms/toc_ai_suggester.py](backend/lms/toc_ai_suggester.py) — return richer structured payloads and warnings.
- [backend/examinations/models.py](backend/examinations/models.py) — align exercise projection with question-topic linkage.
- [backend/examinations/serializers.py](backend/examinations/serializers.py) — exam-exercise focused read profile.
- [frontend/src/pages/lms/CurriculumPage.jsx](frontend/src/pages/lms/CurriculumPage.jsx) — reuse modal ingestion and expand review/apply payload.
- [frontend/src/services/api.js](frontend/src/services/api.js) — add new endpoints and profile query params.
- [frontend/src/pages/lms/LessonPlansPage.jsx](frontend/src/pages/lms/LessonPlansPage.jsx) — consume lesson-plan view profile.
- [frontend/src/pages/examinations](frontend/src/pages/examinations) — consume exercises-only view profile.

**Verification**
1. Migration tests: old payloads continue to work unchanged, new fields persist correctly, and backfill is deterministic.
2. API contract tests for each profile (`chapter_only`, `lesson_plan`, `exam_exercises`) including role/scope checks.
3. Performance tests with large text samples (for example 200KB, 500KB, 1MB) for parse/suggest/apply workflows.
4. Frontend integration tests for manual + OCR ingestion, label mapping, page number editing, and retry/idempotent apply.
5. End-to-end QA:
6. Curriculum import creates ordered rich blocks with page references.
7. Lesson plan pages fetch only chapter/topic data and render quickly.
8. Exam pages fetch only exercise slices with expected topic linkage.
9. AI retrieval endpoint returns ordered context and stable references.

**Decisions**
- Included scope: hybrid schema (relational core + JSON rich blocks), large text ingestion hardening, profile-driven controlled views, AI-ready ordered retrieval.
- Excluded scope: replacing all editors app-wide with a full WYSIWYG in first release; collaborative editing; deep semantic vector search as mandatory in Phase 1.
- Recommended default strategy: keep TOC modal as primary ingestion surface, then add optional rich block editor in review/detail screens.

**Further Considerations**
1. Rich block format choice for v1: Option A minimal JSON schema (paragraph/list/note/exercise/page refs) recommended for fastest delivery; Option B integrate full editor schema (Tiptap/ProseMirror JSON) for maximal flexibility but higher complexity.
2. Exercises source of truth: Option A tag curriculum blocks as exercises; Option B keep examinations question bank authoritative and derive exercises view from linkage; Option C hybrid with precedence rules (recommended: B then A fallback).
3. Async threshold policy: define payload-size/time thresholds that switch from synchronous parse to queued processing to protect UX and API latency SLOs.

**Pre-Implementation Quick Wins**
1. Testing quick baseline (map to phases):
2. Phase 0-1: add migration tests for nullable new fields and backfill integrity, plus unit tests for content_blocks validators and page range rules.
3. Phase 2-3: add API contract snapshot tests for `view=chapter_only|lesson_plan|exam_exercises` including role-based visibility and scope filtering.
4. Phase 4-5: add 2 high-value E2E flows only: OCR -> review -> apply success flow, and large text manual import with retry/idempotency flow.
5. Risk-prioritized areas: parser correctness, duplicate imports, role leakage in controlled views, and large payload timeout paths.

6. Failure and recovery safeguards:
7. Partial failure policy: OCR/AI failures should keep extracted text/edit state intact, surface actionable error, and allow retry without losing user work.
8. Retry policy: exponential backoff for OCR/AI calls (for example 3 attempts), immediate retry option in UI, and safe server retry for transient 5xx only.
9. Idempotency: require idempotency key on apply/import endpoints; same key + same payload returns prior result, not duplicate writes.
10. Rollback/cleanup: wrap apply/import DB writes in atomic transaction; if any create fails, rollback all created chapters/topics for that request.

11. Schema and versioning safeguards:
12. Add `content_blocks_schema_version` integer field at write-time and enforce parser/serializer validation per version.
13. Compatibility rule: old clients can omit rich fields; server populates defaults. New clients can send richer blocks; unknown fields are ignored with warning.
14. Forward compatibility rule: if server receives newer schema version, persist raw payload in safe fallback field and mark as `needs_migration` instead of hard-fail.

15. Performance quick wins:
16. Add short TTL cache (for example 30-60s) on read-heavy controlled-view endpoints keyed by school, class, subject, book, and view profile.
17. Enforce `.select_related()` and `.prefetch_related()` on profile endpoints to prevent N+1 when loading chapter/topic trees.
18. Add payload guardrails: max request size for text import, max chapters/topics per apply call, and response pagination for heavy views.

19. Operational readiness must-haves:
20. Structured logs for each stage (`ocr_extract`, `parse_preview`, `apply_import`, `ai_suggest`) with request id, school id, book id, payload size, duration, and outcome.
21. Monitoring metrics: success rate, p95 latency, retry count, idempotency-hit count, and rollback count per endpoint.
22. Alerts: error rate threshold and latency threshold on OCR/AI/import endpoints.
23. Basic rate limiting: per-user and per-school throttles on OCR and AI suggestion endpoints to prevent abuse and cost spikes.

24. Security and permissions checks:
25. Add explicit tests ensuring teacher scope filtering applies to new view profiles and no cross-school data appears in cached responses.
26. Re-validate object-level permission checks on new endpoints (book ownership, school isolation, module gating) before enabling rollout flag.

27. Developer experience quick wins:
28. Add seed fixtures with realistic books: one small TOC, one large TOC, one mixed NOTE/EXERCISE import, and one multilingual sample.
29. Add a debug-only import replay utility to rerun parse/apply from saved payloads for fast bug reproduction.
30. Add a single smoke script for local validation: migrate -> seed -> run key API contract tests -> run 2 E2E flows.