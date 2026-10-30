import { schoolToday } from '../../utils/schoolTime'
import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import SessionSetupWizard from './SessionSetupWizard'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Stepper from '../../components/academic/Stepper'
import YearCard from './YearCard'
import { formatDay } from './termDefaults'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import TermsModal from './TermsModal'
import { yearWarnings } from '../../components/timeline/timelineMath'
import YearTimeline from '../../components/timeline/YearTimeline'
import YearsStrip from '../../components/timeline/YearsStrip'

const EMPTY_YEAR = { name: '', start_date: '', end_date: '' }
const EMPTY_TERM_IMPORT = {
  source_academic_year_id: '',
  target_academic_year_id: '',
  conflict_mode: 'skip',
  include_inactive: false,
}

export default function AcademicYearsPage() {
  const queryClient = useQueryClient()
  const { refresh: refreshAcademicYear, activeAcademicYear } = useAcademicYear()
  const { isSchoolAdmin } = useAuth()
  const { showSuccess, showError } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const [termsYearId, setTermsYearId] = useState(null) // year whose terms modal is open

  // Year state
  const [showYearModal, setShowYearModal] = useState(false)
  const [editYearId, setEditYearId] = useState(null)
  const [yearForm, setYearForm] = useState(EMPTY_YEAR)
  const [yearErrors, setYearErrors] = useState({})

  // Term state
  const [showImportModal, setShowImportModal] = useState(false)
  const [importForm, setImportForm] = useState(EMPTY_TERM_IMPORT)
  const [importErrors, setImportErrors] = useState({})
  const [importPreview, setImportPreview] = useState(null)

  // Setup wizard
  const [showSetupWizard, setShowSetupWizard] = useState(false)

  // Queries
  const { data: yearsRes, isLoading: yearsLoading } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  // Every year's terms, for the timeline on each year card. Refetched with the ['terms'] prefix after any term change.
  const { data: allTermsRes } = useQuery({
    queryKey: ['terms', 'all'],
    queryFn: () => sessionsApi.getTerms({ page_size: 9999 }),
  })

  const { data: summaryRes } = useQuery({
    queryKey: ['yearSummary', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getYearSummary(activeAcademicYear.id),
    enabled: !!activeAcademicYear?.id,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const summary = summaryRes?.data || null
  const termsYear = years.find(y => y.id === termsYearId) || null
  const allTerms = allTermsRes?.data?.results || allTermsRes?.data || []

  // Year mutations
  const createYearMut = useMutation({
    mutationFn: (data) => sessionsApi.createAcademicYear(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); closeYearModal(); showSuccess('Academic year added') },
    onError: (err) => setYearErrors(err.response?.data || { detail: 'Failed to create' }),
  })

  const updateYearMut = useMutation({
    mutationFn: ({ id, data }) => sessionsApi.updateAcademicYear(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); closeYearModal(); showSuccess('Academic year updated') },
    onError: (err) => setYearErrors(err.response?.data || { detail: 'Failed to update' }),
  })

  const deleteYearMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteAcademicYear(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); showSuccess('Academic year deleted') },
    onError: (err) => showError(err.response?.data?.detail || 'Could not delete the year'),
  })

  const setCurrentMut = useMutation({
    // The dialog the admin just accepted is the confirmation the server asks for on a past or future year.
    mutationFn: (id) => sessionsApi.setCurrentYear(id, { confirm_warnings: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['academicYears'] }); refreshAcademicYear(); showSuccess('Current academic year changed') },
    onError: (err) => showError(err.response?.data?.detail || 'Could not set the current year'),
  })

  const importPreviewMut = useMutation({
    mutationFn: (data) => sessionsApi.importTermsPreview(data),
    onSuccess: (res) => {
      setImportPreview(res?.data || null)
      setImportErrors({})
      showSuccess('Preview generated')
    },
    onError: (err) => {
      const data = err.response?.data || {}
      setImportErrors(data)
      showError(data.detail || data.non_field_errors?.[0] || 'Failed to generate preview')
    },
  })

  const importApplyMut = useMutation({
    mutationFn: (data) => sessionsApi.importTermsApply(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['terms'] })
      queryClient.invalidateQueries({ queryKey: ['academicYears'] })
      const applied = res?.data?.applied || {}
      showSuccess(`Imported terms (${applied.created || 0} created, ${applied.updated || 0} updated, ${applied.skipped || 0} skipped)`)
      closeImportModal()
    },
    onError: (err) => {
      const data = err.response?.data || {}
      setImportErrors(data)
      showError(data.detail || data.non_field_errors?.[0] || 'Failed to import terms')
    },
  })

  // Year modal helpers
  const openCreateYear = () => { setYearForm(EMPTY_YEAR); setEditYearId(null); setYearErrors({}); setShowYearModal(true) }
  const openEditYear = (y) => {
    setYearForm({ name: y.name, start_date: y.start_date, end_date: y.end_date })
    setEditYearId(y.id); setYearErrors({}); setShowYearModal(true)
  }
  const closeYearModal = () => { setShowYearModal(false); setEditYearId(null); setYearForm(EMPTY_YEAR); setYearErrors({}) }

  // Overlap and odd length are warnings the admin can accept: the form shows them while typing and the
  // button then reads "Save anyway". The server asks again if it sees something the form could not.
  const otherYears = years.filter(y => y.id !== editYearId)
  const yearFormWarnings = showYearModal ? yearWarnings(yearForm, otherYears) : []
  const serverYearWarnings = yearErrors.confirm_warnings ? [].concat(yearErrors.non_field_errors || []) : []

  const submitYear = (confirmed) => {
    const data = { ...yearForm }
    if (confirmed || yearFormWarnings.length) data.confirm_warnings = true
    if (editYearId) updateYearMut.mutate({ id: editYearId, data })
    else createYearMut.mutate(data)
  }
  const handleYearSubmit = (e) => { e.preventDefault(); submitYear(false) }

  const openImportModal = (yearId) => {
    setImportErrors({})
    setImportPreview(null)
    setImportForm({
      ...EMPTY_TERM_IMPORT,
      target_academic_year_id: yearId || '',
    })
    setShowImportModal(true)
  }

  const closeImportModal = () => {
    setShowImportModal(false)
    setImportErrors({})
    setImportPreview(null)
    setImportForm(EMPTY_TERM_IMPORT)
  }

  useEscapeKey(closeYearModal, showYearModal)
  useEscapeKey(closeImportModal, showImportModal)

  const handleImportPreview = (e) => {
    e.preventDefault()
    if (!importForm.source_academic_year_id || !importForm.target_academic_year_id) {
      setImportErrors({ detail: 'Please select source and target academic years.' })
      return
    }
    importPreviewMut.mutate(importForm)
  }

  const handleImportApply = () => {
    if (!importPreview) {
      showError('Generate preview before importing terms.')
      return
    }
    importApplyMut.mutate(importForm)
  }

  return (
    <div>
      <PageHeader title="Academic Sessions" subtitle="Manage academic years and their terms" className="mb-6" />

      {/* ─── Academic Years ─── */}
      <>
          {isSchoolAdmin && <div className="flex justify-end gap-2 mb-4">
            {years.length > 0 && (
              <Button variant="secondary" onClick={() => setShowSetupWizard(true)} className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI Setup Wizard
              </Button>
            )}
            <Button onClick={openCreateYear}>+ Add Academic Year</Button>
          </div>}

          {yearsLoading ? (
            <div className="text-center py-12">
              <Spinner size="md" className="mx-auto" />
            </div>
          ) : years.length === 0 ? (
            <div className="card p-4 sm:p-6 dark:bg-gray-800 dark:border-gray-700">
              <Stepper steps={['Create Academic Year', 'Add Terms', 'Activate Year']} current={1} />
              <p className="text-sm text-gray-500 mt-3 dark:text-gray-400">{isSchoolAdmin ? 'No academic years yet. Click "+ Add Academic Year" to create your first one.' : 'No academic years yet. A school admin or principal sets them up.'}</p>
              {isSchoolAdmin && <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 mt-3 dark:bg-primary-900/20 dark:border-primary-900/60">
                <p className="text-xs text-primary-700 dark:text-primary-300">
                  <span className="font-semibold">Tip:</span> Use the AI Setup Wizard to auto-generate years and terms.
                </p>
              </div>}
            </div>
          ) : (
            <>
            <YearsStrip years={years} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {years.map(y => (
                <YearCard
                  key={y.id}
                  year={y}
                  readOnly={!isSchoolAdmin}
                  activeYearId={activeAcademicYear?.id}
                  terms={allTerms.filter(t => t.academic_year === y.id)}
                  classesCount={y.id === activeAcademicYear?.id && summary ? (summary.classes_count || 0) : undefined}
                  onManageTerms={() => setTermsYearId(y.id)}
                  onEdit={() => openEditYear(y)}
                  onSetCurrent={async () => {
                    const today = schoolToday()
                    const outside = today < y.start_date ? ' It has not started yet.' : today > y.end_date ? ' It has already ended.' : ''
                    const ok = await confirm({ title: 'Set as Current', message: `Set "${y.name}" as current academic year?${outside}`, variant: 'warning', confirmLabel: 'Set as Current' })
                    if (ok) setCurrentMut.mutate(y.id)
                  }}
                  onDelete={async () => {
                    const ok = await confirm({ title: 'Delete Year', message: `Delete "${y.name}"? This cannot be undone.` })
                    if (ok) deleteYearMut.mutate(y.id)
                  }}
                />
              ))}
            </div>
            </>
          )}

          {/* Year Modal */}
          {showYearModal && (
            <Modal open onClose={closeYearModal} title={editYearId ? 'Edit Academic Year' : 'Add Academic Year'}>

                {(yearErrors.detail || yearErrors.non_field_errors) && !yearErrors.confirm_warnings && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm dark:bg-red-900/30 dark:text-red-300">
                    {yearErrors.detail || yearErrors.non_field_errors}
                  </div>
                )}
                {(yearFormWarnings.length > 0 || serverYearWarnings.length > 0) && (
                  <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                    {[...new Set([...yearFormWarnings, ...serverYearWarnings])].map(w => <p key={w}>{w}</p>)}
                    <p className="mt-1">You can still save it.</p>
                  </div>
                )}

                <form onSubmit={handleYearSubmit} className="space-y-4">
                  <div>
                    <label className="label">Name *</label>
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
                    <label className="label">Start Date *</label>
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
                    <label className="label">End Date *</label>
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
                    <Button type="button" variant="ghost" onClick={closeYearModal}>Cancel</Button>
                    <Button type="submit" loading={createYearMut.isPending || updateYearMut.isPending}>
                      {(yearFormWarnings.length || serverYearWarnings.length) ? 'Save anyway' : editYearId ? 'Update' : 'Create'}
                    </Button>
                  </div>
                </form>
              </Modal>
          )}
      </>

          {showImportModal && (
            <Modal open onClose={closeImportModal} title="Import Terms From Previous Session" size="3xl">

                {(importErrors.detail || importErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm dark:bg-red-900/30 dark:text-red-300">
                    {importErrors.detail || importErrors.non_field_errors}
                  </div>
                )}

                <form onSubmit={handleImportPreview} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Source Academic Year *</label>
                      <select
                        value={importForm.source_academic_year_id}
                        onChange={e => setImportForm(p => ({ ...p, source_academic_year_id: e.target.value ? parseInt(e.target.value) : '' }))}
                        className="input w-full"
                        required
                      >
                        <option value="">Select source year...</option>
                        {years
                          .filter(y => String(y.id) !== String(importForm.target_academic_year_id || ''))
                          .map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                      </select>
                      {importErrors.source_academic_year_id && <p className="text-xs text-red-600 mt-1">{importErrors.source_academic_year_id}</p>}
                    </div>
                    <div>
                      <label className="label">Target Academic Year *</label>
                      <select
                        value={importForm.target_academic_year_id}
                        onChange={e => setImportForm(p => ({ ...p, target_academic_year_id: e.target.value ? parseInt(e.target.value) : '' }))}
                        className="input w-full"
                        required
                      >
                        <option value="">Select target year...</option>
                        {years
                          .filter(y => String(y.id) !== String(importForm.source_academic_year_id || ''))
                          .map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                      </select>
                      {importErrors.target_academic_year_id && <p className="text-xs text-red-600 mt-1">{importErrors.target_academic_year_id}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Conflict Mode">
<select
                        value={importForm.conflict_mode}
                        onChange={e => setImportForm(p => ({ ...p, conflict_mode: e.target.value }))}
                        className="input w-full"
                      >
                        <option value="skip">Skip existing terms</option>
                        <option value="update">Update existing terms</option>
                      </select>
</Field>
                    <div className="flex items-end">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700 mb-2 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={importForm.include_inactive}
                          onChange={e => setImportForm(p => ({ ...p, include_inactive: e.target.checked }))}
                        />
                        Include inactive source terms
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" loading={importPreviewMut.isPending}>
                      {importPreviewMut.isPending ? 'Generating Preview...' : 'Preview Import'}
                    </Button>
                  </div>
                </form>

                {importPreview && (
                  <div className="mt-5 border-t pt-4">
                    <div className="flex flex-wrap gap-2 mb-3 text-xs">
                      <Badge tone="success">Create: {importPreview.counts?.create || 0}</Badge>
                      <Badge tone="warning">Update: {importPreview.counts?.update || 0}</Badge>
                      <Badge tone="neutral">Skip: {importPreview.counts?.skip || 0}</Badge>
                      <Badge tone="danger">Conflict: {importPreview.counts?.conflict || 0}</Badge>
                    </div>

                    {(importPreview.counts?.conflict || 0) > 0 && (
                      <div className="mb-3 p-2 rounded border border-red-200 bg-red-50 text-red-700 text-xs dark:border-red-900/60 dark:bg-red-900/30 dark:text-red-300">
                        Preview contains conflicts (duplicate order/date overlap). Resolve terms in the target year or switch conflict mode before importing.
                      </div>
                    )}

                    <div className="max-h-72 overflow-auto border border-gray-200 rounded-lg dark:border-gray-700">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-gray-700 dark:text-gray-300">
                            <th className="px-3 py-2 text-left">Term</th>
                            <th className="px-3 py-2 text-left">Source Dates</th>
                            <th className="px-3 py-2 text-left">Target Dates</th>
                            <th className="px-3 py-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {(importPreview.terms || []).map((row) => (
                            <tr key={row.source_term_id}>
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{row.name}</p>
                                <p className="text-xs text-gray-500">{row.term_type} | Order {row.order}</p>
                              </td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{formatDay(row.source_start_date)} - {formatDay(row.source_end_date)}</td>
                              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{formatDay(row.start_date)} - {formatDay(row.end_date)}</td>
                              <td className="px-3 py-2">
                                <Badge colors={row.action === 'create' ? TONE.success : row.action === 'update' ? TONE.warning : TONE.neutral}>
                                  {row.action}
                                </Badge>
                                {row.reason && <p className="text-xs text-gray-500 mt-1">{row.reason}</p>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                      <Button type="button" variant="ghost" onClick={closeImportModal}>Cancel</Button>
                      <Button
                        type="button"
                        onClick={handleImportApply}
                        loading={importApplyMut.isPending}
                        disabled={(importPreview.counts?.conflict || 0) > 0 || (importPreview.counts?.create || 0) + (importPreview.counts?.update || 0) === 0}
                      >
                        {importApplyMut.isPending ? 'Importing...' : 'Import Terms'}
                      </Button>
                    </div>
                  </div>
                )}
              </Modal>
          )}
      {termsYear && (
        <TermsModal
          year={termsYear}
          onClose={() => setTermsYearId(null)}
          onImport={() => openImportModal(termsYear.id)}
        />
      )}
      {/* AI Setup Wizard Modal */}
      {showSetupWizard && (
        <SessionSetupWizard onClose={() => setShowSetupWizard(false)} />
      )}
      <ConfirmModalRoot />
    </div>
  )
}
