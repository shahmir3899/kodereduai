# Frontend Components & Architecture

## Tech Stack
- **React 18.3** + **Vite 6.0** (NOT Next.js — no SSR, client-side routing only)
- **Tailwind CSS 3.4** — utility classes, no custom CSS
- **React Query 5.60** (@tanstack/react-query) — server state management
- **React Router 7.1** — client-side routing
- **Axios 1.7** — HTTP client

## Shared Components (src/components/)

### Layout.jsx
Main layout wrapper for all authenticated routes. Contains:
- **Header**: SchoolSwitcher, AcademicYearSwitcher, NotificationBell, TaskDrawer button, user profile menu, logout
- **Sidebar**: Role-based navigation menu with module availability checks, collapsible sections, active state highlighting
- **Content**: `<Outlet/>` renders page content
- Navigation sections: Attendance, Students, Academics, Finance (includes Accounts link at /finance/accounts), HR, Sessions, Admissions, Hostel, Transport, Library, Inventory, Messages, Settings

### SchoolSwitcher.jsx
Dropdown for switching active school. Reads from `useAuth().schools`. Calls `POST /api/auth/switch-school/`. Triggers page reload on switch.

### AcademicYearSwitcher.jsx
Dropdown for switching active academic year. Reads from `useAcademicYear()` context. Stored per-school in localStorage (`active_academic_year_{schoolId}`).

### NotificationBell.jsx
Bell icon with unread count badge. Polls `GET /api/notifications/unread-count/` every 30s. Dropdown shows 8 most recent notifications with mark-read on click, mark-all-read button. Bounce animation (3s) when new notifications arrive. Links to /notifications.

### Toast.jsx
Toast notification system with context provider.
- Methods: `showError()`, `showSuccess()`, `showWarning()`, `addToast()`
- Auto-dismissal with configurable duration
- Access via `useToast()` hook

### TaskDrawer.jsx
Sliding drawer showing background task progress. Uses BackgroundTaskContext. Shows task type, status, progress. Auto-polls status every 3 seconds.

### LoadingSpinner.jsx
Reusable spinner component used as Suspense fallback.

### AI Chat Widgets
All AI chat widgets support multi-round tool calling (LLM calls multiple tools per query) and conversation history on the backend. Send `{message}` via POST, receive `{response}`.

- **FinanceChatWidget.jsx** — Collapsible AI chat for finance queries. 18 tools: fee collection, expenses, scholarships, discounts, defaulters, payment methods, trends, etc. Calls `POST /api/finance/ai-chat/`
- **AcademicsChatWidget.jsx** — AI chat for timetable & academics. 13 tools: schedules, workload, quality scores, substitutes, curriculum gaps, conflict resolution, room usage, etc. Calls `POST /api/academics/ai-chat/`
- **CommunicationChatWidget.jsx** — AI chat for parent communication. 15 tools: student info, attendance, fees, exam results, assignments, transport, leave requests, etc. Calls `POST /api/notifications/ai-chat/`
- **StudentStudyHelper.jsx** — AI study assistant (student portal). Hybrid: free-form study help + 8 data tools (marks, assignments, topics, attendance, exams, materials, grade targets, feedback). Calls `POST /api/students/portal/study-helper/`

### Dashboard Widgets
- **SessionHealthWidget.jsx** — Session health metrics. Calls `GET /api/sessions/health/`
- **AttendanceRiskWidget.jsx** — At-risk students. Calls `GET /api/sessions/attendance-risk/`
- **SchoolCompletionWidget.jsx** — School setup completion timeline with per-module progress. Calls `GET /api/schools/completion/` via `schoolsApi.getCompletion()`
- **AIInsightsCard.jsx** — Cross-module AI insights card on admin dashboard. Shows top 10 actionable insights (alerts, warnings, info) from attendance, finance, academics, HR. Color-coded by type with action links. Calls `GET /api/tasks/ai-insights/` via `tasksApi.getAIInsights()`

### Shared Dashboard Components (src/components/dashboard/)
Reusable components created during the dashboard redesign. Used across all role-specific dashboards.

- **StatCard.jsx** — Reusable KPI card with icon, large value, subtitle, color theming (sky, green, red, amber, blue, purple, orange, gray), loading skeleton, optional Link wrapper. Props: `{ label, value, subtitle, icon, color, href, loading }`
- **QuickActionGrid.jsx** — Grid of icon action buttons with optional badge counts. 2-col on mobile, 3-col on sm+. Props: `{ actions: [{label, href, icon, color, badge}] }`
- **NotificationsFeed.jsx** — Self-contained notification list component. Fetches `notificationsApi.getMyNotifications({limit})` via React Query. Shows time-ago formatting, unread indicators (blue dot), "View All Notifications" link. Props: `{ limit }`
- **ModuleHealthCard.jsx** — Compact module status card with metric, status dot (green/yellow/red/gray), optional Link wrapper, loading skeleton. Used in admin dashboard Module Health Grid. Props: `{ icon, label, metric, metricLabel, status, href, loading }`

### AI Accuracy Dashboard Cards (in CaptureReviewPage.jsx)
- **Threshold Configuration Card** — Displays current per-school AI thresholds (fuzzy match, confidence, etc.), auto-tune toggle, last tuned date, history. Calls `GET/POST threshold_status/`, `tune_thresholds/`
- **Pipeline Configuration Card** — Primary provider selector (Google Vision / Groq Vision / Tesseract), fallback chain, multi-pipeline voting toggle. Pipeline badge on reviewed uploads.
- **Drift Monitor Card** — Line chart of daily accuracy with red dots for drift events. Alert banner when active drift detected. Calls `GET drift_history/`

### Attendance Anomaly Components (AnomaliesPage.jsx)
- **AnomaliesPage.jsx** — Full page at `/attendance/anomalies`. Filter bar (type, severity, resolved toggle), table with Date/Class/Description/Severity/Status/Actions columns. Severity badges: HIGH=red, MEDIUM=amber, LOW=blue. Resolve dialog with notes input. Calls `GET anomalies/`, `POST anomalies/{id}/resolve/`

### Role-Specific Dashboards (src/pages/)
The `/dashboard` route renders **DashboardRouter.jsx** which switches on `effectiveRole`:

- **DashboardRouter.jsx** — Switcher component. Lazy-loads role-specific dashboards, eagerly imports DashboardPage (most common).
- **DashboardPage.jsx** — SCHOOL_ADMIN / PRINCIPAL dashboard. Module-aware command center with: 4 KPI StatCards (Students, Attendance Rate, Fee Collection, Staff Present — all module-gated), collapsible AI Insights with module badges, two-column layout with Module Health Grid (10 modules with status dots), Attendance bar, Finance snapshot, Session Health, Attendance Risk (left column); Quick Actions (8 module-gated buttons), NotificationsFeed (right column). Principal variant shows academic-focused quick actions. All sections use `isModuleEnabled()` gating.
- **TeacherDashboard.jsx** (src/pages/teacher/) — 4 StatCards (Classes Today with "Now: Subject" subtitle, Attendance to Mark, Pending Grading, Upcoming Exams), enhanced timetable with current period highlighting (sky-blue bg + "Now" badge), Exams & Marks Entry section with "Enter Marks" links, Lesson Plans This Week with progress bar (completed/published/draft counts), QuickActionGrid, NotificationsFeed. All sections module-gated.
- **HRManagerDashboard.jsx** — 6 KPI StatCards (2 rows of 3: Total Staff, On Leave, Pending Leave, Staff Present %, Payroll This Month, Payslip Status), department breakdown with horizontal bar chart, pending leave requests with inline Approve/Reject buttons (useMutation), top absentees table, payroll overview (basic + allowances + deductions = net), QuickActionGrid, NotificationsFeed.
- **AccountantDashboard.jsx** — 4 enhanced StatCards, fee collection by class table (color-coded rates: green ≥80%, yellow ≥50%, red <50%), recent transactions list (credit/debit formatting), overdue fees list, income vs expense visual bars with net balance, per-account balances with type badges, QuickActionGrid, NotificationsFeed.
- **StaffDashboard.jsx** (src/pages/staff/) — Resolves myStaffId via `hrApi.getStaff({user: userId})`. 4 StatCards (Attendance This Month, Leave Balance, Last Salary, Notifications), mini attendance calendar grid with color-coded days (present=green, absent=red, leave=amber, today=ring), leave balance breakdown per type, recent payslips with status badges, assigned inventory items, NotificationsFeed.
- **StudentDashboard.jsx** (src/pages/student/) — Welcome card with gradient, 4 stat cards (Attendance, Fee Due, Assignments, Last Exam Score from `studentPortalApi.getExamResults`), two-column layout: timetable with current period highlighting, assignments with urgency indicators, recent exam results with percentage badges (left); quick links (6 items), NotificationsFeed (right).
- **ParentDashboard.jsx** (src/pages/parent/) — Per-child cards with `getChildOverview()` data: attendance rate, fees due (PKR amount), last exam %, today's status (Present/Absent/Late). Per-child action buttons (Attendance, Fees, Results, Timetable, Apply Leave). Shared QuickActionGrid + NotificationsFeed. Loading skeletons per child card.

### Attendance Components
- **CaptureReviewPage.jsx** — Main OCR attendance operations page at `/attendance` with tabs: Upload, Pending Review, Analytics, Configuration.
- **UploadTab** (in CaptureReviewPage.jsx) — Register image OCR upload flow with class/date and image pipeline controls.
- **PendingReviewTab** (in CaptureReviewPage.jsx) — Lists pending uploads and opens inline review details for confirmation.
- **AnalyticsTab** (src/components/attendance/AnalyticsTab.jsx) — AI accuracy metrics, trend table, and OCR error insights from `accuracy_stats/`.
- **ConfigurationTab** (src/components/attendance/ConfigurationTab.jsx) — Mark mapping + register layout configuration from school settings APIs.
- **ManualEntryPage.jsx** — Separate route at `/attendance/manual-entry` for manual attendance capture; writes to AttendanceRecord source MANUAL.
- **AttendanceRecordsPage.jsx** — Separate route at `/attendance/register` showing the consolidated register table from AttendanceRecord.

### Modals
- **BatchConvertModal.jsx** — Batch convert admission enquiries to students. Calls `POST /api/admissions/enquiries/batch-convert/`
- **TransferModal.jsx** — Transfer funds between accounts. Calls `POST /api/finance/transfers/`

## Fee Collection Sub-components (src/pages/fee-collection/)
Complex page broken into:
- **FeeFilters.jsx** — Filter controls (month, year, class, status). Class/status filters apply client-side (no backend call)
- **FeeSummaryCards.jsx** — KPI cards (Total Students, Total Payable, Received, Balance, Collection Rate) with per-class breakdown lines. Summary from backend `fee_summary/` endpoint (not client-side computed). Also exports **ClassBreakdown** component for detailed class table with expandable student rows
- **FeeCharts.jsx** — Recharts visualizations (class-wise bar chart, status donut)
- **FeeTable.jsx** — Table with inline editing, bulk selection, sort by class/roll
- **FeeModals.jsx** — Multiple modals: CreateSingleFeeModal (auto-fills amount from fee structure via `resolve_amount`, conditional payment fields when amount_paid > 0, duplicate warning, searchable student dropdown), GenerateModal (thin modal wrapper around shared fee-generation surface), FeeStructureModal (per-type fee tabs, confirmation review), PaymentModal, IncomeModal, StudentFeeModal
- **FeeGenerationSurface.jsx** — Shared fee-generation UI used by both Fee Setup and Fee Collect. Handles monthly vs annual switching, preview via `preview_generation`, category selection, conflict strategy, review state, result messaging, and responsive modal/inline presentation.
- **BulkActionsBar.jsx** — Bulk action toolbar with payment method selector, account picker, "Pay Full" button (sets each student's paid amount = their total payable in one click), confirmation dialogs
- **FeeSetupPage.jsx** — Dedicated 3-tab fee configuration page:
  - **Tab 1: Fee Structures** — By Class mode (fee amount per class for each fee type) and By Student mode (per-student overrides with blue highlight). Both have confirmation review step before saving.
  - **Tab 2: Generate Records** — Uses the shared fee-generation surface for monthly and annual generation, including live preview, category selection, conflict strategy, and confirmation flow.
  - **Tab 3: Student Discounts** — Select class to see students with columns: Roll, Name, Base Fee, Discount/Scholarship (badge), Effective Fee, Action. Per-student assign/remove modals (toggle discount vs scholarship, dropdown selection with value preview). Bulk assign button to apply one discount/scholarship to all students in class. Uses `discountApi` (getDiscounts, getScholarships, getStudentDiscounts, assignDiscount, bulkAssign, removeStudentDiscount).
- **useFeeSetup.js** — Custom hook for FeeSetupPage: fetches classes, all fee structures, class students, class fee structures. Provides bulkFeeMutation, bulkStudentFeeMutation, generateMutation, generateAnnualMutation.
- **useFeeOverview.js** — Custom hook for FeeOverviewPage: fetches backend `fee_summary/` for stat cards + individual fee-payments for ClassBreakdown drill-down. No mutations.
- **useFeeCollection.js** — Custom hook for FeeCollectPage: fetches backend `fee_summary/` (filter-aware) for stat cards, individual fee-payments for table, all payment mutations (generate, pay, bulk update/delete, create). Invalidates `feeSummary` cache on every mutation.
- **useFeeData.js** — Legacy hook (deprecated): single fetch per month/year/feeType, client-side class/status filtering via `useMemo`, client-side summary computation. Replaced by useFeeOverview/useFeeCollection + backend fee_summary endpoint
- **feeExport.js** — Fee Collection PDF export utility. Generates branded report with school logo/header, summary + class summary tables, class-sectioned student detail tables (Roll, Student, Fee Breakdown, Total Payable, Received, Balance, Remarks), per-class subtotal rows, class-teacher signature area after each class section, principal signature at final footer, and footer metadata (prepared date + page number).

## Reusable Components (src/components/)
- **ClassSelector.jsx** — Reusable class dropdown. Uses `useClasses()` hook for data fetching/caching. Props: value, onChange, placeholder, showAllOption, allOptionLabel, className, disabled, required, classes (external override), schoolId. Displays `name - section` format
- **SubjectSelector.jsx** — Reusable subject dropdown. Uses `useSubjects()` hook for data fetching/caching. Same prop interface as ClassSelector. Displays subject name
- **RTLWrapper.jsx** — Wraps content with `dir="rtl"` for RTL languages (ur, ar, sd, ps). Exports `isRTLLanguage()` helper
- **SearchableSelect.jsx** — Zero-dependency searchable dropdown. Text-input filtering, keyboard navigation (Arrow keys, Enter, Escape), click-outside close, loading/disabled/clear states. Used in CreateSingleFeeModal for student selection

## Custom Hooks (src/hooks/)
- **useClasses.js** — Fetches and caches classes via `classesApi.getClasses()`. Returns `{ classes, isLoading, error }`
- **useSubjects.js** — Fetches and caches subjects via `academicsApi.getSubjects()`. Returns `{ subjects, isLoading, error }`

## Utility Files
- **studentExport.js** — PDF/PNG export for student lists
- **gradePresets.js** — Pakistani grade levels (Playgroup through Class 10)

---

## Contexts (src/contexts/)

### AuthContext.jsx — `useAuth()`
Manages authentication state globally.
- **State**: user, tokens (localStorage), activeSchool, schools list
- **Methods**: login(username, password), logout(), switchSchool(schoolId), isModuleEnabled(module), getAllowableRoles()
- **Token storage**: `access_token`, `refresh_token`, `active_school_id` in localStorage
- **Interceptor**: Axios request interceptor adds `Authorization: Bearer {token}` + `X-School-ID` header. Response interceptor handles 401 → refresh token → retry.
- **Roles**: SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER, ACCOUNTANT, TEACHER, STAFF, PARENT, STUDENT

### AcademicYearContext.jsx — `useAcademicYear()`
Manages academic year selection per school.
- **State**: academicYears list, activeAcademicYear, terms, currentTerm
- **Storage**: `active_academic_year_{schoolId}` in localStorage
- **Logic**: Fetches years on school change, detects current term by date range
- **Methods**: setActiveAcademicYear(id)

### BackgroundTaskContext.jsx — `useBackgroundTasks()`
Tracks long-running Celery tasks.
- **State**: tasks list, polling status
- **Features**: Auto-polling every 3s while tasks active, toast on completion/failure, React Query invalidation on success
- **Task types**: REPORT_GENERATION, PAYSLIP_GENERATION, TIMETABLE_GENERATION, FEE_GENERATION, BULK_PROMOTION, PROMOTION_ADVISOR, AI_COMMENT_GENERATION
- **Methods**: addTask(task), dismissTask(id)

---

## Custom Hooks (src/hooks/)

### useBackgroundTask.js
Submit background task and track its result.
```js
const { trigger, isSubmitting, taskStatus, isComplete, resultData } = useBackgroundTask({
  mutationFn: (data) => api.post('/endpoint/', data),
  taskType: 'REPORT_GENERATION',
  title: 'Generating Report',
  onSuccess: (data) => { /* handle result */ }
})
```

### useDebounce.js
Debounce values for search inputs.
```js
const debouncedSearch = useDebounce(searchTerm, 300) // 300ms default
```

### useWorkflowTransition.js
Manage admissions workflow state.
```js
const { workflow, currentStage, nextStages, allowBypass } = useWorkflowTransition(enquiryId, sessionId)
```

---

## API Service Layer (src/services/api.js — 876 lines)

Centralized axios instance with interceptors. Organized into named API modules:

| Module | Prefix | Key Methods |
|--------|--------|-------------|
| attendanceApi | /api/attendance/ | uploadImageToStorage, createUpload, confirmAttendance, getRecords, getMyAttendanceClasses, getThresholdStatus, tuneThresholds, getDriftHistory, getAnomalies, resolveAnomaly |
| schoolsApi | /api/schools/ | getMySchool, getAllSchools, getMarkMappings, getCompletion |
| studentsApi | /api/students/ | getStudents, createStudent, bulkCreate, getProfileSummary |
| classesApi | /api/classes/ | getClasses, createClass |
| financeApi | /api/finance/ | getFeePayments, getFeeSummary, generateMonthly, generateOnetimeFees, generateAnnualFees, resolveFeeAmount, previewGeneration, getAccounts, createExpense, bulkUpdatePayments, bulkDeletePayments, createPayment, recordPayment, deleteFeePayment |
| hrApi | /api/hr/ | getStaff, getDashboardStats, generatePayslips, createStaffUserAccount, linkStaffUserAccount, unlinkStaffUserAccount, bulkCreateStaffAccounts |
| academicsApi | /api/academics/ | getSubjects, getTimetableEntries, autoGenerate |
| sessionsApi | /api/sessions/ | getAcademicYears, getEnrollments, bulkPromote, getHealth |
| examinationsApi | /api/examinations/ | getExams, getMarks, bulkEntry, getReportCard, generateComments |
| admissionsApi | /api/admissions/ | getEnquiries, batchConvert, updateStatus |
| notificationsApi | /api/notifications/ | getTemplates, sendNotification, getMyNotifications |
| parentPortalApi | /api/parents/ | getMyChildren, getChildOverview, submitLeave |
| studentPortalApi | /api/students/portal/ | getDashboard, getAttendance, studyHelper |
| transportApi | /api/transport/ | getRoutes, getVehicles, bulkAssign |
| libraryApi | /api/library/ | getBooks, issueBook, returnBook |
| hostelApi | /api/hostel/ | getHostels, getRooms, approveGatePass |
| inventoryApi | /api/inventory/ | getItems, getDashboard, createTransaction |
| lmsApi | /api/lms/ | getLessonPlans, getAssignments, gradeSubmission |
| messagingApi | /api/messaging/ | getThreads, getThread, createThread, reply, markRead, getRecipients, getUnreadCount |
| tasksApi | /api/tasks/ | getMyTasks, getTask, getAIInsights |
| reportsApi | /api/reports/ | generateReport, getReportList |

---

## Key Patterns

### Data Fetching (React Query)
```js
// Query
const { data, isLoading } = useQuery({
  queryKey: ['students', classId, search],
  queryFn: () => studentsApi.getStudents({ class_obj: classId, search }),
  enabled: !!classId,
})

// Mutation
const mutation = useMutation({
  mutationFn: (data) => studentsApi.createStudent(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['students'] })
    showSuccess('Student created')
  },
  onError: (err) => showError(err.response?.data?.detail || 'Failed')
})
```

### React Query Config (main.jsx)
- staleTime: 30 seconds
- gcTime: 5 minutes
- refetchOnWindowFocus: true
- retry: 1

### Page Component Pattern
```js
export default function SomePage() {
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading } = useQuery({...})

  if (isLoading) return <LoadingSpinner />
  return <div>...</div>
}
```

### Route Protection
```jsx
<Route element={<ProtectedRoute />}>
  <Route element={<SchoolRoute />}>
    <Route element={<Layout />}>
      <Route element={<ModuleRoute module="finance" />}>
        <Route path="/finance" element={<FinanceDashboard />} />
      </Route>
    </Route>
  </Route>
</Route>
```

### Lazy Loading
All pages loaded via `React.lazy()` with `<Suspense fallback={<LoadingSpinner />}>`.

### Icons
Inline SVG components defined in Layout.jsx (no external icon library).

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @tanstack/react-query | 5.60 | Server state, caching, background fetching |
| axios | 1.7.9 | HTTP client |
| react-router-dom | 7.1.0 | Client-side routing |
| recharts | 3.7.0 | Charts & data visualization |
| date-fns | 4.1.0 | Date formatting |
| react-dropzone | 14.3.0 | File drag-and-drop uploads |
| react-easy-crop | 5.5.6 | Image cropping |
| react-zoom-pan-pinch | 3.6.1 | Image zoom/pan (attendance review) |
| jspdf | 4.1.0 | PDF generation |
| jspdf-autotable | 5.0.7 | PDF table layout |
| xlsx | 0.18.5 | Excel read/write |
| html2canvas | 1.4.1 | DOM to canvas (screenshots) |
| compressorjs | 1.2.1 | Image compression before upload |
| msw | 2.12.10 | Mock Service Worker (testing) |

## Testing
- **Framework**: Vitest 4.0.18
- **Library**: React Testing Library + MSW
- **Commands**: `npm test` (watch), `npm run test:run` (single), `npm run test:phase3:coverage`
- **Test files**: `src/pages/__tests__/`, `src/pages/{module}/__tests__/`
