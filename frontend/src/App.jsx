import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'

// Pages
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AttendanceUploadPage from './pages/AttendanceUploadPage'
import AttendanceReviewPage from './pages/AttendanceReviewPage'
import StudentsPage from './pages/StudentsPage'
import ClassesPage from './pages/ClassesPage'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import SettingsPage from './pages/SettingsPage'
import AccuracyDashboardPage from './pages/AccuracyDashboardPage'
import AttendanceRecordsPage from './pages/AttendanceRecordsPage'

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
        <Route path="attendance/upload" element={<AttendanceUploadPage />} />
        <Route path="attendance/review" element={<AttendanceReviewPage />} />
        <Route path="attendance/review/:id" element={<AttendanceReviewPage />} />
        <Route path="attendance/records" element={<AttendanceRecordsPage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="classes" element={<ClassesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="accuracy" element={<AccuracyDashboardPage />} />

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
