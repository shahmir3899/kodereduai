import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { useClasses } from '../../hooks/useClasses'

export default function SectionAllocator({ onClose }) {
  const { activeAcademicYear } = useAcademicYear()
  const { addToast } = useToast()

  const [step, setStep] = useState(1) // 1=Configure, 2=Preview, 3=Done
  const [classId, setClassId] = useState('')
  const [numSections, setNumSections] = useState(2)
  const [preview, setPreview] = useState(null)
  const [activeTab, setActiveTab] = useState('A')

  // Fetch classes
  const { classes, isLoading: classesLoading } = useClasses()

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: (data) => sessionsApi.sectionAllocatorPreview(data),
    onSuccess: (res) => {
      if (res.data.success === false) {
        addToast(res.data.error || 'Failed to generate preview', 'error')
        return
      }
      setPreview(res.data)
      setActiveTab(res.data.sections?.[0]?.section_name || 'A')
      setStep(2)
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || err.response?.data?.error || 'Failed to generate preview', 'error')
    },
  })

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: (data) => sessionsApi.sectionAllocatorApply(data),
    onSuccess: (res) => {
      if (res.data.success) {
        addToast(res.data.message || 'Sections allocated successfully!', 'success')
        setStep(3)
      } else {
        addToast(res.data.error || 'Allocation failed', 'error')
      }
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Allocation failed', 'error')
    },
  })

  const handlePreview = (e) => {
    e.preventDefault()
    if (!classId) {
      addToast('Please select a class', 'error')
      return
    }
    previewMutation.mutate({
      class_id: parseInt(classId),
      academic_year_id: activeAcademicYear?.id || null,
      num_sections: numSections,
    })
  }

  const handleApply = () => {
    applyMutation.mutate({
      class_id: parseInt(classId),
      academic_year_id: activeAcademicYear?.id || null,
      num_sections: numSections,
    })
  }

  const getBalanceLabel = (variance) => {
    if (variance <= 1) return { text: 'Excellent', color: 'text-green-700 bg-green-50' }
    if (variance <= 5) return { text: 'Good', color: 'text-blue-700 bg-blue-50' }
    if (variance <= 10) return { text: 'Fair', color: 'text-amber-700 bg-amber-50' }
    return { text: 'Poor', color: 'text-red-700 bg-red-50' }
  }

  const selectedClass = classes.find(c => c.id === parseInt(classId))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">AI Smart Section Allocator</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {step === 1 && 'Select a class to split into balanced sections'}
              {step === 2 && 'Review the balanced allocation preview'}
              {step === 3 && 'Allocation applied successfully!'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b">
          {[1, 2, 3].map(s => (
            <div key={s} className={`flex items-center gap-1.5 text-xs font-medium ${
              s === step ? 'text-sky-700' : s < step ? 'text-green-600' : 'text-gray-400'
            }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                s === step ? 'bg-sky-100 text-sky-700' : s < step ? 'bg-green-100 text-green-700' : 'bg-gray-100'
              }`}>{s < step ? '\u2713' : s}</div>
              <span>{s === 1 ? 'Configure' : s === 2 ? 'Preview' : 'Done'}</span>
              {s < 3 && <div className="w-8 h-px bg-gray-300 ml-1" />}
            </div>
          ))}
        </div>

        <div className="p-5">
          {/* Step 1: Configure */}
          {step === 1 && (
            <form onSubmit={handlePreview} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class to Split</label>
                {classesLoading ? (
                  <div className="text-sm text-gray-400">Loading classes...</div>
                ) : classes.length === 0 ? (
                  <div className="text-sm text-gray-400">No classes found. Create classes first.</div>
                ) : (
                  <select
                    className="input w-full"
                    value={classId}
                    onChange={e => setClassId(e.target.value)}
                    required
                  >
                    <option value="">Select a class...</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.section ? ` - ${c.section}` : ''} ({c.student_count || 0} students)
                      </option>
                    ))}
                  </select>
                )}
                {selectedClass && (
                  <p className="text-xs text-gray-400 mt-1">
                    {selectedClass.student_count || 0} students will be distributed across {numSections} sections
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year</label>
                <input
                  type="text"
                  className="input w-full bg-gray-50"
                  value={activeAcademicYear?.name || 'No academic year (uses direct class assignment)'}
                  disabled
                />
                <p className="text-xs text-gray-400 mt-1">Uses enrollment data if available, otherwise direct class assignment</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of Sections: <span className="text-sky-700 font-bold">{numSections}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="6"
                  value={numSections}
                  onChange={e => setNumSections(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
                </div>
              </div>

              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3">
                <p className="text-xs text-sky-800">
                  <span className="font-semibold">How it works:</span> Students are sorted by academic
                  performance and distributed using a serpentine (snake) algorithm. This ensures each
                  section gets a balanced mix of high, medium, and low performers.
                  {selectedClass && ` New classes will be created: "${selectedClass.name}-A", "${selectedClass.name}-B", etc.`}
                </p>
              </div>

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={previewMutation.isPending || !classId}
              >
                {previewMutation.isPending ? 'Generating Preview...' : 'Generate Allocation Preview'}
              </button>
            </form>
          )}

          {/* Step 2: Preview */}
          {step === 2 && preview && (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard
                  label="Total Students"
                  value={preview.total_students}
                  color="sky"
                />
                <SummaryCard
                  label="Sections"
                  value={preview.sections?.length || 0}
                  color="purple"
                />
                <SummaryCard
                  label="Score Balance"
                  value={getBalanceLabel(preview.balance_metrics?.score_variance).text}
                  color="green"
                />
                <SummaryCard
                  label="Count Balance"
                  value={getBalanceLabel(preview.balance_metrics?.count_variance).text}
                  color="orange"
                />
              </div>

              {/* Balance metrics detail */}
              <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-gray-500">Source:</span>{' '}
                  <span className="font-medium text-gray-900">{preview.source_name || preview.grade_name}</span>
                </div>
                <div>
                  <span className="text-gray-500">Score Variance:</span>{' '}
                  <span className={`font-medium px-1.5 py-0.5 rounded ${getBalanceLabel(preview.balance_metrics?.score_variance).color}`}>
                    {preview.balance_metrics?.score_variance}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Count Variance:</span>{' '}
                  <span className={`font-medium px-1.5 py-0.5 rounded ${getBalanceLabel(preview.balance_metrics?.count_variance).color}`}>
                    {preview.balance_metrics?.count_variance}
                  </span>
                </div>
              </div>

              {/* Section tabs */}
              <div className="flex gap-1 border-b border-gray-200">
                {preview.sections?.map(sec => (
                  <button
                    key={sec.section_name}
                    onClick={() => setActiveTab(sec.section_name)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === sec.section_name
                        ? 'border-sky-600 text-sky-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Section {sec.section_name}
                    <span className="ml-1.5 text-xs text-gray-400">({sec.count})</span>
                  </button>
                ))}
              </div>

              {/* Active section content */}
              {preview.sections?.filter(s => s.section_name === activeTab).map(sec => (
                <div key={sec.section_name}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-sky-100 flex items-center justify-center">
                        <span className="text-sky-700 font-bold">{sec.section_name}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Section {sec.section_name}</h3>
                        <p className="text-xs text-gray-500">
                          {sec.count} students | Avg Score: {sec.avg_score}%
                        </p>
                      </div>
                    </div>
                    {sec.gender_distribution && (
                      <div className="flex gap-2 text-xs">
                        {Object.entries(sec.gender_distribution).map(([gender, count]) => (
                          <span key={gender} className="px-2 py-1 bg-gray-100 rounded">
                            {gender}: {count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">#</th>
                          <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Name</th>
                          <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Roll No.</th>
                          <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Avg Score</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sec.students?.map((student, idx) => (
                          <tr key={student.student_id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-1.5 font-medium text-gray-900">{student.name}</td>
                            <td className="px-3 py-1.5 text-gray-600">{student.roll_number}</td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                student.avg_score >= 70
                                  ? 'bg-green-50 text-green-700'
                                  : student.avg_score >= 40
                                  ? 'bg-amber-50 text-amber-700'
                                  : student.avg_score > 0
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-gray-50 text-gray-500'
                              }`}>
                                {student.avg_score > 0 ? `${student.avg_score}%` : 'N/A'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1">
                  Back to Configure
                </button>
                <button
                  onClick={handleApply}
                  className="btn-primary flex-1"
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? 'Applying...' : 'Apply Allocation'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Sections Allocated Successfully!</h3>
              <p className="text-sm text-gray-500 mb-6">
                Students have been distributed across sections with balanced academic performance.
                New section classes have been created on the Classes page.
              </p>
              <button onClick={onClose} className="btn-primary">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  const colors = {
    sky: 'bg-sky-50 text-sky-800',
    purple: 'bg-purple-50 text-purple-800',
    green: 'bg-green-50 text-green-800',
    orange: 'bg-orange-50 text-orange-800',
  }
  return (
    <div className={`rounded-lg p-3 ${colors[color] || colors.sky}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  )
}
