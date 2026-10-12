import { useState, useEffect } from 'react'
import { AuthCardLayout, LoginForm } from '../components'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
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

  const handleSubmit = async ({ username, password, rememberMe }) => {
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
          // login() (AuthContext) already returns the flat user object —
          // there's no nested `.user` — this always evaluated to [] before,
          // rejecting every subdomain-scoped login regardless of role.
          const userSchools = userData.schools || []
          const hasAccess = userSchools.some(s => s.id === subdomainSchool.id)
          
          if (!hasAccess) {
            // User doesn't belong to this school
            setError(`You don't have access to ${subdomainSchool.name}`)
            setLoading(false)
            return
          }
        }
      }

      // Role-aware landing page — mirrors RootRedirect's logic (App.jsx),
      // which LoginPage's own post-login navigate never used. Previously
      // every non-super-admin landed on /dashboard regardless of role; that
      // was masked for PARENT/STUDENT by the hasAccess bug above always
      // rejecting them first, so this never actually ran for those roles
      // until that fix. Without this, a Parent/Student would reach
      // /dashboard, which DashboardRouter has no case for — falling through
      // to the School Admin dashboard shell (its data-fetching calls are
      // safely blocked server-side, but the UI itself is wrong for them).
      const userSchools = userData.schools || []
      const matchedSchool =
        (subdomainSchool && userSchools.find((s) => s.id === subdomainSchool.id)) ||
        userSchools.find((s) => s.is_default) ||
        userSchools[0] ||
        null
      const effectiveRole = matchedSchool?.role || userData.role

      if (effectiveRole === 'PARENT') {
        navigate('/parent/dashboard', { replace: true })
      } else if (effectiveRole === 'STUDENT') {
        navigate('/student/dashboard', { replace: true })
      } else {
        navigate(userData.is_super_admin ? '/admin' : '/dashboard', { replace: true })
      }
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

  // Portal passes its own branding explicitly; otherwise AuthCardLayout falls
  // back to the stored school (or generic EducationAI) branding.
  const portalBranding = isPortalMode
    ? {
        title: 'Education AI Admin Portal',
        subtitle: 'Super Administrator Access',
        logo: '/Logo.jpeg',
        address: '',
        email: '',
      }
    : {}

  return (
    <AuthCardLayout {...portalBranding}>
      <LoginForm
        onSubmit={handleSubmit}
        onForgotPassword={() => navigate('/forgot-password')}
        error={error}
        loading={loading}
      />
    </AuthCardLayout>
  )
}
