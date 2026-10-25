import { useState } from 'react'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import TermsManager from '../sessions/TermsManager'
import YearsStrip from '../../components/timeline/YearsStrip'
import { yearWarnings } from '../../components/timeline/timelineMath'

const EMPTY_YEAR = { name: '', start_date: '', end_date: '', is_current: true }

export default function AcademicYearStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [yearForm, setYearForm] = useState(EMPTY_YEAR)
  const [showYearForm, setShowYearForm] = useState(false)
  const [errors, setErrors] = useState({})

  // Queries
  const { data: yearsRes, isLoading } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 100 }),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const currentYear = years.find(y => y.is_current)

  // Mutations
  const createYearMut = useMutation({
    mutationFn: (data) => sessionsApi.createAcademicYear(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academicYears'] })
      refetchCompletion()
      addToast('Academic year created!', 'success')
      setShowYearForm(false)
      setYearForm(EMPTY_YEAR)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed to create', 'error')
    },
  })

  // Overlap with an existing year and odd lengths are warnings the admin can accept.
  const warnings = showYearForm || !currentYear ? yearWarnings(yearForm, years) : []
  const serverWarnings = errors.confirm_warnings ? [].concat(errors.non_field_errors || []) : []

  const handleCreateYear = () => {
    const e = {}
    if (!yearForm.name.trim()) e.name = ['Name is required']
    if (!yearForm.start_date) e.start_date = ['Start date is required']
    if (!yearForm.end_date) e.end_date = ['End date is required']
    if (Object.keys(e).length) { setErrors(e); return }
    // The warnings are on screen and the button reads "Create anyway", so pressing it is the confirmation.
    createYearMut.mutate(warnings.length ? { ...yearForm, confirm_warnings: true } : yearForm)
  }

  // Auto-suggest year name
  const suggestYearName = () => {
    const now = new Date()
    const y = now.getFullYear()
    return now.getMonth() >= 3 ? `${y}-${(y + 1) % 100}` : `${y - 1}-${y % 100}`
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Academic Year & Terms</h2>
      <p className="text-sm text-gray-500 mb-6">Set up your current academic year and define terms or semesters.</p>

      <YearsStrip years={years} />

      {/* Existing Years */}
      {years.length > 0 && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Academic Years</h3>
          <div className="space-y-2">
            {years.map(y => (
              <div key={y.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800">{y.name}</span>
                  {y.is_current && (
                    <Badge tone="success">Current</Badge>
                  )}
                </div>
                <span className="text-xs text-gray-500">{y.start_date} → {y.end_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Year Form */}
      {!currentYear || showYearForm ? (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {!currentYear ? 'Create Your First Academic Year' : 'Add Academic Year'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Year Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="e.g. 2025-26"
                  value={yearForm.name}
                  onChange={e => { setYearForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
                />
                {!yearForm.name && (
                  <button
                    type="button"
                    onClick={() => setYearForm(p => ({ ...p, name: suggestYearName() }))}
                    className="text-xs text-primary-600 hover:text-primary-700 whitespace-nowrap"
                  >
                    Suggest
                  </button>
                )}
              </div>
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                className="input"
                value={yearForm.start_date}
                onChange={e => setYearForm(p => ({ ...p, start_date: e.target.value }))}
              />
              {errors.start_date && <p className="text-xs text-red-600 mt-1">{errors.start_date[0]}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                className="input"
                value={yearForm.end_date}
                onChange={e => setYearForm(p => ({ ...p, end_date: e.target.value }))}
              />
              {errors.end_date && <p className="text-xs text-red-600 mt-1">{errors.end_date[0]}</p>}
            </div>
          </div>
          {(warnings.length > 0 || serverWarnings.length > 0) && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {[...new Set([...warnings, ...serverWarnings])].map(w => <p key={w}>{w}</p>)}
              <p className="mt-1">You can still create it.</p>
            </div>
          )}
          <div className="flex items-center gap-3 mt-4">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={yearForm.is_current}
                onChange={e => setYearForm(p => ({ ...p, is_current: e.target.checked }))}
                className="rounded"
              />
              Set as current year
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreateYear}
              disabled={createYearMut.isPending}
              className="btn-primary px-4 py-2 text-sm"
            >
              {createYearMut.isPending ? 'Creating...' : (warnings.length || serverWarnings.length) ? 'Create anyway' : 'Create Academic Year'}
            </button>
            {currentYear && (
              <button onClick={() => { setShowYearForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-2">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowYearForm(true)}
          className="text-sm text-primary-600 hover:text-primary-700 mb-4"
        >
          + Add another academic year
        </button>
      )}

      {/* Terms Section */}
      {currentYear && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Terms / Semesters</h3>
          <p className="text-xs text-gray-400 mb-3">Terms are optional but recommended. Drag the handles or type the dates.</p>
          <TermsManager year={currentYear} onChanged={refetchCompletion} />
        </div>
      )}
    </div>
  )
}
