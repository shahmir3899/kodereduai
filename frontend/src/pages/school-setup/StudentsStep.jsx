import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, classesApi, sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const EMPTY_STUDENT = { first_name: '', last_name: '', roll_number: '', class_obj: '', gender: '' }

export default function StudentsStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [form, setForm] = useState(EMPTY_STUDENT)
  const [errors, setErrors] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [filterClass, setFilterClass] = useState('')

  // Queries
  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 200 }),
  })
  const classes = classesRes?.data?.results || classesRes?.data || []

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

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => studentsApi.createStudent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      refetchCompletion()
      addToast('Student added!', 'success')
      setForm(prev => ({ ...EMPTY_STUDENT, class_obj: prev.class_obj }))
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const bulkCreateMut = useMutation({
    mutationFn: (data) => studentsApi.bulkCreateStudents(data),
    onSuccess: (res) => {
      const count = res.data?.created_count || res.data?.length || 0
      queryClient.invalidateQueries({ queryKey: ['students'] })
      refetchCompletion()
      addToast(`${count} students created!`, 'success')
      setShowBulkForm(false)
      setBulkText('')
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || err.response?.data?.error || 'Bulk import failed', 'error')
    },
  })

  const handleCreate = () => {
    const e = {}
    if (!form.first_name.trim()) e.first_name = ['First name is required']
    if (!form.class_obj) e.class_obj = ['Class is required']
    if (Object.keys(e).length) { setErrors(e); return }
    createMut.mutate({
      ...form,
      academic_year: currentYear?.id,
    })
  }

  const handleBulkCreate = () => {
    if (!filterClass) {
      addToast('Select a class first', 'error')
      return
    }
    // Parse CSV: each line is "first_name,last_name,roll_number,gender"
    const lines = bulkText.trim().split('\n').filter(l => l.trim())
    if (lines.length === 0) {
      addToast('Enter at least one student', 'error')
      return
    }
    const studentsList = lines.map(line => {
      const parts = line.split(',').map(s => s.trim())
      return {
        first_name: parts[0] || '',
        last_name: parts[1] || '',
        roll_number: parts[2] || '',
        gender: parts[3] || '',
        class_obj: parseInt(filterClass),
        academic_year: currentYear?.id,
      }
    }).filter(s => s.first_name)

    bulkCreateMut.mutate({ students: studentsList, class_id: parseInt(filterClass) })
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
              onChange={e => setFilterClass(e.target.value)}
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
                    onChange={e => setForm(p => ({ ...p, class_obj: e.target.value }))}
                  >
                    <option value="">Select class</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>
                    ))}
                  </select>
                  {errors.class_obj && <p className="text-xs text-red-600 mt-1">{errors.class_obj[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Roll Number</label>
                  <input
                    type="text"
                    className="input"
                    value={form.roll_number}
                    onChange={e => setForm(p => ({ ...p, roll_number: e.target.value }))}
                  />
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
              <p className="text-xs text-gray-500 mb-3">
                Paste student data — one per line: <code className="bg-gray-100 px-1 rounded">first_name, last_name, roll_number, gender</code>
              </p>
              {!filterClass && (
                <p className="text-xs text-amber-600 mb-2">Select a class from the dropdown above first.</p>
              )}
              <textarea
                className="input w-full h-32 font-mono text-sm"
                placeholder={"Ahmed, Khan, 1, M\nFatima, Ali, 2, F\nHassan, Raza, 3, M"}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
              />
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
