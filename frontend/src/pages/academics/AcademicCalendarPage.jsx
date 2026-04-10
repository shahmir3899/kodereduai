import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { classesApi, sessionsApi, examinationsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const OFF_DAY_TYPES = [
  { value: 'SUMMER_VACATION', label: 'Summer Vacation' },
  { value: 'WINTER_VACATION', label: 'Winter Vacation' },
  { value: 'RELIGIOUS_HOLIDAY', label: 'Religious Holiday' },
  { value: 'NATIONAL_HOLIDAY', label: 'National Holiday' },
  { value: 'EXAM_BREAK', label: 'Exam Break' },
  { value: 'OTHER', label: 'Other' },
]

const EMPTY_FORM = {
  name: '',
  description: '',
  entry_kind: 'EVENT',
  off_day_type: 'OTHER',
  scope: 'SCHOOL',
  start_date: '',
  end_date: '',
  color: '#f97316',
  class_ids: [],
}

function isoDate(year, month, day) {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function getMonthMeta(year, month) {
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7
  return { daysInMonth, startOffset }
}

export default function AcademicCalendarPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear, terms } = useAcademicYear()
  const { showSuccess, showError } = useToast()

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedClassId, setSelectedClassId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [isRangeSelecting, setIsRangeSelecting] = useState(false)
  const [rangeAnchorDate, setRangeAnchorDate] = useState('')
  const [rangeHoverDate, setRangeHoverDate] = useState('')
  const dragRangeRef = useRef({ active: false, startDate: '', moved: false })

  const { daysInMonth, startOffset } = useMemo(
    () => getMonthMeta(year, month),
    [year, month],
  )

  const monthStart = isoDate(year, month, 1)
  const monthEnd = isoDate(year, month, daysInMonth)

  const { data: classesRes } = useQuery({
    queryKey: ['calendarClasses', activeAcademicYear?.id],
    queryFn: () => classesApi.getClasses({ is_active: true, page_size: 999 }),
    enabled: !!activeAcademicYear?.id,
  })

  const classes = classesRes?.data?.results || classesRes?.data || []

  const { data: monthViewRes, isLoading: monthLoading } = useQuery({
    queryKey: ['calendarMonthView', activeAcademicYear?.id, year, month, selectedClassId],
    queryFn: () => sessionsApi.getCalendarMonthView({
      academic_year: activeAcademicYear?.id,
      year,
      month,
      class_id: selectedClassId || undefined,
    }),
    enabled: !!activeAcademicYear?.id,
  })

  const { data: entriesRes, isLoading: entriesLoading } = useQuery({
    queryKey: ['calendarEntries', activeAcademicYear?.id, monthStart, monthEnd, selectedClassId],
    queryFn: () => sessionsApi.getCalendarEntries({
      academic_year: activeAcademicYear?.id,
      date_from: monthStart,
      date_to: monthEnd,
      class_id: selectedClassId || undefined,
      is_active: true,
      page_size: 200,
    }),
    enabled: !!activeAcademicYear?.id,
  })

  const monthDays = monthViewRes?.data?.days || []
  const monthDaysByDate = useMemo(() => {
    const map = {}
    monthDays.forEach((item) => {
      map[item.date] = item
    })
    return map
  }, [monthDays])

  const completeness = useMemo(() => {
    const totalDays = monthDays.length || daysInMonth
    const customConfiguredDays = monthDays.filter((d) => (d.entries || []).length > 0).length
    const offDays = monthDays.filter((d) => d.is_off_day).length
    const score = totalDays > 0 ? Math.round((customConfiguredDays / totalDays) * 100) : 0
    return {
      totalDays,
      customConfiguredDays,
      offDays,
      score,
    }
  }, [monthDays, daysInMonth])

  const visibleEntries = entriesRes?.data?.results || entriesRes?.data || []

  const { data: examGroupsRes } = useQuery({
    queryKey: ['calendarExamGroups', activeAcademicYear?.id],
    queryFn: () => examinationsApi.getExamGroups({ academic_year: activeAcademicYear?.id, page_size: 100, is_active: true }),
    enabled: !!activeAcademicYear?.id,
  })

  const examGroups = examGroupsRes?.data?.results || examGroupsRes?.data || []

  // Map each date in an exam group's range → array of group names
  const examGroupsByDate = useMemo(() => {
    const map = {}
    examGroups.forEach((g) => {
      if (!g.start_date || !g.end_date) return
      const start = new Date(g.start_date)
      const end = new Date(g.end_date)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10)
        if (!map[key]) map[key] = []
        if (!map[key].includes(g.name)) map[key].push(g.name)
      }
    })
    return map
  }, [examGroups])

  const currentExamGroups = examGroups.filter((g) => {
    if (!g.start_date || !g.end_date) return false
    return g.end_date >= monthStart && g.start_date <= monthEnd
  })

  const createEntryMut = useMutation({
    mutationFn: (payload) => sessionsApi.createCalendarEntry(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarMonthView'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEntries'] })
      showSuccess('Calendar entry saved')
      closeModal()
    },
    onError: (err) => {
      const data = err.response?.data || {}
      setFormErrors(data)
      showError(data.detail || data.non_field_errors?.[0] || 'Failed to save calendar entry')
    },
  })

  const deleteEntryMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteCalendarEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendarMonthView'] })
      queryClient.invalidateQueries({ queryKey: ['calendarEntries'] })
      showSuccess('Calendar entry deleted')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete entry'),
  })

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12)
      setYear((cur) => cur - 1)
      return
    }
    setMonth((cur) => cur - 1)
  }

  const nextMonth = () => {
    if (month === 12) {
      setMonth(1)
      setYear((cur) => cur + 1)
      return
    }
    setMonth((cur) => cur + 1)
  }

  const openAddModalForDates = (startDate, endDate = startDate) => {
    setForm({
      ...EMPTY_FORM,
      start_date: startDate,
      end_date: endDate,
    })
    setFormErrors({})
    setShowModal(true)
  }

  const openAddModal = () => {
    openAddModalForDates(monthStart, monthStart)
  }

  const closeModal = () => {
    setShowModal(false)
    setForm(EMPTY_FORM)
    setFormErrors({})
  }

  const toggleRangeSelecting = () => {
    setIsRangeSelecting((cur) => !cur)
    setRangeAnchorDate('')
    setRangeHoverDate('')
    dragRangeRef.current = { active: false, startDate: '', moved: false }
  }

  const handleCalendarDateSelect = (dateKey) => {
    if (!isRangeSelecting) {
      openAddModalForDates(dateKey, dateKey)
      return
    }
    if (!rangeAnchorDate) {
      setRangeAnchorDate(dateKey)
      setRangeHoverDate(dateKey)
      return
    }
    const [start, end] = [rangeAnchorDate, dateKey].sort()
    openAddModalForDates(start, end)
    setIsRangeSelecting(false)
    setRangeAnchorDate('')
    setRangeHoverDate('')
    dragRangeRef.current = { active: false, startDate: '', moved: false }
  }

  const handleDayPointerDown = (e, dateKey) => {
    if (!isRangeSelecting || e.pointerType !== 'mouse') return
    dragRangeRef.current = { active: true, startDate: dateKey, moved: false }
  }

  const handleDayPointerEnter = (e, dateKey) => {
    if (!dragRangeRef.current.active || e.pointerType !== 'mouse') return
    if (dateKey !== dragRangeRef.current.startDate) {
      dragRangeRef.current.moved = true
      setRangeAnchorDate(dragRangeRef.current.startDate)
      setRangeHoverDate(dateKey)
    }
  }

  const resetDragState = () => {
    dragRangeRef.current = { active: false, startDate: '', moved: false }
  }

  const finalizeRangeSelection = (fromDate, toDate) => {
    const [start, end] = [fromDate, toDate].sort()
    openAddModalForDates(start, end)
    setIsRangeSelecting(false)
    setRangeAnchorDate('')
    setRangeHoverDate('')
    resetDragState()
  }

  const handleDayPointerUp = (e, dateKey) => {
    if (e.pointerType === 'mouse' && dragRangeRef.current.active) {
      const { startDate, moved } = dragRangeRef.current
      if (moved) {
        finalizeRangeSelection(startDate || dateKey, dateKey)
      } else {
        // Mouse click in range mode should use the same two-click flow as touch.
        handleCalendarDateSelect(dateKey)
        resetDragState()
      }
      return
    }
    handleCalendarDateSelect(dateKey)
  }

  const toggleClassId = (id) => {
    const sid = String(id)
    setForm((cur) => {
      const exists = cur.class_ids.includes(sid)
      return {
        ...cur,
        class_ids: exists ? cur.class_ids.filter((item) => item !== sid) : [...cur.class_ids, sid],
      }
    })
  }

  const submitEntry = (e) => {
    e.preventDefault()
    if (!activeAcademicYear?.id) {
      showError('Select an academic year first')
      return
    }

    const payload = {
      academic_year: activeAcademicYear.id,
      name: form.name,
      description: form.description,
      entry_kind: form.entry_kind,
      off_day_type: form.entry_kind === 'OFF_DAY' ? form.off_day_type : '',
      scope: form.scope,
      start_date: form.start_date,
      end_date: form.end_date,
      color: form.color,
      class_ids: form.scope === 'CLASS' ? form.class_ids.map((id) => Number(id)) : [],
      is_active: true,
    }

    createEntryMut.mutate(payload)
  }

  const dayCells = []
  const previewStart = isRangeSelecting && rangeAnchorDate
    ? (rangeHoverDate && rangeHoverDate < rangeAnchorDate ? rangeHoverDate : rangeAnchorDate)
    : ''
  const previewEnd = isRangeSelecting && rangeAnchorDate
    ? (rangeHoverDate && rangeHoverDate > rangeAnchorDate ? rangeHoverDate : rangeAnchorDate)
    : ''
  for (let i = 0; i < startOffset; i += 1) {
    dayCells.push(<div key={`blank-${i}`} className="rounded-xl border border-gray-100 bg-gray-50 min-h-[120px]" />)
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = isoDate(year, month, day)
    const dayInfo = monthDaysByDate[dateKey]
    const isOff = !!dayInfo?.is_off_day
    const events = dayInfo?.events || []
    const eventsCount = events.length
    const offDayEntries = (dayInfo?.entries || []).filter((entry) => entry.entry_kind === 'OFF_DAY')
    const offDayTitles = [...new Set(offDayEntries.map((entry) => entry.name).filter(Boolean))]
    const hasSundayOnlyOff = isOff && offDayTitles.length === 0 && (dayInfo?.is_sunday || false)
    const examNames = examGroupsByDate[dateKey] || []
    const isAnchor = isRangeSelecting && rangeAnchorDate === dateKey
    const isWithinPendingRange = !!previewStart && dateKey >= previewStart && dateKey <= previewEnd

    dayCells.push(
      <div
        key={dateKey}
        className={`rounded-xl border min-h-[120px] p-2 sm:p-3 cursor-pointer hover:border-orange-300 transition select-none ${isOff ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'} ${isWithinPendingRange ? 'ring-2 ring-orange-200' : ''} ${isAnchor ? 'ring-2 ring-orange-400' : ''}`}
        onPointerDown={(e) => handleDayPointerDown(e, dateKey)}
        onPointerEnter={(e) => handleDayPointerEnter(e, dateKey)}
        onPointerUp={(e) => handleDayPointerUp(e, dateKey)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCalendarDateSelect(dateKey)
          }
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">{day}</p>
          {isOff && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">OFF</span>}
        </div>
        {(offDayTitles.length > 0 || hasSundayOnlyOff) && (
          <div className="mt-2">
            <p className="text-[11px] text-rose-700 line-clamp-1">{offDayTitles[0] || 'Sunday'}</p>
            {offDayTitles.length > 1 && (
              <p className="mt-0.5 text-[10px] text-rose-700">+{offDayTitles.length - 1} more</p>
            )}
          </div>
        )}
        {eventsCount > 0 && (
          <div className="mt-2">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 block truncate" title={events[0]?.name || ''}>
              {events[0]?.name || 'Event'}
            </span>
            {eventsCount > 1 && (
              <p className="mt-1 text-[10px] text-blue-700">+{eventsCount - 1} more</p>
            )}
          </div>
        )}
        {examNames.map((name) => (
          <span key={name} className="mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 block truncate" title={name}>
            {name}
          </span>
        ))}
      </div>,
    )
  }

  const currentTerms = (terms || []).filter((term) => {
    if (!term.start_date || !term.end_date) return false
    return term.end_date >= monthStart && term.start_date <= monthEnd
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Academic Calendar</h1>
          <p className="text-sm text-gray-600">Large calendar view for sessions, terms, off-days and school events.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary px-4 py-2 text-sm" onClick={openAddModal}>+ Add Event / Off Day</button>
          <button
            className={`px-4 py-2 text-sm rounded-lg border ${isRangeSelecting ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            onClick={toggleRangeSelecting}
          >
            {!isRangeSelecting ? 'Select Date Range' : (!rangeAnchorDate ? 'Pick Start Date' : 'Pick End Date')}
          </button>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Academic Year</label>
            <div className="mt-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700">
              {activeAcademicYear?.name || 'No active academic year'}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Class Filter</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Whole School</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>{cls.section ? `${cls.name} - ${cls.section}` : cls.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value || today.getFullYear()))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>{name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="btn-secondary px-3 py-1.5 text-sm">Previous</button>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{MONTH_NAMES[month - 1]} {year}</h2>
          <button onClick={nextMonth} className="btn-secondary px-3 py-1.5 text-sm">Next</button>
        </div>

        <div className="mb-4 inline-flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold">Calendar Completeness</p>
            <p className="text-lg font-bold text-emerald-800 leading-tight">{completeness.score}%</p>
          </div>
          <div className="h-10 w-px bg-emerald-200" />
          <div className="text-xs text-emerald-800">
            <p>Configured: <span className="font-semibold">{completeness.customConfiguredDays}/{completeness.totalDays}</span> days</p>
            <p>OFF days: <span className="font-semibold">{completeness.offDays}</span></p>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-300" /> OFF day</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-300" /> Event</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-indigo-300" /> Exam period</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-200" /> Sunday auto OFF</span>
        </div>

        <div className="mb-3 text-xs text-gray-600">
          {isRangeSelecting && rangeAnchorDate
            ? `Range start selected: ${rangeAnchorDate}. Tap/click another date to set end.`
            : isRangeSelecting
              ? 'Range mode active. Tap/click a start date.'
              : 'Tip: Tap/click any date to add a single-day event, use "Select Date Range" for duration events, or drag across dates on desktop.'}
        </div>

        {monthLoading ? (
          <div className="py-16 text-center text-gray-500">Loading calendar...</div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {DAY_LABELS.map((dayLabel) => (
                <div key={dayLabel} className="text-center text-xs font-semibold text-gray-500 py-2">{dayLabel}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">{dayCells}</div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Terms Touching This Month</h3>
          {currentTerms.length === 0 ? (
            <p className="text-sm text-gray-500">No term dates overlap this month.</p>
          ) : (
            <div className="space-y-2">
              {currentTerms.map((term) => (
                <div key={term.id} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <p className="text-sm font-medium text-indigo-900">{term.name}</p>
                  <p className="text-xs text-indigo-700">{term.start_date} to {term.end_date}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Entries In This Month</h3>
          {entriesLoading ? (
            <p className="text-sm text-gray-500">Loading entries...</p>
          ) : visibleEntries.length === 0 ? (
            <p className="text-sm text-gray-500">No custom events or off days in selected month.</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-auto">
              {visibleEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{entry.name}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{entry.start_date} to {entry.end_date}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{entry.scope === 'CLASS' ? 'Class Specific' : 'Whole School'}</p>
                    </div>
                    <button
                      onClick={() => deleteEntryMut.mutate(entry.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Exam Groups This Month</h3>
        {currentExamGroups.length === 0 ? (
          <p className="text-sm text-gray-500">No exam groups scheduled this month.</p>
        ) : (
          <div className="space-y-2">
            {currentExamGroups.map((g) => (
              <div key={g.id} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-sm font-medium text-indigo-900">{g.name}</p>
                <p className="text-xs text-indigo-700">{g.start_date} to {g.end_date}</p>
                {g.exam_type && <p className="text-xs text-indigo-600 mt-0.5">{g.exam_type_name || g.exam_type?.name || ''}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Event / Off Day</h3>
            <form className="space-y-4" onSubmit={submitEntry}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600">Title</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((cur) => ({ ...cur, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Independence Day / Eid Holiday / Orange Color Day"
                  />
                  {formErrors.name && <p className="text-xs text-red-600 mt-1">{String(formErrors.name)}</p>}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600">Type</label>
                  <select
                    value={form.entry_kind}
                    onChange={(e) => setForm((cur) => ({ ...cur, entry_kind: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    <option value="EVENT">Event</option>
                    <option value="OFF_DAY">OFF Day</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600">Scope</label>
                  <select
                    value={form.scope}
                    onChange={(e) => setForm((cur) => ({ ...cur, scope: e.target.value, class_ids: [] }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  >
                    <option value="SCHOOL">Whole School</option>
                    <option value="CLASS">Specific Classes</option>
                  </select>
                  {formErrors.class_ids && <p className="text-xs text-red-600 mt-1">{String(formErrors.class_ids)}</p>}
                </div>

                {form.entry_kind === 'OFF_DAY' && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">OFF Day Category</label>
                    <select
                      value={form.off_day_type}
                      onChange={(e) => setForm((cur) => ({ ...cur, off_day_type: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      {OFF_DAY_TYPES.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-gray-600">Start Date</label>
                  <input
                    required
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((cur) => ({ ...cur, start_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600">End Date</label>
                  <input
                    required
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((cur) => ({ ...cur, end_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  {formErrors.end_date && <p className="text-xs text-red-600 mt-1">{String(formErrors.end_date)}</p>}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600">Color Tag</label>
                  <input
                    type="color"
                    value={form.color || '#f97316'}
                    onChange={(e) => setForm((cur) => ({ ...cur, color: e.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-2"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((cur) => ({ ...cur, description: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Optional details for teachers and attendance teams"
                />
              </div>

              {form.scope === 'CLASS' && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Select Classes</label>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 border border-gray-200 rounded-lg p-3 max-h-44 overflow-auto">
                    {classes.length === 0 && <p className="text-xs text-gray-500">No classes available</p>}
                    {classes.map((cls) => {
                      const id = String(cls.id)
                      const checked = form.class_ids.includes(id)
                      return (
                        <label key={cls.id} className="inline-flex items-center gap-2 text-xs text-gray-700">
                          <input type="checkbox" checked={checked} onChange={() => toggleClassId(id)} />
                          <span>{cls.section ? `${cls.name} - ${cls.section}` : cls.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
                <button type="submit" className="btn-primary px-4 py-2 text-sm" disabled={createEntryMut.isPending}>
                  {createEntryMut.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
