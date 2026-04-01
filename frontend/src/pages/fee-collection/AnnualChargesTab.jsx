import { useState } from 'react'
import AnnualChargesCardView from './AnnualChargesCardView'
import AnnualChargesStudentTab from './AnnualChargesStudentTab'

/**
 * AnnualChargesTab — Wrapper component that displays the card-based view for all classes.
 *
 * This component delegates to AnnualChargesCardView which shows all classes as cards,
 * allowing schools to configure annual charges for multiple classes at once without
 * needing to switch between class selectors.
 */
export default function AnnualChargesTab() {
  const [mode, setMode] = useState('class')

  return (
    <div className="card">
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('class')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'class' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          By Class
        </button>
        <button
          type="button"
          onClick={() => setMode('student')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'student' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          By Student
        </button>
      </div>

      {mode === 'class' ? <AnnualChargesCardView /> : <AnnualChargesStudentTab />}
    </div>
  )
}
