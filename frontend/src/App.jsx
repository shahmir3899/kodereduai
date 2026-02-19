import { Component, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

// Components (kept eager - needed for app shell)
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'

// Login kept eager (first page users see)
import LoginPage from './pages/LoginPage'

// Lazy-loaded pages
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CaptureReviewPage = lazy(() => import('./pages/CaptureReviewPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const StudentsPage = lazy(() => import('./pages/StudentsPage'))
const ClassesGradesPage = lazy(() => import('./pages/ClassesGradesPage'))
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const FeeCollectionPage = lazy(() => import('./pages/fee-collection/FeeCollectionPage'))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'))
const FinanceDashboardPage = lazy(() => import('./pages/FinanceDashboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const StudentProfilePage = lazy(() => import('./pages/StudentProfilePage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))

// HR pages
const HRDashboardPage = lazy(() => import('./pages/hr/HRDashboardPage'))
const StaffDirectoryPage = lazy(() => import('./pages/hr/StaffDirectoryPage'))
const StaffFormPage = lazy(() => import('./pages/hr/StaffFormPage'))
const DepartmentsPage = lazy(() => import('./pages/hr/DepartmentsPage'))
const SalaryManagementPage = lazy(() => import('./pages/hr/SalaryManagementPage'))
const PayrollPage = lazy(() => import('./pages/hr/PayrollPage'))
const LeaveManagementPage = lazy(() => import('./pages/hr/LeaveManagementPage'))
const StaffAttendancePage = lazy(() => import('./pages/hr/StaffAttendancePage'))
const PerformanceAppraisalPage = lazy(() => import('./pages/hr/PerformanceAppraisalPage'))
const StaffDocumentsPage = lazy(() => import('./pages/hr/StaffDocumentsPage'))

// Academics pages
const SubjectsPage = lazy(() => import('./pages/academics/SubjectsPage'))
const TimetablePage = lazy(() => import('./pages/academics/TimetablePage'))
const AcademicsAnalyticsPage = lazy(() => import('./pages/academics/AcademicsAnalyticsPage'))
const AcademicYearsPage = lazy(() => import('./pages/sessions/AcademicYearsPage'))
const PromotionPage = lazy(() => import('./pages/sessions/PromotionPage'))

// Examination pages
const ExamTypesPage = lazy(() => import('./pages/examinations/ExamTypesPage'))
const ExamsPage = lazy(() => import('./pages/examinations/ExamsPage'))
const MarksEntryPage = lazy(() => import('./pages/examinations/MarksEntryPage'))
const ResultsPage = lazy(() => import('./pages/examinations/ResultsPage'))
const ReportCardPage = lazy(() => import('./pages/examinations/ReportCardPage'))
const GradeScalePage = lazy(() => import('./pages/examinations/GradeScalePage'))

// Parent Portal pages
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'))
const ChildOverview = lazy(() => import('./pages/parent/ChildOverview'))
const ChildAttendance = lazy(() => import('./pages/parent/ChildAttendance'))
const ChildFees = lazy(() => import('./pages/parent/ChildFees'))
const ChildTimetable = lazy(() => import('./pages/parent/ChildTimetable'))
const ChildExamResults = lazy(() => import('./pages/parent/ChildExamResults'))
const LeaveApplication = lazy(() => import('./pages/parent/LeaveApplication'))
const ParentMessages = lazy(() => import('./pages/parent/ParentMessages'))
const PaymentResultPage = lazy(() => import('./pages/parent/PaymentResultPage'))

// Admissions pages
const EnquiriesPage = lazy(() => import('./pages/admissions/EnquiriesPage'))
const EnquiryForm = lazy(() => import('./pages/admissions/EnquiryForm'))

// Finance additions
const DiscountsPage = lazy(() => import('./pages/finance/DiscountsPage'))
const PaymentGatewayPage = lazy(() => import('./pages/finance/PaymentGatewayPage'))

// LMS pages
const CurriculumPage = lazy(() => import('./pages/lms/CurriculumPage'))
const LessonPlansPage = lazy(() => import('./pages/lms/LessonPlansPage'))
const AssignmentsPage = lazy(() => import('./pages/lms/AssignmentsPage'))
const SubmissionReviewPage = lazy(() => import('./pages/lms/SubmissionReviewPage'))

// Student Portal pages
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'))
const StudentAttendance = lazy(() => import('./pages/student/StudentAttendance'))
const StudentFees = lazy(() => import('./pages/student/StudentFees'))
const StudentTimetable = lazy(() => import('./pages/student/StudentTimetable'))
const StudentResults = lazy(() => import('./pages/student/StudentResults'))
const StudentAssignments = lazy(() => import('./pages/student/StudentAssignments'))
const StudentProfileView = lazy(() => import('./pages/student/StudentProfileView'))
const StudentStudyHelper = lazy(() => import('./pages/student/StudentStudyHelper'))

// Hostel pages
const HostelDashboard = lazy(() => import('./pages/hostel/HostelDashboard'))
const HostelRoomsPage = lazy(() => import('./pages/hostel/HostelRoomsPage'))
const HostelAllocationsPage = lazy(() => import('./pages/hostel/HostelAllocationsPage'))
const GatePassesPage = lazy(() => import('./pages/hostel/GatePassesPage'))

// Transport pages
const TransportDashboard = lazy(() => import('./pages/transport/TransportDashboard'))
const RoutesPage = lazy(() => import('./pages/transport/RoutesPage'))
const VehiclesPage = lazy(() => import('./pages/transport/VehiclesPage'))
const TransportAssignmentsPage = lazy(() => import('./pages/transport/TransportAssignmentsPage'))
const TransportAttendancePage = lazy(() => import('./pages/transport/TransportAttendancePage'))

// Library pages
const LibraryDashboard = lazy(() => import('./pages/library/LibraryDashboard'))
const BookCatalogPage = lazy(() => import('./pages/library/BookCatalogPage'))
const BookIssuePage = lazy(() => import('./pages/library/BookIssuePage'))
const OverdueBooksPage = lazy(() => import('./pages/library/OverdueBooksPage'))

// Inventory pages
const InventoryDashboard = lazy(() => import('./pages/inventory/InventoryDashboard'))
const InventoryItemsPage = lazy(() => import('./pages/inventory/InventoryItemsPage'))
const StockTransactionsPage = lazy(() => import('./pages/inventory/StockTransactionsPage'))
const ItemAssignmentsPage = lazy(() => import('./pages/inventory/ItemAssignmentsPage'))

// Face Attendance pages
const FaceAttendancePage = lazy(() => import('./pages/face-attendance/FaceAttendancePage'))
const FaceReviewPage = lazy(() => import('./pages/face-attendance/FaceReviewPage'))
const FaceEnrollmentPage = lazy(() => import('./pages/face-attendance/FaceEnrollmentPage'))

// Error Boundary to catch runtime crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('React Error Boundary caught:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
          <h1 style={{ color: '#dc2626' }}>Something went wrong</h1>
          <pre style={{ background: '#fef2f2', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Protected Route component
function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const { isAuthenticated, loading, isSuperAdmin } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

// Redirect root to role-appropriate dashboard
function RootRedirect() {
  const { isSuperAdmin, isParent, isStudent } = useAuth()
  if (isParent) return <Navigate to="/parent/dashboard" replace />
  if (isStudent) return <Navigate to="/student/dashboard" replace />
  return <Navigate to={isSuperAdmin ? '/admin' : '/dashboard'} replace />
}

// Guard: only allow student users
function StudentRoute({ children }) {
  const { isStudent } = useAuth()
  if (!isStudent) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

// Guard: only allow parent users
function ParentRoute({ children }) {
  const { isParent } = useAuth()
  if (!isParent) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

// Guard: redirect SuperAdmin away from school-internal routes
function SchoolRoute({ children }) {
  const { isSuperAdmin } = useAuth()
  if (isSuperAdmin) {
    return <Navigate to="/admin" replace />
  }
  return children
}

// Guard: block access to disabled modules
function ModuleRoute({ module, children }) {
  const { isModuleEnabled, isSuperAdmin } = useAuth()
  if (isSuperAdmin) return children
  if (!isModuleEnabled(module)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Module Not Available</h2>
        <p className="text-gray-500 max-w-md">This module is not enabled for your school. Contact your administrator to enable it.</p>
      </div>
    )
  }
  return children
}

function App() {
  const { loading } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<RootRedirect />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="dashboard" element={<SchoolRoute><DashboardPage /></SchoolRoute>} />

            {/* Attendance — consolidated into 2 pages */}
            <Route path="attendance" element={<SchoolRoute><ModuleRoute module="attendance"><CaptureReviewPage /></ModuleRoute></SchoolRoute>} />
            <Route path="attendance/review/:id" element={<SchoolRoute><ModuleRoute module="attendance"><CaptureReviewPage /></ModuleRoute></SchoolRoute>} />
            <Route path="attendance/register" element={<SchoolRoute><ModuleRoute module="attendance"><RegisterPage /></ModuleRoute></SchoolRoute>} />

            {/* Face Attendance (camera-based) */}
            <Route path="face-attendance" element={<SchoolRoute><ModuleRoute module="attendance"><FaceAttendancePage /></ModuleRoute></SchoolRoute>} />
            <Route path="face-attendance/review/:sessionId" element={<SchoolRoute><ModuleRoute module="attendance"><FaceReviewPage /></ModuleRoute></SchoolRoute>} />
            <Route path="face-attendance/enrollment" element={<SchoolRoute><ModuleRoute module="attendance"><FaceEnrollmentPage /></ModuleRoute></SchoolRoute>} />

            {/* Redirects from old routes */}
            <Route path="attendance/upload" element={<Navigate to="/attendance" replace />} />
            <Route path="attendance/review" element={<Navigate to="/attendance?tab=review" replace />} />
            <Route path="attendance/records" element={<Navigate to="/attendance/register" replace />} />
            <Route path="settings" element={<SchoolRoute><SettingsPage /></SchoolRoute>} />
            <Route path="accuracy" element={<Navigate to="/attendance/register?tab=analytics" replace />} />

            <Route path="students" element={<SchoolRoute><ModuleRoute module="students"><StudentsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="students/:id" element={<SchoolRoute><ModuleRoute module="students"><StudentProfilePage /></ModuleRoute></SchoolRoute>} />
            <Route path="classes" element={<SchoolRoute><ModuleRoute module="students"><ClassesGradesPage /></ModuleRoute></SchoolRoute>} />

            {/* HR routes */}
            <Route path="hr" element={<SchoolRoute><ModuleRoute module="hr"><HRDashboardPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/staff" element={<SchoolRoute><ModuleRoute module="hr"><StaffDirectoryPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/staff/new" element={<SchoolRoute><ModuleRoute module="hr"><StaffFormPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/staff/:id/edit" element={<SchoolRoute><ModuleRoute module="hr"><StaffFormPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/departments" element={<SchoolRoute><ModuleRoute module="hr"><DepartmentsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/salary" element={<SchoolRoute><ModuleRoute module="hr"><SalaryManagementPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/payroll" element={<SchoolRoute><ModuleRoute module="hr"><PayrollPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/leave" element={<SchoolRoute><ModuleRoute module="hr"><LeaveManagementPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/attendance" element={<SchoolRoute><ModuleRoute module="hr"><StaffAttendancePage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/appraisals" element={<SchoolRoute><ModuleRoute module="hr"><PerformanceAppraisalPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hr/documents" element={<SchoolRoute><ModuleRoute module="hr"><StaffDocumentsPage /></ModuleRoute></SchoolRoute>} />

            {/* Academics routes */}
            <Route path="academics/subjects" element={<SchoolRoute><ModuleRoute module="academics"><SubjectsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/timetable" element={<SchoolRoute><ModuleRoute module="academics"><TimetablePage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/analytics" element={<SchoolRoute><ModuleRoute module="academics"><AcademicsAnalyticsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/sessions" element={<SchoolRoute><ModuleRoute module="academics"><AcademicYearsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/promotion" element={<SchoolRoute><ModuleRoute module="academics"><PromotionPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/exam-types" element={<SchoolRoute><ModuleRoute module="examinations"><ExamTypesPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/exams" element={<SchoolRoute><ModuleRoute module="examinations"><ExamsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/marks-entry" element={<SchoolRoute><ModuleRoute module="examinations"><MarksEntryPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/results" element={<SchoolRoute><ModuleRoute module="examinations"><ResultsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/report-cards" element={<SchoolRoute><ModuleRoute module="examinations"><ReportCardPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/grade-scale" element={<SchoolRoute><ModuleRoute module="examinations"><GradeScalePage /></ModuleRoute></SchoolRoute>} />

            {/* Classes (legacy /grades redirects) */}
            <Route path="grades" element={<Navigate to="/classes" replace />} />

            {/* Notifications */}
            <Route path="notifications" element={<SchoolRoute><ModuleRoute module="notifications"><NotificationsPage /></ModuleRoute></SchoolRoute>} />

            {/* Finance routes */}
            <Route path="finance" element={<SchoolRoute><ModuleRoute module="finance"><FinanceDashboardPage /></ModuleRoute></SchoolRoute>} />
            <Route path="finance/fees" element={<SchoolRoute><ModuleRoute module="finance"><FeeCollectionPage /></ModuleRoute></SchoolRoute>} />
            <Route path="finance/accounts" element={<Navigate to="/settings?tab=accounts" replace />} />
            <Route path="finance/expenses" element={<SchoolRoute><ModuleRoute module="finance"><ExpensesPage /></ModuleRoute></SchoolRoute>} />
            <Route path="finance/reports" element={<Navigate to="/finance" replace />} />
            <Route path="finance/discounts" element={<SchoolRoute><ModuleRoute module="finance"><DiscountsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="finance/payment-gateways" element={<SchoolRoute><ModuleRoute module="finance"><PaymentGatewayPage /></ModuleRoute></SchoolRoute>} />

            {/* Parent Portal routes */}
            <Route path="parent/dashboard" element={<ParentRoute><ParentDashboard /></ParentRoute>} />
            <Route path="parent/children/:studentId" element={<ParentRoute><ChildOverview /></ParentRoute>} />
            <Route path="parent/children/:studentId/attendance" element={<ParentRoute><ChildAttendance /></ParentRoute>} />
            <Route path="parent/children/:studentId/fees" element={<ParentRoute><ChildFees /></ParentRoute>} />
            <Route path="parent/children/:studentId/timetable" element={<ParentRoute><ChildTimetable /></ParentRoute>} />
            <Route path="parent/children/:studentId/results" element={<ParentRoute><ChildExamResults /></ParentRoute>} />
            <Route path="parent/leave" element={<ParentRoute><LeaveApplication /></ParentRoute>} />
            <Route path="parent/messages" element={<ParentRoute><ParentMessages /></ParentRoute>} />
            <Route path="parent/payment-result" element={<ParentRoute><PaymentResultPage /></ParentRoute>} />

            {/* LMS routes */}
            <Route path="academics/curriculum" element={<SchoolRoute><ModuleRoute module="lms"><CurriculumPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/lesson-plans" element={<SchoolRoute><ModuleRoute module="lms"><LessonPlansPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/assignments" element={<SchoolRoute><ModuleRoute module="lms"><AssignmentsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="academics/assignments/:id/submissions" element={<SchoolRoute><ModuleRoute module="lms"><SubmissionReviewPage /></ModuleRoute></SchoolRoute>} />

            {/* Student Portal routes */}
            <Route path="student/dashboard" element={<StudentRoute><StudentDashboard /></StudentRoute>} />
            <Route path="student/attendance" element={<StudentRoute><StudentAttendance /></StudentRoute>} />
            <Route path="student/fees" element={<StudentRoute><StudentFees /></StudentRoute>} />
            <Route path="student/timetable" element={<StudentRoute><StudentTimetable /></StudentRoute>} />
            <Route path="student/results" element={<StudentRoute><StudentResults /></StudentRoute>} />
            <Route path="student/assignments" element={<StudentRoute><StudentAssignments /></StudentRoute>} />
            <Route path="student/profile" element={<StudentRoute><StudentProfileView /></StudentRoute>} />
            <Route path="student/study-helper" element={<StudentRoute><StudentStudyHelper /></StudentRoute>} />

            {/* Hostel routes */}
            <Route path="hostel" element={<SchoolRoute><ModuleRoute module="hostel"><HostelDashboard /></ModuleRoute></SchoolRoute>} />
            <Route path="hostel/rooms" element={<SchoolRoute><ModuleRoute module="hostel"><HostelRoomsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hostel/allocations" element={<SchoolRoute><ModuleRoute module="hostel"><HostelAllocationsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="hostel/gate-passes" element={<SchoolRoute><ModuleRoute module="hostel"><GatePassesPage /></ModuleRoute></SchoolRoute>} />

            {/* Transport routes */}
            <Route path="transport" element={<SchoolRoute><ModuleRoute module="transport"><TransportDashboard /></ModuleRoute></SchoolRoute>} />
            <Route path="transport/routes" element={<SchoolRoute><ModuleRoute module="transport"><RoutesPage /></ModuleRoute></SchoolRoute>} />
            <Route path="transport/vehicles" element={<SchoolRoute><ModuleRoute module="transport"><VehiclesPage /></ModuleRoute></SchoolRoute>} />
            <Route path="transport/assignments" element={<SchoolRoute><ModuleRoute module="transport"><TransportAssignmentsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="transport/attendance" element={<SchoolRoute><ModuleRoute module="transport"><TransportAttendancePage /></ModuleRoute></SchoolRoute>} />

            {/* Library routes */}
            <Route path="library" element={<SchoolRoute><ModuleRoute module="library"><LibraryDashboard /></ModuleRoute></SchoolRoute>} />
            <Route path="library/catalog" element={<SchoolRoute><ModuleRoute module="library"><BookCatalogPage /></ModuleRoute></SchoolRoute>} />
            <Route path="library/issues" element={<SchoolRoute><ModuleRoute module="library"><BookIssuePage /></ModuleRoute></SchoolRoute>} />
            <Route path="library/overdue" element={<SchoolRoute><ModuleRoute module="library"><OverdueBooksPage /></ModuleRoute></SchoolRoute>} />

            {/* Inventory routes */}
            <Route path="inventory" element={<SchoolRoute><ModuleRoute module="inventory"><InventoryDashboard /></ModuleRoute></SchoolRoute>} />
            <Route path="inventory/items" element={<SchoolRoute><ModuleRoute module="inventory"><InventoryItemsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="inventory/transactions" element={<SchoolRoute><ModuleRoute module="inventory"><StockTransactionsPage /></ModuleRoute></SchoolRoute>} />
            <Route path="inventory/assignments" element={<SchoolRoute><ModuleRoute module="inventory"><ItemAssignmentsPage /></ModuleRoute></SchoolRoute>} />

            {/* Admissions routes */}
            <Route path="admissions" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiriesPage /></ModuleRoute></SchoolRoute>} />
            <Route path="admissions/new" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiryForm /></ModuleRoute></SchoolRoute>} />
            <Route path="admissions/:id/edit" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiryForm /></ModuleRoute></SchoolRoute>} />

            {/* Super Admin routes */}
            <Route
              path="admin"
              element={
                <ProtectedRoute requireSuperAdmin>
                  <SuperAdminDashboard />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Catch-all redirect */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

export default App
