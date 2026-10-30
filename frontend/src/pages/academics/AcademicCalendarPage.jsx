import { schoolNowDate } from '../../utils/schoolTime'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import Button from '../../components/ui/Button'
import { useConfirmModal } from '../../components/ConfirmModal'
import { ENTRY_DOT } from '../../components/academic/academicTones'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { classesApi, sessionsApi, examinationsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import CalendarHeader from './calendar/CalendarHeader'
import MonthGrid from './calendar/MonthGrid'
import AgendaView from './calendar/AgendaView'
import SidePanel from './calendar/SidePanel'
import DayDetailsModal from './calendar/DayDetailsModal'
import EntryFormModal from './calendar/EntryFormModal'
import HolidaySuggestionsModal from './calendar/HolidaySuggestionsModal'
import { EMPTY_FORM, getMonthMeta, isoDate } from './calendar/calendarUtils'

const VIEW_STORAGE_KEY = 'academicCalendarView'

export default function AcademicCalendarPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear, terms, loading: yearLoading } = useAcademicYear()
  const { activeSchool, isSchoolAdmin } = useAuth()
  const { showSuccess, showError } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const isPhone = useMediaQuery('(max-width: 639px)')

  const today = schoolNowDate()
  const todayKey = isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedClassId, setSelectedClassId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showHolidays, setShowHolidays] = useState(false)
  const [selectedDateKey, setSelectedDateKey] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [isRangeSelecting, setIsRangeSelecting] = useState(false)
  const [rangeAnchorDate, setRangeAnchorDate] = useState('')
  const [rangeHoverDate, setRangeHoverDate] = useState('')
  const dragRangeRef = useRef({ active: false, startDate: '', moved: false })
  // A remembered choice wins; otherwise phones start on the agenda, where entry names are readable.
  const [view, setViewState] = useState(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY)
      if (saved === 'month' || saved === 'agenda') return saved
    } catch {
      // storage blocked (private browsing): fall back to the screen-size default
    }
    return null
  })
  const effectiveView = view || (isPhone ? 'agenda' : 'month')
  const setView = (next) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // not persisted; the choice still applies for this visit
    }
  }

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
    // Class list rarely changes mid-session — avoid refetching on every focus.
    staleTime: 5 * 60_000,
  })

  const classes = classesRes?.data?.results || classesRes?.data || []
  // When a year is active, show session classes in dropdowns; else show master classes
  const displayClasses = classSelectorScope === 'session' ? sessionClasses : classes
  // Build class filter params for API calls
  const classFilterParams = selectedClassId
    ? (classSelectorScope === 'session'
        ? { session_class_id: selectedClassId }
        : { class_id: selectedClassId })
    : {}

  const { data: monthViewRes, isLoading: monthLoading } = useQuery({
    queryKey: ['calendarMonthView', activeAcademicYear?.id, year, month, selectedClassId],
    queryFn: () => sessionsApi.getCalendarMonthView({
      academic_year: activeAcademicYear?.id,
      year,
      month,
      ...classFilterParams,
    }),
    enabled: !!activeAcademicYear?.id,
  })

  const { data: entriesRes, isLoading: entriesLoading } = useQuery({
    queryKey: ['calendarEntries', activeAcademicYear?.id, monthStart, monthEnd, selectedClassId],
    queryFn: () => sessionsApi.getCalendarEntries({
      academic_year: activeAcademicYear?.id,
      date_from: monthStart,
      date_to: monthEnd,
      ...classFilterParams,
      is_active: true,
      page_size: 200,
    }),
    enabled: !!activeAcademicYear?.id,
  })

  // Whether attendance was recorded on each working day; the year-wide streak rides along.
  const { data: coverageRes } = useQuery({
    queryKey: ['calendarCoverage', activeAcademicYear?.id, year, month],
    queryFn: () => sessionsApi.getCalendarCoverage({ academic_year: activeAcademicYear?.id, year, month }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 60_000,
  })
  const coverage = coverageRes?.data || null
  const coverageByDate = useMemo(() => {
    const map = {}
    ;(coverage?.days || []).forEach((d) => { map[d.date] = d })
    return map
  }, [coverage])

  const { data: planningRes } = useQuery({
    queryKey: ['calendarPlanning', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getCalendarPlanning({ academic_year: activeAcademicYear?.id }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 60_000,
  })

  const monthDays = monthViewRes?.data?.days || []
  const monthDaysByDate = useMemo(() => {
    const map = {}
    monthDays.forEach((item) => {
      map[item.date] = item
    })
    return map
  }, [monthDays])

  const selectedDateInfo = selectedDateKey ? monthDaysByDate[selectedDateKey] : null

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

  // Terms keep their position in the year's order so a term has the same colour here as on the timelines.
  const orderedTerms = useMemo(
    () => [...(terms || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [terms],
  )
  const termAt = (dateKey) => {
    const index = orderedTerms.findIndex((t) => t.start_date && t.end_date && t.start_date <= dateKey && dateKey <= t.end_date)
    return index < 0 ? null : { term: orderedTerms[index], index }
  }
  const termsThisMonth = orderedTerms
    .map((term, index) => ({ term, index }))
    .filter(({ term }) => term.start_date && term.end_date && term.end_date >= monthStart && term.start_date <= monthEnd)

  const invalidateCalendar = () => {
    queryClient.invalidateQueries({ queryKey: ['calendarMonthView'] })
    queryClient.invalidateQueries({ queryKey: ['calendarEntries'] })
    queryClient.invalidateQueries({ queryKey: ['calendarPlanning'] })
  }

  const createEntryMut = useMutation({
    mutationFn: (payload) => sessionsApi.createCalendarEntry(payload),
    onSuccess: () => {
      invalidateCalendar()
      showSuccess('Calendar entry saved')
      closeModal()
    },
    onError: (err) => {
      const data = err.response?.data || {}
      setFormErrors(data)
      showError(data.detail || data.non_field_errors?.[0] || 'Failed to save calendar entry')
    },
  })

  const updateEntryMut = useMutation({
    mutationFn: ({ id, payload }) => sessionsApi.updateCalendarEntry(id, payload),
    onSuccess: () => {
      invalidateCalendar()
      showSuccess('Calendar entry updated')
      closeModal()
    },
    onError: (err) => {
      const data = err.response?.data || {}
      setFormErrors(data)
      showError(data.detail || data.non_field_errors?.[0] || 'Failed to update calendar entry')
    },
  })

  const deleteEntryMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteCalendarEntry(id),
    onSuccess: () => {
      invalidateCalendar()
      showSuccess('Calendar entry deleted')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete entry'),
  })

  const removeEntry = async (entry) => {
    const ok = await confirm({ title: 'Delete entry', message: `Delete "${entry.name}"? This cannot be undone.` })
    if (ok) deleteEntryMut.mutate(entry.id)
  }

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

  const goToday = () => {
    setYear(today.getFullYear())
    setMonth(today.getMonth() + 1)
  }

  const jumpTo = (y, m) => {
    setYear(y)
    setMonth(m)
  }

  const openAddModalForDates = (startDate, endDate = startDate) => {
    setEditingEntryId(null)
    setForm({
      ...EMPTY_FORM,
      start_date: startDate,
      end_date: endDate,
    })
    setFormErrors({})
    setShowModal(true)
  }

  // From the planning checklist: open the form already set to the missing kind of entry.
  const openAddEntryPreset = ({ off_day_type: offDayType, name }) => {
    closeDayDetailsModal()
    setEditingEntryId(null)
    setForm({ ...EMPTY_FORM, entry_kind: 'OFF_DAY', off_day_type: offDayType, name: name || '' })
    setFormErrors({})
    setShowModal(true)
  }

  const openAddModal = () => {
    closeDayDetailsModal()
    openAddModalForDates(monthStart, monthStart)
  }

  const openEditModal = (entry) => {
    setEditingEntryId(entry.id)
    setForm({
      name: entry.name || '',
      description: entry.description || '',
      entry_kind: entry.entry_kind || 'EVENT',
      off_day_type: entry.off_day_type || 'OTHER',
      scope: entry.scope || 'SCHOOL',
      start_date: entry.start_date || '',
      end_date: entry.end_date || '',
      color: entry.color || EMPTY_FORM.color,
      class_ids: (entry.class_ids || []).map((id) => String(id)),
      affects_students: entry.affects_students !== false,
      affects_staff: entry.affects_staff !== false,
    })
    setFormErrors({})
    closeDayDetailsModal()
    setShowModal(true)
  }

  const openDayDetailsModal = (dateKey) => {
    setSelectedDateKey(dateKey)
  }

  const closeDayDetailsModal = () => {
    setSelectedDateKey('')
  }

  const closeModal = () => {
    setShowModal(false)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setEditingEntryId(null)
  }

  const toggleRangeSelecting = () => {
    setIsRangeSelecting((cur) => !cur)
    setRangeAnchorDate('')
    setRangeHoverDate('')
    dragRangeRef.current = { active: false, startDate: '', moved: false }
  }

  const handleCalendarDateSelect = (dateKey) => {
    if (!isRangeSelecting) {
      const dayInfo = monthDaysByDate[dateKey]
      const hasEntries = (dayInfo?.entries || []).length > 0
      if (hasEntries) {
        openDayDetailsModal(dateKey)
      } else if (isSchoolAdmin) {
        closeDayDetailsModal()
        openAddModalForDates(dateKey, dateKey)
      }
      return
    }
    if (!isSchoolAdmin) return
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
    if (form.entry_kind === 'OFF_DAY' && !form.affects_students && !form.affects_staff) {
      showError('An OFF day must apply to at least Students or Staff.')
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
      affects_students: form.entry_kind === 'OFF_DAY' ? form.affects_students : true,
      affects_staff: form.entry_kind === 'OFF_DAY' ? form.affects_staff : true,
      class_ids: form.scope === 'CLASS'
        ? form.class_ids.map((id) => {
            const masterClassId = getResolvedMasterClassId(id, activeAcademicYear?.id, sessionClasses)
            return Number(masterClassId || id)
          })
        : [],
      is_active: true,
    }

    if (editingEntryId) {
      updateEntryMut.mutate({ id: editingEntryId, payload })
      return
    }

    createEntryMut.mutate(payload)
  }

  const previewStart = isRangeSelecting && rangeAnchorDate
    ? (rangeHoverDate && rangeHoverDate < rangeAnchorDate ? rangeHoverDate : rangeAnchorDate)
    : ''
  const previewEnd = isRangeSelecting && rangeAnchorDate
    ? (rangeHoverDate && rangeHoverDate > rangeAnchorDate ? rangeHoverDate : rangeAnchorDate)
    : ''

  if (yearLoading) return <LoadingState label="Loading calendar..." />

  if (!activeAcademicYear?.id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Academic Calendar" subtitle="Terms, off-days, exam periods and school events in one calendar." />
        <div className="card dark:bg-gray-800 dark:border-gray-700">
          <EmptyState
            title="No academic year selected"
            description="The calendar is built on an academic year and its terms. Create one first, then come back here to add events and off days."
            action={<Link to="/academics/sessions"><Button>Set up an academic year</Button></Link>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Academic Calendar" subtitle="Terms, off-days, exam periods and school events in one calendar." actions={<>
{isSchoolAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={openAddModal}>+ Add Event / Off Day</Button>
          <Button variant="secondary" onClick={() => setShowHolidays(true)}>Suggested holidays</Button>
          <Button
            variant="secondary"
            className={isRangeSelecting ? '!bg-primary-50 !border-primary-300 !text-primary-700' : ''}
            onClick={toggleRangeSelecting}
          >
            {!isRangeSelecting ? 'Select Date Range' : (!rangeAnchorDate ? 'Pick Start Date' : 'Pick End Date')}
          </Button>
        </div>
        )}
</>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="card space-y-4 p-3 sm:p-5 dark:bg-gray-800 dark:border-gray-700">
          <CalendarHeader
            academicYear={activeAcademicYear}
            year={year}
            month={month}
            onPrev={prevMonth}
            onNext={nextMonth}
            onToday={goToday}
            onJump={jumpTo}
            view={effectiveView}
            onViewChange={setView}
            classes={displayClasses}
            selectedClassId={selectedClassId}
            onClassChange={setSelectedClassId}
            termsThisMonth={termsThisMonth}
            coverage={coverage}
            planning={planningRes?.data || null}
            isSchoolAdmin={isSchoolAdmin}
            onAddEntry={openAddEntryPreset}
          />

          {effectiveView === 'month' && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
              <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${ENTRY_DOT.off}`} /> OFF day (all)</span>
              <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${ENTRY_DOT.offStudents}`} /> OFF (students only)</span>
              <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${ENTRY_DOT.event}`} /> Event</span>
              <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${ENTRY_DOT.exam}`} /> Exam period</span>
              <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded ${ENTRY_DOT.sunday}`} /> Sunday auto OFF</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Attendance not recorded</span>
            </div>
          )}

          {effectiveView === 'month' && (
            <p className="text-xs text-gray-600 dark:text-gray-300">
              {isRangeSelecting && rangeAnchorDate
                ? `Range start selected: ${rangeAnchorDate}. Tap/click another date to set end.`
                : isRangeSelecting
                  ? 'Range mode active. Tap/click a start date.'
                  : 'Tip: tap/click any date to add a single-day event, use "Select Date Range" for duration events, or drag across dates on desktop.'}
            </p>
          )}

          {monthLoading ? (
            <LoadingState label="Loading calendar..." />
          ) : effectiveView === 'month' ? (
            <MonthGrid
              year={year}
              month={month}
              daysInMonth={daysInMonth}
              startOffset={startOffset}
              monthDaysByDate={monthDaysByDate}
              examGroupsByDate={examGroupsByDate}
              termAt={termAt}
              todayKey={todayKey}
              coverageByDate={coverageByDate}
              isRangeSelecting={isRangeSelecting}
              rangeAnchorDate={rangeAnchorDate}
              previewStart={previewStart}
              previewEnd={previewEnd}
              onPointerDown={handleDayPointerDown}
              onPointerEnter={handleDayPointerEnter}
              onPointerUp={handleDayPointerUp}
              onActivate={handleCalendarDateSelect}
            />
          ) : (
            <AgendaView
              monthDays={monthDays}
              examGroupsByDate={examGroupsByDate}
              todayKey={todayKey}
              onSelectDate={openDayDetailsModal}
            />
          )}
        </div>

        <SidePanel
          terms={termsThisMonth}
          entries={visibleEntries}
          entriesLoading={entriesLoading}
          examGroups={currentExamGroups}
          isSchoolAdmin={isSchoolAdmin}
          onEdit={openEditModal}
          onDelete={removeEntry}
        />
      </div>

      {selectedDateKey && selectedDateInfo && (
        <DayDetailsModal
          dateKey={selectedDateKey}
          info={selectedDateInfo}
          examNames={examGroupsByDate[selectedDateKey] || []}
          coverage={coverageByDate[selectedDateKey]}
          isSchoolAdmin={isSchoolAdmin}
          onClose={closeDayDetailsModal}
          onAdd={() => {
            closeDayDetailsModal()
            openAddModalForDates(selectedDateKey, selectedDateKey)
          }}
          onEdit={openEditModal}
          onDelete={removeEntry}
        />
      )}

      {isSchoolAdmin && showModal && (
        <EntryFormModal
          editing={!!editingEntryId}
          form={form}
          setForm={setForm}
          formErrors={formErrors}
          displayClasses={displayClasses}
          onToggleClass={toggleClassId}
          onSubmit={submitEntry}
          onClose={closeModal}
          saving={createEntryMut.isPending || updateEntryMut.isPending}
        />
      )}
      {isSchoolAdmin && showHolidays && (
        <HolidaySuggestionsModal
          academicYear={activeAcademicYear}
          onClose={() => setShowHolidays(false)}
          onAdded={invalidateCalendar}
        />
      )}
      <ConfirmModalRoot />
    </div>
  )
}
