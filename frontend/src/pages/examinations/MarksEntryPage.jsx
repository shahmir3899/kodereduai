import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, classesApi } from '../../services/api'
import * as XLSX from 'xlsx'

export default function MarksEntryPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  // Selection state
  const [selectedExamId, setSelectedExamId] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

  // Marks grid state
  const [marksData, setMarksData] = useState([])
  const [saveMsg, setSaveMsg] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
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
    queryFn: () => examinationsApi.getExamSubjects({ exam: selectedExamId, page_size: 9999 }),
    enabled: !!selectedExamId,
  })

  const { data: marksRes, isLoading: marksLoading } = useQuery({
    queryKey: ['marks', selectedSubjectId],
    queryFn: () => examinationsApi.getMarks({ exam_subject: selectedSubjectId, page_size: 9999 }),
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

  // Download Excel template
  const handleDownloadTemplate = async () => {
    if (!selectedSubjectId) return
    setDownloading(true)
    try {
      const res = await examinationsApi.downloadMarksTemplate(selectedSubjectId)
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // Extract filename from Content-Disposition or use default
      const disposition = res.headers?.['content-disposition']
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/)
      link.download = filenameMatch?.[1] || `Marks_Template.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setSaveMsg('Error: Failed to download template')
      setTimeout(() => setSaveMsg(''), 3000)
    }
    setDownloading(false)
  }

  // Upload filled template
  const handleUploadTemplate = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-uploaded
    e.target.value = ''

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: 'binary' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        // Read all rows starting from row 5 (1-indexed in Excel = row 5)
        // Headers at row 4: Student ID, Roll Number, Student Name, Marks, Absent, Remarks
        const jsonData = XLSX.utils.sheet_to_json(sheet, { range: 3 })

        if (jsonData.length === 0) {
          setSaveMsg('Error: No data rows found in the uploaded file')
          setTimeout(() => setSaveMsg(''), 3000)
          return
        }

        // Map Excel columns to marksData format
        const headers = Object.keys(jsonData[0])
        // Find columns by index position (matching the template structure)
        const studentIdCol = headers[0]      // Student ID
        const rollCol = headers[1]           // Roll Number
        const nameCol = headers[2]           // Student Name
        const marksCol = headers[3]          // Marks
        const absentCol = headers[4]         // Absent (Y/N)
        const remarksCol = headers[5]        // Remarks

        const uploadedMarks = jsonData
          .filter(row => row[studentIdCol])   // Skip empty rows
          .map(row => {
            const absentVal = String(row[absentCol] || '').toUpperCase().trim()
            const isAbsent = absentVal === 'Y' || absentVal === 'YES'
            const marksVal = row[marksCol]
            return {
              student_id: parseInt(row[studentIdCol]),
              student_name: String(row[nameCol] || ''),
              student_roll: String(row[rollCol] || ''),
              marks_obtained: isAbsent ? '' : (marksVal !== undefined && marksVal !== null && marksVal !== '' ? String(marksVal) : ''),
              is_absent: isAbsent,
              remarks: String(row[remarksCol] || ''),
            }
          })

        if (uploadedMarks.length > 0) {
          // Merge with existing marksData (update by student_id, keep new entries)
          if (marksData.length > 0) {
            const uploadMap = new Map(uploadedMarks.map(m => [m.student_id, m]))
            setMarksData(prev => prev.map(existing => {
              const uploaded = uploadMap.get(existing.student_id)
              if (uploaded) {
                return {
                  ...existing,
                  marks_obtained: uploaded.marks_obtained,
                  is_absent: uploaded.is_absent,
                  remarks: uploaded.remarks || existing.remarks,
                }
              }
              return existing
            }))
          } else {
            setMarksData(uploadedMarks)
          }
          setSaveMsg(`Imported ${uploadedMarks.length} rows from Excel. Review and click "Save All Marks".`)
          setTimeout(() => setSaveMsg(''), 5000)
        }
      } catch {
        setSaveMsg('Error: Failed to parse the uploaded file. Make sure it is a valid Excel file.')
        setTimeout(() => setSaveMsg(''), 4000)
      }
    }
    reader.readAsBinaryString(file)
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
          <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center gap-4 text-xs text-gray-600">
            <span>Total Marks: <strong>{selectedSubject.total_marks}</strong></span>
            <span>Passing: <strong>{selectedSubject.passing_marks}</strong></span>
            {selectedSubject.exam_date && <span>Date: <strong>{selectedSubject.exam_date}</strong></span>}
            <div className="flex-1" />
            {/* Template Download/Upload buttons */}
            <button
              onClick={handleDownloadTemplate}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {downloading ? 'Downloading...' : 'Download Template'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload Filled Template
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUploadTemplate}
              className="hidden"
            />
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
          <p>No student marks found for this exam subject.</p>
          <p className="text-xs mt-2">You can download the template to fill marks in Excel, then upload it back.</p>
          <div className="flex justify-center gap-3 mt-4">
            <button
              onClick={handleDownloadTemplate}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {downloading ? 'Downloading...' : 'Download Template'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload Filled Template
            </button>
          </div>
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
