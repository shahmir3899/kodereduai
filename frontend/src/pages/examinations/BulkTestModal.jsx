import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { academicsApi, examinationsApi, sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import ClassSelector from '../../components/ClassSelector'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

const STEPS = [
  { id: 1, label: 'Details' },
  { id: 2, label: 'Schedule' },
  { id: 3, label: 'Preview' },
]

const createDefaultForm = (academicYearId = '', termId = '') => ({
  academic_year: academicYearId ? String(academicYearId) : '',
  term: termId ? String(termId) : '',
  exam_type: '',
  class_obj: '',
  subject_ids: [],
})

function shortAcademicYearName(name) {
  return (name || '').replace(/^academic\s+year\s*/i, '').trim()
}

function buildTestName(subjectName, termName, academicYearName) {
  let name = `Test - ${subjectName}`
  if (termName && !name.toLowerCase().includes(termName.toLowerCase())) {
    name += ` - ${termName}`
  }
  const shortYear = shortAcademicYearName(academicYearName)
  if (shortYear) {
    name += ` ${shortYear}`
  }
  return name
}

export default function BulkTestModal({ onClose, onSuccess }) {
  const queryClient = useQueryClient()
  const { activeAcademicYear, currentTerm } = useAcademicYear()
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState({})
  const [preview, setPreview] = useState(null)
  const [form, setForm] = useState(() => createDefaultForm(activeAcademicYear?.id, currentTerm?.id))
  const [testRows, setTestRows] = useState([])

  const selectedAcademicYearId = form.academic_year || activeAcademicYear?.id
  const { sessionClasses } = useSessionClasses(selectedAcademicYearId)
  const classSelectorScope = getClassSelectorScope(selectedAcademicYearId)
  const resolvedClassObj = getResolvedMasterClassId(form.class_obj, selectedAcademicYearId, sessionClasses)

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })
  const { data: termsRes } = useQuery({
    queryKey: ['terms', form.academic_year],
    queryFn: () => sessionsApi.getTerms({ academic_year: form.academic_year, page_size: 9999 }),
    enabled: !!form.academic_year,
  })
  const { data: examTypesRes } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes({ page_size: 9999 }),
  })
  const { data: classSubjectsRes, isLoading: classSubjectsLoading } = useQuery({
    queryKey: ['bulkTestClassSubjects', resolvedClassObj, selectedAcademicYearId],
    queryFn: () => academicsApi.getClassSubjects({
      class_obj: resolvedClassObj,
      academic_year: selectedAcademicYearId || undefined,
      page_size: 9999,
    }),
    enabled: !!resolvedClassObj,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || []
  const availableSubjects = useMemo(() => {
    const items = classSubjectsRes?.data?.results || classSubjectsRes?.data || []
    return [...items].sort((a, b) => a.subject_name.localeCompare(b.subject_name))
  }, [classSubjectsRes])

  const selectedYear = years.find((year) => String(year.id) === String(form.academic_year))
  const selectedTerm = terms.find((term) => String(term.id) === String(form.term))

  useEffect(() => {
    setTestRows((previousRows) => {
      const previousMap = new Map(previousRows.map((row) => [row.subject_id, row]))
      return form.subject_ids.map((subjectId) => {
        const subject = availableSubjects.find((item) => String(item.subject) === String(subjectId))
        const previous = previousMap.get(subjectId)
        const generatedName = buildTestName(
          subject?.subject_name || previous?.subject_name || 'Subject',
          selectedTerm?.name,
          selectedYear?.name,
        )
        return {
          subject_id: subjectId,
          subject_name: subject?.subject_name || previous?.subject_name || 'Subject',
          subject_code: subject?.subject_code || previous?.subject_code || '',
          name: previous?.manualName ? previous.name : generatedName,
          manualName: previous?.manualName || false,
          exam_date: previous?.exam_date || '',
          total_marks: previous?.total_marks || '100',
          start_time: previous?.start_time || '',
          end_time: previous?.end_time || '',
        }
      })
    })
  }, [availableSubjects, form.subject_ids, selectedTerm?.name, selectedYear?.name])

  const previewMutation = useMutation({
    mutationFn: (payload) => examinationsApi.bulkTestPreview(payload),
    onSuccess: (response) => {
      setPreview(response.data)
      setErrors({})
      setStep(3)
    },
    onError: (error) => {
      const errData = error.response?.data || {}
      setErrors(typeof errData === 'string' ? { detail: errData } : errData)
    },
  })

  const applyMutation = useMutation({
    mutationFn: (payload) => examinationsApi.bulkTestApply(payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      setErrors({})
      onSuccess?.(response.data)
    },
    onError: (error) => {
      const errData = error.response?.data || {}
      setErrors(typeof errData === 'string' ? { detail: errData } : errData)
    },
  })

  const updateForm = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }))
    setPreview(null)
    setErrors({})
  }

  const updateRow = (subjectId, patch) => {
    setTestRows((previousRows) => previousRows.map((row) => (
      row.subject_id === subjectId ? { ...row, ...patch } : row
    )))
    setPreview(null)
    setErrors({})
  }

  const buildPayload = () => ({
    academic_year: Number(form.academic_year),
    term: form.term ? Number(form.term) : null,
    exam_type: Number(form.exam_type),
    class_obj: Number(resolvedClassObj),
    tests: testRows.map((row) => ({
      subject_id: Number(row.subject_id),
      name: row.name.trim(),
      exam_date: row.exam_date,
      total_marks: Number(row.total_marks),
      start_time: row.start_time || null,
      end_time: row.end_time || null,
    })),
  })

  const validateStepOne = () => {
    const nextErrors = {}
    if (!form.academic_year) nextErrors.academic_year = 'Academic year is required.'
    if (!form.exam_type) nextErrors.exam_type = 'Exam type is required.'
    if (!resolvedClassObj) nextErrors.class_obj = 'Please select a valid class.'
    if (form.subject_ids.length === 0) nextErrors.subject_ids = 'Select at least one subject.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const validateStepTwo = () => {
    const nextErrors = {}
    testRows.forEach((row) => {
      if (!row.exam_date) {
        nextErrors[`exam_date_${row.subject_id}`] = 'Date is required.'
      }
      if (!row.total_marks || Number(row.total_marks) <= 0) {
        nextErrors[`total_marks_${row.subject_id}`] = 'Total marks must be greater than 0.'
      }
      if (row.start_time && row.end_time && row.start_time > row.end_time) {
        nextErrors[`end_time_${row.subject_id}`] = 'End time must be on or after start time.'
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const goNext = () => {
    if (step === 1 && !validateStepOne()) return
    if (step === 2) {
      if (!validateStepTwo()) return
      previewMutation.mutate(buildPayload())
      return
    }
    setStep((previous) => Math.min(previous + 1, 3))
  }

  const goBack = () => {
    setErrors({})
    setStep((previous) => Math.max(previous - 1, 1))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Create Tests</h2>
            <p className="text-sm text-gray-500">Create one standalone test per selected subject.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="flex items-center gap-2 px-6 py-4 bg-gray-50 border-b border-gray-200 overflow-x-auto">
          {STEPS.map((item) => (
            <div key={item.id} className="flex items-center gap-2 min-w-fit">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${item.id === step ? 'bg-primary-100 text-primary-700' : item.id < step ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                {item.id < step ? '✓' : item.id}
              </div>
              <span className={`text-sm font-medium ${item.id === step ? 'text-primary-700' : 'text-gray-500'}`}>{item.label}</span>
            </div>
          ))}
        </div>

        {(errors.detail || errors.non_field_errors) && (
          <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {errors.detail || errors.non_field_errors}
          </div>
        )}

        {step === 1 && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                <select value={form.academic_year} onChange={(event) => updateForm('academic_year', event.target.value)} className="input w-full">
                  <option value="">Select...</option>
                  {years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
                </select>
                {errors.academic_year && <p className="text-xs text-red-600 mt-1">{errors.academic_year}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                <select value={form.term} onChange={(event) => updateForm('term', event.target.value)} className="input w-full">
                  <option value="">None</option>
                  {terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Exam Type *</label>
                <select value={form.exam_type} onChange={(event) => updateForm('exam_type', event.target.value)} className="input w-full">
                  <option value="">Select...</option>
                  {examTypes.map((examType) => <option key={examType.id} value={examType.id}>{examType.name}</option>)}
                </select>
                {errors.exam_type && <p className="text-xs text-red-600 mt-1">{errors.exam_type}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
                <ClassSelector
                  value={form.class_obj}
                  onChange={(event) => {
                    updateForm('class_obj', event.target.value)
                    setForm((previous) => ({ ...previous, subject_ids: [] }))
                    setTestRows([])
                  }}
                  className="input w-full"
                  scope={classSelectorScope}
                  academicYearId={selectedAcademicYearId}
                  placeholder="Select..."
                />
                {errors.class_obj && <p className="text-xs text-red-600 mt-1">{errors.class_obj}</p>}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Subjects *</label>
                {availableSubjects.length > 0 && (
                  <div className="flex items-center gap-3 text-xs">
                    <button type="button" className="text-primary-600 hover:underline" onClick={() => updateForm('subject_ids', availableSubjects.map((subject) => subject.subject))}>Select All</button>
                    <button type="button" className="text-gray-500 hover:underline" onClick={() => updateForm('subject_ids', [])}>Clear</button>
                  </div>
                )}
              </div>

              {!resolvedClassObj ? (
                <div className="p-4 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500">Select a class to load available subjects.</div>
              ) : classSubjectsLoading ? (
                <div className="p-4 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500">Loading subjects...</div>
              ) : availableSubjects.length === 0 ? (
                <div className="p-4 border border-dashed border-amber-300 rounded-lg text-sm text-amber-700">No accessible subjects found for this class in the selected academic year.</div>
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                  {availableSubjects.map((subject) => {
                    const checked = form.subject_ids.includes(subject.subject)
                    return (
                      <label key={subject.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${checked ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            updateForm(
                              'subject_ids',
                              event.target.checked
                                ? [...form.subject_ids, subject.subject]
                                : form.subject_ids.filter((id) => id !== subject.subject),
                            )
                          }}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{subject.subject_name}</p>
                          <p className="text-xs text-gray-500">{subject.subject_code}</p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
              {errors.subject_ids && <p className="text-xs text-red-600 mt-1">{errors.subject_ids}</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="p-6">
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Test Name</th>
                    <th className="px-4 py-3">Date *</th>
                    <th className="px-4 py-3">Total Marks *</th>
                    <th className="px-4 py-3">Start</th>
                    <th className="px-4 py-3">End</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {testRows.map((row) => (
                    <tr key={row.subject_id}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-gray-900">{row.subject_name}</p>
                        <p className="text-xs text-gray-500">{row.subject_code}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(event) => updateRow(row.subject_id, { name: event.target.value, manualName: true })}
                          className="input w-full"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="date"
                          value={row.exam_date}
                          onChange={(event) => updateRow(row.subject_id, { exam_date: event.target.value })}
                          className="input w-full"
                        />
                        {errors[`exam_date_${row.subject_id}`] && <p className="text-xs text-red-600 mt-1">{errors[`exam_date_${row.subject_id}`]}</p>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={row.total_marks}
                          onChange={(event) => updateRow(row.subject_id, { total_marks: event.target.value })}
                          className="input w-full"
                        />
                        {errors[`total_marks_${row.subject_id}`] && <p className="text-xs text-red-600 mt-1">{errors[`total_marks_${row.subject_id}`]}</p>}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="time"
                          value={row.start_time}
                          onChange={(event) => updateRow(row.subject_id, { start_time: event.target.value })}
                          className="input w-full"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="time"
                          value={row.end_time}
                          onChange={(event) => updateRow(row.subject_id, { end_time: event.target.value })}
                          className="input w-full"
                        />
                        {errors[`end_time_${row.subject_id}`] && <p className="text-xs text-red-600 mt-1">{errors[`end_time_${row.subject_id}`]}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs uppercase text-gray-500">Requested</p>
                <p className="text-2xl font-semibold text-gray-900">{preview.counts.requested}</p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-xs uppercase text-green-700">Create</p>
                <p className="text-2xl font-semibold text-green-700">{preview.counts.create}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs uppercase text-amber-700">Conflicts</p>
                <p className="text-2xl font-semibold text-amber-700">{preview.counts.conflict}</p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs uppercase text-red-700">Blocked</p>
                <p className="text-2xl font-semibold text-red-700">{preview.counts.forbidden + preview.counts.invalid}</p>
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Test Name</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Total Marks</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.tests.map((row) => (
                    <tr key={row.subject_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{row.subject_name || 'Unknown Subject'}</p>
                        <p className="text-xs text-gray-500">{row.subject_code || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{row.name}</td>
                      <td className="px-4 py-3 text-gray-700">{row.exam_date}</td>
                      <td className="px-4 py-3 text-gray-700">{row.total_marks}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${row.status === 'create' ? 'bg-green-100 text-green-700' : row.status === 'conflict' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.reason || 'Ready to create.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button type="button" onClick={step === 1 ? onClose : goBack} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <button
            type="button"
            onClick={step === 3 ? () => applyMutation.mutate(buildPayload()) : goNext}
            disabled={previewMutation.isPending || applyMutation.isPending || (step === 3 && !preview?.can_apply)}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            {previewMutation.isPending ? 'Previewing...' : applyMutation.isPending ? 'Creating...' : step === 1 ? 'Next' : step === 2 ? 'Preview' : 'Create Tests'}
          </button>
        </div>
      </div>
    </div>
  )
}