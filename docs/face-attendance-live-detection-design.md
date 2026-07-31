# Face Attendance — Live Detection Design (Tier A/B, with Tier C fallback)

Status: **Phases 1–3.5 implemented and verified.** This document was originally a design-only pass; it's now been updated to reflect what actually shipped, where implementation deviated from the original design, and what remains as backlog. Treat §10 below as the current source of truth for status — sections 1–9 are the original design reasoning and are largely still accurate, but check §10 first for anything that changed during implementation.

## Implementation status (added post-design)

| Phase | Scope | Status |
|---|---|---|
| 1 | pgvector migration — `embedding_vector` column, dual-write, matcher rewritten to pgvector `L2Distance` query, thresholds keyed by `embedding_version` | ✅ Done, verified |
| 2 | Tier B backend — `FaceCaptureDevice`, `FaceLiveDetectionEvent`, device-key auth, `live/match/` endpoint, on-prem Docker service | ✅ Done, verified |
| 2.5 | Tier B frontend — real tier gating (`FaceTierRoute` replacing dead `CapabilityRoute`), device list/status page, live-events log | ✅ Done, verified |
| 3 | Tier A — face-api.js live capture, `faceapi_v1` enrollment, JWT auth on `live/match/`, teacher-level permissions | ✅ Done, verified |
| 3.5 | Retention policy — `FaceLiveDetectionEvent` purge job, `cleanup_old_face_sessions` finally scheduled | ✅ Done, verified |
| 3.6 | `faceapi_v1` threshold data collection — `FaceMatchThresholdSample`, operator feedback endpoint + UI, Tier A only | ✅ Done, verified — **tooling only, no threshold values changed yet, see below** |

See §10 for full details, deviations from the original design, and what's still open.

## 0. Scope recap

Current production behavior (**Tier C**, unchanged by this design): teacher/admin snaps one group photo → uploads to Supabase → Celery pipeline runs `face_recognition`/dlib detection+matching → admin reviews/confirms → `AttendanceRecord`s written. Live in production for The Focus Montessori. **Not being touched.**

New behavior being designed:
- **Tier A — mobile browser**: teacher/guard opens a page on their phone, live camera preview, face detection + embedding extraction runs **client-side in JS**. Only `{embedding vector, timestamp}` is sent to Django — never image/video.
- **Tier B — fixed IP camera**: school-owned camera on school LAN. An on-prem process does local detection + embedding extraction, POSTs only `{embedding vector, timestamp}` to Django. Video never leaves the school network, never touches Render.
- Django stays lightweight in both: receive a vector, match against that school's enrolled students via pgvector, apply dedup, write `AttendanceRecord`. No image processing, no Celery pipeline, no stream handling on the backend.
- Additive only — Tier C keeps working exactly as today for schools that don't opt into A/B.

---

## 1. Embedding compatibility — the core constraint

`StudentFaceEmbedding.embedding` today is a 128-d **dlib** descriptor (`embedding_version='dlib_v1'`), produced by `face_recognition.face_encodings()`. A browser-JS model produces vectors from a *different, numerically incomparable* space — same dimensionality is not the same as same meaning. Mixing them in a distance query would silently produce garbage matches.

### Key design decision: don't force one model across both new tiers

The user's example framed Tier B as "Python, same client-side-equivalent detection." Recommendation: **Tier B should run Python with the existing `face_recognition`/dlib stack** — the exact library already proven in production for Tier C — rather than a new JS/Node runtime on-prem. Consequence: **Tier B produces `dlib_v1` embeddings**, wire-compatible with every enrollment a school already has from the group-photo flow. A school that only adds Tier B needs **zero re-enrollment**.

Tier A cannot run dlib in a browser (native C++/CMake dependency), so it needs a JS-native model:

**Recommendation: face-api.js**, specifically its face-recognition ResNet model (128-d descriptor, TensorFlow.js-based). Justification:
- It's the only mature, actively-used browser-native library that ships a dedicated *identity* embedding model (not just landmarks/mesh). MediaPipe's Tasks API (Face Detector, Face Landmarker) does face detection and geometry (landmarks/blendshapes) but has no first-party *recognition/identity embedding* task comparable to FaceNet/dlib — it solves a different problem (AR/mesh), not "is this the same person."
- Same 128-dim output shape as dlib, which keeps the `VectorField` schema uniform (see §2), even though the two spaces are not interchangeable.
- Runs fully client-side via WebGL/tfjs — satisfies "raw video never leaves the device."
- Mature enough to also run in Node.js (via `@tensorflow/tfjs-node`) if a future non-browser JS ingestion path is ever needed — kept as an option, not required now.

New embedding version tag: `embedding_version='faceapi_v1'`. Its introduction is purely additive.

### Multi-version enrollment

A student **can and, for mixed-tier schools, will** have more than one `StudentFaceEmbedding` row simultaneously — one per `embedding_version` that's active for their school. Matching always filters by the incoming event's declared `embedding_version` before computing distance, so cross-space comparison is structurally impossible, not just discouraged by convention.

| School's enabled tiers | Embedding rows a student needs |
|---|---|
| Tier C only (today's default) | `dlib_v1` only — nothing changes |
| Tier C + Tier B | `dlib_v1` only — Tier B reuses it |
| Tier A added | `dlib_v1` **and** `faceapi_v1` — one extra guided re-enrollment pass required |

This is the main rollout lever: **adding Tier B is a zero-re-enrollment upgrade; adding Tier A is a one-time re-enrollment campaign.** Worth stating explicitly to whoever prioritizes rollout order.

---

## 2. pgvector migration

pgvector is already a first-class dependency here (`pgvector==0.4.1`, `'pgvector.django'` in `INSTALLED_APPS`, extension already enabled and exercised by `lms.ContentBlock.embedding` / `lms.Topic.embedding` / `examinations.Question.embedding`, all `VectorField(dimensions=1536, ...)` matched via `CosineDistance` in `lms/views.py` and `examinations/views.py`). `face_attendance` is the odd one out — it still does brute-force Python distance over `BinaryField` bytes. This migration brings it in line with the rest of the codebase, not a novel pattern.

### Schema change (expand/contract, two migrations)

**Migration 1 (additive, safe):**
- Add `StudentFaceEmbedding.embedding_vector = VectorField(dimensions=128, null=True)` alongside the existing `embedding = BinaryField`.
- Data-migration step: for every existing row (all currently `dlib_v1`), `np.frombuffer(row.embedding, dtype=np.float64)` → cast to `float32` → write into `embedding_vector`. Idempotent, re-runnable, no downtime.
- Leave `FaceDetectionResult.embedding` (the per-detection debug/reprocess copy) as-is — it's never queried/searched, only kept for audit; migrating it buys nothing.

**Migration 2 (contract, later, after Tier B/A are validated in prod):**
- Drop the old `embedding` `BinaryField` from `StudentFaceEmbedding` once nothing reads it.
- `EmbeddingService.store_embedding()` and `matcher.py` get rewritten to read/write only `embedding_vector`.

### New matching query shape (school- and class-scoped, version-filtered)

Same pattern already used in `lms/views.py:1069` / `examinations/views.py:2514`, applied here:

```
StudentFaceEmbedding.objects
    .filter(school=school, is_active=True, embedding_version=event.embedding_version)
    .filter(student__in=class_roster_student_ids)          # keep today's class-scoping rule
    .annotate(distance=L2Distance('embedding_vector', incoming_vector))
    .order_by('distance')
```

- **Distance metric**: `L2Distance`, not `CosineDistance` — the current thresholds (`HIGH=0.40`, `MEDIUM=0.55`) are calibrated to `face_recognition.face_distance`'s Euclidean convention. Keep them meaningful for `dlib_v1` by keeping the metric L2. `faceapi_v1` may warrant its own metric/thresholds (face-api.js's own docs recommend Euclidean too, but this should be empirically validated during Tier A rollout, not assumed).
- Thresholds become a lookup keyed by `embedding_version` (see §7) rather than a single global dict, since two incompatible embedding spaces will not share one meaningful threshold.
- **ANN index (HNSW/IVFFlat)**: recommend *not* adding one initially. Matching is already class-scoped (typically tens of students), so the filtered candidate set is tiny — brute-force distance over ≤~40 rows is not a real cost. Adding an index now would be premature optimization for a table where the `WHERE` clause, not the vector search, is what makes it fast. Flagged as an explicit open question in §9 in case school size assumptions turn out wrong (e.g. whole-school Tier B matching, not just one class).

---

## 3. New models

### `FaceAttendanceSchoolConfig` — the real feature flag

Important context: the frontend's existing `<CapabilityRoute module="attendance" capability="face_recognition">` wrapper around `/face-attendance/*` is **currently a dead pass-through** — `frontend/src/App.jsx:253` — a leftover from an entitlements system that was removed 2026-05-13 in favor of flat pricing (`backend/core/module_registry.py:110-118`). Today there is effectively **no per-school gate** on this feature besides being logged into a school where the `attendance` module is on. This model becomes the real, backend-owned gate that `CapabilityRoute` should have been.

- `school` — OneToOne → `schools.School`
- `tier_a_enabled`, `tier_b_enabled` — bool, default `False`
- `tier_c_enabled` — bool, default `True` (preserves current behavior for every existing school with zero migration risk)
- `live_window_start`, `live_window_end` — nullable `TimeField`; the "arrival window" during which live tiers are expected to run (semantics — hard gate vs. soft label — is an open question, §9)
- `threshold_overrides` — nullable `JSONField`, keyed by `embedding_version`; falls back to the global default table in settings when absent (§7)
- timestamps

### `FaceCaptureDevice` — Tier B device registry

On-prem devices have no human user session, so they need a narrower credential than the JWT+`X-School-ID` scheme used everywhere else.

- `school` FK
- `name` (e.g. "Front Gate Camera")
- `device_id` — UUID, unique, used as the device's identity
- `api_key_hash` — hashed device credential (same pattern as hashing a token, not stored plaintext), sent as a request header (e.g. `X-Device-Key`) by the on-prem process
- `is_active`
- `embedding_version` — fixed per device (a device always emits one model's vectors; avoids a device needing to declare it per-request)
- `last_seen_at` — heartbeat, updated on every successful ingest, used for a simple "camera offline" admin signal
- `created_by`, `created_at`

Requires a new narrow DRF authentication class (device-key → `FaceCaptureDevice`, scoped only to that school and only to the live-ingest endpoint) — this is new auth surface, not a reuse of `IsSchoolAdmin`/JWT, and should get its own security review before building.

### `FaceLiveDetectionEvent` — the event-stream model

Distinct from `FaceAttendanceSession` on purpose: a session is "one processed photo," this is "one match attempt in a continuous stream." Shaped for high write volume during an arrival window, not for one-row-per-review-item.

- `id` — UUID
- `school` FK, `class_obj` FK (nullable for Tier B if the device isn't scoped to one class — see open question §9)
- `source_tier` — `TIER_A` / `TIER_B`
- `device` FK (nullable, Tier B only) / `captured_by` User FK (nullable, Tier A only — the teacher/guard holding the phone)
- `embedding_version`
- `client_timestamp` (device/browser clock) + `received_at` (server clock) — both, for latency/clock-skew debugging
- `matched_student` FK (nullable), `confidence`, `distance`, `match_status` — reuses the existing `AUTO_MATCHED / FLAGGED / IGNORED` vocabulary from `FaceDetectionResult` for consistency across the two paradigms
- `resulted_in_attendance` — bool; `True` only for the one event per `(student, date)` that actually wrote/updated the `AttendanceRecord` (see dedup, §4) — every later same-day sighting is logged but flagged `False`, so the audit trail stays complete without implying duplicate writes
- `attendance_record` FK (nullable) — traceability back to the record it caused
- Raw vector is **not stored by default** (storage cost + biometric-data-retention exposure at high write volume — see §9); only retained on `FLAGGED`/no-match events, and only if a retention policy explicitly says so

Indexes: `(school, class_obj, client_timestamp)`, `(school, matched_student, client_timestamp)`, `status`.

No separate "window" model — window boundaries are read from `FaceAttendanceSchoolConfig.live_window_start/end` at ingest time rather than modeled as their own row. Simpler, and avoids a second start/stop lifecycle to manage; revisit only if reporting ever needs to group events into named sessions.

---

## 4. API contract

New namespace, kept separate from `sessions/` so the two paradigms (batch-photo vs. streaming-event) don't get tangled in one viewset:

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/face-attendance/live/match/` | JWT (Tier A) or device key (Tier B) | Body: `{embedding, embedding_version, class_id?, timestamp, source_tier}`. Runs the pgvector query (§2), applies dedup (below), returns `{match_status, student, confidence, event_id, attendance_marked}` |
| `GET /api/face-attendance/live/events/?date=&class_id=&status=` | JWT, admin/teacher | Audit/troubleshooting list — mirrors `sessions/` list shape but event-shaped; primarily useful for "who got detected but not matched" during Tier A onboarding |
| `GET /api/face-attendance/status/` (extended, not new) | JWT | Add tier availability/config for the current school to the existing response |
| `POST /api/face-attendance/enroll/` (extended, not new) | JWT, admin/teacher | Accepts either today's `{student_id, image_url}` (unchanged, dlib/Celery path) **or** a new `{student_id, embedding, embedding_version, quality_score}` shape (synchronous, no Celery needed — there's no server-side detection work left once the browser already extracted the vector) |

### Dedup logic — reused, not reimplemented

Today's per-day/class-scoped/conflict-resolution rules live inline in `FaceAttendanceSessionViewSet.confirm()`:
- `AttendanceRecord.unique_together=('student','date')` + `update_or_create` (idempotent per-day write)
- class-scoped matching only
- "prefer false negatives over false positives" conflict resolution when two candidates tie

Recommendation: extract the "resolve a candidate match into an idempotent `AttendanceRecord` write" step into a shared service function, called by both `confirm()` (Tier C) and `live/match/` (Tier A/B). Without this, the per-day-uniqueness and conflict-resolution logic will exist in two places and drift. This is a refactor-for-reuse point to plan for, not something to build today.

Streaming-specific addition: because Tier A/B can fire many events per person per window (someone lingering in frame), `live/match/` must short-circuit — only the *first* `AUTO_MATCHED` event per `(student, date)` triggers the `AttendanceRecord` write; every subsequent same-day match for that student is logged (`resulted_in_attendance=False`) and returns immediately without a DB write to the attendance table. Client-side debouncing (only POST on a newly-tracked face, or at most every few seconds per face) is also expected on the capture side to keep event volume sane — a Tier A/B client implementation concern, not something this document specifies further.

---

## 5. Enrollment flow changes

Today: photo → Supabase upload → Celery → dlib detect+embed → `StudentFaceEmbedding(dlib_v1)`. **Unchanged for Tier C-only schools.**

New, additive path for `faceapi_v1`:
1. Guided capture UI (same UX shape as today's `FaceEnrollmentPage` — class → student → photo), but the capture step runs face-api.js **in the browser**, same library/model as Tier A live matching, guaranteeing enrollment and live-matching embeddings live in the same space by construction (no separate "did the enrollment pipeline drift from the matching pipeline" risk).
2. Browser computes the 128-d vector (and a quality score, from the same size/blur-style heuristics used server-side today) client-side, then `POST /enroll/` with `{student_id, embedding, embedding_version: 'faceapi_v1', quality_score}`. Optionally still upload the source photo for admin audit/manual review purposes only — never used for matching.
3. Endpoint becomes synchronous (no Celery dispatch needed for this path) since detection already happened client-side.
4. `enrollments/` list UI needs a version indicator per row (a student may show up twice — once per active embedding_version for their school) instead of assuming one embedding per student.

Rollout tool worth planning for (not required for an MVP): a bulk "re-enroll all students for Tier A" admin flow, since every existing school adopting Tier A needs a one-time re-capture pass across their whole roster.

---

## 6. Multi-tenancy and rollout

Because the capability/entitlements system was removed in favor of flat pricing, **there is no existing mechanism to gate a new paid/opt-in capability per school** — `enabled_modules` is coarse (whole-module on/off, e.g. "attendance"), and `CapabilityRoute` no longer does anything. `FaceAttendanceSchoolConfig` (§3) is therefore not just a data model, it **is** the feature-flag mechanism for this rollout, and probably the template for any future per-school-opt-in feature now that the old capability registry is gone — worth naming explicitly since this is a small architectural gap the removal left behind.

Rollout mechanics:
- Every school gets a `FaceAttendanceSchoolConfig` row (migration creates one per existing school) with `tier_c_enabled=True, tier_a_enabled=False, tier_b_enabled=False` — **identical behavior to today**, no visible change, no re-enrollment, no risk to The Focus Montessori's live usage.
- Frontend: replace the dead `CapabilityRoute` wrapper on `/face-attendance*` with a real check against the config (surfaced via the extended `status/` response), and add new routes (`/face-attendance/live`, a Tier A capture page) gated on `tier_a_enabled`.
- Backend: `required_module='attendance'` stays as the coarse gate, unchanged; tier flags are the fine-grained gate, checked inside the new live-match/enroll code paths only.
- Suggested build order, independent of this document's structure: (1) pgvector migration + dual `embedding_version` support first — invisible to users, matching stays dlib-only, de-risks the storage layer; (2) Tier B next — lowest incremental risk since it reuses the existing dlib embedding space and requires no re-enrollment; (3) Tier A last, once B is validated, since it's the one requiring a re-enrollment campaign and a new client-side model.

---

## 7. Threshold configuration — global default + per-school override

`FACE_RECOGNITION_SETTINGS` (`backend/config/settings.py:597-618`) is currently one global dict. Recommendation: keep a global **default table keyed by `embedding_version`** (since `dlib_v1` and `faceapi_v1` will not share meaningful thresholds — different models, different score distributions), and let `FaceAttendanceSchoolConfig.threshold_overrides` optionally override per school when a specific site's camera/lighting/hardware genuinely needs it. Default-global-with-opt-in-override, not mandatory-per-school-config — most schools should never need to touch this, and forcing every school through a threshold-tuning step at onboarding would be unnecessary friction for the common case.

---

## 8. Permissions — closing gaps the investigation surfaced

- **`CanConfirmAttendance` is imported in `views.py` but never used** in any `permission_classes` — today everything on `sessions/`/`enrollments/` is `IsSchoolAdmin`-only, admin-only even for teachers. Recommendation: Tier A specifically should allow `CanConfirmAttendance`/`CanUploadAttendance` (admin **and** teacher), because the entire premise of Tier A is a teacher or gate guard using their own phone at drop-off — restricting it to school-admin-only would defeat the feature (an admin isn't standing at the gate every morning). Tier B has no human operator per event (device-key authenticated), so its permission model is orthogonal to roles entirely. **Tier C stays admin-only, unchanged** — no reason to loosen something already working as designed.
- **`cleanup_old_face_sessions` exists (`tasks.py:48-61`) but was never registered in `CELERY_BEAT_SCHEDULE`.** Recommend fixing this regardless of this project, and — more importantly — designing an equivalent retention/purge task for the new `FaceLiveDetectionEvent` table from day one, not after the fact. Continuous capture during arrival windows will generate order-of-magnitude more rows per school per day than the current photo-session flow ever did; unbounded retention here is a much bigger problem than the existing unscheduled cleanup task.
- Biometric data retention is worth flagging as a decision this document does not make: schools are handling children's biometric identifiers (face embeddings), and depending on jurisdiction that may carry data-protection obligations beyond ordinary attendance data. A retention/anonymization policy for `FaceLiveDetectionEvent` (and re-confirming the existing policy, if any, for `StudentFaceEmbedding`) should be decided before Tier A/B ship, not left as an engineering default.

---

## 9. Open questions / tradeoffs requiring a decision before implementation

*(Original list, kept for history. See §10 for which of these are now resolved.)*

1. **Tier B runtime choice.** This document recommends Python + the existing `face_recognition`/dlib stack (reuses the current embedding space, zero re-enrollment) over a from-scratch JS/Node on-prem service. Tradeoff: dlib has a native/CMake build that's historically painful to package for a non-technical school's on-prem mini PC. Needs a packaging decision (Docker image? PyInstaller binary? prebuilt wheel + install script?) before this is buildable — not resolved here.
2. **face-api.js model weight size (~6MB+)** loaded in-browser on a teacher's phone — fine on wifi, worth flagging for schools with poor connectivity or metered data.
3. **Event audit-trail depth.** Should every live-detection event be retained indefinitely for audit, or purged aggressively? Directly affects storage cost and biometric-data-retention exposure (§8). Needs an explicit policy decision, not just an engineering default.
4. **Tier B device onboarding.** Does `FaceCaptureDevice` get a self-service pairing/registration flow now, or is it fine to create rows manually via Django admin for an initial pilot rollout? Affects how much of §3's device model needs a UI built alongside it.
5. **pgvector ANN index.** This document recommends *not* adding an HNSW/IVFFlat index initially, since class-scoped candidate sets are small (tens of rows) and the `WHERE` filter, not vector search, dominates cost. Revisit if Tier B ever needs to match against a whole-school roster rather than one class at a time (e.g. an entrance camera that doesn't know which class the student belongs to until after matching).
6. **Live-window enforcement semantics.** Is `FaceAttendanceSchoolConfig.live_window_start/end` a hard server-side gate (events outside the window are rejected) or a soft label (events outside the window still process normally, just get tagged as a late arrival in reporting)? Changes both the API contract's error behavior and how "late" is reported downstream.
7. **Tier B class scoping.** Can one fixed camera cover multiple classes (e.g. a school entrance seeing every student), meaning matching would need to search the whole school's roster rather than one class — which changes both the candidate-set size assumption in §2/§9.5 and the `FaceLiveDetectionEvent.class_obj` nullability in §3?

---

## 10. Implementation reality — what shipped, resolutions, deviations, and remaining backlog

### §9 open questions — resolved

1. **Tier B runtime/packaging** → resolved: Python + `face_recognition`/dlib as designed, packaged as a **Docker image** (decision made explicitly before Phase 2's prompt, not left to the agent).
4. **Tier B device onboarding** → resolved: manual Django-admin row creation for pilot, as the design doc's own lower-risk option suggested. No self-service pairing UI built. `FaceCaptureDeviceViewSet` (added in Phase 2.5) is list/retrieve/partial_update only — create/delete still admin-only, by design.
7. **Tier B class scoping** → resolved: **both modes supported**, configurable per device (`scope_type`: `CLASS` / `SCHOOL`), not one or the other. `FaceLiveDetectionEvent.class_obj` is nullable, populated only for `CLASS`-scoped devices.
3. **Event audit-trail depth / retention** → resolved in Phase 3.5: `FaceLiveDetectionEvent` rows are purged **48 hours** after creation, regardless of `resulted_in_attendance` — retained only as long as needed for same-day dedup and admin troubleshooting. `AttendanceRecord` (the permanent outcome) is untouched by this purge. Configurable via `FACE_RECOGNITION_SETTINGS['LIVE_EVENT_RETENTION_HOURS']`. `cleanup_old_face_sessions` (pre-existing, previously unscheduled) was registered in `CELERY_BEAT_SCHEDULE` alongside the new purge task in the same phase.
2. **face-api.js model weight size** → not mitigated, only implemented as-is (~6.7MB, tiny face detector + landmark68 + recognition ResNet fetched into `public/models/`). Loading-state UI exists on the capture page. No CDN/lazy-optimization work done — acceptable for now, revisit if schools report poor-connectivity issues in practice.

### §9 open questions — still genuinely open

5. **pgvector ANN index** — not added, as originally recommended (candidate sets still small enough that brute-force is fine). Revisit only if a `SCHOOL`-scoped Tier B device's whole-roster matching becomes a real school's default at meaningful scale.
6. **Live-window enforcement semantics** (hard gate vs. soft label) — **not resolved during Phase 1–3.5**. `FaceAttendanceSchoolConfig.live_window_start/end` fields exist but enforcement behavior was never explicitly decided or implemented. Still open.

### Consent — resolved outside the original §8/§9 framing

Design doc §8 flagged biometric consent as a decision needed before Tier A/B shipped. Resolution (made explicitly, Phase 3.5): **guardian consent is assumed present by default for every school**, handled contractually/administratively by the school itself — EducationAI does not capture, track, or gate on per-student consent. No consent model/field/UI was built, intentionally.

### Deviations from the original design (discovered/decided during implementation — not just gaps)

- **`source_tier` is not client-supplied.** The original API contract (§4) had the client declare `source_tier` in the `live/match/` payload. Implementation instead **derives it from which auth path succeeded** (device-key → Tier B, JWT → Tier A) so a caller can't misdeclare itself. This is a security-motivated deviation, worth keeping.
- **Teacher permission scoping is tighter than "any teacher."** §8 recommended `CanConfirmAttendance` for Tier A generally; the shipped version additionally requires a teacher to be **the assigned class teacher** for the `class_id` they submit (reusing `get_teacher_class_scope`), and admins can go whole-school. This wasn't explicit in the original design but is a reasonable tightening.
- **`faceapi_v1` thresholds are unvalidated.** Phase 3 shipped with `faceapi_v1` reusing `dlib_v1`'s threshold numbers as a placeholder, explicitly commented as such. §2's own text flagged this needs empirical validation once real data exists — **still needs to happen**, now that Tier A is live and generating real match data.

### Known pre-existing gaps surfaced along the way (not caused by this project, still unresolved)

- **`ModuleAccessMixin`/`request.tenant_school` is `None` for pure-JWT requests** — `TenantMiddleware` only populates it for session-authenticated requests, silently skipping the module gate for JWT-only calls. App-wide, pre-existing, not fixed. Tier A's own module check was routed around it via `ensure_tenant_school_id` (an existing documented workaround), but the underlying mixin issue remains for any other JWT-only endpoint.
- **`AcademicYearProvider`/`BackgroundTaskProvider` missing from `test/utils.jsx`'s `renderWithProviders`** — pre-existing, breaks several face-attendance test files independent of this work, confirmed via `git stash` at Phase 2.5. Worked around per-file with `vi.mock` where it blocked new tests; the underlying shared test-infra gap was never fixed.
- **5 stale test assertions** in `FaceEnrollmentPage.test.jsx`/`FaceAttendancePage.test.jsx` asserting old `"Select class..."` placeholder text that no longer matches `ClassSelector`'s actual behavior (`"All Classes"` for non-teacher roles). Disclosed, not fixed — cosmetic test debt.

### Remaining backlog (not yet started)

- **`faceapi_v1` threshold tuning — analysis phase.** Data-collection tooling shipped in Phase 3.6 (`FaceMatchThresholdSample`, operator ✓/✗ feedback on Tier A matches). No threshold values have been changed — this is now a **waiting-then-analyzing** task, not a build task: needs a real accumulation period (days-to-weeks, however long it takes to get enough labeled samples across enough students/lighting conditions at whichever school is piloting Tier A) before a threshold-recommendation pass makes sense. Revisit once sample volume looks meaningful, not on a fixed calendar date.
- **Bulk re-enrollment tool** — explicitly deferred through every phase. Needed once a school with an existing roster wants to adopt Tier A without one-by-one guided capture per student.
- **Live-window enforcement semantics** (§9.6) — undecided, not implemented either way.
- **pgvector ANN index** (§9.5) — revisit if/when whole-school Tier B matching is used at real scale.
- **`ModuleAccessMixin` JWT gap** — app-wide fix, out of scope for face-attendance specifically but worth its own cleanup pass.
- **Stale `ClassSelector` test assertions** — cheap fix, low priority, cosmetic.
- **Tier B feedback loop** — Phase 3.6 deliberately scoped feedback collection to Tier A only (dlib/Tier B thresholds are already production-validated from Tier C's prior usage, lower priority). Not started; revisit only if Tier B accuracy becomes a live concern.