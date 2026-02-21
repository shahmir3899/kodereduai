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
- Navigation sections: Attendance, Students, Academics, Finance, HR, Sessions, Admissions, Hostel, Transport, Library, Inventory, Settings

### SchoolSwitcher.jsx
Dropdown for switching active school. Reads from `useAuth().schools`. Calls `POST /api/auth/switch-school/`. Triggers page reload on switch.

### AcademicYearSwitcher.jsx
Dropdown for switching active academic year. Reads from `useAcademicYear()` context. Stored per-school in localStorage (`active_academic_year_{schoolId}`).

### NotificationBell.jsx
Bell icon with unread count badge. Calls `GET /api/notifications/unread-count/`. Links to /notifications.

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
- **FinanceChatWidget.jsx** — Collapsible AI chat for finance. Calls `POST /api/finance/ai-chat/`
- **AcademicsChatWidget.jsx** — AI chat for academics. Calls `POST /api/academics/ai-chat/`
- **CommunicationChatWidget.jsx** — AI chat for notifications. Calls `POST /api/notifications/ai-chat/`

### Dashboard Widgets
- **SessionHealthWidget.jsx** — Session health metrics. Calls `GET /api/sessions/health/`
- **AttendanceRiskWidget.jsx** — At-risk students. Calls `GET /api/sessions/attendance-risk/`
- **SchoolCompletionWidget.jsx** — School setup completion timeline with per-module progress. Calls `GET /api/schools/completion/` via `schoolsApi.getCompletion()`
- **AIInsightsCard.jsx** — Cross-module AI insights card on admin dashboard. Shows top 10 actionable insights (alerts, warnings, info) from attendance, finance, academics, HR. Color-coded by type with action links. Calls `GET /api/tasks/ai-insights/` via `tasksApi.getAIInsights()`

### AI Accuracy Dashboard Cards (in CaptureReviewPage.jsx)
- **Threshold Configuration Card** — Displays current per-school AI thresholds (fuzzy match, confidence, etc.), auto-tune toggle, last tuned date, history. Calls `GET/POST threshold_status/`, `tune_thresholds/`
- **Pipeline Configuration Card** — Primary provider selector (Google Vision / Groq Vision / Tesseract), fallback chain, multi-pipeline voting toggle. Pipeline badge on reviewed uploads.
- **Drift Monitor Card** — Line chart of daily accuracy with red dots for drift events. Alert banner when active drift detected. Calls `GET drift_history/`

### Attendance Anomaly Components (AnomaliesPage.jsx)
- **AnomaliesPage.jsx** — Full page at `/attendance/anomalies`. Filter bar (type, severity, resolved toggle), table with Date/Class/Description/Severity/Status/Actions columns. Severity badges: HIGH=red, MEDIUM=amber, LOW=blue. Resolve dialog with notes input. Calls `GET anomalies/`, `POST anomalies/{id}/resolve/`

### Role-Specific Dashboards (src/pages/)
The `/dashboard` route renders **DashboardRouter.jsx** which switches on `effectiveRole`:

- **DashboardRouter.jsx** — Switcher component. Lazy-loads role-specific dashboards, eagerly imports DashboardPage (most common).
- **DashboardPage.jsx** — SCHOOL_ADMIN / PRINCIPAL dashboard. Accepts `variant` prop; `variant="principal"` shows academic quick actions (Lesson Plans, Examinations, Class Management) instead of admin actions (Upload/Review Attendance, Manage Students).
- **TeacherDashboard.jsx** (src/pages/teacher/) — Today's timetable (`academicsApi.getMyTimetable`), stats (attendance to mark, pending grading, active assignments), submissions needing grading, 6 quick actions, notifications.
- **HRManagerDashboard.jsx** — 4 KPI cards from `hrApi.getDashboardStats()`, 6 quick actions linking to /hr sub-pages, notifications.
- **AccountantDashboard.jsx** — 4 KPI cards from `financeApi.getAccountBalances()`, `getMonthlySummary()`, `getFinanceSummary()`, 5 quick actions linking to /finance, notifications.
- **StaffDashboard.jsx** (src/pages/staff/) — Notifications list, conditional quick links (Profile, Notifications, Library if module enabled, Inventory if module enabled).

### Attendance Components
- **ManualEntryTab** (in RegisterPage.jsx) — Manual attendance entry with class/date selectors and P/A toggle grid. Tab within RegisterPage at `/attendance/register?tab=manual`. Calls `attendanceApi.getMyAttendanceClasses()`, `studentsApi.getStudents()`, `attendanceApi.getRecords()`, `attendanceApi.bulkEntryAttendance()`. Visible to Admin, Principal, Teacher only. Follows MarksEntryPage.jsx spreadsheet-style entry pattern.

### Modals
- **BatchConvertModal.jsx** — Batch convert admission enquiries to students. Calls `POST /api/admissions/enquiries/batch-convert/`
- **TransferModal.jsx** — Transfer funds between accounts. Calls `POST /api/finance/transfers/`

## Fee Collection Sub-components (src/pages/fee-collection/)
Complex page broken into:
- **FeeFilters.jsx** — Filter controls (month, year, class, status). Class/status filters apply client-side (no backend call)
- **FeeSummaryCards.jsx** — KPI cards (Total Payable, Received, Balance, Collection Rate). Summary computed client-side from cached payment data
- **FeeCharts.jsx** — Recharts visualizations (class-wise bar chart, status donut)
- **FeeTable.jsx** — Table with inline editing, bulk selection, sort by class/roll
- **FeeModals.jsx** — Multiple modals: CreateSingleFeeModal (auto-fills amount from fee structure via `resolve_amount`, conditional payment fields when amount_paid > 0, duplicate warning, searchable student dropdown), GenerateModal (preview via `preview_generation` before generation, confirmation step, auto-closes on success after 1.5s), FeeStructureModal (per-type fee tabs, confirmation review), PaymentModal, IncomeModal, StudentFeeModal
- **BulkActionsBar.jsx** — Bulk action toolbar with payment method selector, account picker, "Pay Full" button (sets each student's paid amount = their total payable in one click), confirmation dialogs
- **useFeeData.js** — Custom hook: single fetch per month/year/feeType, client-side class/status filtering via `useMemo`, client-side summary computation (replaces monthlySummary API call)
- **feeExport.js** — PDF/Excel export utilities

## Reusable Components (src/components/)
- **SearchableSelect.jsx** — Zero-dependency searchable dropdown. Text-input filtering, keyboard navigation (Arrow keys, Enter, Escape), click-outside close, loading/disabled/clear states. Used in CreateSingleFeeModal for student selection

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
| attendanceApi | /api/attendance/ | uploadImageToStorage, createUpload, confirmAttendance, getRecords, getThresholdStatus, tuneThresholds, getDriftHistory, getAnomalies, resolveAnomaly |
| schoolsApi | /api/schools/ | getMySchool, getAllSchools, getMarkMappings, getCompletion |
| studentsApi | /api/students/ | getStudents, createStudent, bulkCreate, getProfileSummary |
| classesApi | /api/classes/ | getClasses, createClass |
| financeApi | /api/finance/ | getFeePayments, generateMonthly, resolveFeeAmount, previewGeneration, getAccounts, createExpense, bulkUpdatePayments, bulkDeletePayments, createPayment |
| hrApi | /api/hr/ | getStaff, getDashboardStats, generatePayslips |
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
