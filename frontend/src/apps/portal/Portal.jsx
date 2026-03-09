import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import LoginPage from '../../pages/LoginPage'
import App from '../../App'
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
      // Store subdomain before clearing everything
      const hostname = window.location.hostname
      const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.0.0.1')
      
      let redirectSubdomain = null
      if (isLocalhost) {
        // Check URL param first, then localStorage
        const params = new URLSearchParams(window.location.search)
        redirectSubdomain = params.get('subdomain') || localStorage.getItem('dev_subdomain')
      }
      
      // Clear auth tokens and state
      localStorage.removeItem('token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('access_token')
      localStorage.removeItem('active_school_id')
      localStorage.removeItem('active_school_name')
      localStorage.removeItem('isPortalMode')
      // Don't clear dev_subdomain on localhost - we need it!
      
      if (isLocalhost) {
        // Redirect with subdomain preserved
        if (redirectSubdomain && redirectSubdomain !== 'portal') {
          window.location.href = `/?subdomain=${redirectSubdomain}`
        } else {
          window.location.href = '/'
        }
      } else {
        // Production - user logged into wrong portal, send to school subdomain
        const schoolSubdomain = user.schools?.[0]?.subdomain
        if (schoolSubdomain && window.location.hostname.includes('kodereduai.pk')) {
          window.location.href = `https://${schoolSubdomain}.kodereduai.pk/`
        } else {
          window.location.href = '/login'
        }
      }
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

  // Super admin → show full app with routing
  return <App />
}
