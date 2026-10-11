import { useState } from 'react'
import { AuthCardLayout, LoginForm } from '../../../components'
import { useAuth } from '../../../contexts/AuthContext'
import useSubdomainNavigate from '../../../hooks/useSubdomainNavigate'

/**
 * School-specific Login Page
 * 
 * Shows school branding and validates user belongs to school during login
 */
export default function SchoolLoginPage({ school }) {
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useSubdomainNavigate()

  const handleLogin = async ({ username, password, rememberMe }) => {
    setLoading(true)
    setError(null)

    try {
      const user = await login(username, password, rememberMe)

      // Check if user has ANY school access
      if (!user.schools || user.schools.length === 0) {
        setError('Your account has no school assigned. Contact your administrator.')
        return
      }

      // Validate: user must belong to this subdomain's school
      const membership = school && user.schools.find(s => s.id === school.id)
      if (!membership) {
        setError(`You don't have access to ${school?.name || 'this school'}. Please login from your school's portal.`)
        // Clear tokens since the user logged in but shouldn't be here
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        return
      }

      localStorage.setItem('active_school_id', school.id)
      localStorage.setItem('active_school_name', school.name)

      // Same role-aware landing as LoginPage: Parent/Student have their own
      // dashboards, and /dashboard would render the School Admin shell for them.
      // Navigation keeps the ?subdomain param on localhost via useSubdomainNavigate.
      const effectiveRole = membership.role || user.role
      if (effectiveRole === 'PARENT') {
        navigate('/parent/dashboard')
      } else if (effectiveRole === 'STUDENT') {
        navigate('/student/dashboard')
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        err.response?.data?.non_field_errors?.[0] ||
        err.message ||
        'Login failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCardLayout
      title={school?.name || 'School'}
      subtitle="Sign in to access your school"
      logo={school?.logo || '/Logo.jpeg'}
      address={school?.address || ''}
      email={school?.contact_email || ''}
    >
      <LoginForm
        onSubmit={handleLogin}
        onForgotPassword={() => navigate('/forgot-password')}
        error={error}
        loading={loading}
      />
    </AuthCardLayout>
  )
}
