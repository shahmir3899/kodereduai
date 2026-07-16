# Student Progress Report — Contents & Data Sources

Tracks what appears in the PDF "Student Report" and exactly where each piece of data comes from. Keep this updated whenever `student.py` changes.

- **Generator:** `backend/reports/generators/student.py` — class `StudentComprehensiveReportGenerator`
  - `get_data()` — pulls everything from the DB into one dict
  - `render_pdf(data)` — lays it out with reportlab (pure Python PDF, no HTML/CSS template)
- **Triggered from:** `backend/reports/views.py` (`InstantReportView`, `GENERATOR_MAP['STUDENT_COMPREHENSIVE']`)
- **Params accepted:** `student_id` (required), `academic_year`, `date_from`/`date_to` (optional — narrows attendance/exams/lessons; fees always show a fixed 12-month window regardless)

## 1. Header / Letterhead

| On report | Source | Notes |
|---|---|---|
| School name | `School.name` (`self.school`) | |
| School logo | `School.logo` | fetched via `fetch_image_bytes()`, silently omitted on failure |
| "Student Report" title | hardcoded string | `student.py` — `render_pdf()`, header block |
| "Academic Session: ..." | `AcademicYear.name` | via `_resolve_academic_year()` — resolves from `academic_year` param, else the AY containing `date_from`, else the school's `is_current=True` year |

## 2. Student Profile Card

| Field | Source | Notes |
|---|---|---|
| Name | `Student.name` | |
| Class | `StudentEnrollment.session_class`/`class_obj` for the report's academic year, else `Student.class_obj.name` | via `_resolve_class_name()` |
| Roll # | `StudentEnrollment.roll_number`, else `Student.roll_number` | via `_resolve_roll_number()` |
| Admission # | `Student.admission_number` | row **hidden** if empty |
| Date of Birth | `Student.date_of_birth` | row **hidden** if empty |
| Gender | `Student.gender` | row **hidden** if empty |
| Parent Name | `Student.parent_name`, falls back to `Student.guardian_name` | shows "-" if both empty |
| Parent Contact | `Student.parent_phone`, falls back to `Student.guardian_phone` | formatted `0XXX-XXXXXXX` via `format_pk_phone()` |
| Photo | `Student.photo_url` | fetched via `fetch_image_bytes()` |

## 3. Attendance

| On report | Source | Notes |
|---|---|---|
| Colored month-grid calendar | `AttendanceRecord` (attendance app) — `.date`, `.status` (`PRESENT`/`ABSENT`) | filtered by `student`, and by `date_from`/`date_to` if given, else by `academic_year_id` |
| Holiday shading | `SchoolCalendarEntry` (academic_sessions app), `entry_kind=OFF_DAY`, `is_active=True` | expanded to individual dates via `_resolve_holiday_dates()`; class-scoped entries only apply if the student's class matches |
| Weekend shading | computed (Sunday) | not DB-sourced |
| Present / Absent / Attendance % / Working Days stat cards | counted from the `AttendanceRecord` queryset above | |
| "Report Period: ..." label | `date_from`/`date_to` params, or `AcademicYear.name`, or "All Time" | |

## 4. Learning Progress

| On report | Source | Notes |
|---|---|---|
| Topics grouped by subject | `LessonPlan` (lms app) — `status=PUBLISHED`, `.subject.name`, `.display_text`/`.title` | filtered by `class_obj` + `date_from`/`date_to` or `academic_year_id`; **class-level**, not per-student |

## 5. Exam Results (only shown if marks exist)

| On report | Source | Notes |
|---|---|---|
| Exam name / Subject / Marks / Percentage | `StudentMark` (examinations app) joined to `ExamSubject` → `Exam`, `Subject` | filtered by `date_from`/`date_to` (via `exam.start_date`) or `enrollment.academic_year_id` |
| Average % | computed from the same rows | |

## 6. Skills Assessment / Behaviour Evaluation / Remarks

| On report | Source | Notes |
|---|---|---|
| 7 skill ratings (Listening, Speaking, Writing, Reading, Participation, Confidence, Social Skills) | `StudentTermAssessment` (examinations app) | latest matching monthly row for the student in the resolved academic year; if `date_from`/`date_to` are present, the report prefers the newest month inside that range |
| 5 behaviour ratings (Discipline, Respect, Teamwork, Class Participation, Responsibility) | same `StudentTermAssessment` row | |
| Teacher Remark / Principal Remark | same row — `teacher_remark`, `principal_remark` | both fields come from the selected monthly snapshot; teacher saves still preserve principal remarks on the API side |

**Layout:** both the 7-row skill table and the 5-row behaviour table render as **two side-by-side columns** (`build_two_column_ratings()` in `student.py`, same split pattern as the fee table in §7 — `build_two_column_row()` is shared by both) instead of one tall single-column table, to keep the report compact.

**Entered via:** `/assessments` (class-wide monthly roster page — supports both a bulk "Save Month" and a per-student "Save" button) or the Student Profile page's "Assessment" tab (single-student, also month-aware). Both are backed by `examinations` app endpoints:
- `GET/POST /api/examinations/student-term-assessment/` — single student/month upsert (Student Profile tab, and the roster page's per-row save)
- `GET /api/examinations/student-term-assessment/roster/` — class roster for a given academic year + month
- `POST /api/examinations/student-term-assessment/bulk-save/` — bulk upsert for a whole class/month (roster page's "Save Month")
- `POST /api/examinations/student-term-assessment/ai-remark/` — drafts a Teacher/Principal remark from the ratings already entered for that student ("AI Suggest" button, roster page only); returns `400` if no ratings are set yet rather than inserting placeholder text

The model stores a `month` alongside `student` and `academic_year` (unique together), so each save targets one monthly snapshot instead of overwriting a single yearly row.

> **Selection rule:** if the report has `date_from`/`date_to`, section 6 chooses the newest assessment month covered by that window. If there is no date range, it chooses the latest month available for the academic year.

## 7. Fee Summary

| On report | Source | Notes |
|---|---|---|
| 12-month table (2 columns of 6 months, Month/Fee/Paid/Balance) | `FeePayment` (finance app), `Sum(amount_due)`, `Sum(amount_paid)` grouped by `(year, month)` | always the fixed 12 months starting the resolved academic year's `start_date` — **ignores `date_from`/`date_to`**, by design (a partial window isn't useful for spotting collection trends). Built via `build_two_column_row()` — the same 2-column helper used for the ratings tables in §6 |
| Total Fee / Total Paid / Outstanding stat cards | sums of the same 12-month data | |
| Due vs Paid bar chart | same 12-month data | **hand-drawn** in `build_fee_chart()` — thin rounded-top bars on a single baseline, hairline gridlines, borderless inline legend; no longer reportlab's `VerticalBarChart` widget. Colors are a validated, colorblind-safe categorical pair (blue `#2a78d6` = Due, green `#008300` = Paid) |

## 8. Signatures & Footer

| On report | Source | Notes |
|---|---|---|
| Teacher / Principal Signature / Date lines | static | no data |
| Footer (school name, "Generated by EducationAI", timestamp, "Page X of Y") | generated at render time | drawn on every page via a custom reportlab `Canvas` subclass (`_make_footer_canvas`), not stored anywhere |

## Cross-reference: models touched by this report

| App | Model | Used for |
|---|---|---|
| students | `Student` | profile fields, photo |
| academic_sessions | `AcademicYear`, `StudentEnrollment`, `SchoolCalendarEntry` | session label, class/roll resolution, holidays |
| attendance | `AttendanceRecord` | calendar + stats |
| lms | `LessonPlan` | learning progress |
| examinations | `StudentMark`, `ExamSubject`, `Exam`, `Subject`, `StudentTermAssessment` | exam results, skills/behaviour/remarks |
| finance | `FeePayment` | fee table, stat cards, chart |
| schools | `School` | letterhead |
