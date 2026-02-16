import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'

export default function SessionSetupWizard({ onClose }) {
  const { activeSchool } = useAuth()
  const { academicYears, refresh: refreshYears } = useAcademicYear()
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  const [step, setStep] = useState(1) // 1=Configure, 2=Preview, 3=Done
  const [formData, setFormData] = useState({
    source_year_id: '',
    new_year_name: '',
    new_start_date: '',
    new_end_date: '',
    fee_increase_percent: 0,
  })
  const [preview, setPreview] = useState(null)

  // Generate preview
  const previewMutation = useMutation({
    mutationFn: (data) => sessionsApi.setupPreview(data),
    onSuccess: (res) => {
      if (res.data.success === false) {
        addToast(res.data.error || 'Failed to generate preview', 'error')
        return
      }
      setPreview(res.data)
      setStep(2)
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Failed to generate preview', 'error')
    },
  })

  // Apply setup
  const applyMutation = useMutation({
    mutationFn: (data) => sessionsApi.setupApply(data),
    onSuccess: (res) => {
      if (res.data.success) {
        addToast('New academic year created successfully!', 'success')
        queryClient.invalidateQueries({ queryKey: ['academicYears'] })
        refreshYears()
        setStep(3)
      } else {
        addToast(res.data.error || 'Setup failed', 'error')
      }
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Setup failed', 'error')
    },
  })

  const handlePreview = (e) => {
    e.preventDefault()
    if (!formData.source_year_id || !formData.new_year_name || !formData.new_start_date || !formData.new_end_date) {
      addToast('All fields are required', 'error')
      return
    }
    previewMutation.mutate(formData)
  }

  const handleApply = () => {
    applyMutation.mutate(preview)
  }

  // Auto-suggest year name when source year changes
  const handleSourceChange = (sourceId) => {
    setFormData(prev => ({ ...prev, source_year_id: sourceId }))
    const source = academicYears.find(y => String(y.id) === String(sourceId))
    if (source) {
      // Auto-suggest next year name: "2025-2026" -> "2026-2027"
      const match = source.name.match(/(\d{4})-(\d{4})/)
      if (match) {
        const nextStart = parseInt(match[2])
        const nextEnd = nextStart + 1
        setFormData(prev => ({
          ...prev,
          source_year_id: sourceId,
          new_year_name: `${nextStart}-${nextEnd}`,
          new_start_date: `${nextStart}-04-01`,
          new_end_date: `${nextEnd}-03-31`,
        }))
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">AI Session Setup Wizard</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {step === 1 && 'Configure new academic year based on a previous year'}
              {step === 2 && 'Review what will be created'}
              {step === 3 && 'Setup complete!'}
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
              <span>{s === 1 ? 'Configure' : s === 2 ? 'Review' : 'Done'}</span>
              {s < 3 && <div className="w-8 h-px bg-gray-300 ml-1" />}
            </div>
          ))}
        </div>

        <div className="p-5">
          {/* Step 1: Configure */}
          {step === 1 && (
            <form onSubmit={handlePreview} className="space-y-4">
              <div>
                <label className="label">Copy From (Source Year)</label>
                <select
                  className="input"
                  value={formData.source_year_id}
                  onChange={e => handleSourceChange(e.target.value)}
                  required
                >
                  <option value="">Select source year...</option>
                  {academicYears.map(y => (
                    <option key={y.id} value={y.id}>
                      {y.name} {y.is_current ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">New Year Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 2026-2027"
                  value={formData.new_year_name}
                  onChange={e => setFormData(prev => ({ ...prev, new_year_name: e.target.value }))}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Start Date</label>
                  <input
                    type="date"
                    className="input"
                    value={formData.new_start_date}
                    onChange={e => setFormData(prev => ({ ...prev, new_start_date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input
                    type="date"
                    className="input"
                    value={formData.new_end_date}
                    onChange={e => setFormData(prev => ({ ...prev, new_end_date: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Fee Increase (%)</label>
                <input
                  type="number"
                  className="input"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.fee_increase_percent}
                  onChange={e => setFormData(prev => ({ ...prev, fee_increase_percent: parseFloat(e.target.value) || 0 }))}
                />
                <p className="text-xs text-gray-500 mt-1">Applied to all carried-forward fee structures</p>
              </div>

              <button type="submit" className="btn-primary w-full" disabled={previewMutation.isPending}>
                {previewMutation.isPending ? 'Generating Preview...' : 'Generate Preview'}
              </button>
            </form>
          )}

          {/* Step 2: Preview */}
          {step === 2 && preview && (
            <div className="space-y-5">
              {/* AI Suggestions */}
              {preview.ai_suggestions?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1">AI Suggestions</p>
                  {preview.ai_suggestions.map((s, i) => (
                    <p key={i} className="text-xs text-amber-700 mt-0.5">- {s}</p>
                  ))}
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Terms" value={preview.statistics?.terms_count || 0} color="sky" />
                <SummaryCard label="Subject Assignments" value={preview.statistics?.subjects_assigned || 0} color="purple" />
                <SummaryCard label="Fee Structures" value={preview.statistics?.fee_structures_count || 0} color="green" />
                <SummaryCard label="Timetable Entries" value={preview.statistics?.timetable_entries || 0} color="orange" />
              </div>

              {/* Terms preview */}
              {preview.terms?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Terms</h3>
                  <div className="space-y-1">
                    {preview.terms.map((t, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-gray-500 text-xs">{t.start_date} to {t.end_date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fee preview */}
              {preview.fee_structures?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Fee Structures</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs text-gray-500">Class/Student</th>
                          <th className="text-right px-3 py-2 text-xs text-gray-500">Old Amount</th>
                          <th className="text-right px-3 py-2 text-xs text-gray-500">New Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.fee_structures.slice(0, 10).map((f, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5">{f.student_name || f.class_name || '-'}</td>
                            <td className="px-3 py-1.5 text-right text-gray-500">{f.original_amount}</td>
                            <td className="px-3 py-1.5 text-right font-medium">{f.new_amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.fee_structures.length > 10 && (
                      <p className="text-xs text-gray-500 mt-1 px-3">...and {preview.fee_structures.length - 10} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="btn-secondary flex-1">
                  Back to Configure
                </button>
                <button onClick={handleApply} className="btn-primary flex-1" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? 'Creating...' : 'Create New Session'}
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
              <h3 className="text-lg font-bold text-gray-900 mb-2">Session Created Successfully!</h3>
              <p className="text-sm text-gray-500 mb-6">
                Your new academic year has been set up with all carried-forward data.
                You can now set it as the current year from the Sessions page.
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
