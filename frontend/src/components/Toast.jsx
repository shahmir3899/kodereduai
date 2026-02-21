import { createContext, useContext, useState, useCallback, useEffect } from 'react'

// Toast Context
const ToastContext = createContext(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// Toast Provider Component
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'error', duration = 5000) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showError = useCallback((message) => {
    addToast(message, 'error')
  }, [addToast])

  const showSuccess = useCallback((message) => {
    addToast(message, 'success')
  }, [addToast])

  const showWarning = useCallback((message) => {
    addToast(message, 'warning')
  }, [addToast])

  // Listen for global API error events (dispatched by Axios interceptor)
  useEffect(() => {
    const handler = (e) => showError(e.detail.message)
    window.addEventListener('api-error', handler)
    return () => window.removeEventListener('api-error', handler)
  }, [showError])

  return (
    <ToastContext.Provider value={{ showError, showSuccess, showWarning, addToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

// Toast Container (renders all toasts)
function ToastContainer({ toasts, removeToast }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto z-50 space-y-2 max-w-sm sm:max-w-md">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

// Individual Toast Item
function ToastItem({ toast, onClose }) {
  const { message, type } = toast

  const bgColor = {
    error: 'bg-red-50 border-red-500',
    success: 'bg-green-50 border-green-500',
    warning: 'bg-yellow-50 border-yellow-500',
  }[type] || 'bg-gray-50 border-gray-500'

  const textColor = {
    error: 'text-red-800',
    success: 'text-green-800',
    warning: 'text-yellow-800',
  }[type] || 'text-gray-800'

  const iconColor = {
    error: 'text-red-500',
    success: 'text-green-500',
    warning: 'text-yellow-500',
  }[type] || 'text-gray-500'

  const Icon = {
    error: ErrorIcon,
    success: SuccessIcon,
    warning: WarningIcon,
  }[type] || ErrorIcon

  return (
    <div
      className={`${bgColor} ${textColor} border-l-4 p-4 rounded-lg shadow-lg flex items-start animate-slide-in`}
      role="alert"
    >
      <Icon className={`w-5 h-5 ${iconColor} mr-3 flex-shrink-0 mt-0.5`} />
      <div className="flex-1 text-sm font-medium">{message}</div>
      <button
        onClick={onClose}
        className="ml-2 -mr-1 p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg"
      >
        <CloseIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

// Icons
function ErrorIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  )
}

function SuccessIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
}

function WarningIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  )
}

function CloseIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}

export default ToastProvider
