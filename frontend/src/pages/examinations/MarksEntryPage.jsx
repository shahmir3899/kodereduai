import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, classesApi } from '../../services/api'

export default function MarksEntryPage() {
  const queryClient = useQueryClient()

  // Selection state
  const [selectedExamId, setSelectedExamId] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

  // Marks grid state
  const [marksData, setMarksData] = useState([])
  const [saveMsg, setSaveMsg] = useState('')

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears(),
  })

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
  })

  const { data: examsRes } = useQuery({
    queryKey: ['exams', yearFilter, classFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      class_obj: classFilter || undefined,
    }),
  })

  const { data: examSubjectsRes } = useQuery({
    queryKey: ['examSubjects', selectedExamId],
    queryFn: () => examinationsApi.getExamSubjects({ exam: selectedExamId }),
    enabled: !!selectedExamId,
  })

  const { data: marksRes, isLoading: marksLoading } = useQuery({
    queryKey: ['marks', selectedSubjectId],
    queryFn: () => examinationsApi.getMarks({ exam_subject: selectedSubjectId }),
    enabled: !!selectedSubjectId,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []
  const exams = examsRes?.data?.results || examsRes?.data || []
  const examSubjects = examSubjectsRes?.data?.results || examSubjectsRes?.data || []
  const existingMarks = marksRes?.data?.results || marksRes?.data || []

  // Selected subject details
  const selectedSubject = examSubjects.find(s => s.id === parseInt(selectedSubjectId))

  // Initialize marks grid when subject is selected and marks load
  const initGrid = () => {
    if (existingMarks.length > 0) {
      setMarksData(existingMarks.map(m => ({
        student_id: m.student,
        student_name: m.student_name,
        student_roll: m.student_roll_number,
        marks_obtained: m.marks_obtained !== null ? String(m.marks_obtained) : '',
        is_absent: m.is_absent,
        remarks: m.remarks || '',
      })))
    }
  }

  // When selectedSubjectId or existingMarks change, reinit
  useState(() => {
    if (existingMarks.length > 0) initGrid()
  }, [existingMarks])

  // Bulk save mutation
  const bulkSaveMut = useMutation({
    mutationFn: (data) => examinationsApi.bulkEntryMarks(data),
    onSuccess: () => {
      setSaveMsg('Marks saved successfully!')
      queryClient.invalidateQueries({ queryKey: ['marks'] })
      setTimeout(() => setSaveMsg(''), 3000)
    },
    onError: (err) => {
      setSaveMsg(`Error: ${err.response?.data?.detail || 'Failed to save marks'}`)
    },
  })

  const handleSubjectSelect = (subjectId) => {
    setSelectedSubjectId(subjectId)
    setMarksData([])
    setSaveMsg('')
  }

  const updateMark = (idx, field, value) => {
    setMarksData(prev => prev.map((m, i) => {
      if (i !== idx) return m
      if (field === 'is_absent' && value) {
        return { ...m, is_absent: true, marks_obtained: '' }
      }
      return { ...m, [field]: value }
    }))
  }

  const handleSave = () => {
    const payload = {
      exam_subject_id: parseInt(selectedSubjectId),
      marks: marksData.map(m => ({
        student_id: m.student_id,
        marks_obtained: m.is_absent ? null : (m.marks_obtained !== '' ? parseFloat(m.marks_obtained) : null),
        is_absent: m.is_absent,
        remarks: m.remarks,
      })),
    }
    bulkSaveMut.mutate(payload)
  }

  // Load existing marks when they arrive
  if (existingMarks.length > 0 && marksData.length === 0) {
    initGrid()
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Marks Entry</h1>
        <p className="text-sm text-gray-600">Enter marks for students in a spreadsheet-style grid</p>
      </div>

      {/* Selection Bar */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setSelectedExamId(''); setSelectedSubjectId(''); setMarksData([]) }} className="input w-full text-sm">
              <option value="">All Years</option>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select value={classFilter} onChange={e => { setClassFilter(e.target.value); setSelectedExamId(''); setSelectedSubjectId(''); setMarksData([]) }} className="input w-full text-sm">
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Exam</label>
            <select value={selectedExamId} onChange={e => { setSelectedExamId(e.target.value); setSelectedSubjectId(''); setMarksData([]) }} className="input w-full text-sm">
              <option value="">Select exam...</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <select value={selectedSubjectId} onChange={e => handleSubjectSelect(e.target.value)} className="input w-full text-sm" disabled={!selectedExamId}>
              <option value="">Select subject...</option>
              {examSubjects.map(s => <option key={s.id} value={s.id}>{s.subject_name} ({s.total_marks})</option>)}
            </select>
          </div>
        </div>
        {selectedSubject && (
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-4 text-xs text-gray-600">
            <span>Total Marks: <strong>{selectedSubject.total_marks}</strong></span>
            <span>Passing: <strong>{selectedSubject.passing_marks}</strong></span>
            {selectedSubject.exam_date && <span>Date: <strong>{selectedSubject.exam_date}</strong></span>}
          </div>
        )}
      </div>

      {/* Marks Grid */}
      {!selectedSubjectId ? (
        <div className="card text-center py-12 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Select an exam and subject above to start entering marks
        </div>
      ) : marksLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : marksData.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No student marks found for this exam subject. Marks will appear here once students are enrolled.
        </div>
      ) : (
        <>
          {/* Save bar */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">{marksData.length} students</p>
            <div className="flex items-center gap-3">
              {saveMsg && (
                <span className={`text-sm ${saveMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{saveMsg}</span>
              )}
              <button
                onClick={handleSave}
                disabled={bulkSaveMut.isPending}
                className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >{bulkSaveMut.isPending ? 'Saving...' : 'Save All Marks'}</button>
            </div>
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-3 text-left w-12">#</th>
                  <th className="px-3 py-3 text-left">Roll No</th>
                  <th className="px-3 py-3 text-left">Student Name</th>
                  <th className="px-3 py-3 text-center w-28">Marks ({selectedSubject?.total_marks})</th>
                  <th className="px-3 py-3 text-center w-20">Absent</th>
                  <th className="px-3 py-3 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {marksData.map((m, idx) => {
                  const marks = parseFloat(m.marks_obtained)
                  const isPass = !m.is_absent && !isNaN(marks) && marks >= parseFloat(selectedSubject?.passing_marks || 0)
                  const isFail = !m.is_absent && !isNaN(marks) && marks < parseFloat(selectedSubject?.passing_marks || 0)
                  return (
                    <tr key={idx} className={`${m.is_absent ? 'bg-red-50/50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-1.5 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-1.5 text-sm font-mono text-gray-600">{m.student_roll}</td>
                      <td className="px-3 py-1.5 text-sm font-medium text-gray-900">{m.student_name}</td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="number"
                          min="0"
                          max={selectedSubject?.total_marks || 100}
                          step="0.01"
                          value={m.marks_obtained}
                          onChange={e => updateMark(idx, 'marks_obtained', e.target.value)}
                          disabled={m.is_absent}
                          className={`input text-sm py-1 w-24 text-center ${
                            m.is_absent ? 'bg-gray-100 text-gray-400' :
                            isPass ? 'border-green-300 bg-green-50' :
                            isFail ? 'border-red-300 bg-red-50' : ''
                          }`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={m.is_absent}
                          onChange={e => updateMark(idx, 'is_absent', e.target.checked)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={m.remarks}
                          onChange={e => updateMark(idx, 'remarks', e.target.value)}
                          className="input text-sm py-1 w-full"
                          placeholder="Optional..."
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {marksData.map((m, idx) => (
              <div key={idx} className={`card ${m.is_absent ? 'bg-red-50/30 border-red-200' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{m.student_name}</p>
                    <p className="text-xs text-gray-500">Roll: {m.student_roll}</p>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={m.is_absent} onChange={e => updateMark(idx, 'is_absent', e.target.checked)} className="rounded border-gray-300" />
                    Absent
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Marks (/{selectedSubject?.total_marks})</label>
                    <input
                      type="number" min="0" max={selectedSubject?.total_marks || 100}
                      value={m.marks_obtained} onChange={e => updateMark(idx, 'marks_obtained', e.target.value)}
                      disabled={m.is_absent} className="input text-sm py-1 w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Remarks</label>
                    <input type="text" value={m.remarks} onChange={e => updateMark(idx, 'remarks', e.target.value)} className="input text-sm py-1 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom save */}
          <div className="flex justify-end mt-4">
            <button onClick={handleSave} disabled={bulkSaveMut.isPending} className="btn-primary px-6 py-2 text-sm disabled:opacity-50">
              {bulkSaveMut.isPending ? 'Saving...' : 'Save All Marks'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
