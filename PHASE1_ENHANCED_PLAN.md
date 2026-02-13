# Phase 1: Enhanced Foundation Plan

## Current State Assessment

### Already Built (Previously thought missing)
- Academic Year / Session Management (CRUD, set current, summary)
- Terms (TERM/SEMESTER/QUARTER with ordering)
- Student Enrollment tracking with status (ACTIVE/PROMOTED/RETAINED/TRANSFERRED/WITHDRAWN)
- Bulk Student Promotion workflow
- Examination module (Exam Types, Exams, Subjects, Marks Entry, Results, Report Cards, Grade Scales)

### Actual Gaps Identified
The existing modules (Attendance, Finance, Timetable) are **NOT session-aware**. They operate independently of academic year/term, which means:
- Attendance records have no link to which academic session they belong to
- Fee structures are not tied to academic years
- Timetable entries don't know which session they're for
- No automatic carry-forward of data when a new session starts

---

## Phase 1 Implementation Plan

### Part A: Foundation Wiring (Connect Sessions to Everything)

#### A1. Attendance ↔ Session Integration
- Add `academic_year` FK to `AttendanceUpload` and `AttendanceRecord`
- Auto-resolve current academic year when creating attendance
- Filter attendance records by academic year/term on both backend and frontend
- Attendance register page: session selector filter

#### A2. Fee Structure ↔ Session Integration
- Add `academic_year` FK to `FeeStructure`
- Fee structures become session-specific (different fees each year)
- Fee collection page: filter by academic year
- Auto-carry-forward fee structures to new academic year

#### A3. Timetable ↔ Session Integration
- Add `academic_year` FK to `TimetableEntry`
- Timetable becomes session-specific
- When new session starts, option to clone previous timetable
- Timetable page: session selector

#### A4. Class-Subject ↔ Session Integration
- Add `academic_year` FK to `ClassSubject`
- Teacher-subject assignments become yearly
- Carry-forward assignments to new session

#### A5. Dashboard Session Context
- Dashboard shows data for current academic year by default
- Global session switcher in the top nav/header
- All stats and counts are session-scoped

---

### Part B: Section System Strengthening

#### B1. Grade → Section Flow Enhancement
- Verify Grade → Class (with section) → Student flow works end-to-end
- Ensure section field is properly used in:
  - Student listing and filtering
  - Attendance uploads (per section)
  - Timetable entries (per section)
  - Exam creation (per section)
  - Fee structures (per section)
- Add section-wise analytics views

#### B2. Section Management UI
- Add section management within grade view
- Quick-create sections (A, B, C, D) for a grade
- Bulk student transfer between sections

---

### Part C: AI-Powered Features (Phase 1 Enhancements)

#### C1. AI Smart Promotion Advisor
**What:** When promoting students at year-end, AI analyzes each student and recommends PROMOTE / RETAIN / REVIEW with confidence scores.

**How it works:**
- Input: Student's exam results (all terms), attendance rate, fee payment status
- AI evaluates:
  - Overall academic performance (weighted by exam type)
  - Attendance percentage (flag if below 75%)
  - Term-over-term improvement/decline trend
  - Subject-wise weak areas
- Output per student:
  - Recommendation: PROMOTE / RETAIN / NEEDS_REVIEW
  - Confidence: 0-100%
  - Reasoning: "Strong academics (82%), good attendance (91%), improving trend"
  - Risk flags: "Below passing in Mathematics (38%)", "Attendance dropped 15% in Term 3"

**Integration:** Shown on the Promotion page before bulk promote action. Teachers/admins can override.

#### C2. AI Session Health Dashboard
**What:** A natural language AI summary widget on the dashboard that gives a real-time "health check" of the current academic session.

**How it works:**
- Aggregates data across modules for current session:
  - Total enrollment vs capacity
  - Average attendance rate this term vs last term
  - Fee collection rate (% collected vs expected)
  - Exam performance summary (pass rate, average scores)
  - Staff attendance and leave patterns
- AI generates a concise 3-5 bullet summary in natural language
- Highlights top 3 concerns and top 3 achievements
- Compares current term to previous term

**Example Output:**
```
Session Health: 2025-2026 | Term 2

Highlights:
- Enrollment is at 94% capacity (847/900 students across 12 grades)
- Overall attendance improved 3.2% from Term 1 (88.4% → 91.6%)
- Fee collection at 78% — PKR 2.3M outstanding from 156 students

Concerns:
- Class 8-B has 23% chronic absenteeism (7 students below 70% attendance)
- Mathematics pass rate dropped to 61% in mid-terms (was 74% in Term 1)
- 3 teachers have taken 15+ leaves this term

Action Items:
- Review Class 8-B attendance patterns — consider parent meetings
- Math department may need intervention — suggest remedial classes
- Send fee reminders to 156 defaulting families
```

#### C3. AI Smart Section Allocator
**What:** When starting a new academic year, AI optimally distributes students across sections to create balanced classes.

**How it works:**
- Input: List of students being promoted to a grade, number of sections needed
- AI balances sections by:
  - Academic performance (mix of high/medium/low performers)
  - Gender ratio (equalize across sections)
  - Student count (even distribution)
  - Optional: keep friend groups, separate disruptive pairs (future)
- Output: Suggested section assignments for each student
- Admin can review, adjust, and confirm

#### C4. AI Attendance Risk Predictor
**What:** Predicts which students are at risk of chronic absenteeism based on patterns, enabling early intervention.

**How it works:**
- Analyzes historical attendance data per session/term
- Detects patterns:
  - Day-of-week patterns (always absent on Mondays)
  - Seasonal patterns (absent during harvest season, weather)
  - Declining trend (attendance dropping week over week)
  - Peer correlation (absent when friend group is absent)
- Flags students with:
  - Current attendance below threshold (configurable: 75%, 80%)
  - Predicted to fall below threshold within 2-4 weeks
  - Sudden change in pattern (was 95%, now 70%)
- Output: Risk list with severity (HIGH/MEDIUM/LOW), trend chart, suggested actions

#### C5. AI Auto-Session Setup Wizard
**What:** When creating a new academic year, AI pre-populates everything based on the previous year, saving hours of manual setup.

**How it works:**
1. Admin clicks "Create New Academic Year"
2. AI analyzes previous year and auto-generates:
   - Term dates (shifted by 1 year, adjusted for weekends/holidays)
   - Class-Subject mappings (cloned from previous year)
   - Fee structures (with optional % increase)
   - Timetable template (cloned structure)
   - Grade scales (carried forward)
3. Admin reviews the "setup preview" and can modify before confirming
4. One-click "Apply Setup" creates everything in bulk

---

## Implementation Order

| Step | Task | Dependencies | Estimated Effort |
|------|------|-------------|-----------------|
| 1 | A5: Dashboard session context + global session switcher | None | Small |
| 2 | A1: Attendance ↔ Session wiring | Step 1 | Medium |
| 3 | A2: Fee Structure ↔ Session wiring | Step 1 | Medium |
| 4 | A3: Timetable ↔ Session wiring | Step 1 | Medium |
| 5 | A4: ClassSubject ↔ Session wiring | Step 1 | Small |
| 6 | B1-B2: Section system strengthening | None | Medium |
| 7 | C5: AI Auto-Session Setup Wizard | Steps 1-5 | Medium |
| 8 | C2: AI Session Health Dashboard | Steps 1-5 | Medium |
| 9 | C1: AI Smart Promotion Advisor | Steps 1-5 | Medium |
| 10 | C3: AI Smart Section Allocator | Step 6 | Medium |
| 11 | C4: AI Attendance Risk Predictor | Step 2 | Medium |

---

## Technical Approach

### Backend Changes
- New migrations adding `academic_year` FK (nullable for backward compat) to existing models
- New API endpoints for AI features (use existing Groq LLM integration pattern)
- New management command: `setup_new_session` for AI wizard
- Session context middleware enhancement

### Frontend Changes
- Global `AcademicYearContext` provider (similar to AuthContext)
- Session switcher component in Layout header
- AI feature widgets/pages integrated into existing UI
- Promotion page enhanced with AI recommendations

### AI Integration
- Reuse existing Groq LLM pattern from Finance AI Chat and Attendance AI
- New `SessionAIService` for session-related AI features
- Structured prompts with school data context
- Confidence scoring pattern from attendance module

---

## Success Criteria
- All existing modules are session-aware
- Creating a new academic year carries forward all configuration
- AI provides actionable insights on the dashboard
- Promotion decisions are data-driven with AI recommendations
- Sections are balanced and properly utilized
- Zero breaking changes to existing functionality
