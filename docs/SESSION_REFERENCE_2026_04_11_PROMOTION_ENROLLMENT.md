# Session Reference - 2026-04-11 (Promotion, Enrollment, Finance)

## Scope
School data repair and behavior alignment for Branch 2 and Branch 1.

## What Was Done
1. Diagnosed enrollment vs fee discrepancies for Branch 2.
2. Identified 12 Class 5 graduated students with 24 extra annual unpaid fee rows (2026-27).
3. Deleted those 24 fee rows directly from DB.
4. Fixed historical Students page behavior so session-selected class chips/labels use enrollment-scoped class data.
5. Backfilled promotion history for Branch 2 (2025-26 -> 2026-27):
   - PromotionOperation created: ID 1
   - PromotionEvent inserted: 143 (131 PROMOTED, 12 GRADUATED)
6. Backfilled promotion history for Branch 1 (2025-26 -> 2026-27):
   - PromotionOperation created: ID 2
   - PromotionEvent inserted: 234 (214 PROMOTED, 20 GRADUATED)
7. Implemented backend support to re-open graduated rows in correction flow:
   - Graduated row with no target enrollment can now be corrected to PROMOTE/REPEAT.
   - System creates target enrollment during correction.
   - GRADUATE correction without target enrollment is also accepted.
8. Ran real smoke test with rollback (Branch 2, student 462):
   - GRADUATED -> REPEAT applied successfully
   - Then rolled back REPEAT -> GRADUATE successfully
   - Final state restored (`restored_to_original=True`)

## New/Updated Scripts
- `backend/diagnose_branch2_enrollments.py` (diagnostic + detailed fee rows)
- `backend/dry_run_backfill_promotion_history.py` (no-write planner)
- `backend/backfill_promotion_history.py` (actual backfill, commit via `--commit`)
- `backend/smoke_test_graduate_reopen_and_rollback.py` (real correction smoke test + rollback)

## Code Changes
- `backend/students/views.py`
  - `academic_year` queries now annotate enrollment class ID/name/grade and sort by historical class.
- `backend/students/serializers.py`
  - `class_obj` and `class_name` now resolve from enrollment annotations when present.
- `backend/academic_sessions/views.py`
  - `_run_single_correction` now supports re-open from graduated without pre-existing target enrollment.
- `frontend/src/pages/StudentsPage.jsx`
  - Added missing `ClassSelector` import to fix runtime crash (`ClassSelector is not defined`).

## Documentation Updates
- `docs/FRONTEND_PAGES.md`
- `docs/API_ENDPOINTS.md`

## Operational Notes
- Promotion History tab reads `PromotionEvent`; legacy transitions without events appear empty until backfilled.
- Graduated rows are terminal by default, but now correction flow can re-open them when needed.
- Fee summary and student enrollment may diverge if fee rows exist for students without target-year enrollments.

---

## Continuation - 2026-04-12 (Historical Scope + Repeat Correction Hardening)

### Additional Bugs Removed
1. Fixed `students/{id}/enrollment_history` endpoint returning empty data due to invalid relation usage.
2. Fixed Students page ordering so single-class filtered views prioritize roll ordering.
3. Fixed repeat correction drift where REPEAT could still land in promoted target class/session when stale target payloads were reused.
4. Fixed repeat correction for cross-year class-id drift cases by resolving target-year session class identity safely.

### Production Data Corrections Applied (via correction flow with audit)
- Student ID 41 (Branch 1): corrected to repeat in target-year Junior 1 session mapping.
- Student ID 186 (Branch 1): corrected to repeat in target-year Class 1 session mapping.

### Backend Behavior Alignment Implemented
- REPEAT correction now enforces same-grade repeat intent and normalizes stale promoted targets.
- If a target session class is resolved, correction aligns target class from that session class.
- Repeat session mapping now supports fallback matching by session-class identity (display name/section/grade) when master class IDs drift between years.
- Student snapshot status remains operational (`ACTIVE` after repeat), while repeat semantics remain in enrollment/history.

### Added Regression Coverage
- `backend/tests/test_historical_scope_regressions.py`
  - Enrollment-scoped student status/active behavior under academic year filter.
  - Attendance class filtering correctness for historical year scope.
  - Enrollment history endpoint shape validation.
- `backend/tests/test_roll_allocation.py`
  - REPEAT correction ignores stale promoted target class.
  - REPEAT correction handles target session mapping when class IDs drift across years.

### Documentation/UX Alignment
- Updated Students API docs for enrollment-scoped behavior under `academic_year`.
- Added enrollment history response documentation and source-of-truth note for Student Profile History tab.
- Promotion correction notes now explicitly describe REPEAT normalization behavior.
