import { useState } from 'react'
import MonthlyChargesCardView from './MonthlyChargesCardView'
import StudentChargesGrid from './StudentChargesGrid'

export default function MonthlyChargesTab() {
  const [mode, setMode] = useState('class') // 'class' | 'student'

  return (
    <div className="card">
      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setMode('class')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'class' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >By Class</button>
        <button type="button" onClick={() => setMode('student')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'student' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >By Student</button>
      </div>

      {mode === 'class' ? <MonthlyChargesCardView /> : <StudentChargesGrid feeType="MONTHLY" />}
    </div>
  )
}
