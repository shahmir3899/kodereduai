import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { AuthProvider } from '../../contexts/AuthContext'
import { AcademicYearProvider } from '../../contexts/AcademicYearContext'
import { ToastProvider } from '../../components/Toast'
import { BackgroundTaskProvider } from '../../contexts/BackgroundTaskContext'
import { ThemeProvider } from '../../contexts/ThemeContext'
import Portal from './Portal'
import { createAppPersister, queryPersistOptions } from '../../queryPersistConfig'
import '../../index.css'

const QUERY_STALE_TIME_MS = Number(import.meta.env.VITE_QUERY_STALE_TIME_MS || 30 * 1000)
// Must be >= the persister's maxAge (queryPersistConfig.js), or a reference-data
// query can be garbage-collected from memory before it's ever written to localStorage.
const QUERY_GC_TIME_MS = Number(import.meta.env.VITE_QUERY_GC_TIME_MS || 10 * 60 * 1000)
// Default off: queries that genuinely need fresh-on-focus data (notifications,
// background-task/job status, messaging) already poll via their own
// refetchInterval, so a blanket window-focus refetch only adds redundant
// calls across the rest of the app without those queries needing it.
const QUERY_REFETCH_ON_FOCUS = String(import.meta.env.VITE_QUERY_REFETCH_ON_WINDOW_FOCUS || 'false').toLowerCase() === 'true'
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

const persister = createAppPersister()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, ...queryPersistOptions }}>
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
      </PersistQueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
