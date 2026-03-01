import { useNavigate } from 'react-router-dom'
import SchoolCompletionWidget from '../../components/SchoolCompletionWidget'

export default function ReviewStep({ completion }) {
  const navigate = useNavigate()

  const pct = completion?.overall_percentage || 0

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Review & Finish</h2>
      <p className="text-sm text-gray-500 mb-6">Here's your school setup progress across all modules.</p>

      {/* Reuse the existing SchoolCompletionWidget */}
      <SchoolCompletionWidget />

      {/* Action */}
      <div className="mt-8 text-center">
        <button
          onClick={() => navigate('/dashboard')}
          className="btn-primary px-6 py-2.5 text-sm"
        >
          Go to Dashboard
        </button>
        <p className="text-xs text-gray-400 mt-2">You can return to this setup page anytime from the sidebar.</p>
      </div>
    </div>
  )
}
