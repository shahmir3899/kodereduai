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
import FeeCollectionPage from './pages/fee-collection/FeeCollectionPage'
import ExpensesPage from './pages/ExpensesPage'
import FinancialReportsPage from './pages/FinancialReportsPage'
import AccountsPage from './pages/AccountsPage'

// Components
import Layout from './components/Layout'
import LoadingSpinner from './components/LoadingSpinner'

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

function App() {
  const { loading } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  return (
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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        {/* Attendance — consolidated into 2 pages */}
        <Route path="attendance" element={<CaptureReviewPage />} />
        <Route path="attendance/review/:id" element={<CaptureReviewPage />} />
        <Route path="attendance/register" element={<RegisterPage />} />

        {/* Redirects from old routes */}
        <Route path="attendance/upload" element={<Navigate to="/attendance" replace />} />
        <Route path="attendance/review" element={<Navigate to="/attendance?tab=review" replace />} />
        <Route path="attendance/records" element={<Navigate to="/attendance/register" replace />} />
        <Route path="settings" element={<Navigate to="/attendance/register?tab=config" replace />} />
        <Route path="accuracy" element={<Navigate to="/attendance/register?tab=analytics" replace />} />

        <Route path="students" element={<StudentsPage />} />
        <Route path="classes" element={<ClassesPage />} />

        {/* Finance routes */}
        <Route path="finance/fees" element={<FeeCollectionPage />} />
        <Route path="finance/accounts" element={<AccountsPage />} />
        <Route path="finance/expenses" element={<ExpensesPage />} />
        <Route path="finance/reports" element={<FinancialReportsPage />} />

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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
