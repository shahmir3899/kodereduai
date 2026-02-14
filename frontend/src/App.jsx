import { Component } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

// Pages
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CaptureReviewPage from './pages/CaptureReviewPage'
import RegisterPage from './pages/RegisterPage'
import StudentsPage from './pages/StudentsPage'
import ClassesGradesPage from './pages/ClassesGradesPage'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import ProfilePage from './pages/ProfilePage'
import FeeCollectionPage from './pages/fee-collection/FeeCollectionPage'
import ExpensesPage from './pages/ExpensesPage'
import FinancialReportsPage from './pages/FinancialReportsPage'
import FinanceDashboardPage from './pages/FinanceDashboardPage'
import SettingsPage from './pages/SettingsPage'
import HRDashboardPage from './pages/hr/HRDashboardPage'
import StaffDirectoryPage from './pages/hr/StaffDirectoryPage'
import StaffFormPage from './pages/hr/StaffFormPage'
import DepartmentsPage from './pages/hr/DepartmentsPage'
import SalaryManagementPage from './pages/hr/SalaryManagementPage'
import PayrollPage from './pages/hr/PayrollPage'
import LeaveManagementPage from './pages/hr/LeaveManagementPage'
import StaffAttendancePage from './pages/hr/StaffAttendancePage'
import PerformanceAppraisalPage from './pages/hr/PerformanceAppraisalPage'
import StaffDocumentsPage from './pages/hr/StaffDocumentsPage'
import SubjectsPage from './pages/academics/SubjectsPage'
import TimetablePage from './pages/academics/TimetablePage'
import AcademicsAnalyticsPage from './pages/academics/AcademicsAnalyticsPage'
import AcademicYearsPage from './pages/sessions/AcademicYearsPage'
import PromotionPage from './pages/sessions/PromotionPage'
import ExamTypesPage from './pages/examinations/ExamTypesPage'
import ExamsPage from './pages/examinations/ExamsPage'
import MarksEntryPage from './pages/examinations/MarksEntryPage'
import ResultsPage from './pages/examinations/ResultsPage'
import ReportCardPage from './pages/examinations/ReportCardPage'
import GradeScalePage from './pages/examinations/GradeScalePage'
import StudentProfilePage from './pages/StudentProfilePage'
import NotificationsPage from './pages/NotificationsPage'

// Parent Portal pages
import ParentDashboard from './pages/parent/ParentDashboard'
import ChildOverview from './pages/parent/ChildOverview'
import ChildAttendance from './pages/parent/ChildAttendance'
import ChildFees from './pages/parent/ChildFees'
import ChildTimetable from './pages/parent/ChildTimetable'
import ChildExamResults from './pages/parent/ChildExamResults'
import LeaveApplication from './pages/parent/LeaveApplication'
import ParentMessages from './pages/parent/ParentMessages'
import PaymentResultPage from './pages/parent/PaymentResultPage'

// Admissions pages
import AdmissionDashboard from './pages/admissions/AdmissionDashboard'
import EnquiriesPage from './pages/admissions/EnquiriesPage'
import EnquiryDetail from './pages/admissions/EnquiryDetail'
import EnquiryForm from './pages/admissions/EnquiryForm'
import AdmissionSessionsPage from './pages/admissions/AdmissionSessionsPage'

// Finance additions
import DiscountsPage from './pages/finance/DiscountsPage'
import PaymentGatewayPage from './pages/finance/PaymentGatewayPage'

// LMS pages
import LessonPlansPage from './pages/lms/LessonPlansPage'
import AssignmentsPage from './pages/lms/AssignmentsPage'
import SubmissionReviewPage from './pages/lms/SubmissionReviewPage'

// Student Portal pages
import StudentDashboard from './pages/student/StudentDashboard'
import StudentAttendance from './pages/student/StudentAttendance'
import StudentFees from './pages/student/StudentFees'
import StudentTimetable from './pages/student/StudentTimetable'
import StudentResults from './pages/student/StudentResults'
import StudentAssignments from './pages/student/StudentAssignments'
import StudentProfileView from './pages/student/StudentProfileView'

// Transport pages
import TransportDashboard from './pages/transport/TransportDashboard'
import RoutesPage from './pages/transport/RoutesPage'
import VehiclesPage from './pages/transport/VehiclesPage'
import TransportAssignmentsPage from './pages/transport/TransportAssignmentsPage'
import TransportAttendancePage from './pages/transport/TransportAttendancePage'

// Library pages
import LibraryDashboard from './pages/library/LibraryDashboard'
import BookCatalogPage from './pages/library/BookCatalogPage'
import BookIssuePage from './pages/library/BookIssuePage'
import OverdueBooksPage from './pages/library/OverdueBooksPage'

// Components
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'

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
          <Route path="finance/reports" element={<SchoolRoute><ModuleRoute module="finance"><FinancialReportsPage /></ModuleRoute></SchoolRoute>} />
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

          {/* Admissions CRM routes */}
          <Route path="admissions" element={<SchoolRoute><ModuleRoute module="admissions"><AdmissionDashboard /></ModuleRoute></SchoolRoute>} />
          <Route path="admissions/enquiries" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiriesPage /></ModuleRoute></SchoolRoute>} />
          <Route path="admissions/enquiries/new" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiryForm /></ModuleRoute></SchoolRoute>} />
          <Route path="admissions/enquiries/:id" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiryDetail /></ModuleRoute></SchoolRoute>} />
          <Route path="admissions/enquiries/:id/edit" element={<SchoolRoute><ModuleRoute module="admissions"><EnquiryForm /></ModuleRoute></SchoolRoute>} />
          <Route path="admissions/sessions" element={<SchoolRoute><ModuleRoute module="admissions"><AdmissionSessionsPage /></ModuleRoute></SchoolRoute>} />

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
    </ErrorBoundary>
  )
}

export default App
