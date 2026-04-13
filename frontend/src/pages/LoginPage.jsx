import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [subdomainSchool, setSubdomainSchool] = useState(null)
  const [isPortalMode, setIsPortalMode] = useState(false)

  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    // Check if this is portal mode
    const portalMode = localStorage.getItem('isPortalMode') === 'true'
    setIsPortalMode(portalMode)
    
    // Load subdomain school context (not used in portal mode)
    if (!portalMode) {
      const schoolId = localStorage.getItem('currentSchoolId')
      const schoolName = localStorage.getItem('currentSchoolName')
      const subdomain = localStorage.getItem('currentSchoolSubdomain')
      const logo = localStorage.getItem('currentSchoolLogo')
      
      if (schoolId && schoolName && subdomain) {
        setSubdomainSchool({ id: parseInt(schoolId), name: schoolName, subdomain, logo })
      }
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const userData = await login(username, password, rememberMe)
      
      // Portal mode: require SUPER_ADMIN role
      if (isPortalMode) {
        if (!userData.is_super_admin) {
          setError('Only super administrators can access the portal')
          setLoading(false)
          return
        }
      } else {
        // Regular school mode: validate user belongs to this school
        if (subdomainSchool) {
          const userSchools = userData.user?.schools || []
          const hasAccess = userSchools.some(s => s.id === subdomainSchool.id)
          
          if (!hasAccess) {
            // User doesn't belong to this school
            setError(`You don't have access to ${subdomainSchool.name}`)
            setLoading(false)
            return
          }
        }
      }
      
      navigate(userData.is_super_admin ? '/admin' : '/dashboard', { replace: true })
    } catch (err) {
      console.error('Login failed:', err)
      setError(
        err.response?.data?.detail ||
        err.response?.data?.error ||
        'Login failed. Please check your credentials.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full">
        {/* Logo/Title */}
        <div className="text-center mb-6 sm:mb-8">
          {isPortalMode ? (
            <>
              <img src="/Logo.jpeg" alt="KoderEduAI" className="h-16 w-16 rounded-full object-cover mx-auto mb-3" />
              <h1 className="text-2xl sm:text-3xl font-bold text-primary-700">KoderEduAI Admin Portal</h1>
              <p className="mt-2 text-gray-600">Super Administrator Access</p>
            </>
          ) : subdomainSchool ? (
            <>
              {subdomainSchool.logo && (
                <img 
                  src={subdomainSchool.logo} 
                  alt={subdomainSchool.name} 
                  className="h-20 w-20 rounded-full object-cover mx-auto mb-4 border-2 border-blue-200" 
                />
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-primary-700">{subdomainSchool.name}</h1>
              <p className="mt-2 text-gray-600">Sign in to access your school</p>
            </>
          ) : (
            <>
              <img src="/Logo.jpeg" alt="KoderEduAI" className="h-16 w-16 rounded-full object-cover mx-auto mb-3" />
              <h1 className="text-2xl sm:text-3xl font-bold text-primary-700">KoderEduAI</h1>
              <p className="mt-2 text-gray-600">AI-Powered Education Platform</p>
            </>
          )}
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl shadow-lg p-5 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-6">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
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
              />
            </div>

            <div className="mb-6 flex items-center gap-2">
              <input
                id="remember_me"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="remember_me" className="text-sm text-gray-700">
                Remember me on this device
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
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
