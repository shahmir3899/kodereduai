# Leadership Insights (Admin / Principal) — Locked Definitions & Engineering Tickets

Companion to the exploratory plan in the prior dashboard discussion. Library module is **out of scope** for these metrics.

---

## Locked business rules

### LEAD-RULES-01 — What counts as a “new admission”

**Include both:**

1. Students created from the **admissions funnel** (enquiry → convert / batch convert).
2. Students created via **Add student** (or any API path that creates a `students.Student` row).

**Admission date for all metrics:** **`Student.created_at`** (timezone-aware per school/backend convention). Do **not** use enquiry `updated_at`, `AdmissionEnquiry.status` alone, or `admission_date` unless product later aligns those fields — single source is record creation after this ticket set.

### LEAD-RULES-02 — “Per session” new admissions

For a selected **`AcademicYear`** (session):

Count `Student` where:

- `student.school_id` = tenant school
- **`Student.created_at`** date falls in **`[academic_year.start_date, academic_year.end_date]`** (inclusive; compare date in local TZ or UTC consistently — document choice in LEAD-BE-01)
- There exists **`StudentEnrollment`** for `(student, academic_year)` *(ties the intake to that session roster)*

**Rolling windows (last calendar month / last 90 days):**

Count `Student` where:

- Same school
- `created_at` in the rolling window (`[today-30d, today]`, `[today-90d, today]` endpoints of day configurable in API)

Optional follow-up ticket: expose “session to date” if year is incomplete (same predicate but cap end at `min(end_date, today)`).

### LEAD-RULES-03 — “Students left”

**Source of truth:** **`StudentEnrollment`**, not `Student.status` alone.

Count departures using enrollment rows where **`status` ∈ {`WITHDRAWN`, `TRANSFERRED`, `GRADUATED`}** *(exact set to confirm in LEAD-QA — default: all three)* and the **effective leave date** is used for filtering.

**Date field:** Today’s schema has no dedicated `left_on`. **Interim:** use **`StudentEnrollment.updated_at`** when status transitions into a terminal/leaving status, with documented limitation (noisy if other edits occur). **Follow-up improvement:** add `leave_effective_date` or audit field (ticket LEAD-DATA-OPT).

### LEAD-RULES-04 — Curriculum & assessment (library excluded)

- **Books per class:** `lms.Book` aggregated by **`class_obj`** (curriculum textbooks only).
- **Topics per book:** count active `Topic` under each book’s chapters (respect `is_active` where applicable).
- **Question bank:** `examinations.Question` for the school (+ optional breakdown by `subject`).
- **Lesson plans:** group by **`teacher`** + **`class_obj`**, buckets by **`lesson_date`** calendar month — previous / current / next month relative to “today” (query params acceptable).

---

## Engineering tickets

| ID | Title | Type | Acceptance criteria |
|----|-------|------|---------------------|
| **LEAD-P0** | Freeze metrics spec & edge cases | Product / Eng | Written sign-off on: (a) enrollment statuses counted as “left”; (b) TZ rule for `created_at` vs session dates; (c) whether rolling windows are calendar-month vs trailing-30-days (pick one API contract). |
| **LEAD-BE-01** | `GET` leadership academic insights aggregation | Backend | New read-only endpoint (recommend `{bootstrap}/leadership-academic-insights/` or extend `AdminDashboardBootstrapView` with `sections=leadership_insights`). **Auth:** same as existing admin bootstrap (`SCHOOL_ADMIN`, `PRINCIPAL`). Returns JSON for: **new admissions** (session-bound per LEAD-RULES-02, plus `last_30d`, `last_90d` from `Student.created_at`), **departures** from `StudentEnrollment` per LEAD-RULES-03 (with breakdown by status), **LMS books by class**, **topic counts by book**, **question bank totals** (+ optional by subject), **lesson plan counts** by teacher/class for prev/current/next month. **Out of scope:** library stats. Efficient queries (`annotate`/`Count`), tenant-scoped. |
| **LEAD-BE-02** | Unit tests — admission counts | Backend | Tests: funnel-created vs manually created students both counted; `created_at` boundary for session `[start,end]` + enrollment exists; rolling windows correctness. |
| **LEAD-BE-03** | Unit tests — enrollment departures | Backend | Tests: only leaving statuses counted; queryset scoped to school and optional `academic_year` filter if exposed. |
| **LEAD-DATA-OPT** | (Optional) Persist “leave effective date” on enrollment | Backend / DB | Migration: add nullable `leave_effective_date` on `StudentEnrollment` (set on transition to leaving status in serializer/signal/admin paths). Insight endpoint prefers this over `updated_at`. |
| **LEAD-FE-01** | API client helper | Frontend | Add `bootstrapApi`/equivalent method in `frontend/src/services/api.js` for the new endpoint + TypeScript/JSDoc as per project norms. |
| **LEAD-FE-02** | Admin dashboard — “Admission & roster” widgets | Frontend | On `DashboardPage.jsx`, gated by `students`/`admissions` as appropriate: show session new admits, rolling 30/90d, departed students (+ status chips). Loading/empty states; links deep-link to `/students`, `/admissions` where helpful. Principal variant inherits same widgets. |
| **LEAD-FE-03** | Admin dashboard — “Curriculum & assessment” widgets | Frontend | Same page, gated by `lms` / `examinations`: bars/table for books per class, topics per book, question bank headline, lesson-plan matrix/table. No library widgets. |
| **LEAD-NOTIF-01** | (Stretch) Threshold / digest triggers | Backend + Config | Extend `SchoolNotificationConfig` + Celery/task if desired: weekly digest OR threshold alerts using LEAD-BE-01 aggregates; IN_APP to admins/principals; idempotent keys per docs/notification correctness patterns. |

### Suggested sequencing

1. **LEAD-P0** → **LEAD-BE-01** → **LEAD-BE-02** / **LEAD-BE-03**  
2. **LEAD-FE-01** → **LEAD-FE-02** → **LEAD-FE-03**  
3. **LEAD-DATA-OPT** anytime after LEAD-P0 once product wants accurate “left in period” trends.  
4. **LEAD-NOTIF-01** last.

### Explicit non-goals (this sprint)

- Library circulation, library books per class, or `GET /api/library/stats/` on this dashboard slice.
- Mobile app parity (`mobile/` admin dashboard) unless a separate ticket is opened.
