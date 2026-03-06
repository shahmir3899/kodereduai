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
      // Only set active_school_id if not already set (preserve explicit switch)
      if (!localStorage.getItem('active_school_id')) {
        localStorage.setItem('active_school_id', schoolInfo.id)
        localStorage.setItem('active_school_name', schoolInfo.name)
      }
      // Clear portal mode
      localStorage.removeItem('isPortalMode')
      
      console.log(`✅ School loaded: ${schoolInfo.name} (ID: ${schoolInfo.id}, subdomain: ${subdomain})`)
    }
  }, [school, subdomain])

  // After login, clear validation errors if user has access to any school in this org
  useEffect(() => {
    if (user && schoolData && !authLoading) {
      setValidationError(null)
      // Note: Do NOT set active_school_id here — AuthContext.resolveActiveSchool()
      // already handles it from localStorage, which preserves explicit switches.
    }
  }, [user, schoolData, authLoading])

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

  // Not logged in → show login page
  if (!user) {
    return <SchoolLoginPage school={schoolData} />
  }

  // Logged in and authorized → show full app with routing
  return <App />
}
