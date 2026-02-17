import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import SessionSetupWizard from './SessionSetupWizard'

const EMPTY_YEAR = { name: '', start_date: '', end_date: '' }
const EMPTY_TERM = { academic_year: '', name: '', term_type: 'TERM', order: 1, start_date: '', end_date: '' }

export default function AcademicYearsPage() {
  const queryClient = useQueryClient()
  const { refresh: refreshAcademicYear, activeAcademicYear } = useAcademicYear()
  const [tab, setTab] = useState('years')

  // Year state
  const [showYearModal, setShowYearModal] = useState(false)
  const [editYearId, setEditYearId] = useState(null)
  const [yearForm, setYearForm] = useState(EMPTY_YEAR)
  const [yearErrors, setYearErrors] = useState({})

  // Term state
  const [yearFilter, setYearFilter] = useState('')
  const [showTermModal, setShowTermModal] = useState(false)
  const [editTermId, setEditTermId] = useState(null)
  const [termForm, setTermForm] = useState(EMPTY_TERM)
  const [termErrors, setTermErrors] = useState({})

  // Expanded year for summary - default to activeAcademicYear
  const [expandedYearId, setExpandedYearId] = useState(activeAcademicYear?.id || null)

  // Setup wizard
  const [showSetupWizard, setShowSetupWizard] = useState(false)

  // Queries
  const { data: yearsRes, isLoading: yearsLoading } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: termsRes, isLoading: termsLoading } = useQuery({
    queryKey: ['terms', yearFilter],
    queryFn: () => sessionsApi.getTerms({ academic_year: yearFilter || undefined, page_size: 9999 }),
    enabled: tab === 'terms',
  })

  const { data: summaryRes } = useQuery({
    queryKey: ['yearSummary', expandedYearId],
    queryFn: () => sessionsApi.getYearSummary(expandedYearId),
    enabled: !!expandedYearId,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const summary = summaryRes?.data || null

  // Sync expanded year with activeAcademicYear from dropdown
  useEffect(() => {
    if (activeAcademicYear?.id) {
      setExpandedYearId(activeAcademicYear.id)
    }
  }, [activeAcademicYear?.id])

  // Year mutations
  const createYearMut = useMutation({
    mutationFn: (data) => sessionsApi.createAcademicYear(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); closeYearModal() },
    onError: (err) => setYearErrors(err.response?.data || { detail: 'Failed to create' }),
  })

  const updateYearMut = useMutation({
    mutationFn: ({ id, data }) => sessionsApi.updateAcademicYear(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); closeYearModal() },
    onError: (err) => setYearErrors(err.response?.data || { detail: 'Failed to update' }),
  })

  const deleteYearMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteAcademicYear(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['academicYears'] }),
  })

  const setCurrentMut = useMutation({
    mutationFn: (id) => sessionsApi.setCurrentYear(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); refreshAcademicYear() },
  })

  // Term mutations
  const createTermMut = useMutation({
    mutationFn: (data) => sessionsApi.createTerm(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['terms'] }); closeTermModal() },
    onError: (err) => setTermErrors(err.response?.data || { detail: 'Failed to create' }),
  })

  const updateTermMut = useMutation({
    mutationFn: ({ id, data }) => sessionsApi.updateTerm(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['terms'] }); closeTermModal() },
    onError: (err) => setTermErrors(err.response?.data || { detail: 'Failed to update' }),
  })

  const deleteTermMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteTerm(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['terms'] }),
  })

  // Year modal helpers
  const openCreateYear = () => { setYearForm(EMPTY_YEAR); setEditYearId(null); setYearErrors({}); setShowYearModal(true) }
  const openEditYear = (y) => {
    setYearForm({ name: y.name, start_date: y.start_date, end_date: y.end_date })
    setEditYearId(y.id); setYearErrors({}); setShowYearModal(true)
  }
  const closeYearModal = () => { setShowYearModal(false); setEditYearId(null); setYearForm(EMPTY_YEAR); setYearErrors({}) }

  const handleYearSubmit = (e) => {
    e.preventDefault()
    if (editYearId) updateYearMut.mutate({ id: editYearId, data: yearForm })
    else createYearMut.mutate(yearForm)
  }

  // Term modal helpers
  const openCreateTerm = (yearId) => {
    setTermForm({ ...EMPTY_TERM, academic_year: yearId || '' })
    setEditTermId(null); setTermErrors({}); setShowTermModal(true)
  }
  const openEditTerm = (t) => {
    setTermForm({
      academic_year: t.academic_year, name: t.name, term_type: t.term_type,
      order: t.order, start_date: t.start_date || '', end_date: t.end_date || '',
    })
    setEditTermId(t.id); setTermErrors({}); setShowTermModal(true)
  }
  const closeTermModal = () => { setShowTermModal(false); setEditTermId(null); setTermForm(EMPTY_TERM); setTermErrors({}) }

  const handleTermSubmit = (e) => {
    e.preventDefault()
    const payload = { ...termForm, order: parseInt(termForm.order) || 1 }
    if (editTermId) updateTermMut.mutate({ id: editTermId, data: payload })
    else createTermMut.mutate(payload)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Academic Sessions</h1>
          <p className="text-sm text-gray-600">Manage academic years and terms</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('years')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'years' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Academic Years
        </button>
        <button
          onClick={() => setTab('terms')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'terms' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Terms
        </button>
      </div>

      {/* ─── Academic Years Tab ─── */}
      {tab === 'years' && (
        <>
          <div className="flex justify-end gap-2 mb-4">
            {years.length > 0 && (
              <button onClick={() => setShowSetupWizard(true)} className="btn-secondary text-sm px-4 py-2 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI Setup Wizard
              </button>
            )}
            <button onClick={openCreateYear} className="btn-primary text-sm px-4 py-2">+ Add Academic Year</button>
          </div>

          {yearsLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : years.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No academic years found. Create one to get started.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {years.map(y => (
                <div key={y.id} className={`card border-2 ${y.id === activeAcademicYear?.id ? 'border-blue-400 bg-blue-50/30' : y.is_current ? 'border-green-400 bg-green-50/30' : 'border-transparent'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900">{y.name}</h3>
                    <div className="flex gap-1">
                      {y.id === activeAcademicYear?.id && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Selected</span>
                      )}
                      {y.is_current && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">Current</span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Start: {y.start_date}</p>
                    <p>End: {y.end_date}</p>
                    {y.terms_count !== undefined && <p className="text-xs text-gray-500">{y.terms_count} term(s)</p>}
                  </div>

                  {/* Summary toggle */}
                  {expandedYearId === y.id && summary && (
                    <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-600 space-y-1">
                      <p>Students enrolled: {summary.total_students || 0}</p>
                      <p>Classes: {summary.total_classes || 0}</p>
                      <p>Terms: {summary.terms?.length || 0}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-gray-100">
                    {!y.is_current && (
                      <button
                        onClick={() => { if (confirm(`Set "${y.name}" as current academic year?`)) setCurrentMut.mutate(y.id) }}
                        className="text-xs text-green-600 hover:underline"
                      >Set Current</button>
                    )}
                    <button
                      onClick={() => setExpandedYearId(expandedYearId === y.id ? null : y.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >{expandedYearId === y.id ? 'Hide Summary' : 'Summary'}</button>
                    <button onClick={() => openEditYear(y)} className="text-xs text-primary-600 hover:underline">Edit</button>
                    <button
                      onClick={() => { if (confirm(`Delete "${y.name}"?`)) deleteYearMut.mutate(y.id) }}
                      className="text-xs text-red-600 hover:underline"
                    >Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Year Modal */}
          {showYearModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeYearModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editYearId ? 'Edit Academic Year' : 'Add Academic Year'}</h2>
                  <button onClick={closeYearModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(yearErrors.detail || yearErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {yearErrors.detail || yearErrors.non_field_errors}
                  </div>
                )}

                <form onSubmit={handleYearSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={yearForm.name}
                      onChange={e => setYearForm(p => ({ ...p, name: e.target.value }))}
                      className="input w-full"
                      required
                      placeholder="e.g. 2025-2026"
                    />
                    {yearErrors.name && <p className="text-xs text-red-600 mt-1">{yearErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={yearForm.start_date}
                      onChange={e => setYearForm(p => ({ ...p, start_date: e.target.value }))}
                      className="input w-full"
                      required
                    />
                    {yearErrors.start_date && <p className="text-xs text-red-600 mt-1">{yearErrors.start_date}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                    <input
                      type="date"
                      value={yearForm.end_date}
                      onChange={e => setYearForm(p => ({ ...p, end_date: e.target.value }))}
                      className="input w-full"
                      required
                    />
                    {yearErrors.end_date && <p className="text-xs text-red-600 mt-1">{yearErrors.end_date}</p>}
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeYearModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createYearMut.isPending || updateYearMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createYearMut.isPending || updateYearMut.isPending ? 'Saving...' : editYearId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Terms Tab ─── */}
      {tab === 'terms' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
              className="input w-full sm:w-52"
            >
              <option value="">All Years</option>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
            <button onClick={() => openCreateTerm(yearFilter)} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              + Add Term
            </button>
          </div>

          {termsLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : terms.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No terms found.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Academic Year</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-center">Order</th>
                      <th className="px-4 py-3 text-left">Start</th>
                      <th className="px-4 py-3 text-left">End</th>
                      <th className="px-4 py-3 text-center">Current</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {terms.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{t.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{t.academic_year_name}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{t.term_type}</span>
                        </td>
                        <td className="px-4 py-2 text-sm text-center">{t.order}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{t.start_date}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{t.end_date}</td>
                        <td className="px-4 py-2 text-center">
                          {t.is_current && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Current</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => openEditTerm(t)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          <button
                            onClick={() => { if (confirm(`Delete term "${t.name}"?`)) deleteTermMut.mutate(t.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {terms.map(t => (
                  <div key={t.id} className="card">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{t.name}</p>
                        <p className="text-xs text-gray-500">{t.academic_year_name}</p>
                      </div>
                      <div className="flex gap-1">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{t.term_type}</span>
                        {t.is_current && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Current</span>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">{t.start_date} — {t.end_date} (Order: {t.order})</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => openEditTerm(t)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      <button onClick={() => { if (confirm('Delete?')) deleteTermMut.mutate(t.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Term Modal */}
          {showTermModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeTermModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editTermId ? 'Edit Term' : 'Add Term'}</h2>
                  <button onClick={closeTermModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(termErrors.detail || termErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {termErrors.detail || termErrors.non_field_errors}
                  </div>
                )}

                <form onSubmit={handleTermSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                    <select
                      value={termForm.academic_year}
                      onChange={e => setTermForm(p => ({ ...p, academic_year: e.target.value }))}
                      className="input w-full"
                      required
                    >
                      <option value="">Select year...</option>
                      {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={termForm.name}
                      onChange={e => setTermForm(p => ({ ...p, name: e.target.value }))}
                      className="input w-full"
                      required
                      placeholder="e.g. Term 1"
                    />
                    {termErrors.name && <p className="text-xs text-red-600 mt-1">{termErrors.name}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                      <select
                        value={termForm.term_type}
                        onChange={e => setTermForm(p => ({ ...p, term_type: e.target.value }))}
                        className="input w-full"
                      >
                        <option value="TERM">Term</option>
                        <option value="SEMESTER">Semester</option>
                        <option value="QUARTER">Quarter</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
                      <input
                        type="number"
                        min="1"
                        value={termForm.order}
                        onChange={e => setTermForm(p => ({ ...p, order: e.target.value }))}
                        className="input w-full"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                    <input type="date" value={termForm.start_date} onChange={e => setTermForm(p => ({ ...p, start_date: e.target.value }))} className="input w-full" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                    <input type="date" value={termForm.end_date} onChange={e => setTermForm(p => ({ ...p, end_date: e.target.value }))} className="input w-full" required />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeTermModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createTermMut.isPending || updateTermMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createTermMut.isPending || updateTermMut.isPending ? 'Saving...' : editTermId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
      {/* AI Setup Wizard Modal */}
      {showSetupWizard && (
        <SessionSetupWizard onClose={() => setShowSetupWizard(false)} />
      )}
    </div>
  )
}
