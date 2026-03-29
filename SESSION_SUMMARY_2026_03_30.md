# Session Summary — March 29–30, 2026

## Objective
Diagnose and fix enrollment data inconsistencies caused by the Promotion feature, and recover accidentally deleted student records.

---

## Problem Discovery

### Initial Observation
- **Branch 1 (School 1):** 234 students in 2025-26, but only 29 in 2026-27
- **Branch 2 (School 2):** Similar gap detected

### Root Cause Analysis

**2025-26 Enrollment Status Breakdown (Branch 1, Year ID 11):**

| Class | Status | Count |
|-------|--------|-------|
| Class 1 - A | PROMOTED | 21 |
| Class 1 - B | PROMOTED | 23 |
| Class 2 | ACTIVE | 32 |
| Class 3 | PROMOTED | 28 |
| Class 4 | PROMOTED | 20 |
| Class 5 | GRADUATED | 20 |
| Junior 1 | ACTIVE | 30 |
| Junior 2 | ACTIVE | 29 |
| Playgroup | ACTIVE | 31 |
| **Total** | | **234** |

**Finding:** 92 students were marked `PROMOTED` but **NO target enrollments were created in 2026-27**. The promotion workflow marked the source enrollment status but failed to create the destination enrollment records.

---

## Recovery Attempts & Actions Taken

### Attempt 1: Recovery Script for 92 PROMOTED Students
- Created enrollments in 2026-27 for PROMOTED students (Class 1→Class 2, Class 3→Class 4, Class 4→Class 5)
- Brought Branch 1 2026-27 count from 29 → 121

### Mistake: Blanket Deletion
- User asked to remove promotion-created enrollments to inspect original data
- First script accidentally **deleted ALL 2026-27 enrollments** including 19 Playgroup new admissions for Branch 2

### Playgroup Recovery (Branch 2)

**Option A — Supabase Backup:** Backup (`supabase_backup.dump`, Feb 21, 2026) was too old — Year 43 (Branch 2 2026-27) didn't exist yet. **Not viable.**

**Option B — Cross-reference Student Records:** ✅ **Used this approach**
1. Found 19 students in Branch 2 with NO 2025-26 enrollment (all created March 2026)
2. Cross-checked against `AdmissionEnquiry` table — **19 enquiries, 19 students, 100% name match**
3. Restored all 19 as Playgroup enrollments in Branch 2 2026-27 (Year 43)

### Final Cleanup: Both Branches
- Removed all promotion-created enrollments from **Branch 1** 2026-27 (Year 33): deleted 92 (Class 2: 44, Class 4: 28, Class 5: 20), kept Playgroup: 32
- **Branch 2** 2026-27 (Year 43) was already clean (only Playgroup: 19)

---

## Final State

### Branch 1 — The Focus Montessori and School - Branch 1

| Year | Class | Students | Notes |
|------|-------|----------|-------|
| 2025-26 (ID 11) | All 9 classes | 234 | Untouched — ACTIVE/PROMOTED/GRADUATED statuses intact |
| 2026-27 (ID 33) | Playgroup | 32 | Only new admissions remain |

### Branch 2 — The Focus Montessori and School - Branch 2

| Year | Class | Students | Notes |
|------|-------|----------|-------|
| 2025-26 (ID 10) | All classes | 143 | Untouched |
| 2026-27 (ID 43) | Playgroup | 19 | Recovered from student/admission records |

### Data Integrity
- ✅ 2025-26 data for both branches: **NOT modified** at any point
- ✅ Playgroup new admissions: **Restored and verified** against admission enquiries
- ✅ All promotion-created enrollments in 2026-27: **Removed** (ready for clean re-promotion)

---

## Academic Year ID Reference

| ID | Name | School | Enrollments |
|----|------|--------|-------------|
| 10 | 2025-26 | Branch 2 | 143 |
| 11 | 2025-26 | Branch 1 | 234 |
| 33 | 2026-27 | Branch 1 | 32 (Playgroup only) |
| 43 | 2026-27 | Branch 2 | 19 (Playgroup only) |

---

## Empty Classes (Pre-existing, Not Session-Related)

These classes exist in the database but have no students in 2025-26 — this is a legacy data structure issue, not caused by this session:

| Class | Section | Issue |
|-------|---------|-------|
| Class 1 | (none) | Empty — students are in Class 1 A & B sections instead |
| Class 2 | A | Empty — students are in unsectioned Class 2 |
| Class 2 | B | Empty — students are in unsectioned Class 2 |

---

## Diagnostic Scripts Created

All in `backend/`:

| Script | Purpose |
|--------|---------|
| `check_status.py` | Enrollment status breakdown by class for 2025-26 |
| `check_enrollments.py` | Class-wise enrollment counts across years |
| `check_empty_classes.py` | Find classes with zero students |
| `check_class_structure.py` | Show class hierarchy with grade levels |
| `check_promoted_targets.py` | Find PROMOTED students missing target enrollments |
| `diagnose_playgroup.py` | Full Playgroup diagnosis across both branches |
| `identify_new_2026_27_students.py` | Find students with no 2025-26 enrollment |
| `crosscheck_admissions.py` | Match students against admission enquiry records |

## Recovery Scripts Created

| Script | Purpose |
|--------|---------|
| `restore_playgroup_branch2.py` | Restored 19 Playgroup students for Branch 2 |
| `remove_branch1_promoted_enrollments.py` | Cleaned promotion enrollments from Branch 1 |
| `undo_recovery_delete_2026_27.py` | Deleted all Branch 2 2026-27 enrollments (used once) |

---

## Lessons Learned

1. **Always scope deletions carefully** — specify exact classes to delete rather than blanket "delete all"
2. **Backups may be stale** — the Supabase backup was too old to help; more frequent backups recommended
3. **Promotion must create target enrollments atomically** — the current code marks source as PROMOTED but doesn't guarantee target creation
4. **Cross-referencing admissions is reliable** — admission enquiry records provided a trustworthy recovery source
