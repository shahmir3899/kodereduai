import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import LoadingSpinner from '../../../components/LoadingSpinner'
import useSubdomainNavigate from '../../../hooks/useSubdomainNavigate'

/**
 * School-specific Login Page
 * 
 * Shows school branding and validates user belongs to school during login
 */
export default function SchoolLoginPage({ school }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const { showError, showSuccess } = useToast()
  const navigate = useSubdomainNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const user = await login(username, password)

      // Check if user has ANY school access
      if (!user.schools || user.schools.length === 0) {
        setError('Your account has no school assigned. Contact your administrator.')
        showError('No school access')
        return
      }

      // Validate: user must belong to this subdomain's school
      const hasAccessToThisSchool = school && user.schools?.some(s => s.id === school.id)
      if (!hasAccessToThisSchool) {
        setError(`You don't have access to ${school?.name || 'this school'}. Please login from your school's portal.`)
        showError('Access denied for this school')
        // Clear tokens since the user logged in but shouldn't be here
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        return
      }

      localStorage.setItem('active_school_id', school.id)
      localStorage.setItem('active_school_name', school.name)

      // Toast notification
      showSuccess(`Welcome back, ${user.first_name || user.username}!`)

      // Redirect to dashboard (subdomain param preserved automatically by useSubdomainNavigate)
      navigate('/dashboard')
    } catch (err) {
      const errorMsg =
        err.response?.data?.detail ||
        err.response?.data?.non_field_errors?.[0] ||
        err.message ||
        'Login failed'
      setError(errorMsg)
      showError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <LoadingSpinner />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full">
        {/* School Branding */}
        <div className="text-center mb-6 sm:mb-8">
          {school?.logo && (
            <img
              src={school.logo}
              alt={school.name}
              className="h-20 w-20 rounded-full object-cover mx-auto mb-4 border-2 border-blue-200"
              onError={(e) => {
                e.target.style.display = 'none'
              }}
            />
          )}
          <h1 className="text-2xl sm:text-3xl font-bold text-primary-700 mb-2">
            {school?.name || 'School'}
          </h1>
          {school?.address && (
            <p className="text-gray-600 text-sm">{school.address}</p>
          )}
          {school?.contact_email && (
            <p className="text-gray-500 text-xs mt-2">{school.contact_email}</p>
          )}
          <p className="mt-2 text-gray-600">Sign in to access your school</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl shadow-lg p-5 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="label" htmlFor="username">
                Username
              </label>
              <input
                type="text"
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="mb-6">
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                type="password"
                id="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full btn btn-primary py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          KoderEduAI.pk - AI-Powered Education Platform
        </p>
      </div>
    </div>
  )
}
