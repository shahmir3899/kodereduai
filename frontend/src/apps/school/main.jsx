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
import SchoolApp from './SchoolApp'
import { createAppPersister, queryPersistOptions } from '../../queryPersistConfig'
import '../../index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      // Must be >= the persister's maxAge below, or a reference-data query
      // can be garbage-collected from memory before it's ever written to
      // localStorage.
      gcTime: 10 * 60 * 1000,
      // Off by default: queries that genuinely need fresh-on-focus data
      // (notifications, background-task/job status, messaging) already poll
      // via their own refetchInterval, so a blanket window-focus refetch only
      // added redundant calls across every other page on every tab switch.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

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
                  <SchoolApp />
                </BackgroundTaskProvider>
              </ToastProvider>
            </AcademicYearProvider>
          </AuthProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
