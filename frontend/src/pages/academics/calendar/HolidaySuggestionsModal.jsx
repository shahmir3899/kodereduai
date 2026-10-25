import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import LoadingState from '../../../components/ui/LoadingState'
import { DEFAULT_OFF_COLOR } from '../../../components/academic/academicTones'
import { sessionsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { formatDay } from '../../sessions/termDefaults'
import { MONTH_NAMES } from './calendarUtils'

const keyOf = (s) => `${s.start_date}|${s.name}`
const monthLabel = (iso) => `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const range = (s) => (s.start_date === s.end_date ? formatDay(s.start_date) : `${formatDay(s.start_date)} - ${formatDay(s.end_date)}`)

function Row({ item, checked, onToggle }) {
  const disabled = item.already_entered
  return (
    <label className={`flex items-start gap-3 rounded-lg px-2 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
      <input type="checkbox" className="mt-1 rounded" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{range(item)}</span>
      </span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {item.tentative && <Badge tone="warning">Tentative</Badge>}
        {item.falls_on_sunday && <Badge tone="neutral">Sunday</Badge>}
        {item.already_entered && <Badge tone="success">Already on your calendar</Badge>}
      </span>
    </label>
  )
}

function Group({ items, selected, toggle }) {
  const byMonth = useMemo(() => {
    const map = new Map()
    items.forEach((s) => {
      const label = monthLabel(s.start_date)
      if (!map.has(label)) map.set(label, [])
      map.get(label).push(s)
    })
    return [...map.entries()]
  }, [items])

  return byMonth.map(([label, rows]) => (
    <div key={label} className="mb-3">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      {rows.map((s) => <Row key={keyOf(s)} item={s} checked={selected.has(keyOf(s))} onToggle={() => toggle(keyOf(s))} />)}
    </div>
  ))
}

/**
 * Suggested holidays for the academic year, from Google's public Holidays in Pakistan calendar. Nothing is
 * added until the admin ticks holidays and confirms; each one becomes an ordinary whole-school OFF entry.
 */
export default function HolidaySuggestionsModal({ academicYear, onClose, onAdded }) {
  const { showSuccess, showError } = useToast()
  const [selected, setSelected] = useState(null) // null until the list loads, then the pre-ticked keys
  const [saving, setSaving] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['holidaySuggestions', academicYear.id],
    queryFn: () => sessionsApi.getHolidaySuggestions({ academic_year: academicYear.id }),
    staleTime: 10 * 60_000,
  })
  const result = data?.data
  const suggestions = result?.suggestions || []
  const publicOnes = suggestions.filter((s) => s.kind === 'public')
  const observances = suggestions.filter((s) => s.kind !== 'public')

  // Public holidays that are not already entered and do not fall on a Sunday start ticked.
  const chosen = selected || new Set(
    publicOnes.filter((s) => !s.already_entered && !s.falls_on_sunday).map(keyOf),
  )
  const toggle = (key) => {
    const next = new Set(chosen)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const add = async () => {
    const picked = suggestions.filter((s) => chosen.has(keyOf(s)) && !s.already_entered)
    if (picked.length === 0) return
    setSaving(true)
    const outcomes = await Promise.allSettled(picked.map((s) => sessionsApi.createCalendarEntry({
      academic_year: academicYear.id,
      name: s.name,
      description: 'Suggested from Google Calendar (Holidays in Pakistan)',
      entry_kind: 'OFF_DAY',
      off_day_type: s.suggested_type,
      scope: 'SCHOOL',
      start_date: s.start_date,
      end_date: s.end_date,
      color: DEFAULT_OFF_COLOR,
      affects_students: true,
      affects_staff: true,
      class_ids: [],
      is_active: true,
    })))
    setSaving(false)
    const failed = outcomes.filter((o) => o.status === 'rejected').length
    const added = picked.length - failed
    if (added > 0) {
      showSuccess(`${added} holiday${added === 1 ? '' : 's'} added to the calendar`)
      onAdded()
    }
    if (failed > 0) showError(`${failed} holiday${failed === 1 ? '' : 's'} could not be added`)
    if (failed === 0) onClose()
  }

  const coveredUntilShort = result?.covered_until && result.covered_until < academicYear.end_date
  const count = [...chosen].filter((k) => suggestions.some((s) => keyOf(s) === k && !s.already_entered)).length

  return (
    <Modal open onClose={onClose} size="2xl" title="Suggested holidays" closeOnBackdrop={!saving}>
      {isLoading ? (
        <LoadingState label="Loading suggestions..." />
      ) : !result?.available ? (
        <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
          {result?.reason === 'disabled'
            ? 'Holiday suggestions are switched off for this server.'
            : 'Holiday suggestions cannot be loaded right now. You can still add holidays by hand with "Add Event / Off Day".'}
        </p>
      ) : (
        <>
          <div className="mb-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
            <p>
              From {result.source}. Dates that depend on moon sighting (Eid, Ashura, Eid Milad un-Nabi) are expected
              dates: confirm them before relying on them. Ticked holidays are added as whole-school OFF days for
              students and staff; you can edit or delete them afterwards.
            </p>
            {coveredUntilShort && (
              <p className="rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Google's list only runs to {formatDay(result.covered_until)}. Holidays after that date have to be added by hand.
              </p>
            )}
          </div>

          <div className="max-h-[50vh] overflow-y-auto pr-1">
            {publicOnes.length === 0
              ? <p className="py-4 text-sm text-gray-500 dark:text-gray-400">No public holidays found in this academic year.</p>
              : <Group items={publicOnes} selected={chosen} toggle={toggle} />}

            {observances.length > 0 && (
              <details className="mt-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
                  Other observances ({observances.length})
                </summary>
                <p className="px-2 pt-2 text-xs text-gray-500 dark:text-gray-400">
                  Religious and cultural days that are not public holidays. Add only the ones your school observes.
                </p>
                <div className="mt-2">
                  <Group items={observances} selected={chosen} toggle={toggle} />
                </div>
              </details>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={add} loading={saving} disabled={count === 0}>
              {count === 0 ? 'Nothing selected' : `Add ${count} holiday${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
