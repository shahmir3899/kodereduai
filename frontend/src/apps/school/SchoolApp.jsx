import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate, Routes, Route } from 'react-router-dom'
import { useSubdomainSchool } from '../../hooks/useSubdomainSchool'
import api from '../../services/api'
import App from '../../App'
import SchoolLoginPage from './pages/SchoolLoginPage'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useToast } from '../../components/Toast'

/**
 * School App Wrapper
 * 
 * Detects school subdomain, fetches school info, validates user membership,
 * and shows either login page or dashboard
 */
export default function SchoolApp() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showError } = useToast()
  const { subdomain, isSubdomain } = useSubdomainSchool()
  const [schoolData, setSchoolData] = useState(null)
  const [validationError, setValidationError] = useState(null)

  // Fetch school by subdomain
  const {
    data: school,
    isLoading: schoolLoading,
    error: schoolError,
  } = useQuery({
    queryKey: ['school-by-subdomain', subdomain],
    queryFn: () => api.get(`/api/schools/by-subdomain/?subdomain=${subdomain}`),
    enabled: isSubdomain && !!subdomain,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Process school data
  useEffect(() => {
    if (school?.data) {
      const schoolInfo = school.data
      setSchoolData(schoolInfo)
      // Store school context in localStorage (same keys as LoginPage expects)
      localStorage.setItem('currentSchoolId', schoolInfo.id.toString())
      localStorage.setItem('currentSchoolName', schoolInfo.name)
      localStorage.setItem('currentSchoolSubdomain', subdomain)
      if (schoolInfo.logo) {
        localStorage.setItem('currentSchoolLogo', schoolInfo.logo)
      }
      // Also set active_school_id for API requests
      localStorage.setItem('active_school_id', schoolInfo.id)
      localStorage.setItem('active_school_name', schoolInfo.name)
      // Clear portal mode
      localStorage.removeItem('isPortalMode')
      
      console.log(`✅ School loaded: ${schoolInfo.name} (ID: ${schoolInfo.id}, subdomain: ${subdomain})`)
    }
  }, [school, subdomain])

  // Validate user has access to this school after login
  useEffect(() => {
    if (user && schoolData && !authLoading) {
      // Check if user belongs to this school
      const hasAccess = user.schools?.some(s => s.id === schoolData.id)

      if (!hasAccess) {
        // User doesn't belong to this school
        const userSchool = user.schools?.[0]
        const errorMsg = `Your account is not registered for ${schoolData.name}.`

        setValidationError({
          message: errorMsg,
          userSchool,
        })

        // Auto-redirect after 3 seconds
        if (userSchool) {
          showError(errorMsg)
          setTimeout(() => {
            window.location.href = `https://${userSchool.subdomain}.kodereduai.pk`
          }, 3000)
        }
        return
      }

      // User has access - clear any validation errors
      setValidationError(null)
    }
  }, [user, schoolData, authLoading, showError])

  // Loading states
  if (!isSubdomain) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Invalid URL</h1>
          <p className="text-gray-600">This page must be accessed via a school subdomain.</p>
          <p className="text-sm text-gray-500 mt-4">
            Example: <code>focus.kodereduai.pk</code>
          </p>
        </div>
      </div>
    )
  }

  if (schoolLoading || authLoading) {
    return <LoadingSpinner />
  }

  if (schoolError) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">School Not Found</h1>
          <p className="text-gray-600">
            School with subdomain "{subdomain}" not found or is inactive.
          </p>
          <a
            href="https://www.kodereduai.pk"
            className="mt-4 inline-block text-blue-600 hover:underline"
          >
            Return to home
          </a>
        </div>
      </div>
    )
  }

  // Show validation error if user not authorized for this school
  if (validationError && user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded shadow-md max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-4">Access Denied</h2>
          <p className="text-gray-700 mb-4">{validationError.message}</p>
          {validationError.userSchool && (
            <p className="text-sm text-gray-600 mb-6">
              You have access to:{' '}
              <strong>{validationError.userSchool.name}</strong>
            </p>
          )}
          <p className="text-sm text-gray-600">
            Redirecting to your school in 3 seconds...
          </p>
          {validationError.userSchool && (
            <a
              href={`https://${validationError.userSchool.subdomain}.kodereduai.pk`}
              className="mt-4 block text-center bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Go to my school
            </a>
          )}
        </div>
      </div>
    )
  }

  // Not logged in → show login page
  if (!user) {
    return <SchoolLoginPage school={schoolData} />
  }

  // Logged in and authorized → show full app with routing
  return <App />
}
