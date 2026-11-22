import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useClasses } from '../../hooks/useClasses'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { parseBulkStudents, buildBulkPayload, bulkErrorMessage, BULK_MAX_ROWS } from './bulkStudentParse'
import { importStudentsInBatches } from '../students/bulkImport'
import { downloadStudentsExcel, readStudentsFile } from '../students/studentExcel'
import { GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const EMPTY_STUDENT = { first_name: '', last_name: '', roll_number: '', class_obj: '', session_class_id: '', gender: '' }

export default function StudentsStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const { activeSchool } = useAuth()
  const [form, setForm] = useState(EMPTY_STUDENT)
  const [errors, setErrors] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [bulkSection, setBulkSection] = useState('')
  const [bulkProblems, setBulkProblems] = useState([])
  const [fileData, setFileData] = useState(null) // parsed upload, waiting for the user to confirm
  const [fileImporting, setFileImporting] = useState(false)
  const [fileProgress, setFileProgress] = useState(null)

  // Queries — shared with the other setup-wizard steps and the rest of the
  // app that read the same class list.
  const { classes } = useClasses(activeSchool?.id)

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 100 }),
  })
  const currentYear = (yearsRes?.data?.results || yearsRes?.data || []).find(y => y.is_current)

  const { data: studentsRes, isLoading } = useQuery({
    queryKey: ['students', filterClass, currentYear?.id],
    queryFn: () => studentsApi.getStudents({
      page_size: 200,
      ...(filterClass ? { class_obj: filterClass } : {}),
      ...(currentYear?.id ? { academic_year: currentYear.id } : {}),
    }),
    enabled: !!currentYear?.id,
  })
  const students = studentsRes?.data?.results || studentsRes?.data || []

  // Enrollment is per section; the backend only needs to be told which one when a class has several.
  const { sessionClasses } = useSessionClasses(currentYear?.id, activeSchool?.id)
  const sections = useMemo(
    () => sessionClasses.filter(sc => String(sc.class_obj) === String(filterClass)),
    [sessionClasses, filterClass],
  )
  const formSections = useMemo(
    () => sessionClasses.filter(sc => String(sc.class_obj) === String(form.class_obj)),
    [sessionClasses, form.class_obj],
  )

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => studentsApi.createStudent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      refetchCompletion()
      addToast('Student added!', 'success')
      // Keep class and section so a whole roster can be typed in without re-picking them.
      setForm(prev => ({ ...EMPTY_STUDENT, class_obj: prev.class_obj, session_class_id: prev.session_class_id }))
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (d && typeof d === 'object') {
        setErrors(d)
        // Errors on fields the form doesn't show (e.g. no current academic year) would otherwise vanish.
        const shown = ['first_name', 'class_obj', 'roll_number', 'session_class_id']
        if (!Object.keys(d).some(k => shown.includes(k))) addToast(bulkErrorMessage(d), 'error')
      } else {
        addToast(bulkErrorMessage(d), 'error')
      }
    },
  })

  const bulkCreateMut = useMutation({
    mutationFn: (data) => studentsApi.bulkCreateStudents(data),
    onSuccess: (res) => {
      const { created_count = 0, updated_count = 0, errors = [] } = res.data || {}
      queryClient.invalidateQueries({ queryKey: ['students'] })
      refetchCompletion()
      // A matching roll number overwrites that student, so say so rather than calling it "created".
      const parts = [`${created_count} added`]
      if (updated_count) parts.push(`${updated_count} updated (roll number already existed)`)
      addToast(parts.join(', '), errors.length ? 'warning' : 'success')
      if (errors.length) {
        setBulkProblems(errors.map(e => `Roll ${e.roll_number}: ${e.error}`))
        return // keep the form open so the failed lines can be fixed
      }
      setShowBulkForm(false)
      setBulkText('')
      setBulkProblems([])
    },
    onError: (err) => {
      addToast(bulkErrorMessage(err.response?.data), 'error')
    },
  })

  const handleCreate = () => {
    const e = {}
    if (!form.first_name.trim()) e.first_name = ['First name is required']
    if (!form.class_obj) e.class_obj = ['Class is required']
    if (!form.roll_number.trim()) e.roll_number = ['Roll number is required']
    if (formSections.length > 1 && !form.session_class_id) e.session_class_id = ['Select a section']
    if (Object.keys(e).length) { setErrors(e); return }
    // The API takes one `name`, the school, and (for a multi-section class) the section.
    createMut.mutate({
      school: activeSchool?.id,
      class_obj: parseInt(form.class_obj),
      ...(formSections.length > 1
        ? { session_class_id: parseInt(form.session_class_id) }
        : formSections[0] && { session_class_id: formSections[0].id }),
      name: `${form.first_name.trim()} ${form.last_name.trim()}`.trim(),
      roll_number: form.roll_number.trim(),
      ...(form.gender && { gender: form.gender }),
    })
  }

  const handleDownloadTemplate = async () => {
    try {
      await downloadStudentsExcel({
        schoolName: activeSchool?.name, classes, students: [], sessionClasses,
      })
    } catch {
      addToast('Could not create the template', 'error')
    }
  }

  // The file names each row's class/section itself, so it ignores the dropdowns above.
  const handleFilePicked = async (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    try {
      const { error, studentsByClass, issues } = await readStudentsFile(file, classes, sessionClasses)
      if (error) { addToast(error, 'error'); return }
      const total = Object.values(studentsByClass).flat().length
      if (total === 0) { addToast('No valid students found in file', 'error'); return }
      setFileData({ name: file.name, studentsByClass, total })
      setBulkProblems(issues)
    } catch {
      addToast('Could not read the file. Use the template (.xlsx) or a .csv with the same columns.', 'error')
    }
  }

  const fileTargetLabel = (key) => {
    const [classId, sectionId] = key.split(':')
    if (sectionId) {
      const sc = sessionClasses.find(s => String(s.id) === sectionId)
      return sc?.label || sc?.display_name || `Section ${sectionId}`
    }
    return classMap[classId]?.name || `Class ${classId}`
  }

  const handleFileImport = async () => {
    setFileImporting(true)
    setFileProgress(null)
    try {
      const result = await importStudentsInBatches({
        schoolId: activeSchool?.id,
        studentsByClass: fileData.studentsByClass,
        labelFor: fileTargetLabel,
        onProgress: setFileProgress,
      })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      refetchCompletion()
      const parts = [`${result.added} added`]
      if (result.updated) parts.push(`${result.updated} updated (roll number already existed)`)
      addToast(parts.join(', '), result.failedCount ? 'warning' : 'success')
      setBulkProblems(result.failures)
      if (result.failedCount) {
        // Keep only the failed rows so "Import" becomes a retry; saved rows are not resent.
        setFileData(prev => ({ ...prev, studentsByClass: result.failedRows, total: result.failedCount, retry: true }))
      } else {
        setFileData(null)
        setShowBulkForm(false)
      }
    } catch (err) {
      addToast(err.message || 'Import failed', 'error')
    } finally {
      setFileImporting(false)
      setFileProgress(null)
    }
  }

  const handleBulkCreate = () => {
    if (!filterClass) {
      addToast('Select a class first', 'error')
      return
    }
    if (sections.length > 1 && !bulkSection) {
      addToast('Select a section first', 'error')
      return
    }
    const { students: studentsList, problems } = parseBulkStudents(bulkText)
    setBulkProblems(problems)
    if (problems.length) return
    if (studentsList.length === 0) {
      addToast('Enter at least one student', 'error')
      return
    }
    bulkCreateMut.mutate(buildBulkPayload({
      schoolId: activeSchool?.id,
      classId: filterClass,
      sessionClassId: sections.length > 1 ? bulkSection : sections[0]?.id,
      students: studentsList,
    }))
  }

  // Group students by class
  const groupedByClass = useMemo(() => {
    const g = {}
    for (const s of students) {
      const key = s.class_obj || 'unassigned'
      if (!g[key]) g[key] = []
      g[key].push(s)
    }
    return g
  }, [students])

  const classMap = useMemo(() => Object.fromEntries(classes.map(c => [c.id, c])), [classes])

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Students</h2>
      <p className="text-sm text-gray-500 mb-6">
        Add students to your classes. You need at least 10 students.
        <span className="ml-2 text-gray-400">({students.length} found)</span>
      </p>

      {!currentYear && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-700">Please create an academic year first (Step 2) before adding students.</p>
        </div>
      )}

      {classes.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-700">Please create classes first (Step 3) before adding students.</p>
        </div>
      )}

      {classes.length > 0 && currentYear && (
        <>
          {/* Class Filter */}
          <div className="flex items-center gap-3 mb-4">
            <select
              className="input w-48"
              value={filterClass}
              onChange={e => { setFilterClass(e.target.value); setBulkSection('') }}
            >
              <option value="">All classes</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowForm(true); setShowBulkForm(false) }}
                className="text-sm text-sky-600 hover:text-sky-700"
              >
                + Add One
              </button>
              <button
                onClick={() => { setShowBulkForm(true); setShowForm(false) }}
                className="text-sm text-sky-600 hover:text-sky-700"
              >
                + Bulk Import
              </button>
            </div>
          </div>

          {/* Single Add Form */}
          {showForm && (
            <div className="bg-white rounded-xl border p-5 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Add Student</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.first_name}
                    onChange={e => { setForm(p => ({ ...p, first_name: e.target.value })); setErrors({}) }}
                  />
                  {errors.first_name && <p className="text-xs text-red-600 mt-1">{errors.first_name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input
                    type="text"
                    className="input"
                    value={form.last_name}
                    onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Class *</label>
                  <select
                    className="input"
                    value={form.class_obj}
                    onChange={e => setForm(p => ({ ...p, class_obj: e.target.value, session_class_id: '' }))}
                  >
                    <option value="">Select class</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>
                    ))}
                  </select>
                  {errors.class_obj && <p className="text-xs text-red-600 mt-1">{errors.class_obj[0]}</p>}
                </div>
                {formSections.length > 1 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Section *</label>
                    <select
                      className="input"
                      value={form.session_class_id}
                      onChange={e => setForm(p => ({ ...p, session_class_id: e.target.value }))}
                    >
                      <option value="">Select section</option>
                      {formSections.map(sc => (
                        <option key={sc.id} value={sc.id}>{sc.display_name || sc.section || sc.id}</option>
                      ))}
                    </select>
                    {errors.session_class_id && <p className="text-xs text-red-600 mt-1">{errors.session_class_id[0]}</p>}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Roll Number *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.roll_number}
                    onChange={e => setForm(p => ({ ...p, roll_number: e.target.value }))}
                  />
                  {errors.roll_number && <p className="text-xs text-red-600 mt-1">{errors.roll_number[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                  <select
                    className="input"
                    value={form.gender}
                    onChange={e => setForm(p => ({ ...p, gender: e.target.value }))}
                  >
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleCreate}
                  disabled={createMut.isPending}
                  className="btn-primary px-4 py-1.5 text-sm"
                >
                  {createMut.isPending ? 'Adding...' : 'Add Student'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Bulk Import Form */}
          {showBulkForm && (
            <div className="bg-white rounded-xl border p-5 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-1">Bulk Import</h3>

              {/* Upload a file (all classes at once) */}
              <div className="rounded-lg bg-gray-50 border border-dashed p-3 mb-4">
                <p className="text-xs text-gray-600 mb-2">
                  Have a spreadsheet? Download the template, fill in class, roll number and name, then browse for it here.
                  One file can cover every class.
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  A file can hold any number of students; it is sent to the server in batches of {BULK_MAX_ROWS}, so a
                  large file may take a moment. Keep this tab open until it finishes.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={handleDownloadTemplate} className="text-sm text-sky-600 hover:text-sky-700">
                    Download template
                  </button>
                  <label className="btn-primary px-3 py-1.5 text-sm cursor-pointer">
                    Browse file…
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFilePicked} />
                  </label>
                </div>
                {fileData && (
                  <div className="mt-3 text-xs text-gray-700">
                    <p className="font-medium">{fileData.name}: {fileData.total} students</p>
                    <ul className="list-disc pl-4 mt-1">
                      {Object.entries(fileData.studentsByClass).map(([key, rows]) => (
                        <li key={key}>{fileTargetLabel(key)}: {rows.length}</li>
                      ))}
                    </ul>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={handleFileImport}
                        disabled={fileImporting}
                        className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {fileImporting
                          ? `Importing… ${fileProgress ? `${fileProgress.done} of ${fileProgress.total}` : ''}`
                          : `${fileData.retry ? 'Retry' : 'Import'} ${fileData.total} students`}
                      </button>
                      <button type="button" onClick={() => { setFileData(null); setBulkProblems([]) }} className="text-sm text-gray-500 px-2">
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs font-medium text-gray-600 mb-1">Or paste into one class</p>
              <p className="text-xs text-gray-500 mb-3">
                Paste student data — one per line, <strong>maximum {BULK_MAX_ROWS} students at a time</strong> (for more, paste in several rounds or upload a file above): <code className="bg-gray-100 px-1 rounded">roll_number, name, parent_name, parent_phone</code> (last two optional).
                A roll number that already exists in the class updates that student.
              </p>
              {!filterClass && (
                <p className="text-xs text-amber-600 mb-2">Select a class from the dropdown above first.</p>
              )}
              {sections.length > 1 && (
                <select className="input w-48 mb-2" value={bulkSection} onChange={e => setBulkSection(e.target.value)}>
                  <option value="">Select section</option>
                  {sections.map(sc => (
                    <option key={sc.id} value={sc.id}>{sc.display_name || sc.section || sc.id}</option>
                  ))}
                </select>
              )}
              <textarea
                className="input w-full h-32 font-mono text-sm"
                placeholder={"1, Ahmed Khan\n2, Fatima Ali, Mr Ali, 03001234567\n3, Hassan Raza"}
                value={bulkText}
                onChange={e => { setBulkText(e.target.value); setBulkProblems([]) }}
              />
              {(() => {
                const count = bulkText.split('\n').filter(l => l.trim()).length
                if (count === 0) return null
                const over = count > BULK_MAX_ROWS
                return (
                  <p className={`text-xs mt-1 ${over ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {count} / {BULK_MAX_ROWS} students{over ? ` — remove ${count - BULK_MAX_ROWS} line(s) and import them in a second round.` : ''}
                  </p>
                )
              })()}
              {bulkProblems.length > 0 && (
                <ul className="text-xs text-red-600 mt-2 list-disc pl-4">
                  {bulkProblems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}
                  {bulkProblems.length > 8 && <li>…and {bulkProblems.length - 8} more</li>}
                </ul>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleBulkCreate}
                  disabled={bulkCreateMut.isPending || !filterClass}
                  className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
                >
                  {bulkCreateMut.isPending ? 'Importing...' : 'Import Students'}
                </button>
                <button onClick={() => setShowBulkForm(false)} className="text-sm text-gray-500 px-3 py-1.5">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Student List */}
          {students.length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Students ({students.length})</h3>
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Roll #</th>
                      <th className="py-2 pr-3">Class</th>
                      <th className="py-2">Gender</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.slice(0, 50).map(s => (
                      <tr key={s.id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3 text-gray-800">{s.first_name} {s.last_name}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{s.roll_number || '—'}</td>
                        <td className="py-1.5 pr-3 text-gray-500">
                          {classMap[s.class_obj]?.name || '—'}
                        </td>
                        <td className="py-1.5 text-gray-500">{s.gender || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {students.length > 50 && (
                  <p className="text-xs text-gray-400 mt-2">Showing 50 of {students.length} students</p>
                )}
              </div>
            </div>
          )}

          {students.length > 0 && students.length < 10 && (
            <p className="text-xs text-amber-600 mt-3">Add at least {10 - students.length} more student(s) to complete this step.</p>
          )}
        </>
      )}
    </div>
  )
}
