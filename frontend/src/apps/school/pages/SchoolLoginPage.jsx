import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import LoadingSpinner from '../../../components/LoadingSpinner'

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
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const user = await login(username, password)

      // VALIDATE: Does user belong to this school?
      if (school) {
        const hasAccessToSchool = user.schools?.some(s => s.id === school.id)

        if (!hasAccessToSchool) {
          // User doesn't belong to this school
          const userSchool = user.schools?.[0] || null
          const msg =
            `Your account is not registered for ${school.name}. ` +
            (userSchool
              ? `You have access to: ${user.schools
                  ?.map(s => s.name)
                  .join(', ')}`
              : 'Contact your school administrator.')

          setError(msg)
          showError('Access denied for this school')

          // Auto-redirect to user's primary school after 3 seconds
          if (userSchool) {
            setTimeout(() => {
              window.location.href = `https://${userSchool.subdomain}.kodereduai.pk`
            }, 3000)
          }
          return
        }
      }

      // Login successful
      localStorage.setItem('active_school_id', school.id)
      localStorage.setItem('active_school_name', school.name)

      // Toast notification
      showSuccess(`Welcome back, ${user.first_name || user.username}!`)

      // Redirect to dashboard
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* School Branding Card */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          {school?.logo && (
            <div className="text-center mb-6">
              <img
                src={school.logo}
                alt={school.name}
                className="h-20 mx-auto mb-4"
                onError={(e) => {
                  e.target.style.display = 'none'
                }}
              />
            </div>
          )}

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {school?.name || 'School'}
            </h1>
            {school?.address && (
              <p className="text-gray-600 text-sm">{school.address}</p>
            )}
            {school?.contact_email && (
              <p className="text-gray-500 text-xs mt-2">{school.contact_email}</p>
            )}
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your username"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>

        {/* Footer Links */}
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-600">
            Don't have an account?{' '}
            <a
              href="https://www.kodereduai.pk/signup"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Sign up here
            </a>
          </p>
          <p className="text-xs text-gray-500">
            <a
              href="https://www.kodereduai.pk"
              className="text-gray-600 hover:text-gray-700"
            >
              Back to home
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
