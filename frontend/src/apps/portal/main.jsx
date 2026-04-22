import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../contexts/AuthContext'
import { AcademicYearProvider } from '../../contexts/AcademicYearContext'
import { ToastProvider } from '../../components/Toast'
import { BackgroundTaskProvider } from '../../contexts/BackgroundTaskContext'
import Portal from './Portal'
import '../../index.css'

const QUERY_STALE_TIME_MS = Number(import.meta.env.VITE_QUERY_STALE_TIME_MS || 30 * 1000)
const QUERY_GC_TIME_MS = Number(import.meta.env.VITE_QUERY_GC_TIME_MS || 5 * 60 * 1000)
const QUERY_REFETCH_ON_FOCUS = String(import.meta.env.VITE_QUERY_REFETCH_ON_WINDOW_FOCUS || 'true').toLowerCase() === 'true'
const QUERY_RETRY_COUNT = Number(import.meta.env.VITE_QUERY_RETRY_COUNT || 1)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      refetchOnWindowFocus: QUERY_REFETCH_ON_FOCUS,
      retry: QUERY_RETRY_COUNT,
    },
  },
})

// Set portal mode in localStorage when portal app loads
localStorage.setItem('isPortalMode', 'true')
// Clear school context
localStorage.removeItem('currentSchoolId')
localStorage.removeItem('currentSchoolName')
localStorage.removeItem('currentSchoolSubdomain')
localStorage.removeItem('currentSchoolLogo')
console.log('✅ Portal mode activated')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AcademicYearProvider>
            <ToastProvider>
              <BackgroundTaskProvider>
                <Portal />
              </BackgroundTaskProvider>
            </ToastProvider>
          </AcademicYearProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
