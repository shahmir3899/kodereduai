# Face Attendance System — Architecture & Workflow

## Overview

Camera-based face recognition attendance system that runs **parallel** to the existing OCR pipeline. A teacher captures a group photo, the backend detects faces, generates embeddings, matches them to enrolled students (class-scoped), and presents results for teacher review before creating attendance records.

**Key constraints:**
- Class-scoped matching only (never cross-class)
- Prefer false negatives over false positives
- All heavy processing in Celery (upload response < 1 second)
- Teacher must review and confirm every session
- Final output: standard `AttendanceRecord` with `source=FACE_CAMERA`

## Django App: `face_attendance`

### Models

| Model | Purpose |
|-------|---------|
| `FaceAttendanceSession` | One per capture event. UUID PK. Status workflow: UPLOADING → PROCESSING → NEEDS_REVIEW → CONFIRMED / FAILED. No unique constraint on (school, class, date) — allows multiple sessions per day. |
| `StudentFaceEmbedding` | 128-d face embedding stored as binary (numpy float64 → bytes). Supports multiple embeddings per student. School denormalized for fast queries. |
| `FaceDetectionResult` | Individual face detected in a session image. Stores bounding box, crop URL, match status, confidence, and alternative matches. |

### Modified Existing Models

- `AttendanceRecord.Source` — added `FACE_CAMERA` choice
- `AttendanceRecord.face_session` — optional FK to `FaceAttendanceSession`
- `BackgroundTask.TaskType` — added `FACE_ATTENDANCE`

## Face Recognition Pipeline

```
Image URL received (Supabase)
  │
  ├─→ [1] Load Image (download from URL, decode to RGB numpy array)
  │
  ├─→ [2] Face Detection (face_recognition.face_locations, HOG model)
  │     └─→ Reject if 0 faces or > MAX_FACES (default: 15)
  │
  ├─→ [3] Quality Filtering (per face)
  │     ├─→ Size check: face ≥ 60x60 pixels
  │     ├─→ Blur detection: Laplacian variance > 50.0
  │     └─→ Quality score: 0.4 * size_score + 0.6 * blur_norm
  │
  ├─→ [4] Embedding Generation (face_recognition.face_encodings)
  │     └─→ 128-dimensional float64 vector per face
  │
  ├─→ [5] Class-Scoped Matching
  │     ├─→ Load embeddings ONLY for students in session's class
  │     ├─→ Vectorized L2 distance computation (numpy)
  │     ├─→ For each face, find closest student + top-3 alternatives
  │     └─→ Conflict resolution: if two faces → same student, keep lower distance
  │
  └─→ [6] Store Results + Upload Face Crops
        ├─→ Create FaceDetectionResult for each face
        ├─→ Upload cropped face images to Supabase
        └─→ Update session status → NEEDS_REVIEW
```

## Confidence Thresholds

Distance is L2/Euclidean between 128-d embeddings.

| Level | Distance Range | Action | Status |
|-------|---------------|--------|--------|
| HIGH | d < 0.40 | Auto-mark present | `AUTO_MATCHED` |
| MEDIUM | 0.40 ≤ d < 0.55 | Flag for review | `FLAGGED` |
| LOW | d ≥ 0.55 | Ignore | `IGNORED` |

**Confidence formula:** `max(0, (1 - distance / 0.6)) * 100` (percentage)

Thresholds are stored in `FACE_RECOGNITION_SETTINGS` in Django settings and saved per-session in `thresholds_used` for reproducibility.

## Conflict Resolution

When two detected faces match the same enrolled student:
1. Group matches by student_id
2. Keep the match with the **lowest distance** (highest confidence)
3. Demoted face gets its next-best alternative or falls to `IGNORED`

## API Endpoints

All under `/api/face-attendance/`:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/upload-image/` | Upload image to Supabase → returns URL |
| POST | `/sessions/` | Create session → dispatches Celery task → returns immediately |
| GET | `/sessions/` | List sessions (filterable by class, date, status) |
| GET | `/sessions/{id}/` | Session detail with detections + class students |
| GET | `/sessions/pending_review/` | Sessions needing review (auto-recovers stuck ones) |
| POST | `/sessions/{id}/confirm/` | Confirm attendance → creates AttendanceRecords |
| POST | `/sessions/{id}/reprocess/` | Re-run pipeline on existing image |
| POST | `/enroll/` | Upload student portrait → generate embedding (async) |
| GET | `/enrollments/` | List enrolled face embeddings |
| DELETE | `/enrollments/{id}/` | Soft-delete face embedding |
| GET | `/status/` | Face recognition availability + stats |

### Session Create → Response (< 1 second)

```json
// POST /api/face-attendance/sessions/
// Request: { "class_obj": 5, "date": "2026-02-18", "image_url": "https://..." }
// Response:
{
  "id": "uuid-here",
  "status": "PROCESSING",
  "class_obj": 5,
  "date": "2026-02-18",
  "celery_task_id": "abc123"
}
```

### Confirm Request

```json
// POST /api/face-attendance/sessions/{id}/confirm/
{
  "present_student_ids": [12, 18, 25],
  "removed_detection_ids": [3],
  "manual_additions": [25],
  "corrections": [
    { "detection_face_index": 1, "correct_student_id": 22 }
  ]
}
```

The confirm flow:
1. Validates all student IDs belong to session's class
2. Creates/updates AttendanceRecords (source=FACE_CAMERA, face_session=session)
3. Students in `present_student_ids` → PRESENT
4. All other class students → ABSENT
5. Sets session status → CONFIRMED

## Celery Tasks

| Task | Purpose | Retries |
|------|---------|---------|
| `process_face_session` | Main pipeline: detect → embed → match → store | 2, 30s delay |
| `enroll_student_face` | Single-face enrollment: detect → embed → store | 2, 15s delay |
| `cleanup_old_face_sessions` | Delete old failed sessions | N/A |

All tasks use `core.task_utils` for BackgroundTask tracking (progress updates, success/failure marking).

## Face Enrollment

Before face attendance works, students need at least one face embedding:

1. Admin uploads student portrait photo (single face)
2. System detects exactly 1 face (rejects 0 or multiple)
3. Quality filter applied (size, blur)
4. 128-d embedding generated
5. Stored in `StudentFaceEmbedding` table

## Services Architecture

```
face_attendance/services/
├── face_detector.py      # FaceDetector: detection, quality filtering, cropping
├── embedding_service.py  # EmbeddingService: generate, store, retrieve (class-scoped)
├── matcher.py            # FaceMatcher: distance computation, thresholds, conflicts
└── pipeline.py           # FaceAttendancePipeline + FaceEnrollmentPipeline orchestrators
```

## Frontend Integration

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| FaceAttendancePage | `/face-attendance` | Capture tab (upload + create session) + Sessions tab (list) |
| FaceReviewPage | `/face-attendance/review/:sessionId` | Review detections, toggle present/absent, confirm |
| FaceEnrollmentPage | `/face-attendance/enrollment` | Enroll student faces, view/delete enrollments |

### Polling Pattern

```javascript
const { data } = useQuery({
  queryKey: ['faceSession', sessionId],
  queryFn: () => faceAttendanceApi.getSession(sessionId),
  refetchInterval: (query) => {
    const status = query.state.data?.data?.status
    return status === 'PROCESSING' ? 3000 : false
  },
})
```

### BackgroundTaskContext

`FACE_ATTENDANCE` task type is registered in the invalidation map:
```javascript
FACE_ATTENDANCE: [['faceSessions'], ['pendingFaceReviews'], ['faceEnrollments']]
```

## Mobile Integration

### Screens

| Screen | Path | Purpose |
|--------|------|---------|
| capture.tsx | `/(admin)/face-attendance/capture` | Camera capture + class selection + upload |
| review.tsx | `/(admin)/face-attendance/review?id=` | Poll session, view detections, confirm |
| enrollment.tsx | `/(admin)/face-attendance/enrollment` | Enroll student faces from gallery |

## Configuration

In `config/settings.py`:

```python
FACE_RECOGNITION_SETTINGS = {
    'CONFIDENCE_THRESHOLDS': {
        'HIGH': 0.40,
        'MEDIUM': 0.55,
    },
    'MAX_FACES_PER_IMAGE': 15,
    'MIN_FACE_SIZE': 60,
    'MIN_BLUR_SCORE': 50.0,
    'NUM_JITTERS': 1,
    'EMBEDDING_MODEL': 'dlib_v1',
}
```

## Dependencies

- `face_recognition>=1.3.0` (dlib-based, 99.38% LFW accuracy)
- `numpy>=1.24.0` (embedding computation)
- `opencv-python` (already present — blur detection, image processing)

---

## Testing

### Backend Tests

**Service unit tests** (`backend/tests/test_face_attendance_services.py`) — 25 tests:
- `TestDistanceToConfidence` — distance-to-confidence conversion
- `TestClassifyMatch` — distance-to-match-status classification
- `TestFaceMatcherMatching` — face matching, conflict resolution, empty embeddings
- `TestEmbeddingBytesRoundtrip` — numpy ↔ bytes lossless conversion
- `TestEmbeddingStorage` — class-scoped retrieval, inactive filtering
- `TestFaceDetector` — detection, quality filtering, cropping

**API integration tests** (`backend/tests/test_face_attendance_api.py`) — 38 tests:
- `TestSessionCRUD` — create, list, filter, retrieve sessions
- `TestSessionConfirm` — confirm flow, present/absent marking, corrections
- `TestPendingReview` — pending review listing, stuck session recovery
- `TestReprocess` — reprocess dispatching, status guards
- `TestEnrollmentAPI` — enroll, list, filter, soft-delete enrollments
- `TestStatusEndpoint` — thresholds, enrollment counts
- `TestPermissions` — 401/403 for unauthorized users
- `TestSchoolIsolation` — multi-tenancy isolation

```bash
# Run all backend face attendance tests
cd backend
pytest tests/test_face_attendance_services.py tests/test_face_attendance_api.py -v

# Run only service tests (no DB required for non-django_db tests)
pytest tests/test_face_attendance_services.py -v -k "not django_db"
```

### Frontend Tests

**Page tests** (`frontend/src/pages/face-attendance/__tests__/`) — 21 tests:
- `FaceAttendancePage.test.jsx` — tabs, class selector, sessions list, navigation
- `FaceReviewPage.test.jsx` — detected faces, badges, class roll, toggle presence, confirm payload
- `FaceEnrollmentPage.test.jsx` — class/student selectors, enrollment list, delete

```bash
# Run frontend face attendance tests
cd frontend
npx vitest run src/pages/face-attendance/__tests__/
```

### Seed Data

- **Pytest** (`backend/conftest.py`): The `seed_data` fixture auto-creates 4 face embeddings for Class 1A students + 1 NEEDS_REVIEW session with 3 detections (AUTO_MATCHED, FLAGGED, IGNORED).
- **Manual testing** (`backend/seed_test_data.py`): `create_face_seed_data(seed)` creates embeddings and a sample session for the test school.

### Mocking Strategy

Backend tests mock `face_recognition` by bypassing `__init__` with `cls.__new__(cls)` and directly setting `instance._fr = mock_fr`. Celery tasks are mocked via `dispatch_background_task` patching. Supabase storage is mocked to return dummy URLs.
