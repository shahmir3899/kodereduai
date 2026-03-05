import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../contexts/AuthContext'
import { AcademicYearProvider } from '../../contexts/AcademicYearContext'
import { ToastProvider } from '../../components/Toast'
import { BackgroundTaskProvider } from '../../contexts/BackgroundTaskContext'
import SchoolApp from './SchoolApp'
import '../../index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  </React.StrictMode>,
)
