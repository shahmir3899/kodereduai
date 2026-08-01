# Face Attendance System

Consolidated reference for the `face_attendance` Django app. Replaces the previous three separate documents (`FACE_ATTENDANCE.md`, `FACE_ATTENDANCE_PHASES.md`, `face-attendance-live-detection-design.md`), which are superseded by this file.

---

## A. What this system is about

Face-recognition attendance for classrooms, offered as three capture methods that share one data model and one matching backend. **Confirmed product decision: all three are unconditionally available to every school — there is no school-level enable/disable gate for any of them.**

- **Group Photo capture (in production).** A teacher/admin snaps one group photo on a phone or tablet, uploads it to Supabase, and a Celery pipeline detects faces, generates embeddings, matches them against that class's enrolled students, and surfaces results for human review before any `AttendanceRecord` is written. This is the original and only production-live method, used today by The Focus Montessori.
- **Live Mobile capture.** A teacher/guard opens a page on their phone; face detection and embedding extraction run **client-side in JavaScript** (face-api.js). Only a `{embedding vector, timestamp}` is sent to the backend — never an image or video frame.
- **Fixed Camera capture.** A school-owned camera on the school LAN runs an on-prem Python process (same `face_recognition`/dlib stack as Group Photo capture) that does local detection/embedding extraction and POSTs only the resulting vector to Django. Video never leaves the school network. Availability is derived purely from whether the school has an active, recently-seen `FaceCaptureDevice` — not from a flag.

Design principles that apply across all three:
- Class-scoped matching only (never cross-class), except Fixed Camera devices explicitly configured for whole-school scope.
- Prefer false negatives over false positives — low-confidence matches are flagged for review or ignored, never silently auto-marked.
- All heavy processing happens off the request path (Celery for Group Photo capture; client-side or on-prem for Live Mobile/Fixed Camera) — upload/ingest responses return in under a second.
- A human confirms Group Photo sessions; Live Mobile/Fixed Camera write directly via a dedup/first-match rule (see below) since there's no per-photo review step.
- Final output is always a standard `AttendanceRecord`, tagged with its originating capture method.
- On the frontend, `FaceAttendancePage` presents Group Photo capture and Live Mobile capture as equal, always-available tabs (with a short plain-text note under each explaining what it does); Fixed Camera capture shows only a status badge (Active/Offline) when a device is actually registered, since it's a passive on-prem stream rather than something a teacher picks per session.

### Core data model

| Model | Purpose |
|-------|---------|
| `FaceAttendanceSession` | One per Group Photo capture event. UUID PK. Status: `UPLOADING → PROCESSING → NEEDS_REVIEW → CONFIRMED / FAILED`. |
| `StudentFaceEmbedding` | Face embedding per student. Supports multiple rows per student — one per `embedding_version` (`dlib_v1`, `faceapi_v1`) active for their school. Stored in both a legacy `BinaryField` (`embedding`, scheduled for removal) and a pgvector `VectorField` (`embedding_vector`, the field actually queried). |
| `FaceDetectionResult` | One detected face within a Group Photo session image: bounding box, crop URL, match status, confidence, alternatives. |
| `FaceAttendanceSchoolConfig` | Per-school knobs that aren't simple on/off gates: `threshold_overrides`, `live_window_start/end` (semantics not yet enforced). No enable/disable flags — Group Photo and Live Mobile capture are unconditionally available; Fixed Camera capture's availability is derived from device presence, not stored here. |
| `FaceCaptureDevice` | Fixed Camera device registry: device-key credential, `scope_type` (`CLASS` or `SCHOOL`), fixed `embedding_version`, `last_seen_at` heartbeat. |
| `FaceLiveDetectionEvent` | One match attempt in a Live Mobile/Fixed Camera stream (as opposed to one reviewed photo). `source_method` records which one (`LIVE_MOBILE` / `FIXED_CAMERA`). Purged 48h after creation regardless of outcome; `AttendanceRecord` itself is untouched by the purge. |
| `FaceMatchThresholdSample` | Operator ✓/✗ feedback on Live Mobile matches, feeding future threshold tuning. Also carries a `source_method` field, kept indefinitely (not purged like `FaceLiveDetectionEvent`). |

Modified existing models: `AttendanceRecord.Source` gained `FACE_CAMERA`; `AttendanceRecord.face_session` FK added; `BackgroundTask.TaskType` gained `FACE_ATTENDANCE`.

### Group Photo capture pipeline (production)

```
Image URL (Supabase)
  → Face detection (face_recognition.face_locations, HOG model; reject 0 or >15 faces)
  → Quality filter per face (size ≥60x60, Laplacian blur variance >50.0)
  → 128-d embedding (face_recognition.face_encodings)
  → Class-scoped matching (pgvector L2Distance against that class's dlib_v1 embeddings)
  → Conflict resolution (two faces matching one student → keep lower distance)
  → Store FaceDetectionResults, upload face crops, status → NEEDS_REVIEW
```

Confidence thresholds (L2/Euclidean distance): HIGH `d<0.40` → auto-matched; MEDIUM `0.40≤d<0.55` → flagged for review; LOW `d≥0.55` → ignored. `confidence % = max(0, (1 - distance/0.6)) * 100`. Configured in `FACE_RECOGNITION_SETTINGS` (`config/settings.py`), overridable per school via `FaceAttendanceSchoolConfig.threshold_overrides`, keyed by `embedding_version`.

### Live Mobile / Fixed Camera live-match flow

`POST /api/face-attendance/live/match/` accepts `{embedding, embedding_version, class_id?, timestamp}`. Auth determines the capture method server-side (JWT → Live Mobile, device-key → Fixed Camera — deliberately not client-declared, to prevent spoofing). It runs the same pgvector query scoped by school + `embedding_version`, then applies dedup: only the first `AUTO_MATCHED` event per `(student, date)` writes an `AttendanceRecord`; later same-day matches are logged (`resulted_in_attendance=False`) but don't write again.

---

## B. Implementation status

| Phase | Scope | Status |
|---|---|---|
| Group Photo capture (original) | Group-photo capture, async Celery pipeline, teacher review, enrollment | ✅ Live in production |
| 1 — pgvector migration | `embedding_vector` column, dual-write, matcher rewritten to pgvector `L2Distance`, thresholds keyed by `embedding_version` | ✅ Done, verified |
| 2 — Fixed Camera backend | `FaceCaptureDevice`, `FaceLiveDetectionEvent`, device-key auth, `live/match/` endpoint, on-prem Docker service | ✅ Done, verified |
| 2.5 — Fixed Camera frontend | Device list/status page, live-events log | ✅ Done, verified |
| 3 — Live Mobile capture | face-api.js live capture, `faceapi_v1` enrollment, JWT auth on `live/match/`, teacher-level permissions (must be the assigned class teacher) | ✅ Done, verified |
| 3.5 — Retention | `FaceLiveDetectionEvent` 48h purge job; `cleanup_old_face_sessions` finally registered in `CELERY_BEAT_SCHEDULE` | ✅ Done, verified |
| 3.6 — Threshold data collection | `FaceMatchThresholdSample` + operator ✓/✗ feedback UI, Live Mobile capture only | ✅ Tooling shipped — **no threshold values changed yet** |
| 4 — Naming/gating cleanup | Removed all per-method enable/disable flags (confirmed: all three methods are unconditionally available); renamed the internal "tier" terminology throughout to Group Photo / Live Mobile / Fixed Camera capture, including a `source_tier` → `source_method` field rename + data migration on `FaceLiveDetectionEvent` and `FaceMatchThresholdSample` | ✅ Done, verified |

### API surface (all under `/api/face-attendance/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `upload-image/` | Upload image to Supabase → returns URL |
| POST / GET | `sessions/` | Create Group Photo session (dispatches Celery, returns immediately) / list sessions |
| GET | `sessions/{id}/` | Session detail with detections + class roster |
| GET | `sessions/pending_review/` | Sessions needing review (auto-recovers stuck ones) |
| POST | `sessions/{id}/confirm/` | Confirm → creates AttendanceRecords |
| POST | `sessions/{id}/reprocess/` | Re-run pipeline on existing image |
| POST / GET / DELETE | `enroll/`, `enrollments/`, `enrollments/{id}/` | Enroll (dlib photo path or faceapi vector path), list, soft-delete |
| GET | `status/` | Availability (`group_photo_available`, `live_mobile_available`, `fixed_camera_status`), thresholds, enrollment counts for current school |
| POST | `live/match/` | Live Mobile / Fixed Camera live match ingest |
| GET | `live/events/` | Audit/troubleshooting list of live-match events |
| GET/PATCH | `devices/` (`FaceCaptureDeviceViewSet`) | List/retrieve/partial_update Fixed Camera devices — create/delete admin-only, no self-service pairing |

### Frontend / Mobile

- Pages: `FaceAttendancePage` (`/face-attendance`, hosts Group Photo capture and Live Mobile capture as tabs plus a Sessions tab), `FaceReviewPage` (`/face-attendance/review/:sessionId`), `FaceEnrollmentPage` (`/face-attendance/enrollment`), plus Fixed Camera device/live-events pages added in phases 2.5–3.
- There is no dedicated capture-method-gating route wrapper — routing to face-attendance pages goes through the same `SchoolRoute`/`AdminPrincipalRoute` wrappers used everywhere else in the app. (An earlier draft of this doc referenced a route-gating component that does not exist anywhere in the codebase; the reference has been removed.)
- Mobile screens: `capture.tsx`, `review.tsx`, `enrollment.tsx` under `/(admin)/face-attendance/`.

### Tests

- Backend: `backend/tests/test_face_attendance_services.py` (unit, matcher/detector/embedding logic) and `backend/tests/test_face_attendance_api.py` (API integration: session CRUD, confirm, pending-review, reprocess, enrollment, status, permissions, school isolation). Live Mobile/Fixed Camera-specific coverage lives in `backend/tests/test_face_attendance_tier_a.py`, `test_face_attendance_tier_b.py`, and `test_face_attendance_retention.py` — the filenames still carry the old "tier" naming (not renamed as part of the naming cleanup, to avoid unnecessary file-history churn) but their contents use the current Group Photo / Live Mobile / Fixed Camera terminology.
- Frontend: `frontend/src/pages/face-attendance/__tests__/` covers `FaceAttendancePage`, `FaceReviewPage`, `FaceEnrollmentPage`.
- Seed data: `conftest.py`'s `seed_data` fixture (4 embeddings + 1 NEEDS_REVIEW session) and `backend/seed_test_data.py::create_face_seed_data`.

### Resolved design questions (from the original live-detection design doc)

- **Fixed Camera runtime**: Python + `face_recognition`/dlib, packaged as a Docker image (not a JS/Node on-prem service) — reuses the existing `dlib_v1` embedding space, so schools adding Fixed Camera capture need zero re-enrollment.
- **Fixed Camera onboarding**: manual Django-admin row creation for the pilot; no self-service device pairing UI.
- **Fixed Camera class scoping**: both `CLASS`- and `SCHOOL`-scoped devices supported, configurable per device.
- **Event retention**: `FaceLiveDetectionEvent` purged 48h after creation (`FACE_RECOGNITION_SETTINGS['LIVE_EVENT_RETENTION_HOURS']`); `AttendanceRecord` is permanent and untouched.
- **Consent**: guardian consent for biometric processing is assumed handled contractually by the school itself — no consent model/field/UI was built in-app, by deliberate decision.
- **`source_method` derivation**: determined from which auth path succeeded (device-key vs JWT), not client-declared — closes a spoofing gap that was in the original design.
- **Enable/disable gating**: confirmed product decision — Group Photo, Live Mobile, and Fixed Camera capture are all unconditionally available to every school. The per-method enable flags `FaceAttendanceSchoolConfig` used to carry were removed outright (not just defaulted on); Fixed Camera's availability is derived purely from `FaceCaptureDevice` presence.

---

## C. What's remaining

- **`faceapi_v1` threshold validation.** Live Mobile capture currently reuses `dlib_v1`'s threshold numbers as an explicitly-flagged placeholder — it is **not yet validated against real Live Mobile capture data**. Data-collection tooling (`FaceMatchThresholdSample`) is live and accumulating operator ✓/✗ labels, but a real threshold-recommendation pass should wait until enough samples have built up across schools/lighting/students — not a coding task, a wait-then-analyze task.
- **Bulk re-enrollment tool.** No bulk "re-enroll whole roster for Live Mobile capture" flow exists yet; every school adopting Live Mobile capture currently needs one-by-one guided re-capture per student. Deferred through every phase so far.
- **Live-window enforcement semantics.** `FaceAttendanceSchoolConfig.live_window_start/end` fields exist but it was never decided (or implemented) whether they're a hard server-side gate or just a soft "late arrival" label — still open.
- **pgvector ANN index (HNSW/IVFFlat).** Deliberately not added — class-scoped candidate sets are small enough that brute-force `L2Distance` is fine. Revisit only if `SCHOOL`-scoped Fixed Camera matching against a whole roster becomes common at real scale.
- **`ModuleAccessMixin` / JWT tenant gap.** Pre-existing, app-wide issue: `request.tenant_school` is `None` for pure-JWT requests because `TenantMiddleware` only populates it for session-authenticated requests, silently skipping the module gate. Live Mobile capture routed around it via `ensure_tenant_school_id`; the underlying mixin bug is unfixed and affects other JWT-only endpoints too.
- **Shared test-provider gap.** `AcademicYearProvider`/`BackgroundTaskProvider` are missing from `test/utils.jsx`'s `renderWithProviders`, breaking several face-attendance test files independent of this feature. Worked around per-file with `vi.mock`; the shared test-infra fix itself was never done.
- **Stale test assertions.** 5 assertions in `FaceEnrollmentPage.test.jsx`/`FaceAttendancePage.test.jsx` still expect an old `"Select class..."` placeholder instead of `ClassSelector`'s actual `"All Classes"` text for non-teacher roles — cosmetic, low priority, not fixed. Tracked separately, out of scope of the naming/gating cleanup.
- **Header button-row overflow on narrow viewports.** `FaceAttendancePage`'s header row (`flex items-center justify-between` with no wrap between the title block and the Bulk Enrollment / Capture Devices / Manage Enrollments button row) can overflow well before 375px width. Pre-existing, not introduced by the tier-choice UI work. Tracked separately, out of scope of the naming/gating cleanup.
- **Fixed Camera feedback loop.** Phase 3.6's threshold-feedback tooling deliberately scoped to Live Mobile capture only (Fixed Camera's `dlib_v1` thresholds are already validated from Group Photo capture's production history). Not started; revisit only if Fixed Camera accuracy becomes a live concern.
- **face-api.js model payload size (~6.7MB)** loaded in-browser on a teacher's phone. Not mitigated (no CDN/lazy-load optimization) — acceptable so far, revisit if a school reports poor-connectivity issues in practice.
- **HD/IP camera stream ingestion** for scenarios beyond what Fixed Camera capture already covers (RTSP auto-capture triggers, scheduled per-period capture, live WebSocket preview in admin UI) remains future/unscoped work beyond what's shipped.
