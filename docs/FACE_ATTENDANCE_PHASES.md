# Face Attendance System — Phase-Wise Implementation Plan

## Phase 1: Mobile + Manual Capture + Async Processing (Current)

### Scope
- Single group photo capture per session
- Async face detection, embedding generation, class-scoped matching
- Teacher review screen with confidence indicators
- Confirm flow creates standard AttendanceRecords (source=FACE_CAMERA)
- Face enrollment (single portrait per student)

### Success Criteria
- Upload response < 1 second
- Processing 3-6 faces completes in < 30 seconds
- Class-scoped matching with zero cross-class leaks
- Teacher can confirm/reject/override every match
- Works on shared school device (no student login required)

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| dlib compilation on Render (free tier, no GPU) | Use pre-built wheels, HOG model (CPU-friendly) |
| Face quality in classroom lighting | Quality filters (size, blur), graceful degradation |
| Student enrollment photos missing | Show "no face enrolled" indicators, skip unmatched |

### Deliverables
- `face_attendance` Django app (models, views, serializers, tasks, services)
- 3 frontend pages (FaceAttendancePage, FaceReviewPage, FaceEnrollmentPage)
- 3 mobile screens (capture, review, enrollment)
- API endpoints under `/api/face-attendance/`
- Integration with existing AttendanceRecord model and BackgroundTask system

---

## Phase 2: Continuous Capture / Multi-Frame Refinement (Future)

### Scope
- Multiple captures per session (burst mode)
- Best-face selection across frames
- Incremental matching (new faces added as captures come in)
- Improved accuracy via multi-angle embedding averaging
- Auto-retake suggestion when quality is low

### Success Criteria
- 3-5 captures improve match rate by 15-20%
- Best-face algorithm selects highest quality crop
- No duplicate matches across frames

### Risks
| Risk | Mitigation |
|------|------------|
| Storage growth from multiple images per session | Compress and cleanup after best-face selection |
| UX complexity of multi-capture review | Progressive reveal — show best match, expandable details |
| Processing time with multiple frames | Parallel embedding generation, incremental matching |

### Technical Notes
- Add `FaceAttendanceCapture` model (FK to session, multiple per session)
- Modify pipeline to accept multiple images
- Add embedding averaging for same-student across frames
- Add "capture quality" indicator in mobile UI

---

## Phase 3: HD / IP Camera Integration (Future)

### Scope
- RTSP stream ingestion from IP cameras
- Frame extraction and auto-capture triggers
- Continuous monitoring mode
- Integration with school camera infrastructure
- Scheduled attendance capture (e.g., every period start)

### Success Criteria
- RTSP stream connection within 5 seconds
- Auto-capture triggers on sufficient face count
- Configurable capture schedule per class/period

### Risks
| Risk | Mitigation |
|------|------------|
| Network bandwidth requirements | H.264 stream, extract keyframes only |
| Stream processing resource needs | Dedicated worker, frame skipping |
| Camera placement variability | Configuration UI for camera-to-class mapping |
| Privacy concerns with continuous recording | Store only extracted faces, not full frames |

### Technical Notes
- New `CameraDevice` model (school, classroom, RTSP URL, schedule)
- Celery Beat for scheduled captures
- `ffmpeg` for stream processing
- WebSocket for live preview in admin UI
- Consider GPU instance for real-time processing
