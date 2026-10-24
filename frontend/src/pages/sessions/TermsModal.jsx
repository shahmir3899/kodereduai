import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import { sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import YearTimeline from '../../components/timeline/YearTimeline'
import TermRangeSlider from '../../components/timeline/TermRangeSlider'
import { findOverlaps, spansOverlap } from '../../components/timeline/timelineMath'
import { addDays, formatDay, nextTermDefaults } from './termDefaults'

const EMPTY = { name: '', term_type: 'TERM', order: 1, start_date: '', end_date: '' }
const SUGGESTED_TERM_DAYS = 90

const firstMessage = (value) => (Array.isArray(value) ? value[0] : value)

/**
 * All of one academic year's terms in one place: the year's timeline on top (click a term to edit
 * it), the term list, and an add/edit panel with a slider. Overlapping terms are a warning here:
 * the admin sees it live, and the server asks for confirmation before saving.
 */
export default function TermsModal({ year, onClose, onImport }) {
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const [editing, setEditing] = useState(null) // null = list only; { id } | { id: null } = form open
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [serverWarnings, setServerWarnings] = useState(null) // set when the server wants a confirmation

  const { data: termsRes, isLoading } = useQuery({
    queryKey: ['terms', 'year', year.id],
    queryFn: () => sessionsApi.getTerms({ academic_year: year.id, page_size: 9999 }),
  })
  const terms = useMemo(() => {
    const list = termsRes?.data?.results || termsRes?.data || []
    return [...list].sort((a, b) => a.order - b.order)
  }, [termsRes])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['terms'] })
    queryClient.invalidateQueries({ queryKey: ['academicYears'] })
  }

  const closeForm = () => { setEditing(null); setForm(EMPTY); setErrors({}); setServerWarnings(null) }

  const saveMut = useMutation({
    mutationFn: ({ id, data }) => (id ? sessionsApi.updateTerm(id, data) : sessionsApi.createTerm(data)),
    onSuccess: (_res, vars) => {
      refresh()
      showSuccess(vars.id ? 'Term updated' : 'Term created')
      closeForm()
    },
    onError: (err) => {
      const data = err.response?.data || {}
      if (data.confirm_warnings) {
        setServerWarnings([].concat(data.non_field_errors || []))
        setErrors({})
        return
      }
      setErrors(data)
      showError(firstMessage(data.detail) || firstMessage(data.non_field_errors) || 'Could not save the term')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteTerm(id),
    onSuccess: () => { refresh(); showSuccess('Term deleted') },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete term'),
  })

  const openAdd = () => {
    const next = nextTermDefaults(year, terms)
    const end = next.start_date ? addDays(next.start_date, SUGGESTED_TERM_DAYS - 1) : ''
    setForm({
      ...EMPTY,
      order: next.order,
      name: `Term ${next.order}`,
      start_date: next.start_date,
      end_date: end && end > year.end_date ? year.end_date : end,
    })
    setErrors({}); setServerWarnings(null); setEditing({ id: null })
  }
  const openEdit = (t) => {
    setForm({ name: t.name, term_type: t.term_type, order: t.order, start_date: t.start_date || '', end_date: t.end_date || '' })
    setErrors({}); setServerWarnings(null); setEditing({ id: t.id })
  }

  const draft = editing && form.start_date && form.end_date
    ? { id: editing.id ?? 'draft', name: form.name || 'New term', start_date: form.start_date, end_date: form.end_date }
    : null

  // Live overlap check against the saved terms, so the warning appears while dragging, not after Save.
  const clashes = draft
    ? terms.filter(t => t.id !== editing.id && spansOverlap(draft, t))
    : []
  const outsideYear = draft && (draft.start_date < year.start_date || draft.end_date > year.end_date)
  const inverted = draft && draft.start_date >= draft.end_date

  const save = (confirmed) => {
    const payload = {
      academic_year: year.id,
      name: form.name,
      term_type: form.term_type,
      order: parseInt(form.order, 10) || 1,
      start_date: form.start_date,
      end_date: form.end_date,
    }
    // Showing the overlap warning live counts as seeing it; the button then reads "Save anyway".
    if (confirmed || clashes.length) payload.confirm_warnings = true
    saveMut.mutate({ id: editing.id, data: payload })
  }

  const onSubmit = (e) => { e.preventDefault(); save(false) }
  const set = (patch) => setForm(p => ({ ...p, ...patch }))
  const timelineOverlaps = findOverlaps(terms)

  return (
    <Modal open onClose={onClose} title={`Terms - ${year.name}`} size="3xl">
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        {formatDay(year.start_date)} - {formatDay(year.end_date)}
      </p>

      <YearTimeline
        year={year}
        terms={terms.filter(t => t.id !== editing?.id)}
        draft={draft}
        onTermClick={openEdit}
      />

      {!editing && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {terms.length} term{terms.length === 1 ? '' : 's'}
            </h4>
            <div className="flex gap-2">
              {onImport && <button type="button" onClick={onImport} className="btn-secondary px-3 py-1.5 text-sm">Import from another year</button>}
              <button type="button" onClick={openAdd} className="btn-primary px-3 py-1.5 text-sm">+ Add Term</button>
            </div>
          </div>

          {isLoading ? (
            <div className="py-8 text-center"><Spinner size="md" className="mx-auto" /></div>
          ) : terms.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-600">
              No terms yet. Add the first one, or import them from another year.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {terms.map(t => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t.name}
                      {timelineOverlaps.has(t.id) && <span className="ml-2 text-xs font-medium text-red-600">Overlaps</span>}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDay(t.start_date)} - {formatDay(t.end_date)} · {t.term_type.toLowerCase()} · order {t.order}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => openEdit(t)} className="text-xs text-primary-600 hover:underline">Edit</button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({ title: 'Delete Term', message: `Delete term "${t.name}"? This cannot be undone.` })
                        if (ok) deleteMut.mutate(t.id)
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={onSubmit} className="mt-4 space-y-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:p-4">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editing.id ? 'Edit term' : 'Add term'}</h4>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="label" htmlFor="term-name">Name *</label>
              <input id="term-name" className="input w-full" required value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Term 1" />
              {errors.name && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.name)}</p>}
            </div>
            <div>
              <label className="label" htmlFor="term-type">Type</label>
              <select id="term-type" className="input w-full" value={form.term_type} onChange={e => set({ term_type: e.target.value })}>
                <option value="TERM">Term</option>
                <option value="SEMESTER">Semester</option>
                <option value="QUARTER">Quarter</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="term-order">Order</label>
              <input id="term-order" type="number" min="1" className="input w-full" value={form.order} onChange={e => set({ order: e.target.value })} />
              {errors.order && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.order)}</p>}
            </div>
          </div>

          <TermRangeSlider
            min={year.start_date}
            max={year.end_date}
            start={form.start_date || year.start_date}
            end={form.end_date || year.end_date}
            invalid={clashes.length > 0 || inverted}
            onChange={set}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="term-start">Start date *</label>
              <input id="term-start" type="date" required className="input w-full" value={form.start_date} min={year.start_date} max={year.end_date} onChange={e => set({ start_date: e.target.value })} />
              {errors.start_date && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.start_date)}</p>}
            </div>
            <div>
              <label className="label" htmlFor="term-end">End date *</label>
              <input id="term-end" type="date" required className="input w-full" value={form.end_date} min={year.start_date} max={year.end_date} onChange={e => set({ end_date: e.target.value })} />
              {errors.end_date && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.end_date)}</p>}
            </div>
          </div>

          {(inverted || outsideYear) && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {inverted ? 'The end date must be after the start date.' : `Dates must stay inside the year (${formatDay(year.start_date)} - ${formatDay(year.end_date)}).`}
            </p>
          )}
          {clashes.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <p className="font-medium">These dates overlap another term.</p>
              <ul className="mt-1 list-disc pl-5">
                {clashes.map(t => <li key={t.id}>{t.name} ({formatDay(t.start_date)} - {formatDay(t.end_date)})</li>)}
              </ul>
              <p className="mt-1">You can still save; the terms will run side by side.</p>
            </div>
          )}
          {serverWarnings && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {serverWarnings.map(w => <p key={w}>{w}</p>)}
              <button type="button" onClick={() => save(true)} className="mt-2 rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700">Save anyway</button>
            </div>
          )}
          {(errors.detail || errors.non_field_errors) && !errors.confirm_warnings && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {firstMessage(errors.detail) || firstMessage(errors.non_field_errors)}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={closeForm} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">Cancel</button>
            <button type="submit" disabled={saveMut.isPending || inverted || outsideYear} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {saveMut.isPending ? 'Saving...' : clashes.length ? 'Save anyway' : editing.id ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}
      <ConfirmModalRoot />
    </Modal>
  )
}
