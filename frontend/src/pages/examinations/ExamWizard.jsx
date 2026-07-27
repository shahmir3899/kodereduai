import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, academicsApi } from '../../services/api'
import { useClasses } from '../../hooks/useClasses'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

const STEPS = [
  { num: 1, label: 'Details' },
  { num: 2, label: 'Classes' },
  { num: 3, label: 'Date Sheet' },
  { num: 4, label: 'Preview' },
]

// Parse/format 'YYYY-MM-DD' entirely in UTC so the local timezone offset
// (e.g. UTC+5) never shifts the calendar date by a day during round-tripping.
function parseDateOnly(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addDaysToDateString(dateStr, days) {
  const date = parseDateOnly(dateStr)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetweenInclusive(startStr, endStr) {
  const start = parseDateOnly(startStr)
  const end = parseDateOnly(endStr)
  return Math.round((end - start) / 86400000) + 1
}

// A stable reference for "no data yet" fallbacks. A fresh `[]` literal on
// every render would give useMemo a new dependency each time, and anything
// whose effect depends on that memo's identity (like the subject_ids
// auto-sync below) would re-fire and re-render forever while queries load.
const EMPTY_ARRAY = []

export default function ExamWizard({ onClose, onSuccess }) {
  const queryClient = useQueryClient()
  const { activeAcademicYear, currentTerm } = useAcademicYear()

  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState({})
  const [wizardData, setWizardData] = useState({
    name: '',
    academic_year: activeAcademicYear?.id ? String(activeAcademicYear.id) : '',
    term: currentTerm?.id ? String(currentTerm.id) : '',
    exam_type: '',
    start_date: '',
    end_date: '',
    default_total_marks: '100',
    default_passing_marks: '33',
    class_ids: [],
    subject_ids_by_class: {},  // Key: classId → [subjectId, ...], independent per class
    date_sheet: {},  // Key: "classId_subjectId" → { exam_date, start_time, end_time }
  })

  // Shared queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })
  const { data: termsRes } = useQuery({
    queryKey: ['terms', wizardData.academic_year],
    queryFn: () => sessionsApi.getTerms({ academic_year: wizardData.academic_year, page_size: 9999 }),
    enabled: !!wizardData.academic_year,
  })
  const { data: examTypesRes } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes({ page_size: 9999 }),
  })
  const { classes: classesFromHook } = useClasses()
  const { data: allClassSubjectsRes } = useQuery({
    queryKey: ['allClassSubjectsForWizard'],
    queryFn: () => academicsApi.getClassSubjects({ page_size: 9999 }),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || EMPTY_ARRAY
  const terms = termsRes?.data?.results || termsRes?.data || EMPTY_ARRAY
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || EMPTY_ARRAY
  const classes = classesFromHook || EMPTY_ARRAY
  const allClassSubjects = allClassSubjectsRes?.data?.results || allClassSubjectsRes?.data || EMPTY_ARRAY
  const selectedClasses = classes.filter(c => wizardData.class_ids.includes(c.id))

  // Class → subject count map
  const subjectCountMap = useMemo(() => {
    const counts = {}
    allClassSubjects.forEach(cs => {
      counts[cs.class_obj] = (counts[cs.class_obj] || 0) + 1
    })
    return counts
  }, [allClassSubjects])

  // Highest subject count among selected classes — the class with the most
  // subjects sets how many distinct exam days the date range needs, assuming
  // one subject's exam per day for that class.
  const maxSubjectsPerClass = useMemo(() => {
    const counts = wizardData.class_ids.map(id => subjectCountMap[id] || 0)
    return counts.length > 0 ? Math.max(...counts) : 0
  }, [subjectCountMap, wizardData.class_ids])

  // Each class's own subjects — drives Step 2's per-class subject picker.
  // Deliberately not deduplicated across classes: two classes both offering
  // "Mathematics" get two independent entries, one per class.
  const classSubjectsMap = useMemo(() => {
    const map = {}
    allClassSubjects.forEach(cs => {
      if (!map[cs.class_obj]) map[cs.class_obj] = []
      map[cs.class_obj].push({ id: cs.subject, name: cs.subject_name, code: cs.subject_code || '' })
    })
    Object.values(map).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)))
    return map
  }, [allClassSubjects])

  // Default a newly-selected class's subjects to "all available" the first
  // time it's checked. Only fills in classes missing an entry, so a manual
  // pick within Step 2 sticks even if other classes' selections change —
  // and a class unchecked then rechecked keeps its previous picks.
  useEffect(() => {
    setWizardData(prev => {
      let changed = false
      const next = { ...prev.subject_ids_by_class }
      prev.class_ids.forEach(classId => {
        if (!next[classId]) {
          next[classId] = (classSubjectsMap[classId] || []).map(s => s.id)
          changed = true
        }
      })
      return changed ? { ...prev, subject_ids_by_class: next } : prev
    })
  }, [wizardData.class_ids, classSubjectsMap])

  // Per-class per-subject pairs, filtered to each class's own Step 2 subject
  // selection — feeds both the Step 3 grid's per-cell options and the
  // "unscheduled" list.
  const subjectClassPairs = useMemo(() => {
    const selectedClassMap = {}
    classes.forEach(c => { selectedClassMap[c.id] = c })
    const rows = []
    allClassSubjects
      .filter(cs => wizardData.class_ids.includes(cs.class_obj)
        && (wizardData.subject_ids_by_class[cs.class_obj] || []).includes(cs.subject))
      .forEach(cs => {
        const cls = selectedClassMap[cs.class_obj]
        if (!cls) return
        rows.push({
          key: `${cs.class_obj}_${cs.subject}`,
          classId: cs.class_obj,
          className: cls.section ? `${cls.name} - ${cls.section}` : cls.name,
          subjectId: cs.subject,
          subjectName: cs.subject_name,
          subjectCode: cs.subject_code || '',
        })
      })
    rows.sort((a, b) => {
      const s = a.subjectName.localeCompare(b.subjectName)
      return s !== 0 ? s : a.className.localeCompare(b.className)
    })
    return rows
  }, [allClassSubjects, wizardData.class_ids, wizardData.subject_ids_by_class, classes])

  // Subjects available per class (for the Step 3 per-cell picker).
  const subjectsByClass = useMemo(() => {
    const map = {}
    subjectClassPairs.forEach(row => {
      if (!map[row.classId]) map[row.classId] = []
      map[row.classId].push(row)
    })
    return map
  }, [subjectClassPairs])

  // Every calendar day in [start_date, end_date] — the Step 3 grid's rows.
  const dateRange = useMemo(() => {
    if (!wizardData.start_date || !wizardData.end_date) return []
    const days = daysBetweenInclusive(wizardData.start_date, wizardData.end_date)
    if (days <= 0) return []
    return Array.from({ length: days }, (_, i) => addDaysToDateString(wizardData.start_date, i))
  }, [wizardData.start_date, wizardData.end_date])

  // `${classId}|${date}` -> [subjectId, ...], derived from date_sheet for cell rendering.
  // A cell can hold more than one subject (e.g. two periods on the same day).
  const cellSubjectsByClassDate = useMemo(() => {
    const map = {}
    Object.entries(wizardData.date_sheet).forEach(([key, val]) => {
      if (!val?.exam_date) return
      const [classId, subjectId] = key.split('_').map(Number)
      const mapKey = `${classId}|${val.exam_date}`
      if (!map[mapKey]) map[mapKey] = []
      map[mapKey].push(subjectId)
    })
    return map
  }, [wizardData.date_sheet])

  // Replace a class+date cell's subject set. Subjects removed from the
  // selection go back to unscheduled; subjects newly checked move onto this
  // date (freeing whatever date they occupied before, since a subject only
  // ever sits on one date per class).
  const handleCellSubjectsChange = (classId, date, nextSubjectIds) => {
    const previousIds = cellSubjectsByClassDate[`${classId}|${date}`] || []
    const nextSet = new Set(nextSubjectIds)
    const prevSet = new Set(previousIds)
    const added = nextSubjectIds.filter(id => !prevSet.has(id))
    const removed = previousIds.filter(id => !nextSet.has(id))
    if (added.length === 0 && removed.length === 0) return

    setWizardData(prev => {
      const nextDateSheet = { ...prev.date_sheet }
      removed.forEach(subjectId => {
        const key = `${classId}_${subjectId}`
        nextDateSheet[key] = { ...(nextDateSheet[key] || {}), exam_date: '' }
      })
      added.forEach(subjectId => {
        const key = `${classId}_${subjectId}`
        nextDateSheet[key] = { ...(nextDateSheet[key] || {}), exam_date: date }
      })
      return { ...prev, date_sheet: nextDateSheet }
    })
  }

  // Toggle one subject in/out of a class+date cell — what the popover
  // checkboxes call on each click.
  const toggleCellSubject = (classId, date, subjectId) => {
    const current = cellSubjectsByClassDate[`${classId}|${date}`] || []
    const next = current.includes(subjectId)
      ? current.filter(id => id !== subjectId)
      : [...current, subjectId]
    handleCellSubjectsChange(classId, date, next)
  }

  // Which cell's subject picker is open — `${classId}|${date}` or null.
  // Only one cell is open at a time; clicking outside the open popover closes it.
  const [openCell, setOpenCell] = useState(null)
  useEffect(() => {
    if (!openCell) return
    const handlePointerDown = (e) => {
      if (!e.target.closest(`[data-cell-key="${openCell}"]`)) setOpenCell(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [openCell])

  // Append/remove one trailing day to Step 3's grid without going back to
  // Step 1. Removing is only offered for the very last row, and only while
  // it's empty, so the range can't develop a gap or silently drop data.
  const handleAddDateRow = () => {
    if (!wizardData.end_date) return
    setOpenCell(null)
    update('end_date', addDaysToDateString(wizardData.end_date, 1))
  }

  const lastDateRow = dateRange[dateRange.length - 1]
  const lastDateRowIsEmpty = lastDateRow
    ? selectedClasses.every(cls => (cellSubjectsByClassDate[`${cls.id}|${lastDateRow}`] || []).length === 0)
    : false

  const handleRemoveLastDateRow = () => {
    if (!lastDateRow || !lastDateRowIsEmpty || dateRange.length <= 1) return
    setOpenCell(null)
    update('end_date', addDaysToDateString(wizardData.end_date, -1))
  }

  // Selected subjects still not placed on any date.
  const unscheduledPairs = useMemo(() => {
    return subjectClassPairs.filter(row => !wizardData.date_sheet[row.key]?.exam_date)
  }, [subjectClassPairs, wizardData.date_sheet])

  // Auto-extend the date range (Step 3) so there's at least one calendar day
  // per subject for the class with the most subjects. Only ever extends
  // end_date forward from start_date — never shrinks a range the admin
  // already set longer than required, and never invents a start_date.
  const [autoAdjustedEndDate, setAutoAdjustedEndDate] = useState(null)
  useEffect(() => {
    if (step !== 3) return
    if (!wizardData.start_date || maxSubjectsPerClass === 0) {
      setAutoAdjustedEndDate(null)
      return
    }

    const currentDays = wizardData.end_date
      ? daysBetweenInclusive(wizardData.start_date, wizardData.end_date)
      : 0

    if (currentDays >= maxSubjectsPerClass) {
      setAutoAdjustedEndDate(null)
      return
    }

    const previousEndDate = wizardData.end_date
    const neededEndDate = addDaysToDateString(wizardData.start_date, maxSubjectsPerClass - 1)
    update('end_date', neededEndDate)
    setAutoAdjustedEndDate({
      from: previousEndDate || null,
      to: neededEndDate,
      subjectCount: maxSubjectsPerClass,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, wizardData.start_date, wizardData.class_ids, maxSubjectsPerClass])

  const selectedType = examTypes.find(t => String(t.id) === String(wizardData.exam_type))
  const selectedYear = years.find(y => String(y.id) === String(wizardData.academic_year))
  const selectedTerm = terms.find(t => String(t.id) === String(wizardData.term))

  // Auto-suggest exam name from selections
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)
  useEffect(() => {
    if (nameManuallyEdited || !selectedType) return
    const typeName = selectedType.name
    // Only add term if it's not already in the type name
    const termName = selectedTerm?.name || ''
    const termRedundant = termName && typeName.toLowerCase().includes(termName.toLowerCase())
    // Strip verbose prefix from year: "Academic Year 2025-26" → "2025-26"
    const yearShort = selectedYear?.name?.replace(/^academic\s+year\s*/i, '').trim() || ''

    let name = typeName
    if (termName && !termRedundant) name += ` - ${termName}`
    if (yearShort) name += ` ${yearShort}`
    update('name', name)
  }, [wizardData.exam_type, wizardData.term, wizardData.academic_year, selectedType, selectedTerm, selectedYear, nameManuallyEdited])

  // Inline exam type creation
  const [showNewType, setShowNewType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeWeight, setNewTypeWeight] = useState('100')
  const createTypeMut = useMutation({
    mutationFn: (data) => examinationsApi.createExamType(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['examTypes'] })
      setWizardData(prev => ({ ...prev, exam_type: String(res.data.id) }))
      setShowNewType(false)
      setNewTypeName('')
      setNewTypeWeight('100')
    },
    onError: (err) => setErrors({ exam_type: err.response?.data?.name || 'Failed to create exam type' }),
  })

  // Wizard create mutation
  const wizardMut = useMutation({
    mutationFn: (data) => examinationsApi.wizardCreateExamGroup(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['examGroups'] })
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      setStep(5) // done
    },
    onError: (err) => {
      const errData = err.response?.data
      if (errData?.conflicts) {
        setErrors({ conflicts: errData.conflicts })
      } else {
        setErrors({ detail: errData?.detail || 'Failed to create exams.' })
      }
    },
  })

  const update = (field, value) => setWizardData(prev => ({ ...prev, [field]: value }))

  const setClassSubjects = (classId, subjectIds) => setWizardData(prev => ({
    ...prev,
    subject_ids_by_class: { ...prev.subject_ids_by_class, [classId]: subjectIds },
  }))

  const toggleClassSubject = (classId, subjectId) => {
    const current = wizardData.subject_ids_by_class[classId] || []
    setClassSubjects(classId, current.includes(subjectId)
      ? current.filter(id => id !== subjectId)
      : [...current, subjectId]
    )
  }

  // Validation per step
  const validateStep1 = () => {
    const e = {}
    if (!wizardData.name.trim()) e.name = 'Required'
    if (!wizardData.academic_year) e.academic_year = 'Required'
    if (!wizardData.exam_type) e.exam_type = 'Required'
    if (!wizardData.start_date) e.start_date = 'Required — Step 3 builds a calendar from this range.'
    if (!wizardData.end_date) e.end_date = 'Required — Step 3 builds a calendar from this range.'
    if (wizardData.start_date && wizardData.end_date && wizardData.start_date > wizardData.end_date) {
      e.end_date = 'Must be after start date'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    const e = {}
    if (wizardData.class_ids.length === 0) e.class_ids = 'Select at least one class.'
    const totalSelectedSubjects = wizardData.class_ids.reduce(
      (sum, id) => sum + (wizardData.subject_ids_by_class[id]?.length || 0), 0,
    )
    if (wizardData.class_ids.length > 0 && totalSelectedSubjects === 0) {
      e.subject_ids = 'Select at least one subject for at least one class.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const goNext = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setErrors({})
    setStep(s => Math.min(s + 1, 4))
  }

  const goBack = () => {
    setErrors({})
    setStep(s => Math.max(s - 1, 1))
  }

  const handleSubmit = () => {
    // Convert date_sheet from { "classId_subjectId": {exam_date, start_time, end_time} }
    // to list of { class_id, subject_id, exam_date, start_time, end_time } (only rows with a date)
    const dateSheetList = Object.entries(wizardData.date_sheet)
      .filter(([, val]) => val.exam_date)
      .map(([key, val]) => {
        const [class_id, subject_id] = key.split('_').map(Number)
        return {
          class_id,
          subject_id,
          exam_date: val.exam_date || null,
          start_time: val.start_time || null,
          end_time: val.end_time || null,
        }
      })
    const payload = {
      academic_year: parseInt(wizardData.academic_year),
      term: wizardData.term ? parseInt(wizardData.term) : null,
      exam_type: parseInt(wizardData.exam_type),
      name: wizardData.name,
      start_date: wizardData.start_date || null,
      end_date: wizardData.end_date || null,
      class_ids: wizardData.class_ids,
      class_subjects: wizardData.class_ids.map(classId => ({
        class_id: classId,
        subject_ids: wizardData.subject_ids_by_class[classId] || [],
      })),
      default_total_marks: parseFloat(wizardData.default_total_marks) || 100,
      default_passing_marks: parseFloat(wizardData.default_passing_marks) || 33,
      date_sheet: dateSheetList,
    }
    wizardMut.mutate(payload)
  }

  const dateSheetCount = Object.values(wizardData.date_sheet).filter(v => v?.exam_date).length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create Exam Group</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Step Indicator */}
        {step <= 4 && (
          <div className="flex items-center gap-1 px-6 py-3 bg-gray-50 border-b">
            {STEPS.map((s, i) => (
              <div key={s.num} className="flex items-center">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${
                  s.num === step ? 'text-sky-700' : s.num < step ? 'text-green-600' : 'text-gray-400'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    s.num === step ? 'bg-sky-100 text-sky-700'
                    : s.num < step ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100'
                  }`}>{s.num < step ? '\u2713' : s.num}</div>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="w-6 sm:w-10 h-px bg-gray-300 mx-1" />}
              </div>
            ))}
          </div>
        )}

        {/* Error banner */}
        {(errors.detail || errors.conflicts) && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errors.detail}
            {errors.conflicts && (
              <ul className="mt-1 list-disc list-inside">
                {errors.conflicts.map((c, i) => (
                  <li key={i}>{c.class_name}: already has "{c.existing_exam}"</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="p-6">
          {/* Step 1: Exam Details */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Exam Name *</label>
                  {!nameManuallyEdited ? (
                    <button type="button" onClick={() => setNameManuallyEdited(true)} className="text-xs text-primary-600 hover:underline">
                      Edit
                    </button>
                  ) : (
                    <button type="button" onClick={() => setNameManuallyEdited(false)} className="text-xs text-gray-400 hover:underline">
                      Auto
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={wizardData.name}
                  onChange={e => { setNameManuallyEdited(true); update('name', e.target.value) }}
                  readOnly={!nameManuallyEdited}
                  className={`input w-full ${!nameManuallyEdited ? 'bg-gray-50 text-gray-500 cursor-default' : ''}`}
                  placeholder="Select year, term & type to auto-generate"
                />
                {!nameManuallyEdited && wizardData.name && (
                  <p className="text-xs text-gray-400 mt-1">Auto generated from your selections</p>
                )}
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                  <select value={wizardData.academic_year} onChange={e => update('academic_year', e.target.value)} className="input w-full">
                    <option value="">Select...</option>
                    {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                  </select>
                  {errors.academic_year && <p className="text-xs text-red-600 mt-1">{errors.academic_year}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                  <select value={wizardData.term} onChange={e => update('term', e.target.value)} className="input w-full">
                    <option value="">None</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Exam Type *</label>
                <div className="flex gap-2">
                  <select value={wizardData.exam_type} onChange={e => update('exam_type', e.target.value)} className="input flex-1">
                    <option value="">Select...</option>
                    {examTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.weight}%)</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewType(!showNewType)}
                    className="px-3 py-2 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap">
                    {showNewType ? 'Cancel' : '+ New'}
                  </button>
                </div>
                {errors.exam_type && <p className="text-xs text-red-600 mt-1">{errors.exam_type}</p>}

                {showNewType && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input type="text" value={newTypeName} onChange={e => setNewTypeName(e.target.value)}
                        className="input w-full text-sm" placeholder="e.g. Mid-Term" />
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-gray-500 mb-1">Weight %</label>
                      <input type="number" value={newTypeWeight} onChange={e => setNewTypeWeight(e.target.value)}
                        className="input w-full text-sm" min="0" max="100" />
                    </div>
                    <button type="button" onClick={() => {
                      if (!newTypeName.trim()) return
                      createTypeMut.mutate({ name: newTypeName, weight: parseFloat(newTypeWeight) || 100 })
                    }} disabled={createTypeMut.isPending}
                      className="btn-primary px-3 py-2 text-xs">
                      {createTypeMut.isPending ? '...' : 'Add'}
                    </button>
                  </div>
                )}

                {selectedType && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-700">
                      <strong>Weight: {selectedType.weight}%</strong> — Determines how much this exam contributes to the final grade.
                      If you have Mid-Term (30%) and Final (70%), the GPA is calculated as:
                      <code className="bg-blue-100 px-1 rounded ml-1">0.30 x Mid-Term + 0.70 x Final</code>
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                  <input type="date" value={wizardData.start_date} onChange={e => update('start_date', e.target.value)} className="input w-full" />
                  {errors.start_date && <p className="text-xs text-red-600 mt-1">{errors.start_date}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input type="date" value={wizardData.end_date} onChange={e => update('end_date', e.target.value)} className="input w-full" />
                  {errors.end_date && <p className="text-xs text-red-600 mt-1">{errors.end_date}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Total Marks</label>
                  <input type="number" value={wizardData.default_total_marks} onChange={e => update('default_total_marks', e.target.value)}
                    className="input w-full" min="1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Passing Marks</label>
                  <input type="number" value={wizardData.default_passing_marks} onChange={e => update('default_passing_marks', e.target.value)}
                    className="input w-full" min="0" />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Select Classes */}
          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Select classes for this exam</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => update('class_ids', classes.map(c => c.id))}
                    className="text-xs text-blue-600 hover:underline">Select All</button>
                  <button type="button" onClick={() => update('class_ids', [])}
                    className="text-xs text-gray-500 hover:underline">Clear</button>
                </div>
              </div>
              {errors.class_ids && <p className="text-xs text-red-600 mb-2">{errors.class_ids}</p>}
              {errors.subject_ids && <p className="text-xs text-red-600 mb-2">{errors.subject_ids}</p>}

              <div className="border border-gray-200 rounded-lg max-h-[28rem] overflow-y-auto divide-y divide-gray-100">
                {classes.map(cls => {
                  const subCount = subjectCountMap[cls.id] || 0
                  const checked = wizardData.class_ids.includes(cls.id)
                  const classSubjects = classSubjectsMap[cls.id] || []
                  const selectedSubjectIds = wizardData.subject_ids_by_class[cls.id] || []
                  return (
                    <div key={cls.id}>
                      <label className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${checked ? 'bg-sky-50' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={checked}
                          onChange={() => update('class_ids', checked
                            ? wizardData.class_ids.filter(id => id !== cls.id)
                            : [...wizardData.class_ids, cls.id]
                          )}
                          className="rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                        <span className="flex-1 text-sm font-medium text-gray-800">{cls.name}{cls.section ? ` - ${cls.section}` : ''}</span>
                        {subCount > 0 ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{subCount} subjects</span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">0 subjects</span>
                        )}
                      </label>

                      {checked && (
                        <div className="pl-11 pr-4 pb-3 bg-sky-50/40 border-t border-dashed border-gray-200">
                          {classSubjects.length === 0 ? (
                            <p className="text-xs text-gray-400 py-2">No subjects assigned to this class yet.</p>
                          ) : (
                            <>
                              <div className="flex items-center justify-between pt-2 pb-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Subjects</span>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => setClassSubjects(cls.id, classSubjects.map(s => s.id))}
                                    className="text-xs text-blue-600 hover:underline">All</button>
                                  <button type="button" onClick={() => setClassSubjects(cls.id, [])}
                                    className="text-xs text-gray-500 hover:underline">None</button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                {classSubjects.map(s => {
                                  const subChecked = selectedSubjectIds.includes(s.id)
                                  return (
                                    <label key={s.id} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                      <input type="checkbox" checked={subChecked}
                                        onChange={() => toggleClassSubject(cls.id, s.id)}
                                        className="rounded border-gray-300 text-sky-600 focus:ring-sky-500 h-3.5 w-3.5" />
                                      {s.name}{s.code ? <span className="text-gray-400 ml-0.5">({s.code})</span> : null}
                                    </label>
                                  )
                                })}
                              </div>
                              <p className="text-[11px] text-gray-400 mt-1.5">{selectedSubjectIds.length} of {classSubjects.length} selected</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {wizardData.class_ids.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">{wizardData.class_ids.length} of {classes.length} classes selected</p>
              )}
            </div>
          )}

          {/* Step 3: Date Sheet */}
          {step === 3 && (
            <div>
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700">Assign Exam Dates</p>
                <p className="text-xs text-gray-500">Click a cell to check off every subject that class sits on that date. Start/end times can be set afterward from the Date Sheet.</p>
                {autoAdjustedEndDate && (
                  <p className="text-xs text-amber-600 mt-1">
                    End date adjusted to {autoAdjustedEndDate.to} to fit {autoAdjustedEndDate.subjectCount} subject{autoAdjustedEndDate.subjectCount !== 1 ? 's' : ''} (one exam day each).
                  </p>
                )}
              </div>

              {selectedClasses.length === 0 || dateRange.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No classes selected or no date range set.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-auto max-h-[360px]">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left w-28">Date</th>
                        {selectedClasses.map(cls => (
                          <th key={cls.id} className="px-3 py-2 text-center">
                            {cls.section ? `${cls.name} - ${cls.section}` : cls.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dateRange.map((date, dateIdx) => {
                        const openUpward = dateIdx >= Math.floor(dateRange.length / 2)
                        return (
                          <tr key={date} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-800 text-xs whitespace-nowrap">{date}</td>
                            {selectedClasses.map((cls, classIdx) => {
                              // Flip the popover to the cell's left once we're in the
                              // latter half of the columns, so it opens toward the
                              // table's horizontal-scroll center instead of running
                              // off the right edge on a narrow (mobile) viewport.
                              const openLeft = classIdx >= Math.ceil(selectedClasses.length / 2)
                              const classLabel = cls.section ? `${cls.name} - ${cls.section}` : cls.name
                              const cellKey = `${cls.id}|${date}`
                              const selectedIds = cellSubjectsByClassDate[cellKey] || []
                              const classSubjectOptions = subjectsByClass[cls.id] || []
                              const isOpen = openCell === cellKey
                              return (
                                <td key={cls.id} className="px-2 py-1.5 relative" data-cell-key={cellKey}>
                                  <button
                                    type="button"
                                    aria-label={`${date} - ${classLabel}`}
                                    onClick={() => setOpenCell(isOpen ? null : cellKey)}
                                    className={`w-full min-h-[30px] text-left rounded border px-2 py-1 flex flex-wrap gap-1 items-center text-xs ${isOpen ? 'border-primary-500 ring-1 ring-primary-200 bg-primary-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                                  >
                                    {selectedIds.length === 0 ? (
                                      <span className="text-gray-300">+ Add subjects</span>
                                    ) : selectedIds.map(id => {
                                      const subj = classSubjectOptions.find(r => r.subjectId === id)
                                      return (
                                        <span key={id} className="inline-flex items-center bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                          {subj?.subjectName || id}
                                        </span>
                                      )
                                    })}
                                  </button>

                                  {isOpen && (
                                    <div className={`absolute z-20 w-48 bg-white border border-gray-300 rounded-lg shadow-lg p-2 ${openLeft ? 'right-0' : 'left-0'} ${openUpward ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                                      <p className="text-[10px] font-semibold uppercase text-gray-400 px-1 mb-1">{classLabel} · {date}</p>
                                      <div className="max-h-40 overflow-auto">
                                        {classSubjectOptions.length === 0 ? (
                                          <p className="text-xs text-gray-400 px-1 py-2">No subjects for this class.</p>
                                        ) : classSubjectOptions.map(row => {
                                          const isHere = selectedIds.includes(row.subjectId)
                                          const elsewhereDate = wizardData.date_sheet[`${cls.id}_${row.subjectId}`]?.exam_date
                                          const isElsewhere = !isHere && elsewhereDate && elsewhereDate !== date
                                          return (
                                            <label key={row.subjectId} className="flex items-center gap-2 px-1 py-1 text-xs rounded hover:bg-gray-50 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={isHere}
                                                onChange={() => toggleCellSubject(cls.id, date, row.subjectId)}
                                                className="rounded border-gray-300"
                                              />
                                              <span className="flex-1">{row.subjectName}</span>
                                              {isElsewhere && <span className="text-[10px] text-gray-400">{elsewhereDate}</span>}
                                            </label>
                                          )
                                        })}
                                      </div>
                                      <div className="flex justify-end pt-1 mt-1 border-t border-gray-100">
                                        <button type="button" onClick={() => setOpenCell(null)} className="text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1">
                                          Done
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedClasses.length > 0 && dateRange.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleAddDateRow}
                    className="flex-1 text-xs font-medium text-gray-500 border border-dashed border-gray-300 rounded-lg py-2 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50"
                  >
                    + Add Date
                  </button>
                  {lastDateRowIsEmpty && dateRange.length > 1 && (
                    <button
                      type="button"
                      onClick={handleRemoveLastDateRow}
                      className="text-xs font-medium text-gray-400 border border-gray-200 rounded-lg px-3 py-2 hover:border-red-300 hover:text-red-500"
                    >
                      Remove last
                    </button>
                  )}
                </div>
              )}

              {unscheduledPairs.length > 0 && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs font-medium text-amber-800 mb-1">Not yet scheduled:</p>
                  <ul className="text-xs text-amber-700 list-disc list-inside">
                    {unscheduledPairs.map(row => (
                      <li key={row.key}>{row.subjectName} ({row.className})</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Preview */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Classes', value: selectedClasses.length, color: 'sky' },
                  { label: 'Type', value: selectedType?.name || '-', color: 'purple' },
                  { label: 'Weight', value: `${selectedType?.weight || 100}%`, color: 'green' },
                  { label: 'Dates Set', value: dateSheetCount, color: 'orange' },
                ].map(card => (
                  <div key={card.label} className={`bg-${card.color}-50 rounded-lg p-3 text-center`}>
                    <p className={`text-lg font-bold text-${card.color}-700`}>{card.value}</p>
                    <p className={`text-xs text-${card.color}-600`}>{card.label}</p>
                  </div>
                ))}
              </div>

              {/* Exam details */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Exam Details</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div><span className="text-gray-500">Name:</span> <span className="font-medium">{wizardData.name}</span></div>
                  <div><span className="text-gray-500">Year:</span> {selectedYear?.name || '-'}</div>
                  <div><span className="text-gray-500">Term:</span> {selectedTerm?.name || 'None'}</div>
                  <div><span className="text-gray-500">Period:</span> {wizardData.start_date || '-'} to {wizardData.end_date || '-'}</div>
                  <div><span className="text-gray-500">Total:</span> {wizardData.default_total_marks}</div>
                  <div><span className="text-gray-500">Passing:</span> {wizardData.default_passing_marks}</div>
                </div>
              </div>

              {/* Classes list */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Classes ({selectedClasses.length})</h3>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {selectedClasses.map(cls => (
                    <div key={cls.id} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded text-sm">
                      <span className="font-medium text-gray-800">{cls.name}{cls.section ? ` - ${cls.section}` : ''}</span>
                      <span className="text-xs text-gray-500">{subjectCountMap[cls.id] || 0} subjects</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date sheet preview */}
              {dateSheetCount > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Date Sheet ({dateSheetCount} entries)</h3>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {subjectClassPairs.filter(row => wizardData.date_sheet[row.key]?.exam_date).map(row => {
                      const slot = wizardData.date_sheet[row.key]
                      return (
                        <div key={row.key} className="flex items-center justify-between py-1 px-3 bg-gray-50 rounded text-sm">
                          <span>{row.subjectName} <span className="text-gray-400 text-xs">({row.className})</span></span>
                          <span className="text-gray-500 text-xs">
                            {slot.exam_date}
                            {slot.start_time ? ` · ${slot.start_time.slice(0, 5)}` : ''}
                            {slot.end_time ? `–${slot.end_time.slice(0, 5)}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Exams Created</h3>
              <p className="text-sm text-gray-600 mb-1">
                {wizardMut.data?.data?.exams_created || 0} exams with {wizardMut.data?.data?.subjects_created || 0} subject entries
              </p>
              <p className="text-xs text-gray-500 mb-6">You can now enter marks, set up the date sheet, or publish when ready.</p>
              <button onClick={() => { onSuccess?.(); onClose() }} className="btn-primary px-6 py-2 text-sm">
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {step >= 1 && step <= 4 && (
          <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
            <button type="button" onClick={step === 1 ? onClose : goBack}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button type="button" onClick={goNext} className="btn-primary px-6 py-2 text-sm">
                Next
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={wizardMut.isPending}
                className="btn-primary px-6 py-2 text-sm disabled:opacity-50">
                {wizardMut.isPending ? 'Creating...' : `Create ${selectedClasses.length} Exam(s)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
