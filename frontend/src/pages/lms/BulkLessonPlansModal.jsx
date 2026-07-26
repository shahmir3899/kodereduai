import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  format,
  eachDayOfInterval,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns'
import { lmsApi, academicsApi, hrApi, sessionsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import {
  getClassSelectorScope,
  getResolvedMasterClassId,
  resolveSessionClassId,
} from '../../utils/classScope'
import LessonPlanAIModal from './LessonPlanAIModal'
import LessonPlanTopicsPickerModal from './LessonPlanTopicsPickerModal'
import { normalizeLessonPlanText, deriveAutoTitleFromCurriculumSummary } from './lessonPlanTextUtils'

const STEPS = [
  { num: 1, label: 'Class & range' },
  { num: 2, label: 'Per-day plans' },
  { num: 3, label: 'Review & create' },
]

function computeTeachingDates(dateFromStr, dateToStr, daysMap) {
  if (!dateFromStr || !dateToStr || dateFromStr > dateToStr) return []
  const start = parseISO(dateFromStr)
  const end = parseISO(dateToStr)
  const days = eachDayOfInterval({ start, end })
  const out = []
  for (const d of days) {
    const iso = format(d, 'yyyy-MM-dd')
    const info = daysMap?.[iso]
    if (info?.is_off_day) continue
    if (d.getDay() === 0) continue
    out.push(iso)
  }
  return out
}

/** Prefer session-scoped row, then any active row with a teacher. */
function pickTeacherId(classSubjects, subjectId, sessionClassId) {
  if (!subjectId || !Array.isArray(classSubjects) || !classSubjects.length) return ''
  const sid = String(subjectId)
  const rows = classSubjects.filter(
    (cs) => String(cs.subject) === sid && cs.is_active !== false,
  )
  if (!rows.length) return ''
  if (sessionClassId) {
    const exact = rows.find((cs) => String(cs.session_class || '') === String(sessionClassId))
    if (exact?.teacher != null && exact.teacher !== '') return String(exact.teacher)
  }
  const withTeacher = rows.find((cs) => cs.teacher != null && cs.teacher !== '')
  return withTeacher?.teacher != null ? String(withTeacher.teacher) : ''
}

function emptyRow() {
  return {
    chapterIds: [],
    topicIds: [],
    subtopicIds: [],
    title: '',
    description: '',
    objectives: '',
    teaching_methods: '',
    materials_needed: '',
    ai_generated: false,
    curriculumSummary: '',
    custom_topics: [],
  }
}

export default function BulkLessonPlansModal({ onClose, onSuccess, onCreateSingle }) {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()

  const [step, setStep] = useState(1)
  const [planMode, setPlanMode] = useState('MINIMAL')
  const isMinimal = planMode === 'MINIMAL'
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [duration, setDuration] = useState(45)

  const [teachingDates, setTeachingDates] = useState([])
  const [rowByDate, setRowByDate] = useState({})
  const [topicsPickerDate, setTopicsPickerDate] = useState(null)
  const [bulkCurriculumPickerOpen, setBulkCurriculumPickerOpen] = useState(false)
  const [datesSelectedForBulkCurriculum, setDatesSelectedForBulkCurriculum] = useState([])
  const [aiModalDate, setAiModalDate] = useState(null)
  const [creating, setCreating] = useState(false)
  const [customTopicInputByDate, setCustomTopicInputByDate] = useState({})

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const selectedSessionClassId = resolveSessionClassId(selectedClass, activeAcademicYear?.id, sessionClasses)

  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: true,
    queryKey: 'teacherLessonPlanClasses',
    fetchClasses: () => lmsApi.getMyLessonPlanClasses(),
  })

  const { data: classSubjectsData } = useQuery({
    queryKey: ['classSubjects', resolvedClass, selectedSessionClassId, activeAcademicYear?.id],
    queryFn: () =>
      academicsApi.getClassSubjects({
        class_obj: resolvedClass,
        page_size: 9999,
        ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
        ...(selectedSessionClassId && { session_class: selectedSessionClassId }),
      }),
    enabled: !!resolvedClass,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaffTeachersBulk'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', role: 'TEACHER', page_size: 9999 }),
  })

  const { data: dayStatusData, isFetching: calendarLoading } = useQuery({
    queryKey: ['calendarDayStatus', dateFrom, dateTo, activeAcademicYear?.id],
    queryFn: () =>
      sessionsApi.getCalendarDayStatus({
        date_from: dateFrom,
        date_to: dateTo,
        academic_year: activeAcademicYear?.id,
      }),
    enabled: !!(dateFrom && dateTo && dateFrom <= dateTo && activeSchool?.id),
  })

  const { data: existingPlansData } = useQuery({
    queryKey: ['lessonPlansBulkExisting', resolvedClass, selectedSubject, activeAcademicYear?.id],
    queryFn: () =>
      lmsApi.getLessonPlans({
        class_id: resolvedClass,
        subject_id: selectedSubject,
        academic_year: activeAcademicYear?.id,
        page_size: 9999,
      }),
    enabled: !!resolvedClass && !!selectedSubject && step >= 2,
  })

  const classSubjects = classSubjectsData?.data?.results || classSubjectsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []
  const daysMap = dayStatusData?.data?.days || {}

  const existingDateSet = useMemo(() => {
    const raw = existingPlansData?.data?.results || existingPlansData?.data || []
    const list = Array.isArray(raw) ? raw : []
    const s = new Set()
    list.forEach((p) => {
      if (p.lesson_date && p.is_active !== false) s.add(p.lesson_date)
    })
    return s
  }, [existingPlansData])

  useEffect(() => {
    if (!selectedSubject) {
      setSelectedTeacher('')
      return
    }
    const tid = pickTeacherId(classSubjects, selectedSubject, selectedSessionClassId)
    setSelectedTeacher(tid)
  }, [selectedSubject, classSubjects, selectedSessionClassId])

  const validateStep1 = () => {
    if (!resolvedClass) {
      showError('Please select a class')
      return false
    }
    if (!selectedSubject) {
      showError('Please select a subject')
      return false
    }
    if (!selectedTeacher) {
      showError('Please select a teacher')
      return false
    }
    if (!dateFrom || !dateTo) {
      showError('Please choose a date range')
      return false
    }
    if (dateFrom > dateTo) {
      showError('Start date must be on or before end date')
      return false
    }
    return true
  }

  const goNext = () => {
    if (step === 1) {
      if (!validateStep1()) return
      const dates = computeTeachingDates(dateFrom, dateTo, daysMap)
      if (dates.length === 0) {
        showError('No teaching days in this range after Sundays and calendar off days.')
        return
      }
      const init = {}
      dates.forEach((d) => {
        init[d] = emptyRow()
      })
      setTeachingDates(dates)
      setRowByDate(init)
      setStep(2)
      return
    }
    if (step === 2) {
      if (isMinimal) {
        for (const d of teachingDates) {
          if (existingDateSet.has(d)) continue
          const r = rowByDate[d] || emptyRow()
          const topicCount = (r.chapterIds || []).length + (r.topicIds || []).length + (r.subtopicIds || []).length
          const customTopicCount = (r.custom_topics || []).length
          if (topicCount === 0 && customTopicCount === 0) {
            showError(`Select at least one chapter/topic or add a custom topic for ${d} (or skip dates that already have a plan).`)
            return
          }
        }
        setRowByDate((prev) => {
          const next = { ...prev }
          teachingDates.forEach((d) => {
            if (existingDateSet.has(d)) return
            const r = next[d] || emptyRow()
            next[d] = { ...r, title: deriveAutoTitleFromCurriculumSummary(r.curriculumSummary, r.custom_topics) }
          })
          return next
        })
      } else {
        for (const d of teachingDates) {
          if (existingDateSet.has(d)) continue
          const r = rowByDate[d] || emptyRow()
          if (!normalizeLessonPlanText(r.title)) {
            showError(`Add a title for ${d} (or skip dates that already have a plan).`)
            return
          }
        }
      }
      setStep(3)
    }
  }

  const goBack = () => {
    if (step === 1) {
      onClose()
      return
    }
    setStep((s) => Math.max(s - 1, 1))
  }

  const setToday = () => {
    const t = format(new Date(), 'yyyy-MM-dd')
    setDateFrom(t)
    setDateTo(t)
  }

  const setThisWeek = () => {
    const now = new Date()
    const s = startOfWeek(now, { weekStartsOn: 1 })
    const e = endOfWeek(now, { weekStartsOn: 1 })
    setDateFrom(format(s, 'yyyy-MM-dd'))
    setDateTo(format(e, 'yyyy-MM-dd'))
  }

  const setThisMonth = () => {
    const now = new Date()
    const s = startOfMonth(now)
    const e = endOfMonth(now)
    setDateFrom(format(s, 'yyyy-MM-dd'))
    setDateTo(format(e, 'yyyy-MM-dd'))
  }

  const updateRow = (dateStr, patch) => {
    setRowByDate((prev) => ({
      ...prev,
      [dateStr]: { ...(prev[dateStr] || emptyRow()), ...patch },
    }))
  }

  const addCustomTopic = (dateStr) => {
    const label = (customTopicInputByDate[dateStr] || '').trim()
    if (!label) return
    const r = rowByDate[dateStr] || emptyRow()
    const existing = r.custom_topics || []
    if (!existing.includes(label)) {
      updateRow(dateStr, { custom_topics: [...existing, label] })
    }
    setCustomTopicInputByDate((prev) => ({ ...prev, [dateStr]: '' }))
  }

  const removeCustomTopic = (dateStr, index) => {
    const r = rowByDate[dateStr] || emptyRow()
    updateRow(dateStr, { custom_topics: (r.custom_topics || []).filter((_, i) => i !== index) })
  }

  const handleCreateAll = async () => {
    setCreating(true)
    let created = 0
    let skipped = 0
    let failed = 0
    let firstErrorMessage = null
    try {
      for (const d of teachingDates) {
        if (existingDateSet.has(d)) {
          skipped += 1
          continue
        }
        const r = rowByDate[d] || emptyRow()
        if (!normalizeLessonPlanText(r.title)) {
          showError(`Missing title for ${d}`)
          setCreating(false)
          return
        }
        const contentMode = r.topicIds?.length || r.subtopicIds?.length || r.custom_topics?.length ? 'TOPICS' : 'FREEFORM'
        const payload = {
          school: activeSchool?.id,
          academic_year: activeAcademicYear?.id,
          class_obj: parseInt(resolvedClass, 10),
          subject: parseInt(selectedSubject, 10),
          teacher: parseInt(selectedTeacher, 10),
          lesson_date: d,
          duration_minutes: parseInt(duration, 10) || 45,
          title: normalizeLessonPlanText(r.title),
          description: normalizeLessonPlanText(r.description),
          objectives: normalizeLessonPlanText(r.objectives),
          teaching_methods: normalizeLessonPlanText(r.teaching_methods),
          materials_needed: normalizeLessonPlanText(r.materials_needed),
          content_mode: contentMode,
          ai_generated: !!r.ai_generated,
          planned_topic_ids: r.topicIds || [],
          planned_subtopic_ids: r.subtopicIds || [],
          custom_topics: r.custom_topics || [],
          status: 'DRAFT',
        }
        try {
          await lmsApi.createLessonPlan(payload)
          created += 1
        } catch (err) {
          failed += 1
          if (!firstErrorMessage) {
            const data = err.response?.data
            if (typeof data?.detail === 'string') firstErrorMessage = data.detail
            else if (data && typeof data === 'object') {
              const parts = []
              Object.entries(data).forEach(([k, v]) => {
                if (Array.isArray(v)) parts.push(`${k}: ${v.join(' ')}`)
                else if (typeof v === 'string') parts.push(`${k}: ${v}`)
              })
              firstErrorMessage = parts.join(' · ') || null
            }
            firstErrorMessage = firstErrorMessage || err.message || 'Request failed'
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      if (created === 0 && failed > 0) {
        showError(firstErrorMessage || 'Could not create lesson plans. Check fields and try again.')
        return
      }
      let msg = `Created ${created} draft(s). Skipped ${skipped} existing date(s). Failed: ${failed}.`
      if (failed > 0 && firstErrorMessage) {
        msg += ` First error: ${firstErrorMessage}`
      }
      showSuccess(msg)
      onSuccess?.()
      onClose()
    } finally {
      setCreating(false)
    }
  }

  const rowCurriculumCount = (d) => {
    const r = rowByDate[d] || emptyRow()
    return (r.chapterIds || []).length + (r.topicIds || []).length + (r.subtopicIds || []).length
  }

  const rowAiEligibleCount = (d) => {
    const r = rowByDate[d] || emptyRow()
    return (r.chapterIds || []).length + (r.topicIds || []).length + (r.subtopicIds || []).length
  }

  const toggleDateCurriculumSelect = (d) => {
    setDatesSelectedForBulkCurriculum((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Bulk lesson plans</h2>
          <div className="flex items-center gap-3">
            {step === 1 && onCreateSingle && (
              <button
                type="button"
                onClick={onCreateSingle}
                className="text-xs text-primary-600 hover:text-primary-800 underline"
              >
                Create single lesson plan
              </button>
            )}
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
              &times;
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Step 1: class and date range. Step 2: one row per teaching day — topics and AI are per date (separate API call
          each time you use AI). Step 3: confirm and create drafts.
        </p>

        <div className="flex items-center mb-6 flex-wrap gap-y-2">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= s.num ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step > s.num ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span className={`ml-2 text-sm ${step >= s.num ? 'text-primary-600 font-medium' : 'text-gray-500'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`w-8 sm:w-12 h-0.5 mx-2 sm:mx-3 ${step > s.num ? 'bg-primary-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="bulkLessonPlanMode"
                  checked={planMode === 'MINIMAL'}
                  onChange={() => setPlanMode('MINIMAL')}
                />
                Minimal <span className="text-xs text-gray-500">(date, subject, chapter/topic only)</span>
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="bulkLessonPlanMode"
                  checked={planMode === 'STANDARD'}
                  onChange={() => setPlanMode('STANDARD')}
                />
                Standard <span className="text-xs text-gray-500">(full details per day)</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary text-sm" onClick={setToday}>
                Today
              </button>
              <button type="button" className="btn btn-secondary text-sm" onClick={setThisWeek}>
                This week
              </button>
              <button type="button" className="btn btn-secondary text-sm" onClick={setThisMonth}>
                This month
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">From *</label>
                <input type="date" className="input w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To *</label>
                <input type="date" className="input w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Class *</label>
                <ClassSelector
                  className="input w-full"
                  value={selectedClass}
                  onChange={(e) => {
                    setSelectedClass(e.target.value)
                    setSelectedSubject('')
                    setSelectedTeacher('')
                  }}
                  scope={classSelectorScope}
                  academicYearId={activeAcademicYear?.id}
                  showAllOption={showAllOption}
                  classes={teacherClassOptions || undefined}
                />
              </div>
              <div>
                <label className="label">Subject *</label>
                <select
                  className="input w-full"
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  disabled={!selectedClass}
                >
                  <option value="">Select subject</option>
                  {classSubjects.map((cs) => (
                    <option key={cs.id} value={cs.subject}>
                      {cs.subject_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(!isMinimal || !selectedTeacher) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    Teacher {isMinimal ? '(no default found — please choose)' : '*'}
                  </label>
                  <select
                    className="input w-full"
                    value={selectedTeacher}
                    onChange={(e) => setSelectedTeacher(e.target.value)}
                  >
                    <option value="">Select teacher</option>
                    {staff.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name || t.user_name || `Staff #${t.id}`}
                      </option>
                    ))}
                  </select>
                </div>
                {!isMinimal && (
                  <div>
                    <label className="label">Duration (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      className="input w-full sm:max-w-[12rem]"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
            <p className="text-sm text-gray-600">
              Non-teaching days are skipped automatically: <strong>Sundays</strong> and{' '}
              <strong>school calendar off days</strong>.
            </p>
            <p className="text-sm text-gray-600">
              Dates that already have a lesson plan for this class and subject are skipped when saving (shown on step 2).
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              <strong>{teachingDates.length}</strong> teaching day(s). Pick curriculum per row, or tick several dates
              and <strong>apply the same chapter / topic / sub-topic set</strong> in one go.
              {isMinimal
                ? ' Title is generated automatically from the selected chapter/topic.'
                : ' AI runs one request per row when you use it (needs at least one topic or sub-topic).'}
            </p>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <button
                type="button"
                className="btn btn-secondary text-sm disabled:opacity-50"
                disabled={datesSelectedForBulkCurriculum.length === 0}
                onClick={() => setBulkCurriculumPickerOpen(true)}
              >
                Set curriculum for {datesSelectedForBulkCurriculum.length || 0} selected day(s)
              </button>
              {datesSelectedForBulkCurriculum.length > 0 && (
                <button
                  type="button"
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                  onClick={() => setDatesSelectedForBulkCurriculum([])}
                >
                  Clear selection
                </button>
              )}
            </div>
            <div className="border border-gray-200 rounded-lg overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="w-10 px-2 py-2 font-medium text-gray-600 text-center" title="Select days for bulk curriculum">
                      #
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">Date</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Curriculum</th>
                    {!isMinimal && (
                      <>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[10rem]">Title *</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[12rem]">Description</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">AI</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {teachingDates.map((d) => {
                    const skipRow = existingDateSet.has(d)
                    const r = rowByDate[d] || emptyRow()
                    return (
                      <tr key={d} className={skipRow ? 'bg-gray-100/80' : ''}>
                        <td className="px-2 py-2 align-top text-center">
                          {!skipRow && (
                            <input
                              type="checkbox"
                              checked={datesSelectedForBulkCurriculum.includes(d)}
                              onChange={() => toggleDateCurriculumSelect(d)}
                              className="rounded border-gray-300"
                              title="Include in bulk curriculum apply"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap">
                          <div className="font-medium text-gray-900">{format(parseISO(d), 'EEE MMM d')}</div>
                          <div className="text-xs text-gray-500">{d}</div>
                          {skipRow && (
                            <span className="mt-1 inline-block text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                              Exists — skipped on save
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top min-w-[12rem]">
                          {!skipRow && (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-gray-600">
                                {rowCurriculumCount(d)} item(s) (chapters + topics + sub-topics)
                              </span>
                              <button
                                type="button"
                                className="btn btn-secondary text-xs py-1 px-2 self-start"
                                onClick={() => setTopicsPickerDate(d)}
                              >
                                Select topics
                              </button>
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="text"
                                  className="input text-xs py-1 px-2 flex-1"
                                  placeholder="+ custom topic"
                                  value={customTopicInputByDate[d] || ''}
                                  onChange={(e) =>
                                    setCustomTopicInputByDate((prev) => ({ ...prev, [d]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      addCustomTopic(d)
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn btn-secondary text-xs py-1 px-2 shrink-0"
                                  onClick={() => addCustomTopic(d)}
                                >
                                  Add
                                </button>
                              </div>
                              {(r.custom_topics || []).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {r.custom_topics.map((label, index) => (
                                    <span
                                      key={`${label}-${index}`}
                                      className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs px-1.5 py-0.5 rounded-full"
                                    >
                                      {label}
                                      <button
                                        type="button"
                                        onClick={() => removeCustomTopic(d, index)}
                                        className="text-amber-500 hover:text-amber-700"
                                      >
                                        &times;
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        {!isMinimal && (
                          <>
                            <td className="px-3 py-2 align-top">
                              {!skipRow && (
                                <input
                                  type="text"
                                  className="input w-full text-sm"
                                  placeholder="Lesson title"
                                  value={r.title}
                                  onChange={(e) => updateRow(d, { title: e.target.value })}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              {!skipRow && (
                                <textarea
                                  className="input w-full text-sm"
                                  rows={2}
                                  placeholder="Optional"
                                  value={r.description}
                                  onChange={(e) => updateRow(d, { description: e.target.value })}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 align-top whitespace-nowrap">
                              {!skipRow && (
                                <button
                                  type="button"
                                  className="btn btn-secondary text-xs py-1 px-2"
                                  disabled={rowAiEligibleCount(d) === 0}
                                  title={
                                    rowAiEligibleCount(d) === 0
                                      ? 'Select at least one chapter, topic, or sub-topic to use AI'
                                      : 'Open AI generator for this date'
                                  }
                                  onClick={() => setAiModalDate(d)}
                                >
                                  AI
                                </button>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              You are about to create <strong>{teachingDates.filter((d) => !existingDateSet.has(d)).length}</strong>{' '}
              new draft(s). Rows marked as already existing will be skipped.
            </p>
            <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1 max-h-48 overflow-y-auto">
              {teachingDates.map((d) => {
                if (existingDateSet.has(d)) return null
                const r = rowByDate[d] || emptyRow()
                return (
                  <li key={d}>
                    <strong>{d}</strong>: {r.title || '(no title)'} — {rowCurriculumCount(d)} curriculum item(s)
                    {r.custom_topics?.length ? `, ${r.custom_topics.length} custom topic(s)` : ''}
                    {r.ai_generated ? ' · AI' : ''}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Each lesson is created with its own POST request. AI was run per row when you used the AI button (one
              generate call per use).
            </p>
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex gap-2">
            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={step === 1 && calendarLoading}
                className="btn btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >
                {step === 1 && calendarLoading ? 'Loading calendar…' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreateAll}
                disabled={creating}
                className="btn btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create drafts'}
              </button>
            )}
          </div>
        </div>
      </div>

      <LessonPlanTopicsPickerModal
        open={!!topicsPickerDate || bulkCurriculumPickerOpen}
        onClose={() => {
          setTopicsPickerDate(null)
          setBulkCurriculumPickerOpen(false)
        }}
        classId={parseInt(resolvedClass, 10)}
        subjectId={parseInt(selectedSubject, 10)}
        initialChapterIds={topicsPickerDate ? rowByDate[topicsPickerDate]?.chapterIds || [] : []}
        initialTopicIds={topicsPickerDate ? rowByDate[topicsPickerDate]?.topicIds || [] : []}
        initialSubtopicIds={topicsPickerDate ? rowByDate[topicsPickerDate]?.subtopicIds || [] : []}
        onApply={({ chapterIds, topicIds, subtopicIds, curriculumSummary }) => {
          if (topicsPickerDate) {
            updateRow(topicsPickerDate, { chapterIds, topicIds, subtopicIds, curriculumSummary })
          } else {
            datesSelectedForBulkCurriculum.forEach((iso) => {
              if (!existingDateSet.has(iso)) updateRow(iso, { chapterIds, topicIds, subtopicIds, curriculumSummary })
            })
            setDatesSelectedForBulkCurriculum([])
          }
          setTopicsPickerDate(null)
          setBulkCurriculumPickerOpen(false)
        }}
      />

      <LessonPlanAIModal
        open={!!aiModalDate}
        onClose={() => setAiModalDate(null)}
        chapterIds={aiModalDate ? rowByDate[aiModalDate]?.chapterIds || [] : []}
        topicIds={aiModalDate ? rowByDate[aiModalDate]?.topicIds || [] : []}
        subtopicIds={aiModalDate ? rowByDate[aiModalDate]?.subtopicIds || [] : []}
        lessonDate={aiModalDate || ''}
        durationMinutes={parseInt(duration, 10) || 45}
        onApply={(fields) => {
          if (aiModalDate) {
            updateRow(aiModalDate, {
              ...fields,
              ai_generated: true,
            })
          }
        }}
      />
    </div>
  )
}
