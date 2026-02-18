import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, classesApi, academicsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

const STEPS = [
  { num: 1, label: 'Details' },
  { num: 2, label: 'Classes' },
  { num: 3, label: 'Date Sheet' },
  { num: 4, label: 'Preview' },
]

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
    date_sheet: {},
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
  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
  })
  const { data: allClassSubjectsRes } = useQuery({
    queryKey: ['allClassSubjectsForWizard'],
    queryFn: () => academicsApi.getClassSubjects({ page_size: 9999 }),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []
  const allClassSubjects = allClassSubjectsRes?.data?.results || allClassSubjectsRes?.data || []

  // Class → subject count map
  const subjectCountMap = useMemo(() => {
    const counts = {}
    allClassSubjects.forEach(cs => {
      counts[cs.class_obj] = (counts[cs.class_obj] || 0) + 1
    })
    return counts
  }, [allClassSubjects])

  // Unique subjects across selected classes
  const uniqueSubjects = useMemo(() => {
    const subjectMap = {}
    allClassSubjects
      .filter(cs => wizardData.class_ids.includes(cs.class_obj))
      .forEach(cs => {
        if (!subjectMap[cs.subject]) {
          subjectMap[cs.subject] = {
            id: cs.subject,
            name: cs.subject_name,
            code: cs.subject_code || '',
          }
        }
      })
    return Object.values(subjectMap).sort((a, b) => a.name.localeCompare(b.name))
  }, [allClassSubjects, wizardData.class_ids])

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

  // Validation per step
  const validateStep1 = () => {
    const e = {}
    if (!wizardData.name.trim()) e.name = 'Required'
    if (!wizardData.academic_year) e.academic_year = 'Required'
    if (!wizardData.exam_type) e.exam_type = 'Required'
    if (wizardData.start_date && wizardData.end_date && wizardData.start_date > wizardData.end_date) {
      e.end_date = 'Must be after start date'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const validateStep2 = () => {
    if (wizardData.class_ids.length === 0) {
      setErrors({ class_ids: 'Select at least one class.' })
      return false
    }
    setErrors({})
    return true
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
    const payload = {
      academic_year: parseInt(wizardData.academic_year),
      term: wizardData.term ? parseInt(wizardData.term) : null,
      exam_type: parseInt(wizardData.exam_type),
      name: wizardData.name,
      start_date: wizardData.start_date || null,
      end_date: wizardData.end_date || null,
      class_ids: wizardData.class_ids,
      default_total_marks: parseFloat(wizardData.default_total_marks) || 100,
      default_passing_marks: parseFloat(wizardData.default_passing_marks) || 33,
      date_sheet: wizardData.date_sheet,
    }
    wizardMut.mutate(payload)
  }

  const selectedClasses = classes.filter(c => wizardData.class_ids.includes(c.id))
  const dateSheetCount = Object.values(wizardData.date_sheet).filter(Boolean).length

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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={wizardData.start_date} onChange={e => update('start_date', e.target.value)} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
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

              <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                {classes.map(cls => {
                  const subCount = subjectCountMap[cls.id] || 0
                  const checked = wizardData.class_ids.includes(cls.id)
                  return (
                    <label key={cls.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${checked ? 'bg-sky-50' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={checked}
                        onChange={() => update('class_ids', checked
                          ? wizardData.class_ids.filter(id => id !== cls.id)
                          : [...wizardData.class_ids, cls.id]
                        )}
                        className="rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                      <span className="flex-1 text-sm font-medium text-gray-800">{cls.name}</span>
                      {subCount > 0 ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{subCount} subjects</span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">0 subjects</span>
                      )}
                    </label>
                  )
                })}
              </div>
              {wizardData.class_ids.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">{wizardData.class_ids.length} of {classes.length} classes selected</p>
              )}
            </div>
          )}

          {/* Step 3: Date Sheet (Optional) */}
          {step === 3 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-medium text-gray-700">Assign Exam Dates to Subjects</p>
                  <p className="text-xs text-gray-500">Optional - you can set dates later from the group actions</p>
                </div>
                <button type="button" onClick={() => setStep(4)} className="text-xs text-sky-600 hover:underline">
                  Skip &rarr;
                </button>
              </div>

              {uniqueSubjects.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No subjects found for selected classes. You can assign subjects later.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="px-4 py-2 text-left">Subject</th>
                        <th className="px-4 py-2 text-left">Code</th>
                        <th className="px-4 py-2 text-left w-40">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {uniqueSubjects.map(s => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{s.name}</td>
                          <td className="px-4 py-2 text-gray-500">{s.code}</td>
                          <td className="px-4 py-2">
                            <input type="date"
                              value={wizardData.date_sheet[s.id] || ''}
                              min={wizardData.start_date || undefined}
                              max={wizardData.end_date || undefined}
                              onChange={e => setWizardData(prev => ({
                                ...prev,
                                date_sheet: { ...prev.date_sheet, [s.id]: e.target.value },
                              }))}
                              className="input text-sm py-1 w-full" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                      <span className="font-medium text-gray-800">{cls.name}</span>
                      <span className="text-xs text-gray-500">{subjectCountMap[cls.id] || 0} subjects</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Date sheet preview */}
              {dateSheetCount > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Date Sheet</h3>
                  <div className="space-y-1">
                    {uniqueSubjects.filter(s => wizardData.date_sheet[s.id]).map(s => (
                      <div key={s.id} className="flex items-center justify-between py-1 px-3 bg-gray-50 rounded text-sm">
                        <span>{s.name}</span>
                        <span className="text-gray-500">{wizardData.date_sheet[s.id]}</span>
                      </div>
                    ))}
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
