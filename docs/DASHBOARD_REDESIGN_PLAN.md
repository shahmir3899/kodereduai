# Dashboard Redesign Plan — All Roles

> **Purpose**: Transform each role's dashboard from attendance-centric to a comprehensive school management hub.
> **Approach**: Leverage existing backend APIs — no new backend endpoints needed unless noted.
> **Convention**: All dashboards use React Query, module gating via `isModuleEnabled()`, and Tailwind CSS.

## Implementation Status

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Shared components + SCHOOL_ADMIN/PRINCIPAL | **COMPLETED** |
| Phase 2 | Staff, Accountant, HR Manager dashboards | **COMPLETED** |
| Phase 3 | Teacher dashboard | **COMPLETED** |
| Phase 4 | Student + Parent dashboards | **COMPLETED** |
| Phase 5 | Super Admin overview tab | **NOT STARTED** |

---

## Table of Contents
1. [SCHOOL_ADMIN / PRINCIPAL Dashboard](#1-school_admin--principal-dashboard)
2. [TEACHER Dashboard](#2-teacher-dashboard)
3. [STUDENT Dashboard](#3-student-dashboard)
4. [PARENT Dashboard](#4-parent-dashboard)
5. [HR_MANAGER Dashboard](#5-hr_manager-dashboard)
6. [ACCOUNTANT Dashboard](#6-accountant-dashboard)
7. [STAFF Dashboard](#7-staff-dashboard)
8. [SUPER_ADMIN Dashboard](#8-super_admin-dashboard)
9. [Shared Components](#9-shared-components)
10. [Implementation Order](#10-implementation-order)
11. [New Backend Endpoints Needed](#11-new-backend-endpoints-needed)

---

## 1. SCHOOL_ADMIN / PRINCIPAL Dashboard

**File**: `frontend/src/pages/DashboardPage.jsx`
**Current state**: Attendance-heavy (3/4 stat cards are attendance). Shows pending reviews, absent students, finance overview, AI insights, session health, attendance risk.
**Goal**: Module-aware command center showing KPIs across ALL enabled modules.

### Layout (top to bottom)

#### A. Welcome Header
- School name, current academic year/term, today's date
- Compact inline alerts strip (unread notifications count, pending leave requests, overdue followups)

#### B. KPI Stats Row (4-6 cards, module-gated)
| Card | Source API | Condition |
|------|-----------|-----------|
| Total Students (enrolled this year) | `sessionsApi.getSessionHealth()` → `enrollment.total_enrolled` | Always |
| Today's Attendance Rate | `attendanceApi.getDailyReport()` → compute `present/total %` | `isModuleEnabled('attendance')` |
| Fee Collection Rate (this month) | `financeApi.getMonthlySummary()` → `collected/due %` | `isModuleEnabled('finance')` |
| Staff Present Today | `hrApi.getDashboardStats()` → `present_today` / `active_staff` | `isModuleEnabled('hr')` |
| Pending Admissions | `admissionsApi.getEnquiries({status: 'NEW'})` → `count` | `isModuleEnabled('admissions')` |
| Upcoming Exams | `examinationsApi.getExams({status:'SCHEDULED', page_size:1})` → `count` | `isModuleEnabled('examinations')` |

Each card: icon, label, value, trend arrow (compare with yesterday/last month where API supports it), click navigates to module page.

#### C. Two-Column Layout (desktop), Single Column (mobile)

**Left Column (60%)**:

##### C1. AI Insights Card (KEEP, but enhance)
- Keep existing `tasksApi.getAIInsights()`
- Group insights by module with colored badges
- Collapsible, max 5 shown by default

##### C2. Module Health Grid (NEW)
A 2x3 or 3x2 grid of mini-cards, one per enabled module. Each shows:
- Module icon + name
- Primary metric (e.g., "92% attendance", "78% fee collected", "12 staff on leave")
- Status indicator (green/yellow/red dot)
- Click → navigate to module dashboard

| Module | Metric | Source API | Status Logic |
|--------|--------|-----------|--------------|
| Attendance | Today's rate % | `attendanceApi.getDailyReport()` | ≥90% green, ≥75% yellow, <75% red |
| Finance | Collection rate % | `financeApi.getMonthlySummary()` | ≥80% green, ≥50% yellow, <50% red |
| HR | Staff present % | `hrApi.getDashboardStats()` | ≥90% green, ≥75% yellow, <75% red |
| Academics | Subjects assigned % | `academicsApi.getGapAnalysis()` | No gaps = green, gaps = yellow |
| Examinations | Next exam in N days | `examinationsApi.getExams({ordering:'start_date'})` | Upcoming = info, overdue marks = red |
| Admissions | Open enquiries | `admissionsApi.getEnquiries({status:'NEW'})` | Count display |
| Transport | Active routes today | `transportApi.getDashboardStats()` | All assigned = green |
| Library | Overdue books | `libraryApi.getDashboardStats()` | 0 = green, >0 = yellow |
| Hostel | Occupancy % | `hostelApi.getDashboard()` | Display only |
| Inventory | Low stock items | `inventoryApi.getDashboard()` | 0 = green, >0 = red |

Only show cards for modules where `isModuleEnabled(moduleKey)` is true.

##### C3. Attendance Overview (KEEP, simplified)
- Today's present/absent counts (horizontal bar)
- Pending reviews count with link
- Remove the full absent students table (move to attendance page)

**Right Column (40%)**:

##### C4. Finance Snapshot
- Fee collected vs pending (mini bar chart or donut)
- Collection rate badge
- "View Finance →" link
- Source: `financeApi.getMonthlySummary()`

##### C5. Quick Actions (REDESIGN)
Grid of icon buttons, module-gated:
| Action | Link | Module |
|--------|------|--------|
| Upload Attendance | `/attendance?tab=upload` | attendance |
| Record Payment | `/finance/fee-payments` | finance |
| Add Student | `/students?action=add` | students |
| Add Staff | `/hr/staff?action=add` | hr |
| Create Exam | `/examinations` | examinations |
| Send Notification | `/notifications?action=send` | notifications |
| School Setup | `/school-setup` | always |
| View Reports | `/reports` | always |

##### C6. Recent Activity / Notifications
- Last 5 notifications with unread indicator
- Source: `notificationsApi.getMyNotifications({limit: 5})`
- "View All →" link

#### D. Bottom Section (full width)

##### D1. Session Health Widget (KEEP)
- Already exists and works well
- Move below the fold — it's detailed/secondary info

##### D2. Attendance Risk Monitor (KEEP, collapsed by default)
- Show count badge "N students at risk"
- Expandable to see details

### What to REMOVE from current dashboard
- Absent students table (too detailed for dashboard — belongs on attendance page)
- The 4 attendance-only stat cards (replaced by module-aware KPI row)
- Finance overview section (replaced by Finance Snapshot card)

### Variant: PRINCIPAL
- Same layout, but Quick Actions show: Lesson Plans, Examinations, Teacher Management, Syllabus Progress
- Add a "Teacher Workload" mini card using `academicsApi.getWorkloadAnalysis()`

---

## 2. TEACHER Dashboard

**File**: `frontend/src/pages/teacher/TeacherDashboard.jsx`
**Current state**: Timetable + 3 stats + pending grading + quick actions + notifications. Decent foundation.
**Goal**: Add exam awareness, lesson plan tracking, student performance alerts.

### Layout

#### A. Welcome Bar
- "Good morning, {name}" with today's date
- Compact: classes assigned count, subjects count

#### B. KPI Stats Row (4 cards)
| Card | Source | Current? |
|------|--------|----------|
| Classes Today | `academicsApi.getMyTimetable({day})` → count | YES (keep) |
| Attendance to Mark | `attendanceApi.getMyAttendanceClasses()` → unmarked count | YES (keep) |
| Pending Grading | `lmsApi.getSubmissions({status:'SUBMITTED'})` → count | YES (keep) |
| Marks Entry Due | `examinationsApi.getExams({status:'PUBLISHED'})` → count exams needing marks | NEW |

#### C. Two-Column Layout

**Left Column (60%)**:

##### C1. Today's Timetable (KEEP, enhance)
- Current: shows today only
- Add: highlight current period (based on time), show attendance status per class (marked/not)
- Source: `academicsApi.getMyTimetable({day, academic_year})`
- Each row: time, subject, class, room, [Mark Attendance] button if not yet marked

##### C2. Upcoming Exams & Marks Entry (NEW)
- List of exams for teacher's subjects where marks entry is pending
- Source: `examinationsApi.getExams({academic_year, page_size: 5})` filtered client-side for teacher's subjects
- Show: exam name, subject, class, date, marks entry status (pending/complete)
- "Enter Marks →" button per exam

##### C3. Lesson Plan Status This Week (NEW, if LMS module enabled)
- Source: `lmsApi.getLessonPlans({date_from: weekStart, date_to: weekEnd, page_size: 20})`
- Show: planned vs completed for this week
- Mini progress bar
- "View All Plans →" link

**Right Column (40%)**:

##### C4. Submissions Needing Grading (KEEP)
- Already shows top 5 submissions
- Add: assignment name, student name, submitted date, "Grade →" button

##### C5. Quick Actions (REDESIGN)
| Action | Link | Condition |
|--------|------|-----------|
| Mark Attendance | `/attendance?tab=upload` | Always |
| My Timetable | `/academics/timetable` | Always |
| Lesson Plans | `/lms/lesson-plans` | LMS enabled |
| Assignments | `/lms/assignments` | LMS enabled |
| Enter Marks | `/examinations/marks` | Exams enabled |
| My Notifications | `/notifications` | Always |

##### C6. Recent Notifications (KEEP)
- Last 5 notifications

---

## 3. STUDENT Dashboard

**File**: `frontend/src/pages/student/StudentDashboard.jsx`
**Current state**: Welcome card, 3 stats, timetable, assignments, quick links. Well-designed already.
**Goal**: Add recent results, library info, announcements.

### Changes (minimal — enhance, don't rebuild)

#### A. Stats Row — Add 1 more card
| Card | Source | Status |
|------|--------|--------|
| Attendance Rate | `studentPortalApi.getDashboard()` → `stats.attendance_rate` | KEEP |
| Fee Outstanding | `studentPortalApi.getDashboard()` → `stats.fee_outstanding` | KEEP |
| Upcoming Assignments | `studentPortalApi.getDashboard()` → `stats.upcoming_assignments_count` | KEEP |
| Last Exam Score | `studentPortalApi.getExamResults()` → latest exam average | NEW |

#### B. Add "Recent Results" Section (NEW)
- Below timetable or as a tab alongside assignments
- Source: `studentPortalApi.getExamResults({page_size: 3})`
- Show: exam name, date, percentage/grade, pass/fail badge
- "View All Results →" link

#### C. Add "Library" Mini Section (NEW, if library module enabled)
- Source: `libraryApi.getIssues({page_size: 5})` filtered for current student (need to check if student portal has library endpoint)
- Show: books currently issued, due dates
- If no student library API exists → skip or show static "Visit Library" link

#### D. Add "Announcements" Section (NEW)
- Source: `notificationsApi.getMyNotifications({limit: 5})`
- Show school-wide announcements/notifications
- Unread indicator

---

## 4. PARENT Dashboard

**File**: `frontend/src/pages/parent/ParentDashboard.jsx`
**Current state**: Quick action cards + children cards (attendance %, fee status, last exam score) + notifications. Very thin.
**Goal**: Rich per-child daily status, fee due dates, exam schedules.

### Layout

#### A. Welcome Header
- "Welcome, {name}" with date
- Children count badge

#### B. Per-Child Cards (REDESIGN — richer cards)
For each child from `parentsApi.getMyChildren()`, fetch `parentsApi.getChildOverview(studentId)`:

Each child card shows:
| Field | Source |
|-------|--------|
| Name, class, section, roll number | `getMyChildren()` |
| **Today's Attendance** | `parentsApi.getChildAttendance({month, year})` → find today's record: Present/Absent/Not Marked badge |
| Attendance Rate % | `getChildOverview()` → `attendance_rate` |
| Fee Status | `getChildOverview()` → `fee_balance` (show amount due, colored badge) |
| Last Exam Score | `getChildOverview()` → last exam percentage |
| Next Fee Due | `parentsApi.getChildFees(studentId)` → find next UNPAID fee → show due date + amount |
| Bus Route (if transport) | `getChildOverview()` or transport assignment data |

Action buttons per child:
- "View Attendance" → `/parent/children/{id}/attendance`
- "View Fees" → `/parent/children/{id}/fees`
- "View Results" → `/parent/children/{id}/results`
- "Apply Leave" → `/parent/leave-requests?child={id}`

#### C. Upcoming Exams (NEW)
- Source: `parentsApi.getChildExamResults(studentId)` — check for upcoming/scheduled exams
- OR: Use a new lightweight endpoint (see [Backend Endpoints Needed](#11-new-backend-endpoints-needed))
- Show: exam name, date, subject, class
- One consolidated list if multiple children

#### D. Quick Actions (SIMPLIFY)
| Action | Link |
|--------|------|
| Apply Leave | `/parent/leave-requests` |
| Send Message | `/parent/messages` |
| Pay Fees | `/parent/children/{id}/fees` (if online payment enabled) |
| My Profile | `/profile` |

#### E. Recent Notifications (KEEP)
- Last 5 notifications with unread badges

---

## 5. HR_MANAGER Dashboard

**File**: `frontend/src/pages/HRManagerDashboard.jsx`
**Current state**: 4 KPI cards + quick actions + notifications. Bare minimum.
**Goal**: Add payroll overview, department breakdown, leave calendar, upcoming events.

### Layout

#### A. KPI Stats Row (6 cards, 2 rows of 3)
| Card | Source | Current? |
|------|--------|----------|
| Total Staff | `hrApi.getDashboardStats()` → `total_staff` (subtitle: `active_staff` active) | KEEP |
| On Leave Today | `hrApi.getDashboardStats()` → `on_leave_count` | KEEP |
| Pending Leave Requests | `hrApi.getDashboardStats()` → `pending_leave_requests` | KEEP |
| Staff Present Today | `hrApi.getDashboardStats()` → `present_today` / `active_staff` as % | KEEP (show as %) |
| Payroll This Month | `hrApi.getPayrollSummary({month, year})` → `total_net` | NEW |
| Payslip Status | `hrApi.getPayrollSummary({month, year})` → `status_counts` (DRAFT/APPROVED/PAID) | NEW |

#### B. Two-Column Layout

**Left Column (60%)**:

##### B1. Department Breakdown (NEW)
- Source: `hrApi.getDashboardStats()` → `department_breakdown`
- Horizontal bar chart or simple table: department name, staff count, head count
- Click department → filter staff directory

##### B2. Pending Leave Requests (NEW — detailed list)
- Source: `hrApi.getLeaveApplications({status: 'PENDING', page_size: 5})`
- Show: staff name, leave type, dates, duration
- Quick approve/reject buttons inline
- "View All →" link

##### B3. Staff Attendance Summary (NEW)
- Source: `hrApi.getAttendanceSummary({date_from: monthStart, date_to: today})`
- Show: top 5 staff by absences this month
- Mini table: name, present days, absent days, leave days

**Right Column (40%)**:

##### B4. Payroll Overview (NEW)
- Source: `hrApi.getPayrollSummary({month, year})`
- Show: total basic, allowances, deductions, net pay
- Status breakdown: N draft, N approved, N paid
- "Process Payroll →" button if drafts exist
- "View Payroll →" link

##### B5. Quick Actions (REDESIGN)
| Action | Link |
|--------|------|
| Add Staff | `/hr/staff?action=add` |
| Mark Staff Attendance | `/hr/attendance` |
| Process Payroll | `/hr/payroll` |
| Leave Management | `/hr/leave` |
| Staff Directory | `/hr/staff` |
| Appraisals | `/hr/appraisals` |

##### B6. Recent Notifications (KEEP)

---

## 6. ACCOUNTANT Dashboard

**File**: `frontend/src/pages/AccountantDashboard.jsx`
**Current state**: 4 KPI cards + quick actions + notifications. Very thin for a finance role.
**Goal**: Rich financial overview with recent transactions, overdue fees, income/expense breakdown.

### Layout

#### A. KPI Stats Row (4 cards, enhanced)
| Card | Source | Change |
|------|--------|--------|
| Account Balance | `financeApi.getAccountBalances()` → grand total | KEEP, add per-account tooltip |
| Fee Collected (this month) | `financeApi.getMonthlySummary()` → `total_collected` | KEEP |
| Fee Pending (this month) | `financeApi.getMonthlySummary()` → `total_pending` | KEEP, show as red if high |
| Collection Rate % | Computed: `collected / due * 100` | KEEP, color-coded |

#### B. Two-Column Layout

**Left Column (60%)**:

##### B1. Fee Collection by Class (NEW)
- Source: `financeApi.getMonthlySummary({month, year})` → `by_class` breakdown
- Table: class name, due, collected, pending, rate %
- Sorted by lowest collection rate (highlight problem classes)
- Color-code rows: green (≥80%), yellow (≥50%), red (<50%)

##### B2. Recent Transactions (NEW)
- Source: `financeApi.getRecentEntries({limit: 10})`
- Show: date, description, amount, type (income/expense), account
- "View All →" link

##### B3. Overdue Fee Payments (NEW)
- Source: `financeApi.getFeePayments({status: 'UNPAID', ordering: '-due_date', page_size: 10})`
- Show: student name, class, amount, due date, days overdue
- "Send Reminder" button (links to notifications)
- "View All Overdue →" link

**Right Column (40%)**:

##### B4. Income vs Expense (NEW)
- Source: `financeApi.getFinanceSummary({date_from: monthStart, date_to: today})`
- Simple visual: two horizontal bars (income green, expense red) or mini donut
- Show: total income, total expenses, net balance
- "View Finance Dashboard →" link

##### B5. Account Balances (NEW — per account)
- Source: `financeApi.getAccountBalances()`
- List each account: name, type badge, balance
- Compact card format

##### B6. Quick Actions (REDESIGN)
| Action | Link |
|--------|------|
| Record Fee Payment | `/finance/fee-payments` |
| Add Expense | `/finance/expenses` |
| Record Transfer | `/finance/transfers` |
| Generate Monthly Fees | `/finance/fee-payments?action=generate` |
| Finance Dashboard | `/finance` |
| Fee Discounts | `/finance/discounts` |

##### B7. Recent Notifications (KEEP)

---

## 7. STAFF Dashboard

**File**: `frontend/src/pages/staff/StaffDashboard.jsx`
**Current state**: Just notifications + 2-4 quick links. Practically empty.
**Goal**: Personal work hub — my attendance, leave, salary, announcements, assigned items.

### Layout

#### A. Welcome Header
- "Welcome, {name}" with role badge and today's date

#### B. KPI Stats Row (4 cards)
| Card | Source | Notes |
|------|--------|-------|
| My Attendance This Month | `hrApi.getAttendanceSummary({staff_member: myStaffId, date_from: monthStart, date_to: today})` | Present/Total days |
| Leave Balance | `hrApi.getLeaveBalance(myStaffId)` → remaining days | Total remaining across leave types |
| Last Salary | `hrApi.getPayslips({staff_member: myStaffId, page_size: 1, ordering: '-pay_period_end'})` → `net_salary` | Show net amount of latest payslip |
| Unread Notifications | `notificationsApi.getUnreadCount()` → `unread_count` | Badge count |

**Note**: Need to resolve `myStaffId` — the logged-in user's linked staff member ID. Check if `AuthContext` provides this or if we need to fetch via `hrApi.getStaff({user: currentUserId})`.

#### C. Two-Column Layout

**Left Column (60%)**:

##### C1. My Attendance Calendar (NEW)
- Source: `hrApi.getStaffAttendance({staff_member: myStaffId, date_from: monthStart, date_to: monthEnd})`
- Mini calendar grid showing present (green), absent (red), leave (yellow), holiday (gray) per day
- Month navigation (prev/next)
- Summary below: X present, Y absent, Z leave

##### C2. Announcements & Notifications (ENHANCED)
- Source: `notificationsApi.getMyNotifications({limit: 10})`
- Show with proper formatting: title, message preview, timestamp, read/unread badge
- "Mark All Read" button
- "View All →" link

**Right Column (40%)**:

##### C3. My Leave Balance (NEW — detailed)
- Source: `hrApi.getLeaveBalance(myStaffId)`
- Per leave type: type name, total allocated, used, remaining
- "Apply Leave" button → `/hr/leave?action=apply`

##### C4. Recent Payslips (NEW)
- Source: `hrApi.getPayslips({staff_member: myStaffId, page_size: 3, ordering: '-pay_period_end'})`
- Show: month, net salary, status (PAID/APPROVED/DRAFT)
- "Download" button for PAID payslips
- "View All →" link

##### C5. Quick Actions
| Action | Link | Condition |
|--------|------|-----------|
| My Profile | `/profile` | Always |
| Apply Leave | `/hr/leave?action=apply` | HR enabled |
| My Payslips | `/hr/payroll?tab=my` | HR enabled |
| Notifications | `/notifications` | Always |
| Library | `/library` | Library enabled |
| Inventory | `/inventory` | Inventory enabled |

##### C6. Assigned Inventory (NEW, if inventory module enabled)
- Source: `inventoryApi.getAssignments({user: currentUserId, page_size: 5})`
- Show: item name, assigned date, status
- Compact list

---

## 8. SUPER_ADMIN Dashboard

**File**: `frontend/src/pages/SuperAdminDashboard.jsx`
**Current state**: Pure CRUD admin panel (tabs for schools/users/orgs/memberships). No overview metrics.
**Goal**: Add a summary overview tab as the default landing, keep CRUD tabs.

### Changes

#### A. Add "Overview" Tab (NEW — make it default)
This tab shows platform-wide metrics:

##### A1. Platform KPI Row (4 cards)
| Card | Source |
|------|--------|
| Total Schools | `schoolsApi.getPlatformStats()` → `total_schools` |
| Active Schools | `schoolsApi.getPlatformStats()` → `active_schools` |
| Total Students | `schoolsApi.getPlatformStats()` → `total_students` |
| Total Users | `schoolsApi.getPlatformStats()` → `total_users` |

##### A2. School Health Grid (NEW)
- Source: `schoolsApi.getPlatformStats()` → `school_breakdown`
- Table: school name, students, users, uploads this month, status (active/inactive)
- Color-code inactive schools
- Click → school detail page

##### A3. Recent Activity
- Source: `schoolsApi.getPlatformStats()` → `recent_schools`, `recent_users`
- Two mini lists: recently added schools, recently added users
- Show: name, date added

##### A4. Growth Metrics (NICE-TO-HAVE)
- Compare current month totals vs previous month
- This would need a new backend endpoint or client-side computation
- Lower priority — implement if time permits

#### B. Keep Existing Tabs
- Schools, Users, Organizations, Memberships tabs remain unchanged
- Just add "Overview" as first tab

---

## 9. Shared Components

### New Reusable Components to Create

#### `StatCard.jsx`
```
Props: { label, value, subtitle, icon, color, trend, onClick, loading }
```
- Consistent stat card used across all dashboards
- Shows: icon, label, large value, optional subtitle, optional trend arrow (↑↓)
- Click handler for navigation
- Loading skeleton state

#### `ModuleHealthCard.jsx`
```
Props: { icon, label, metric, metricLabel, status, onClick, loading }
```
- Mini card for module health grid (admin dashboard)
- Status dot: green/yellow/red
- Click to navigate

#### `MiniCalendar.jsx`
```
Props: { data: [{date, status}], month, year, onMonthChange }
```
- Small month calendar grid with colored day cells
- Used in Staff dashboard (attendance) and Parent dashboard (child attendance)

#### `QuickActionGrid.jsx`
```
Props: { actions: [{label, icon, href, badge}] }
```
- Consistent grid of action buttons
- Used across all dashboards
- Module-gated rendering

#### `NotificationsFeed.jsx`
```
Props: { limit, showMarkAllRead }
```
- Self-contained notification list with React Query
- Used in all dashboards that show notifications
- Handles unread badges, mark-read, "View All" link

### File Locations
```
frontend/src/components/dashboard/
├── StatCard.jsx
├── ModuleHealthCard.jsx
├── MiniCalendar.jsx
├── QuickActionGrid.jsx
└── NotificationsFeed.jsx
```

---

## 10. Implementation Order

### Phase 1: Shared Components + SCHOOL_ADMIN (highest impact) — COMPLETED
1. ~~Create `frontend/src/components/dashboard/StatCard.jsx`~~ ✅
2. ~~Create `frontend/src/components/dashboard/QuickActionGrid.jsx`~~ ✅
3. ~~Create `frontend/src/components/dashboard/NotificationsFeed.jsx`~~ ✅
4. ~~Create `frontend/src/components/dashboard/ModuleHealthCard.jsx`~~ ✅
5. ~~Redesign `DashboardPage.jsx` (SCHOOL_ADMIN/PRINCIPAL)~~ ✅

### Phase 2: Staff-level Dashboards (most improvement needed) — COMPLETED
6. ~~Redesign `StaffDashboard.jsx`~~ ✅ — Was empty; now has 4 KPIs, mini attendance calendar, leave balance breakdown, recent payslips, assigned inventory
7. ~~Redesign `AccountantDashboard.jsx`~~ ✅ — Now has enhanced KPIs, fee collection by class, recent transactions, overdue fees, income vs expense, per-account balances
8. ~~Redesign `HRManagerDashboard.jsx`~~ ✅ — Now has 6 KPIs, department breakdown with bars, pending leave with inline approve/reject, top absentees, payroll overview

### Phase 3: Teacher Dashboard (good foundation, enhance) — COMPLETED
9. ~~Enhance `TeacherDashboard.jsx`~~ ✅ — Now has 4 KPIs (with "Now" indicator), current period highlighting, exams & marks entry section, lesson plans this week with progress bar

### Phase 4: Portal Dashboards (student + parent) — COMPLETED
10. ~~Enhance `StudentDashboard.jsx`~~ ✅ — Now has 4 stat cards (added Last Exam Score), two-column layout, recent results section, enhanced timetable with current period, notifications feed
11. ~~Redesign `ParentDashboard.jsx`~~ ✅ — Now has richer per-child cards with getChildOverview() data (attendance, fees due, last exam, today's status), per-child action buttons, shared QuickActionGrid + NotificationsFeed
12. MiniCalendar.jsx — Skipped; Staff dashboard uses inline calendar grid instead of a separate component

### Phase 5: Super Admin (lowest priority) — NOT STARTED
13. Add Overview tab to `SuperAdminDashboard.jsx`

### Estimated Scope per Phase
| Phase | Files Created | Files Modified | Complexity |
|-------|--------------|----------------|------------|
| Phase 1 | 4 components | 1 page | High (admin dashboard is largest) |
| Phase 2 | 0 | 3 pages | Medium |
| Phase 3 | 0 | 1 page | Low-Medium |
| Phase 4 | 1 component | 2 pages | Medium |
| Phase 5 | 0 | 1 page | Low |

---

## 11. New Backend Endpoints Needed

### Required (blocking)
None — all dashboards can be built with existing APIs.

### Nice-to-Have (non-blocking, can add later)

1. **`GET /api/hr/staff/me/`** — Return the staff member linked to the current user
   - **Why**: Staff dashboard needs `myStaffId` to fetch personal attendance, leave, payslips
   - **Workaround**: Fetch `hrApi.getStaff({user: currentUserId, page_size: 1})` and take first result
   - **File**: `backend/hr/views.py` — add `@action(detail=False)` to StaffViewSet

2. **`GET /api/parents/children/{id}/upcoming-exams/`** — Upcoming exams for a specific student
   - **Why**: Parent dashboard exam schedule
   - **Workaround**: Use `examinationsApi.getExams({class_obj: childClassId, status: 'SCHEDULED'})` if class ID is available from child overview
   - **File**: `backend/parents/views.py`

3. **`GET /api/sessions/academic-years/current/summary/`** — Quick summary without needing year ID
   - **Why**: Dashboard needs enrollment count without knowing year ID upfront
   - **Workaround**: Use `sessionsApi.getCurrentYear()` then `getYearSummary(id)`
   - **File**: `backend/academic_sessions/views.py`

4. **`GET /api/admin/schools/platform_stats/`** — Add month-over-month growth
   - **Why**: Super admin dashboard growth metrics
   - **Workaround**: Skip growth metrics initially
   - **File**: `backend/schools/views.py`

---

## Appendix: API Reference per Dashboard

### SCHOOL_ADMIN APIs Used
```
attendanceApi.getDailyReport(date, schoolId, academicYearId)
attendanceApi.getPendingReviews()
financeApi.getMonthlySummary({month, year, academic_year})
hrApi.getDashboardStats()
admissionsApi.getEnquiries({status: 'NEW', page_size: 1})
examinationsApi.getExams({status: 'SCHEDULED', page_size: 1})
academicsApi.getGapAnalysis()
transportApi.getDashboardStats()
libraryApi.getDashboardStats()
hostelApi.getDashboard()
inventoryApi.getDashboard()
tasksApi.getAIInsights()
sessionsApi.getSessionHealth({academic_year})
sessionsApi.getAttendanceRisk({academic_year})
notificationsApi.getMyNotifications({limit: 5})
```

### TEACHER APIs Used
```
academicsApi.getMyTimetable({day, academic_year})
attendanceApi.getMyAttendanceClasses()
lmsApi.getSubmissions({status: 'SUBMITTED', page_size: 10})
lmsApi.getLessonPlans({date_from, date_to, page_size: 20})
examinationsApi.getExams({academic_year, page_size: 5})
notificationsApi.getMyNotifications({limit: 5})
```

### STUDENT APIs Used
```
studentPortalApi.getDashboard()
studentPortalApi.getExamResults({page_size: 3})
notificationsApi.getMyNotifications({limit: 5})
```

### PARENT APIs Used
```
parentsApi.getMyChildren()
parentsApi.getChildOverview(studentId)        — per child
parentsApi.getChildAttendance(studentId, {month, year})  — per child
parentsApi.getChildFees(studentId)            — per child
parentsApi.getChildExamResults(studentId)     — per child
notificationsApi.getMyNotifications({limit: 5})
```

### HR_MANAGER APIs Used
```
hrApi.getDashboardStats()
hrApi.getPayrollSummary({month, year})
hrApi.getLeaveApplications({status: 'PENDING', page_size: 5})
hrApi.getAttendanceSummary({date_from, date_to})
notificationsApi.getMyNotifications({limit: 5})
```

### ACCOUNTANT APIs Used
```
financeApi.getAccountBalances()
financeApi.getMonthlySummary({month, year})
financeApi.getFinanceSummary({date_from, date_to})
financeApi.getRecentEntries({limit: 10})
financeApi.getFeePayments({status: 'UNPAID', ordering: '-due_date', page_size: 10})
notificationsApi.getMyNotifications({limit: 5})
```

### STAFF APIs Used
```
hrApi.getStaff({user: currentUserId, page_size: 1})   — resolve myStaffId
hrApi.getStaffAttendance({staff_member, date_from, date_to})
hrApi.getLeaveBalance(staffMemberId)
hrApi.getPayslips({staff_member, page_size: 3, ordering: '-pay_period_end'})
inventoryApi.getAssignments({user: currentUserId, page_size: 5})
notificationsApi.getMyNotifications({limit: 10})
notificationsApi.getUnreadCount()
```

### SUPER_ADMIN APIs Used
```
schoolsApi.getPlatformStats()
— Plus all existing CRUD APIs (unchanged)
```
