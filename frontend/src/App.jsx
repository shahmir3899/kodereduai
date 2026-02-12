import { Component } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

// Pages
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CaptureReviewPage from './pages/CaptureReviewPage'
import RegisterPage from './pages/RegisterPage'
import StudentsPage from './pages/StudentsPage'
import ClassesPage from './pages/ClassesPage'
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
import GradesPage from './pages/GradesPage'
import ExamTypesPage from './pages/examinations/ExamTypesPage'
import ExamsPage from './pages/examinations/ExamsPage'
import MarksEntryPage from './pages/examinations/MarksEntryPage'
import ResultsPage from './pages/examinations/ResultsPage'
import ReportCardPage from './pages/examinations/ReportCardPage'
import GradeScalePage from './pages/examinations/GradeScalePage'

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
  const { isSuperAdmin } = useAuth()
  return <Navigate to={isSuperAdmin ? '/admin' : '/dashboard'} replace />
}

// Guard: redirect SuperAdmin away from school-internal routes
function SchoolRoute({ children }) {
  const { isSuperAdmin } = useAuth()
  if (isSuperAdmin) {
    return <Navigate to="/admin" replace />
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
          <Route path="attendance" element={<SchoolRoute><CaptureReviewPage /></SchoolRoute>} />
          <Route path="attendance/review/:id" element={<SchoolRoute><CaptureReviewPage /></SchoolRoute>} />
          <Route path="attendance/register" element={<SchoolRoute><RegisterPage /></SchoolRoute>} />

          {/* Redirects from old routes */}
          <Route path="attendance/upload" element={<Navigate to="/attendance" replace />} />
          <Route path="attendance/review" element={<Navigate to="/attendance?tab=review" replace />} />
          <Route path="attendance/records" element={<Navigate to="/attendance/register" replace />} />
          <Route path="settings" element={<SchoolRoute><SettingsPage /></SchoolRoute>} />
          <Route path="accuracy" element={<Navigate to="/attendance/register?tab=analytics" replace />} />

          <Route path="students" element={<SchoolRoute><StudentsPage /></SchoolRoute>} />
          <Route path="classes" element={<SchoolRoute><ClassesPage /></SchoolRoute>} />

          {/* HR routes */}
          <Route path="hr" element={<SchoolRoute><HRDashboardPage /></SchoolRoute>} />
          <Route path="hr/staff" element={<SchoolRoute><StaffDirectoryPage /></SchoolRoute>} />
          <Route path="hr/staff/new" element={<SchoolRoute><StaffFormPage /></SchoolRoute>} />
          <Route path="hr/staff/:id/edit" element={<SchoolRoute><StaffFormPage /></SchoolRoute>} />
          <Route path="hr/departments" element={<SchoolRoute><DepartmentsPage /></SchoolRoute>} />
          <Route path="hr/salary" element={<SchoolRoute><SalaryManagementPage /></SchoolRoute>} />
          <Route path="hr/payroll" element={<SchoolRoute><PayrollPage /></SchoolRoute>} />
          <Route path="hr/leave" element={<SchoolRoute><LeaveManagementPage /></SchoolRoute>} />
          <Route path="hr/attendance" element={<SchoolRoute><StaffAttendancePage /></SchoolRoute>} />
          <Route path="hr/appraisals" element={<SchoolRoute><PerformanceAppraisalPage /></SchoolRoute>} />
          <Route path="hr/documents" element={<SchoolRoute><StaffDocumentsPage /></SchoolRoute>} />

          {/* Academics routes */}
          <Route path="academics/subjects" element={<SchoolRoute><SubjectsPage /></SchoolRoute>} />
          <Route path="academics/timetable" element={<SchoolRoute><TimetablePage /></SchoolRoute>} />
          <Route path="academics/analytics" element={<SchoolRoute><AcademicsAnalyticsPage /></SchoolRoute>} />
          <Route path="academics/sessions" element={<SchoolRoute><AcademicYearsPage /></SchoolRoute>} />
          <Route path="academics/promotion" element={<SchoolRoute><PromotionPage /></SchoolRoute>} />
          <Route path="academics/exam-types" element={<SchoolRoute><ExamTypesPage /></SchoolRoute>} />
          <Route path="academics/exams" element={<SchoolRoute><ExamsPage /></SchoolRoute>} />
          <Route path="academics/marks-entry" element={<SchoolRoute><MarksEntryPage /></SchoolRoute>} />
          <Route path="academics/results" element={<SchoolRoute><ResultsPage /></SchoolRoute>} />
          <Route path="academics/report-cards" element={<SchoolRoute><ReportCardPage /></SchoolRoute>} />
          <Route path="academics/grade-scale" element={<SchoolRoute><GradeScalePage /></SchoolRoute>} />

          {/* Grades */}
          <Route path="grades" element={<SchoolRoute><GradesPage /></SchoolRoute>} />

          {/* Finance routes */}
          <Route path="finance" element={<SchoolRoute><FinanceDashboardPage /></SchoolRoute>} />
          <Route path="finance/fees" element={<SchoolRoute><FeeCollectionPage /></SchoolRoute>} />
          <Route path="finance/accounts" element={<Navigate to="/settings?tab=accounts" replace />} />
          <Route path="finance/expenses" element={<SchoolRoute><ExpensesPage /></SchoolRoute>} />
          <Route path="finance/reports" element={<SchoolRoute><FinancialReportsPage /></SchoolRoute>} />

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
