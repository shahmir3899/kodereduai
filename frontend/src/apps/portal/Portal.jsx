import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import LoginPage from '../../pages/LoginPage'
import SuperAdminDashboard from '../../pages/SuperAdminDashboard'
import LoadingSpinner from '../../components/LoadingSpinner'

/**
 * Super Admin Portal
 * 
 * Only accessible to users with is_super_admin=true
 * Shows SuperAdminDashboard for managing schools, users, etc.
 */
export default function Portal() {
  const { user, loading } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()

  // Check if user is super admin
  useEffect(() => {
    if (user && !loading) {
      if (!user.is_super_admin) {
        showError('Unauthorized: Super Admin access required')
        navigate('/access-denied')
      }
    }
  }, [user, loading, showError, navigate])

  if (loading) {
    return <LoadingSpinner />
  }

  // Not logged in → show login page
  if (!user) {
    return (
      <LoginPage
        isPortal={true}
        title="Super Admin Portal"
        subtitle="Platform Management Console"
      />
    )
  }

  // Logged in but not super admin → access denied
  if (!user.is_super_admin) {
    const handleLogout = () => {
      localStorage.removeItem('token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
    }

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded shadow-md text-center max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
          <p className="text-gray-700 mb-6">
            This portal is only accessible to Super Admin users.
          </p>
          <p className="text-sm text-gray-600 mb-6">
            Your role: <span className="font-medium">{user.role}</span>
          </p>
          <button
            onClick={handleLogout}
            className="inline-block bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700 cursor-pointer"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  // Super admin → show dashboard
  return <SuperAdminDashboard />
}
