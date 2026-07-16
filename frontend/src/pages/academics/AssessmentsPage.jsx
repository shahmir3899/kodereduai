import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import ClassSelector from '../../components/ClassSelector'
import { examinationsApi, sessionsApi } from '../../services/api'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SKILL_FIELDS = [
  ['listening', 'Listening'],
  ['speaking', 'Speaking'],
  ['writing', 'Writing'],
  ['reading', 'Reading'],
  ['participation', 'Participation'],
  ['confidence', 'Confidence'],
  ['social_skills', 'Social Skills'],
]

const BEHAVIOUR_FIELDS = [
  ['discipline', 'Discipline'],
  ['respect', 'Respect'],
  ['teamwork', 'Teamwork'],
  ['class_participation', 'Class Participation'],
  ['responsibility', 'Responsibility'],
]

const RATING_OPTIONS = [
  [1, 'Needs Improvement'],
  [2, 'Fair'],
  [3, 'Good'],
  [4, 'Very Good'],
  [5, 'Excellent'],
]

const EMPTY_ROW = {
  exists: false,
  student: null,
  student_name: '',
  roll_number: '',
  updated_by_name: '',
  updated_at: '',
  teacher_remark: '',
  principal_remark: '',
}

function monthLabel(month) {
  return MONTH_NAMES[month - 1] || `Month ${month}`
}

function createEmptyAssessment(month, academicYearId, sessionClassId, classObjId) {
  return {
    student: null,
    academic_year: academicYearId,
    month,
    session_class: sessionClassId || null,
    class_obj: classObjId || null,
    listening: '',
    speaking: '',
    writing: '',
    reading: '',
    participation: '',
    confidence: '',
    social_skills: '',
    discipline: '',
    respect: '',
    teamwork: '',
    class_participation: '',
    responsibility: '',
    teacher_remark: '',
    principal_remark: '',
  }
}

function buildRowState(row) {
  return {
    ...EMPTY_ROW,
    ...row,
    listening: row?.listening ?? '',
    speaking: row?.speaking ?? '',
    writing: row?.writing ?? '',
    reading: row?.reading ?? '',
    participation: row?.participation ?? '',
    confidence: row?.confidence ?? '',
    social_skills: row?.social_skills ?? '',
    discipline: row?.discipline ?? '',
    respect: row?.respect ?? '',
    teamwork: row?.teamwork ?? '',
    class_participation: row?.class_participation ?? '',
    responsibility: row?.responsibility ?? '',
    teacher_remark: row?.teacher_remark ?? '',
    principal_remark: row?.principal_remark ?? '',
  }
}

function mapAssessmentToForm(row, teacherCanEditPrincipal) {
  const next = {}
  for (const [field] of [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]) {
    next[field] = row?.[field] ?? ''
  }
  next.teacher_remark = row?.teacher_remark || ''
  next.principal_remark = teacherCanEditPrincipal ? (row?.principal_remark || '') : (row?.principal_remark || '')
  return next
}

export default function AssessmentsPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const { activeSchool, user, isTeacher, isSchoolAdmin, isPrincipal } = useAuth()
  const { showError, showSuccess } = useToast()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const canEditPrincipalRemark = !isTeacher || isSchoolAdmin || isPrincipal || user?.role === 'SUPER_ADMIN'

  const today = new Date()
  const [academicYearId, setAcademicYearId] = useState(activeAcademicYear?.id ? String(activeAcademicYear.id) : '')
  const [selectedMonth, setSelectedMonth] = useState(String(today.getMonth() + 1))
  const [selectedClassId, setSelectedClassId] = useState('')
  const [sessionClassId, setSessionClassId] = useState('')
  const [formMap, setFormMap] = useState({})
  const [selectedRowId, setSelectedRowId] = useState(null)
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    if (activeAcademicYear?.id) {
      setAcademicYearId(String(activeAcademicYear.id))
    }
  }, [activeAcademicYear?.id])

  const { data: academicYearsRes } = useQuery({
    queryKey: ['monthlyAssessmentAcademicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const academicYears = academicYearsRes?.data?.results || academicYearsRes?.data || []

  const resolvedSessionClassId = useMemo(() => {
    if (!selectedClassId) return ''
    if (!academicYearId) return ''
    const match = sessionClasses.find((sc) => String(sc.id) === String(selectedClassId))
    if (match) return String(match.id)
    return ''
  }, [academicYearId, selectedClassId, sessionClasses])

  const resolvedClassObjId = useMemo(() => {
    if (!selectedClassId) return ''
    if (!academicYearId) return String(selectedClassId)
    return getResolvedMasterClassId(selectedClassId, academicYearId, sessionClasses)
  }, [academicYearId, selectedClassId, sessionClasses])

  useEffect(() => {
    setSessionClassId(resolvedSessionClassId)
  }, [resolvedSessionClassId])

  const canLoadRoster = !!academicYearId && !!selectedMonth && (!!resolvedSessionClassId || !!resolvedClassObjId)

  const { data: rosterRes, isLoading, error, refetch } = useQuery({
    queryKey: ['studentTermAssessmentRoster', academicYearId, selectedMonth, resolvedSessionClassId, resolvedClassObjId],
    queryFn: () => examinationsApi.getStudentTermAssessmentRoster({
      academic_year: academicYearId,
      month: selectedMonth,
      ...(resolvedSessionClassId ? { session_class: resolvedSessionClassId } : {}),
      ...(resolvedClassObjId ? { class_obj: resolvedClassObjId } : {}),
    }),
    enabled: canLoadRoster,
  })

  const roster = rosterRes?.data?.results || []
  const selectedMonthNumber = Number(selectedMonth)

  useEffect(() => {
    if (!roster.length) return
    setFormMap((prev) => {
      const next = { ...prev }
      roster.forEach((row) => {
        if (next[row.student]) return
        next[row.student] = mapAssessmentToForm(row, canEditPrincipalRemark)
      })
      return next
    })
  }, [canEditPrincipalRemark, roster])

  useEffect(() => {
    setFormMap({})
    setSelectedRowId(null)
  }, [academicYearId, selectedMonth, resolvedSessionClassId, resolvedClassObjId])

  const saveMutation = useMutation({
    mutationFn: (payload) => examinationsApi.bulkSaveStudentTermAssessment(payload),
    onSuccess: (res) => {
      const data = res?.data || {}
      const updatedRows = data.results || []
      setFormMap((prev) => {
        const next = { ...prev }
        updatedRows.forEach((row) => {
          next[row.student] = mapAssessmentToForm(row, canEditPrincipalRemark)
        })
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['studentTermAssessmentRoster'] })
      showSuccess(`Saved ${data.created || 0} new and ${data.updated || 0} updated assessment(s).`)
      if (updatedRows.length > 0) {
        setSelectedRowId(updatedRows[0].student)
      }
    },
    onError: (err) => {
      const message = err?.response?.data?.detail || err?.response?.data?.error || 'Failed to save monthly assessments'
      showError(message)
    },
  })

  const studentRows = useMemo(() => {
    const filter = searchText.trim().toLowerCase()
    if (!filter) return roster
    return roster.filter((row) => {
      const name = String(row.student_name || '').toLowerCase()
      const roll = String(row.roll_number || '').toLowerCase()
      return name.includes(filter) || roll.includes(filter)
    })
  }, [roster, searchText])

  const setField = (studentId, field, value) => {
    setFormMap((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || createEmptyAssessment(selectedMonthNumber, academicYearId, sessionClassId, resolvedClassObjId)),
        [field]: value,
      },
    }))
  }

  const getForm = (studentId) => formMap[studentId] || createEmptyAssessment(selectedMonthNumber, academicYearId, sessionClassId, resolvedClassObjId)

  const buildAssessmentPayload = (row, form) => ({
    student: row.student,
    listening: form.listening === '' ? null : Number(form.listening),
    speaking: form.speaking === '' ? null : Number(form.speaking),
    writing: form.writing === '' ? null : Number(form.writing),
    reading: form.reading === '' ? null : Number(form.reading),
    participation: form.participation === '' ? null : Number(form.participation),
    confidence: form.confidence === '' ? null : Number(form.confidence),
    social_skills: form.social_skills === '' ? null : Number(form.social_skills),
    discipline: form.discipline === '' ? null : Number(form.discipline),
    respect: form.respect === '' ? null : Number(form.respect),
    teamwork: form.teamwork === '' ? null : Number(form.teamwork),
    class_participation: form.class_participation === '' ? null : Number(form.class_participation),
    responsibility: form.responsibility === '' ? null : Number(form.responsibility),
    teacher_remark: form.teacher_remark || '',
    principal_remark: canEditPrincipalRemark ? (form.principal_remark || '') : '',
  })

  const handleSaveAll = () => {
    if (!canLoadRoster) {
      showError('Select an academic year, month, and class first.')
      return
    }

    const assessments = studentRows.map((row) => buildAssessmentPayload(row, getForm(row.student)))

    saveMutation.mutate({
      academic_year: Number(academicYearId),
      month: selectedMonthNumber,
      ...(sessionClassId ? { session_class: Number(sessionClassId) } : {}),
      ...(resolvedClassObjId ? { class_obj: Number(resolvedClassObjId) } : {}),
      assessments,
    })
  }

  const singleSaveMutation = useMutation({
    mutationFn: (payload) => examinationsApi.saveStudentTermAssessment(payload),
    onSuccess: (res) => {
      const row = res?.data
      if (row?.student) {
        setFormMap((prev) => ({ ...prev, [row.student]: mapAssessmentToForm(row, canEditPrincipalRemark) }))
      }
      queryClient.invalidateQueries({ queryKey: ['studentTermAssessmentRoster'] })
      showSuccess('Assessment saved.')
    },
    onError: (err) => {
      const message = err?.response?.data?.detail || err?.response?.data?.error || 'Failed to save assessment'
      showError(message)
    },
  })

  const handleSaveOne = (row) => {
    singleSaveMutation.mutate({
      ...buildAssessmentPayload(row, getForm(row.student)),
      academic_year: Number(academicYearId),
      month: selectedMonthNumber,
    })
  }

  const [aiLoadingKey, setAiLoadingKey] = useState(null)

  const handleAiSuggest = async (row, field) => {
    const key = `${row.student}-${field}`
    setAiLoadingKey(key)
    try {
      const form = getForm(row.student)
      const ratings = {}
      for (const [fieldName, label] of [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]) {
        if (form[fieldName] !== '') ratings[label] = Number(form[fieldName])
      }
      const remarkType = field === 'principal_remark' ? 'principal' : 'teacher'
      const res = await examinationsApi.aiSuggestAssessmentRemark({ ratings, remark_type: remarkType })
      const { remark, fallback } = res?.data || {}
      if (remark) {
        setField(row.student, field, remark)
        showSuccess(fallback ? 'Suggestion added — review and edit before saving.' : 'AI draft added — review and edit before saving.')
      }
    } catch (err) {
      showError(err?.response?.data?.error || 'AI suggestion failed.')
    } finally {
      setAiLoadingKey(null)
    }
  }

  const activeRow = selectedRowId ? roster.find((row) => String(row.student) === String(selectedRowId)) : null

  const RemarkField = ({ row, form, field, label, disabled, placeholder }) => {
    const key = `${row.student}-${field}`
    const isSuggesting = aiLoadingKey === key
    return (
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-gray-500">{label}</label>
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleAiSuggest(row, field) }}
              disabled={isSuggesting}
              className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSuggesting ? 'Suggesting…' : '✨ AI Suggest'}
            </button>
          )}
        </div>
        <textarea
          rows={2}
          value={form[field]}
          onChange={(e) => setField(row.student, field, e.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          placeholder={placeholder}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Academics</p>
            <h1 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">Monthly Assessments</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">
              Review and save monthly skill, behaviour, and remark snapshots for the selected class.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Month</div>
              <div className="mt-1 font-semibold text-gray-900">{monthLabel(selectedMonthNumber)}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Students</div>
              <div className="mt-1 font-semibold text-gray-900">{studentRows.length}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Mode</div>
              <div className="mt-1 font-semibold text-gray-900">{classSelectorScope === 'session' ? 'Session class' : 'Master class'}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">School</div>
              <div className="mt-1 font-semibold text-gray-900">{activeSchool?.name || 'Active school'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Academic Year</label>
          <select
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Select academic year</option>
            {academicYears.map((year) => (
              <option key={year.id} value={year.id}>{year.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Class</label>
          <ClassSelector
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            scope={classSelectorScope}
            academicYearId={academicYearId}
            schoolId={activeSchool?.id}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
            placeholder="Select class"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Month</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
          >
            {MONTH_NAMES.map((label, index) => (
              <option key={label} value={String(index + 1)}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</label>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
            placeholder="Search student or roll"
          />
        </div>
      </div>

      {!canLoadRoster ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Select an academic year, class, and month to load the roster.
        </div>
      ) : isLoading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading roster...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
          Failed to load assessment roster.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Roster</h2>
              <p className="text-xs text-gray-500">{studentRows.length} student(s) in {monthLabel(selectedMonthNumber)}</p>
              {activeRow ? (
                <p className="mt-1 text-xs text-slate-600">
                  Selected: <span className="font-medium text-gray-900">{activeRow.student_name}</span>
                  {' '}(Roll {activeRow.roll_number || '—'}) · {activeRow.exists ? 'Saved' : 'New'} for {monthLabel(selectedMonthNumber)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Select a student to highlight their row.</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saveMutation.isPending || studentRows.length === 0}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save Month'}
            </button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Skill Snapshot</th>
                  <th className="px-4 py-3">Behaviour Snapshot</th>
                  <th className="px-4 py-3">Remarks</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {studentRows.map((row) => {
                  const form = getForm(row.student)
                  const isSelected = String(selectedRowId) === String(row.student)
                  const isSavingThis = singleSaveMutation.isPending && singleSaveMutation.variables?.student === row.student
                  return (
                    <tr
                      key={row.student}
                      className={`cursor-pointer transition hover:bg-gray-50 ${isSelected ? 'bg-slate-50' : ''}`}
                      onClick={() => setSelectedRowId(row.student)}
                    >
                      <td className="px-4 py-4 align-top">
                        <div className="font-medium text-gray-900">{row.student_name || 'Unnamed student'}</div>
                        <div className="text-xs text-gray-500">Roll {row.roll_number || '—'}</div>
                        <div className="mt-1 text-xs text-gray-400">{row.updated_by_name ? `Updated by ${row.updated_by_name}` : 'Not saved yet'}</div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="grid grid-cols-2 gap-2">
                          {SKILL_FIELDS.map(([field, label]) => (
                            <label key={field} className="flex flex-col gap-1 text-xs text-gray-500">
                              <span>{label}</span>
                              <select
                                value={form[field]}
                                onChange={(e) => setField(row.student, field, e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                              >
                                <option value="">Not rated</option>
                                {RATING_OPTIONS.map(([value, optionLabel]) => (
                                  <option key={value} value={String(value)}>{optionLabel}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="grid grid-cols-2 gap-2">
                          {BEHAVIOUR_FIELDS.map(([field, label]) => (
                            <label key={field} className="flex flex-col gap-1 text-xs text-gray-500">
                              <span>{label}</span>
                              <select
                                value={form[field]}
                                onChange={(e) => setField(row.student, field, e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                              >
                                <option value="">Not rated</option>
                                {RATING_OPTIONS.map(([value, optionLabel]) => (
                                  <option key={value} value={String(value)}>{optionLabel}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="space-y-3">
                          <RemarkField row={row} form={form} field="teacher_remark" label="Teacher remark" placeholder="Teacher observation" />
                          <RemarkField
                            row={row}
                            form={form}
                            field="principal_remark"
                            label="Principal remark"
                            disabled={!canEditPrincipalRemark}
                            placeholder={canEditPrincipalRemark ? 'Principal observation' : 'Principal remark locked'}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-right text-xs text-gray-500">
                        <div>{row.exists ? 'Saved' : 'New'}</div>
                        <div>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSaveOne(row) }}
                          disabled={isSavingThis}
                          className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingThis ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {studentRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                      No students found for this class and month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3 p-3">
            {studentRows.map((row) => {
              const form = getForm(row.student)
              const isSelected = String(selectedRowId) === String(row.student)
              const isSavingThis = singleSaveMutation.isPending && singleSaveMutation.variables?.student === row.student
              return (
                <div
                  key={row.student}
                  className={`card ${isSelected ? 'border-slate-400' : ''}`}
                  onClick={() => setSelectedRowId(row.student)}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{row.student_name || 'Unnamed student'}</p>
                      <p className="text-xs text-gray-500">Roll {row.roll_number || '—'}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <div>{row.exists ? 'Saved' : 'New'}</div>
                      <div>{row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '—'}</div>
                    </div>
                  </div>

                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Skill Snapshot</p>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {SKILL_FIELDS.map(([field, label]) => (
                      <label key={field} className="flex flex-col gap-1 text-xs text-gray-500">
                        <span>{label}</span>
                        <select
                          value={form[field]}
                          onChange={(e) => setField(row.student, field, e.target.value)}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="">Not rated</option>
                          {RATING_OPTIONS.map(([value, optionLabel]) => (
                            <option key={value} value={String(value)}>{optionLabel}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Behaviour Snapshot</p>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {BEHAVIOUR_FIELDS.map(([field, label]) => (
                      <label key={field} className="flex flex-col gap-1 text-xs text-gray-500">
                        <span>{label}</span>
                        <select
                          value={form[field]}
                          onChange={(e) => setField(row.student, field, e.target.value)}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="">Not rated</option>
                          {RATING_OPTIONS.map(([value, optionLabel]) => (
                            <option key={value} value={String(value)}>{optionLabel}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <RemarkField row={row} form={form} field="teacher_remark" label="Teacher remark" placeholder="Teacher observation" />
                    <RemarkField
                      row={row}
                      form={form}
                      field="principal_remark"
                      label="Principal remark"
                      disabled={!canEditPrincipalRemark}
                      placeholder={canEditPrincipalRemark ? 'Principal observation' : 'Principal remark locked'}
                    />
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleSaveOne(row) }}
                      disabled={isSavingThis}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingThis ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )
            })}
            {studentRows.length === 0 && (
              <div className="card text-center text-sm text-gray-500">
                No students found for this class and month.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
