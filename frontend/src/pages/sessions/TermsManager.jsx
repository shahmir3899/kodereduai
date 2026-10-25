import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import YearTimeline from '../../components/timeline/YearTimeline'
import { TERM_COLOURS } from '../../components/academic/academicTones'
import { findOverlaps, spansOverlap } from '../../components/timeline/timelineMath'
import { addDays, formatDay, nextTermDefaults } from './termDefaults'

const SUGGESTED_TERM_DAYS = 90
const AUTOSAVE_MS = 700

const firstMessage = (value) => (Array.isArray(value) ? value[0] : value)
const snapshot = (f) => JSON.stringify([f.name.trim(), f.term_type, Number(f.order) || 1, f.start_date, f.end_date])
const formOf = (t) => ({ name: t.name, term_type: t.term_type, order: t.order, start_date: t.start_date || '', end_date: t.end_date || '' })

/**
 * All of one academic year's terms in one place: a single timeline bar (click a term, then drag its
 * edge handles), the term list, and the selected term's fields. Edits save by themselves a moment
 * after you stop. Overlapping terms are only a warning: the change is held back, with a "Save anyway"
 * button, rather than saved silently.
 */
export default function TermsManager({ year, onImport, onChanged }) {
  const queryClient = useQueryClient()
  const { showError } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(null) // the selected term's fields, edited live
  const [errors, setErrors] = useState({})
  const [serverWarnings, setServerWarnings] = useState(null) // the server asked for a confirmation
  const [status, setStatus] = useState('idle') // idle | saving | saved | held | error
  const savedRef = useRef('') // snapshot of what the server has for the selected term

  const { data: termsRes, isLoading } = useQuery({
    queryKey: ['terms', 'year', year.id],
    queryFn: () => sessionsApi.getTerms({ academic_year: year.id, page_size: 9999 }),
  })
  const terms = useMemo(() => {
    const list = termsRes?.data?.results || termsRes?.data || []
    return [...list].sort((a, b) => a.order - b.order)
  }, [termsRes])

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['terms'] })
    queryClient.invalidateQueries({ queryKey: ['academicYears'] })
    onChanged?.()
  }, [queryClient, onChanged])

  const others = terms.filter(t => t.id !== selectedId)
  const live = form ? { id: selectedId, ...form } : null
  // The selected term is drawn from the live form, so dragging and typing move the same bar.
  const drawn = terms.map(t => (t.id === selectedId && live ? { ...t, ...live } : t))
  const clashes = live ? others.filter(t => spansOverlap(live, t)) : []
  const inverted = !!live && live.start_date >= live.end_date
  const outsideYear = !!live && (live.start_date < year.start_date || live.end_date > year.end_date)
  const valid = !!live && live.name.trim() !== '' && !inverted && !outsideYear
  const dirty = !!form && snapshot(form) !== savedRef.current

  const persist = useCallback(async (id, f, confirmed = false) => {
    const sent = snapshot(f)
    setStatus('saving'); setErrors({}); setServerWarnings(null)
    try {
      await sessionsApi.updateTerm(id, {
        name: f.name.trim(), term_type: f.term_type, order: Number(f.order) || 1,
        start_date: f.start_date, end_date: f.end_date,
        ...(confirmed ? { confirm_warnings: true } : {}),
      })
      savedRef.current = sent
      setStatus('saved')
      refresh()
    } catch (err) {
      const data = err.response?.data || {}
      if (data.confirm_warnings) {
        setServerWarnings([].concat(data.non_field_errors || []))
        setStatus('held')
      } else {
        setErrors(data)
        setStatus('error')
        if (data.detail) showError(firstMessage(data.detail))
      }
    }
  }, [refresh, showError])

  // Autosave: a valid, non-overlapping change goes out once the admin pauses.
  useEffect(() => {
    if (!form || !dirty) return undefined
    if (!valid) { setStatus('error'); return undefined }
    if (clashes.length) { setStatus('held'); return undefined }
    setStatus('saving')
    const timer = setTimeout(() => persist(selectedId, form), AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form && snapshot(form), selectedId, valid, clashes.length])

  // Closing the dialog or the step mid-pause must not lose the last edit.
  const latest = useRef({})
  latest.current = { selectedId, form, dirty, valid, clashes: clashes.length, persist }
  useEffect(() => () => {
    const { selectedId: id, form: f, dirty: d, valid: v, clashes: c, persist: save } = latest.current
    if (id && f && d && v && !c) save(id, f)
  }, [])

  const select = async (t) => {
    if (t.id === selectedId) return
    if (dirty && valid && !clashes.length) await persist(selectedId, form)
    else if (dirty) {
      const ok = await confirm({ title: 'Discard changes?', message: 'This term has changes that were not saved. Discard them?', variant: 'warning', confirmLabel: 'Discard' })
      if (!ok) return
    }
    setSelectedId(t.id); setForm(formOf(t)); savedRef.current = snapshot(formOf(t))
    setErrors({}); setServerWarnings(null); setStatus('idle')
  }

  const addTerm = async () => {
    const next = nextTermDefaults(year, terms)
    if (!next.start_date) {
      showError('Every day of this year is already inside a term. Shorten a term first.')
      return
    }
    if (dirty && valid && !clashes.length) await persist(selectedId, form)
    const end = addDays(next.start_date, SUGGESTED_TERM_DAYS - 1)
    const name = `Term ${next.order}`
    try {
      await sessionsApi.createTerm({
        academic_year: year.id, name, term_type: 'TERM', order: next.order,
        start_date: next.start_date, end_date: end > year.end_date ? year.end_date : end,
      })
      // The create response carries no id, so find the new term in the fresh list to select it.
      const fresh = await sessionsApi.getTerms({ academic_year: year.id, page_size: 9999 })
      const list = fresh.data?.results || fresh.data || []
      const created = list.find(t => t.order === next.order && t.name === name)
      refresh()
      if (!created) { setStatus('idle'); return }
      setSelectedId(created.id); setForm(formOf(created)); savedRef.current = snapshot(formOf(created))
      setErrors({}); setServerWarnings(null); setStatus('saved')
    } catch (err) {
      const data = err.response?.data || {}
      showError(firstMessage(data.name) || firstMessage(data.order) || firstMessage(data.non_field_errors) || firstMessage(data.detail) || 'Could not add the term')
    }
  }

  const removeTerm = async (t) => {
    const ok = await confirm({ title: 'Delete Term', message: `Delete term "${t.name}"? This cannot be undone.` })
    if (!ok) return
    try {
      await sessionsApi.deleteTerm(t.id)
      if (t.id === selectedId) { setSelectedId(null); setForm(null); setStatus('idle') }
      refresh()
    } catch (err) {
      showError(err.response?.data?.detail || 'Failed to delete term')
    }
  }

  const set = (patch) => setForm(p => ({ ...p, ...patch }))
  const onRangeChange = (_id, range) => set(range)
  const timelineOverlaps = findOverlaps(terms)

  const statusText = {
    saving: 'Saving...',
    saved: 'All changes saved',
    held: clashes.length ? `Not saved: overlaps ${clashes.map(t => t.name).join(', ')}` : 'Waiting for your confirmation',
    error: 'Not saved: fix the highlighted problem',
    idle: '',
  }[status]

  return (
    <div>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
        {formatDay(year.start_date)} - {formatDay(year.end_date)}
      </p>

      <YearTimeline
        year={year}
        terms={drawn}
        selectedId={selectedId}
        onTermClick={select}
        onRangeChange={onRangeChange}
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {selectedId ? 'Drag the handles on the selected term, or use the date fields below.' : 'Click a term on the bar to adjust it.'}
      </p>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {terms.length} term{terms.length === 1 ? '' : 's'}
          </h4>
          <div className="flex gap-2">
            {onImport && <Button type="button" variant="secondary" size="sm" onClick={onImport}>Import from another year</Button>}
            <Button type="button" size="sm" onClick={addTerm}>+ Add Term</Button>
          </div>
        </div>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Terms cannot overlap. Hatched stretches on the bar are days that no term covers.
        </p>

        {isLoading ? (
          <div className="py-8 text-center"><Spinner size="md" className="mx-auto" /></div>
        ) : terms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-600">
            No terms yet. Add the first one, or import them from another year.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {drawn.map((t, i) => (
              <li key={t.id} className={`flex flex-wrap items-center justify-between gap-2 border-l-4 px-3 py-2 ${t.id === selectedId ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-transparent'}`}>
                <button type="button" onClick={() => select(t)} aria-pressed={t.id === selectedId} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className={`h-8 w-1.5 shrink-0 rounded ${TERM_COLOURS[i % TERM_COLOURS.length]}`} />
                  <span className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t.name}
                    {(timelineOverlaps.has(t.id) || (t.id === selectedId && clashes.length > 0)) && <span className="ml-2 text-xs font-medium text-red-600">Overlaps</span>}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDay(t.start_date)} - {formatDay(t.end_date)} · {t.term_type.toLowerCase()} · order {t.order}
                  </p>
                  </span>
                </button>
                <button type="button" onClick={() => removeTerm(t)} className="text-xs text-red-600 hover:underline dark:text-red-400">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {form && (
        <div className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="term-name">Name *</label>
              <input id="term-name" className="input w-full" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Term 1" />
              {errors.name && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.name)}</p>}
            </div>
            <div>
              <label className="label" htmlFor="term-type">Type</label>
              <select id="term-type" className="input w-full" value={form.term_type} onChange={e => set({ term_type: e.target.value })}>
                <option value="TERM">Term</option>
                <option value="SEMESTER">Semester</option>
                <option value="QUARTER">Quarter</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">A label only; it does not change how dates work.</p>
            </div>
            <div>
              <label className="label" htmlFor="term-order">Order</label>
              <input id="term-order" type="number" min="1" className="input w-full" value={form.order} onChange={e => set({ order: e.target.value })} />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">1 is first in the year.</p>
              {errors.order && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.order)}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="term-start">Start date *</label>
              <input id="term-start" type="date" className="input w-full" value={form.start_date} min={year.start_date} max={year.end_date} onChange={e => set({ start_date: e.target.value })} />
              {errors.start_date && <p className="mt-1 text-xs text-red-600">{firstMessage(errors.start_date)}</p>}
            </div>
            <div>
              <label className="label" htmlFor="term-end">End date *</label>
              <input id="term-end" type="date" className="input w-full" value={form.end_date} min={year.start_date} max={year.end_date} onChange={e => set({ end_date: e.target.value })} />
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
              <p className="font-medium">These dates overlap another term, so this change is not saved yet.</p>
              <ul className="mt-1 list-disc pl-5">
                {clashes.map(t => <li key={t.id}>{t.name} ({formatDay(t.start_date)} - {formatDay(t.end_date)})</li>)}
              </ul>
              <button type="button" onClick={() => persist(selectedId, form, true)} className="mt-2 rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700">Save anyway</button>
            </div>
          )}
          {serverWarnings && !clashes.length && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {serverWarnings.map(w => <p key={w}>{w}</p>)}
              <button type="button" onClick={() => persist(selectedId, form, true)} className="mt-2 rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700">Save anyway</button>
            </div>
          )}
          {(errors.detail || errors.non_field_errors) && !errors.confirm_warnings && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {firstMessage(errors.detail) || firstMessage(errors.non_field_errors)}
            </p>
          )}

          <p className={`text-xs ${status === 'held' || status === 'error' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`} aria-live="polite">{statusText}</p>
        </div>
      )}
      <ConfirmModalRoot />
    </div>
  )
}
