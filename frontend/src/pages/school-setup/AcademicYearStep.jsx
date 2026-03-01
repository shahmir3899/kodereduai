import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const EMPTY_YEAR = { name: '', start_date: '', end_date: '', is_current: true }
const EMPTY_TERM = { name: '', term_type: 'TERM', start_date: '', end_date: '', order: 1 }

export default function AcademicYearStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [yearForm, setYearForm] = useState(EMPTY_YEAR)
  const [termForm, setTermForm] = useState(EMPTY_TERM)
  const [showYearForm, setShowYearForm] = useState(false)
  const [showTermForm, setShowTermForm] = useState(false)
  const [errors, setErrors] = useState({})

  // Queries
  const { data: yearsRes, isLoading } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 100 }),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const currentYear = years.find(y => y.is_current)

  const { data: termsRes } = useQuery({
    queryKey: ['terms', currentYear?.id],
    queryFn: () => sessionsApi.getTerms({ academic_year: currentYear.id, page_size: 100 }),
    enabled: !!currentYear?.id,
  })

  const terms = termsRes?.data?.results || termsRes?.data || []

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

  const createTermMut = useMutation({
    mutationFn: (data) => sessionsApi.createTerm(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terms'] })
      refetchCompletion()
      addToast('Term created!', 'success')
      setShowTermForm(false)
      setTermForm({ ...EMPTY_TERM, order: terms.length + 2 })
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed to create', 'error')
    },
  })

  const handleCreateYear = () => {
    const e = {}
    if (!yearForm.name.trim()) e.name = ['Name is required']
    if (!yearForm.start_date) e.start_date = ['Start date is required']
    if (!yearForm.end_date) e.end_date = ['End date is required']
    if (Object.keys(e).length) { setErrors(e); return }
    createYearMut.mutate(yearForm)
  }

  const handleCreateTerm = () => {
    const e = {}
    if (!termForm.name.trim()) e.name = ['Name is required']
    if (!termForm.start_date) e.start_date = ['Start date is required']
    if (!termForm.end_date) e.end_date = ['End date is required']
    if (Object.keys(e).length) { setErrors(e); return }
    createTermMut.mutate({ ...termForm, academic_year: currentYear.id })
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
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">Current</span>
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
                    className="text-xs text-sky-600 hover:text-sky-700 whitespace-nowrap"
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
              {createYearMut.isPending ? 'Creating...' : 'Create Academic Year'}
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
          className="text-sm text-sky-600 hover:text-sky-700 mb-4"
        >
          + Add another academic year
        </button>
      )}

      {/* Terms Section */}
      {currentYear && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Terms / Semesters</h3>
            {!showTermForm && (
              <button
                onClick={() => {
                  setShowTermForm(true)
                  setTermForm({ ...EMPTY_TERM, order: terms.length + 1 })
                }}
                className="text-xs text-sky-600 hover:text-sky-700"
              >
                + Add Term
              </button>
            )}
          </div>

          {terms.length > 0 && (
            <div className="space-y-2 mb-4">
              {terms.map(t => (
                <div key={t.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-800">{t.name}</span>
                    <span className="text-xs text-gray-400">{t.term_type}</span>
                    {t.is_current && (
                      <span className="px-2 py-0.5 bg-sky-100 text-sky-700 text-xs rounded-full">Current</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">{t.start_date} → {t.end_date}</span>
                </div>
              ))}
            </div>
          )}

          {terms.length === 0 && !showTermForm && (
            <p className="text-sm text-gray-400 mb-3">No terms defined yet. Terms are optional but recommended.</p>
          )}

          {showTermForm && (
            <div className="bg-gray-50 rounded-lg p-4 mt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Term Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Term 1"
                    value={termForm.name}
                    onChange={e => { setTermForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                  <select
                    className="input"
                    value={termForm.term_type}
                    onChange={e => setTermForm(p => ({ ...p, term_type: e.target.value }))}
                  >
                    <option value="TERM">Term</option>
                    <option value="SEMESTER">Semester</option>
                    <option value="QUARTER">Quarter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    className="input"
                    value={termForm.start_date}
                    onChange={e => setTermForm(p => ({ ...p, start_date: e.target.value }))}
                  />
                  {errors.start_date && <p className="text-xs text-red-600 mt-1">{errors.start_date[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    className="input"
                    value={termForm.end_date}
                    onChange={e => setTermForm(p => ({ ...p, end_date: e.target.value }))}
                  />
                  {errors.end_date && <p className="text-xs text-red-600 mt-1">{errors.end_date[0]}</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleCreateTerm}
                  disabled={createTermMut.isPending}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  {createTermMut.isPending ? 'Adding...' : 'Add Term'}
                </button>
                <button
                  onClick={() => { setShowTermForm(false); setErrors({}) }}
                  className="text-sm text-gray-500 px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
