import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { AcademicYearProvider } from './contexts/AcademicYearContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { BackgroundTaskProvider } from './contexts/BackgroundTaskContext.jsx'
import { schoolsApi } from './services/api'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30 seconds – data is fresh for half a minute
      gcTime: 5 * 60 * 1000,       // 5 minutes – unused cache kept in memory
      refetchOnWindowFocus: true,   // refetch stale queries when tab regains focus
      retry: 1,
    },
  },
})

// Wrapper component to handle subdomain detection
function AppWithSubdomain() {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const detectSubdomain = async () => {
      try {
        // Check URL params first (for local testing: ?subdomain=focus)
        const urlParams = new URLSearchParams(window.location.search)
        const subdomainParam = urlParams.get('subdomain')
        
        // Extract subdomain from hostname
        const hostname = window.location.hostname
        const parts = hostname.split('.')
        let subdomain = null

        // Use URL param if present, otherwise extract from hostname (only for kodereduai.pk)
        if (subdomainParam) {
          subdomain = subdomainParam
        } else if (hostname.endsWith('.kodereduai.pk') && parts.length === 3 && parts[0] !== 'www') {
          // Only extract subdomain for *.kodereduai.pk domains
          // e.g., focus.kodereduai.pk -> 'focus'
          subdomain = parts[0]
        }

        // If subdomain detected, fetch school data
        if (subdomain && subdomain !== 'portal') {
          const response = await schoolsApi.getSchoolBySubdomain(subdomain)
          const schoolData = response.data
          
          // Store school context in localStorage
          localStorage.setItem('currentSchoolId', schoolData.id.toString())
          localStorage.setItem('currentSchoolName', schoolData.name)
          localStorage.setItem('currentSchoolSubdomain', subdomain)
          if (schoolData.logo) {
            localStorage.setItem('currentSchoolLogo', schoolData.logo)
          }
          
          console.log(`✅ School auto-detected: ${schoolData.name} (subdomain: ${subdomain})`)
        } else if (subdomain === 'portal') {
          // Portal subdomain - super admin interface
          localStorage.setItem('isPortalMode', 'true')
          console.log('✅ Portal mode detected')
        }
      } catch (err) {
        console.error('Subdomain detection failed:', err)
        setError(err.message || 'Failed to detect school from subdomain')
      } finally {
        setIsLoading(false)
      }
    }

    detectSubdomain()
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading school...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">⚠️ School Not Found</div>
          <p className="text-gray-600">{error}</p>
          <p className="text-sm text-gray-500 mt-2">Please check the subdomain and try again.</p>
        </div>
      </div>
    )
  }

  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AcademicYearProvider>
            <ToastProvider>
              <BackgroundTaskProvider>
                <AppWithSubdomain />
              </BackgroundTaskProvider>
            </ToastProvider>
          </AcademicYearProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
