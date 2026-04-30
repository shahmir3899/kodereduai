import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function AccessRestrictedRedirect({ to = '/dashboard', title = 'Access Restricted', message = 'You do not have permission to open this page.' }) {
  const navigate = useNavigate()

  useEffect(() => {
    const timer = window.setTimeout(() => navigate(to, { replace: true }), 1200)
    return () => window.clearTimeout(timer)
  }, [navigate, to])

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">🚫</div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-500 max-w-md">{message}</p>
      <p className="text-xs text-gray-400 mt-3">Redirecting...</p>
    </div>
  )
}
