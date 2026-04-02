# Session Class Filtering: QA Checklist and Implementation Plan

Date: 2026-04-02
Owner: Finance + Core Frontend/Backend
Status: Ready for execution

## Objective
Ensure all section-based class selections (for example Class 2 - A vs Class 2 - B) return only the students from that exact section, with no cross-section mixing.

## Current State Summary
- Backend students endpoint now applies exact filtering when session_class_id is provided.
- Monthly Structure -> By Student and Annual Charges -> By Student are already updated to pass session_class_id.
- Other fee flows still use class_id only in some places and can still mix sections.

---

## Part 1: QA Checklist (No-Code Validation)

### A. Mandatory pre-checks
1. Select an academic year that has sectioned classes.
2. Confirm class picker shows separate options such as Class 2 - A and Class 2 - B.
3. Pick one class with known duplicate roll numbers across sections to make mixing easy to detect.

### B. High-priority validation (already updated paths)
1. Monthly Structure -> By Student
- Select Class 2 - A.
- Verify students belong only to A.
- Verify roll numbers are unique in that section.
- Switch to Class 2 - B.
- Verify student list changes and includes only B.

2. Annual Charges -> By Student
- Repeat same checks for A then B.
- Confirm no cross-section student appears.

### C. Validation for known at-risk fee paths
1. Fee Setup -> Student Discounts tab
- Select A then B.
- Verify list is section-specific.

2. Fee Setup -> Generate tab -> single student structure flow
- Select A then B.
- Verify student dropdown changes by section.

3. Fee Modals -> FeeStructureModal (student mode)
- Select A then B.
- Verify student grid is section-specific.

4. Fee Modals -> CreateSingleFeeModal
- Select A then B.
- Verify student options are section-specific.

### D. Cross-module smoke checks (session filters)
1. Attendance Records page section filter.
2. Register page section filter.

### E. Evidence capture
1. Screenshot for A and B on each validated screen.
2. Note student count and 2 sample names per section.
3. Log any screen where A and B still show overlap.

### F. Pass criteria
1. No mixed students between A and B on any section-scoped screen.
2. No duplicate roll confusion caused by cross-section mixing.
3. Behavior consistent across fee setup, fee modals, and fee collection.

---

## Part 2: Proper Implementation Plan

## Scope
Complete session_class_id consistency for all fee-related student list queries.

## In scope
1. Fee Setup student queries.
2. Fee Modals student queries.
3. Shared helper for student list params in session-aware contexts.
4. Regression tests for A/B separation.

## Out of scope
1. Full module-wide refactor beyond finance (unless requested).
2. New API endpoint design.

## Target files (expected)
1. frontend/src/pages/fee-collection/FeeSetupPage.jsx
2. frontend/src/pages/fee-collection/FeeModals.jsx
3. frontend/src/pages/fee-collection/useFeeSetup.js
4. frontend/src/utils/classScope.js (only if helper extension needed)
5. backend/tests (or existing finance tests) for regression coverage

## Design decisions
1. If UI selection is session class, always send session_class_id.
2. Keep class_id as optional compatibility field where needed.
3. Keep academic_year in requests for enrollment scoping.
4. Do not change endpoint contracts unless necessary.

## Phase plan

### Phase 1: Parameter consistency in remaining fee screens
1. Add selectedSessionClassId derivation where class picker uses session classes.
2. Pass session_class_id to students list calls in:
- FeeSetupPage student-discount and single-structure student fetches.
- FeeModals student-mode and create-single-fee student fetches.
3. Keep existing class_id for compatibility when useful.

Deliverable:
- All fee student queries become section-accurate.

### Phase 2: Shared utility hardening
1. Add a small helper to build student filter params:
- Inputs: selected class id, active academic year id, session classes.
- Output: class_id, session_class_id, academic_year as applicable.
2. Replace repeated inline mapping logic in fee pages.

Deliverable:
- Reduced drift and future regression risk.

### Phase 3: Regression testing
1. Add tests for students list filtering with session_class_id.
2. Add UI-level checks (if available) or integration assertions for fee pages:
- A selection returns only A students.
- B selection returns only B students.

Deliverable:
- Automated safety net for section filtering behavior.

### Phase 4: Rollout and verification
1. Run QA checklist above.
2. Validate production-like school with known A/B overlap.
3. Monitor support feedback for 48 hours after deploy.

Deliverable:
- Verified rollout with minimal regression risk.

## Risk analysis
1. Medium risk: missed call site can still mix sections in one screen.
2. Low risk: pages not using session_class_id remain unchanged.
3. Low risk: backward compatibility preserved via class_id and academic_year.

## Rollback plan
1. Revert only frontend session_class_id additions if unexpected behavior appears.
2. Keep backend exact session_class filter, since it is semantically correct.
3. Re-run checklist after rollback decision.

## Acceptance criteria
1. Every fee page using section picker returns section-specific students.
2. No observed A/B student overlap in validated pages.
3. Existing non-session behavior remains intact.
4. All targeted tests pass.

## Recommended execution order
1. Phase 1
2. Phase 3 (minimum coverage)
3. Phase 4
4. Phase 2 cleanup refactor (can be same release if time allows)

## Estimated effort
1. Phase 1: 2 to 4 hours
2. Phase 2: 1 to 2 hours
3. Phase 3: 2 to 4 hours
4. Phase 4: 1 hour
Total: 6 to 11 hours
