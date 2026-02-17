import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { AcademicYearProvider } from './contexts/AcademicYearContext.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { BackgroundTaskProvider } from './contexts/BackgroundTaskContext.jsx'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AcademicYearProvider>
            <ToastProvider>
              <BackgroundTaskProvider>
                <App />
              </BackgroundTaskProvider>
            </ToastProvider>
          </AcademicYearProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
