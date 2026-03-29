# Session Class Standardization - Execution Checklist

Owner: Copilot implementation stream
Date: 2026-03-30
Goal: Ensure class filters show session classes for active academic year and all APIs use consistent session-aware mapping.

## Rules (applies to all tickets)
- Use `ClassSelector` with `scope` and `academicYearId` for filter UIs.
- Avoid passing `classes=...` unless the list is already session-scoped by design.
- For legacy endpoints requiring master class IDs, resolve selected session class with `getResolvedMasterClassId`.
- Prefer `session_class_id` + `academic_year` where backend supports it.

## Ticket Board

- [x] T1 - Shared helper baseline
  - Files: frontend/src/utils/classScope.js
  - Deliverable: reusable class scope + mapping helpers.

- [x] T2 - Attendance baseline migration
  - Files: frontend/src/pages/AttendanceRecordsPage.jsx, frontend/src/pages/RegisterPage.jsx, frontend/src/pages/ManualEntryPage.jsx, backend/attendance/views.py, backend/attendance/serializers.py
  - Deliverable: session-first attendance filtering and bulk save support.

- [x] T3 - Exams baseline migration
  - Files: frontend/src/pages/examinations/ResultsPage.jsx, frontend/src/pages/examinations/MarksEntryPage.jsx, frontend/src/pages/examinations/ReportCardPage.jsx
  - Deliverable: session-aware filters with safe master fallback mapping.

- [x] T4 - Capture review alignment
  - Files: frontend/src/pages/CaptureReviewPage.jsx
  - Deliverable: session-aware class selection at upload and year-aware student fetch.

- [x] T5 - Academics Subjects filter standardization
  - Files: frontend/src/pages/academics/SubjectsPage.jsx
  - Deliverable: assignment filter uses session selector and maps to legacy `class_obj` API param.

- [x] T6 - Academics Timetable filter standardization
  - Files: frontend/src/pages/academics/TimetablePage.jsx
  - Deliverable: session selector and resolved master class ID for all timetable APIs.

- [x] T7 - Fee collection filter stack standardization
  - Files: frontend/src/pages/fee-collection/FeeFilters.jsx, frontend/src/pages/fee-collection/FeeModals.jsx, frontend/src/pages/fee-collection/FeeSetupPage.jsx
  - Deliverable: remove class-list bypasses; map to session-aware API params.

- [x] T8 - Finance Discounts class filter standardization
  - Files: frontend/src/pages/finance/DiscountsPage.jsx
  - Deliverable: class filter session-aware with fallback mapping.

- [x] T9 - Exams remaining pages
  - Files: frontend/src/pages/examinations/ExamsPage.jsx, frontend/src/pages/examinations/QuestionPaperBuilderPage.jsx, frontend/src/pages/examinations/CurriculumCoveragePage.jsx
  - Deliverable: full session-aware selector integration and param mapping.

- [x] T10 - LMS class-filter pages
  - Files: frontend/src/pages/lms/AssignmentsPage.jsx, frontend/src/pages/lms/LessonPlansPage.jsx, frontend/src/pages/lms/CurriculumPage.jsx
  - Deliverable: session-aware filters + API mapping.

- [x] T11 - Students and transport
  - Files: frontend/src/pages/StudentsPage.jsx, frontend/src/pages/transport/TransportAssignmentsPage.jsx, frontend/src/components/BatchConvertModal.jsx
  - Deliverable: session-aware class filters for admin workflows.

- [x] T12 - Face attendance pages
  - Files: frontend/src/pages/face-attendance/FaceEnrollmentPage.jsx, frontend/src/pages/face-attendance/FaceAttendancePage.jsx
  - Deliverable: session-aware class filters and payload mapping.

- [x] T13 - Regression hardening
  - Files: targeted tests and grep audits
  - Deliverable:
    - no unsafe `ClassSelector` bypasses for filter UIs
    - build passes
    - key flow smoke checks documented.

### T13 Audit Notes
- Repo-wide grep audit completed for `ClassSelector` usage and class param paths.
- Remaining `classes={...}` usages are intentional and safe:
  - `frontend/src/pages/ManualEntryPage.jsx` uses `classOptions` already session-scoped.
  - `frontend/src/pages/sessions/PromotionPage.jsx` uses `sourceClassOptions` session-scoped by selected academic year.
  - `frontend/src/pages/academics/SubjectsPage.jsx` usage is in assignment modal (non-filter path).
- Hardening fix applied:
  - `frontend/src/pages/lms/LessonPlanWizard.jsx` migrated to session-scoped class selection and resolved master-class mapping for API payloads.
- Smoke verification:
  - Frontend production build passed after hardening updates (`npm run build`).
  - Edited-file diagnostics reported no errors.

## Current Sprint Focus
- T1-T13 complete.
