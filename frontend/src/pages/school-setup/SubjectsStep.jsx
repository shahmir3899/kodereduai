import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { academicsApi, classesApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const COMMON_SUBJECTS = [
  'English', 'Urdu', 'Mathematics', 'Science', 'Social Studies',
  'Islamiat', 'Pakistan Studies', 'Computer Science', 'Physics',
  'Chemistry', 'Biology', 'Arts', 'Physical Education',
]

const EMPTY_SUBJECT = { name: '', code: '', description: '' }

export default function SubjectsStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [form, setForm] = useState(EMPTY_SUBJECT)
  const [errors, setErrors] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [selectedQuick, setSelectedQuick] = useState([])
  const [assignMode, setAssignMode] = useState(false)
  const [assignClassId, setAssignClassId] = useState('')
  const [assignSubjectIds, setAssignSubjectIds] = useState([])

  // Queries
  const { data: subjectsRes } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => academicsApi.getSubjects({ page_size: 200 }),
  })
  const subjects = subjectsRes?.data?.results || subjectsRes?.data || []

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 200 }),
  })
  const classes = classesRes?.data?.results || classesRes?.data || []

  const { data: classSubjectsRes } = useQuery({
    queryKey: ['classSubjects'],
    queryFn: () => academicsApi.getClassSubjects({ page_size: 500 }),
  })
  const classSubjects = classSubjectsRes?.data?.results || classSubjectsRes?.data || []

  // Count assignments per class
  const assignmentCounts = useMemo(() => {
    const counts = {}
    classSubjects.forEach(cs => {
      counts[cs.class_obj] = (counts[cs.class_obj] || 0) + 1
    })
    return counts
  }, [classSubjects])

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => academicsApi.createSubject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      refetchCompletion()
      addToast('Subject created!', 'success')
      setForm(EMPTY_SUBJECT)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const bulkCreateMut = useMutation({
    mutationFn: (data) => academicsApi.bulkCreateSubjects(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      refetchCompletion()
      const count = res.data?.created?.length || res.data?.length || selectedQuick.length
      addToast(`${count} subjects created!`, 'success')
      setSelectedQuick([])
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Failed', 'error')
    },
  })

  const bulkAssignMut = useMutation({
    mutationFn: (data) => academicsApi.bulkAssignSubjects(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classSubjects'] })
      refetchCompletion()
      addToast('Subjects assigned to class!', 'success')
      setAssignSubjectIds([])
      setAssignClassId('')
      setAssignMode(false)
    },
    onError: (err) => {
      addToast(err.response?.data?.detail || 'Assignment failed', 'error')
    },
  })

  const handleCreate = () => {
    const e = {}
    if (!form.name.trim()) e.name = ['Name is required']
    if (Object.keys(e).length) { setErrors(e); return }
    createMut.mutate(form)
  }

  const handleQuickCreate = () => {
    const toCreate = selectedQuick.filter(
      name => !subjects.find(s => s.name.toLowerCase() === name.toLowerCase())
    )
    if (toCreate.length === 0) {
      addToast('All selected subjects already exist', 'info')
      return
    }
    bulkCreateMut.mutate({ subjects: toCreate.map(name => ({ name, code: name.substring(0, 4).toUpperCase() })) })
  }

  const toggleQuick = (name) => {
    setSelectedQuick(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  const toggleAssignSubject = (id) => {
    setAssignSubjectIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Subjects</h2>
      <p className="text-sm text-gray-500 mb-6">
        Create subjects and assign them to classes. Need at least 3 subjects.
        <span className="ml-2 text-gray-400">({subjects.length} created)</span>
      </p>

      {/* Quick Add Subjects */}
      {subjects.length === 0 && (
        <div className="bg-sky-50 rounded-xl border border-sky-200 p-5 mb-6">
          <h3 className="text-sm font-medium text-sky-800 mb-2">Quick Add Common Subjects</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {COMMON_SUBJECTS.map(name => {
              const exists = subjects.find(s => s.name.toLowerCase() === name.toLowerCase())
              const selected = selectedQuick.includes(name)
              return (
                <button
                  key={name}
                  onClick={() => !exists && toggleQuick(name)}
                  disabled={exists}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    exists
                      ? 'bg-green-50 text-green-600 border-green-200 cursor-default'
                      : selected
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-sky-400'
                  }`}
                >
                  {exists ? '✓ ' : ''}{name}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleQuickCreate}
              disabled={selectedQuick.length === 0 || bulkCreateMut.isPending}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {bulkCreateMut.isPending ? 'Creating...' : `Create ${selectedQuick.length} Subjects`}
            </button>
            <button onClick={() => setShowForm(true)} className="text-sm text-gray-600 px-3 py-2">
              Or add manually
            </button>
          </div>
        </div>
      )}

      {/* Existing Subjects */}
      {subjects.length > 0 && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Subjects</h3>
            <div className="flex gap-2">
              <button onClick={() => setShowForm(true)} className="text-xs text-sky-600 hover:text-sky-700">+ Add Subject</button>
              {!assignMode && classes.length > 0 && (
                <button onClick={() => setAssignMode(true)} className="text-xs text-sky-600 hover:text-sky-700">Assign to Class</button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {subjects.map(s => (
              <span key={s.id} className="px-3 py-1.5 bg-gray-50 rounded-lg text-sm text-gray-700 border">
                {s.name}
                {s.code && <span className="text-xs text-gray-400 ml-1">({s.code})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Manual Add Form */}
      {showForm && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Add Subject</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject Name *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Mathematics"
                value={form.name}
                onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
              />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. MATH"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                type="text"
                className="input"
                placeholder="Optional"
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleCreate} disabled={createMut.isPending} className="btn-primary px-4 py-1.5 text-sm">
              {createMut.isPending ? 'Adding...' : 'Add Subject'}
            </button>
            <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Done</button>
          </div>
        </div>
      )}

      {/* Assign to Class */}
      {assignMode && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Assign Subjects to Class</h3>
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Select Class</label>
            <select
              className="input w-48"
              value={assignClassId}
              onChange={e => setAssignClassId(e.target.value)}
            >
              <option value="">Select class</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.section ? ` ${c.section}` : ''} ({assignmentCounts[c.id] || 0} subjects)
                </option>
              ))}
            </select>
          </div>
          {assignClassId && (
            <>
              <p className="text-xs text-gray-500 mb-2">Select subjects to assign:</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {subjects.map(s => {
                  const selected = assignSubjectIds.includes(s.id)
                  const alreadyAssigned = classSubjects.some(
                    cs => cs.class_obj === parseInt(assignClassId) && cs.subject === s.id
                  )
                  return (
                    <button
                      key={s.id}
                      onClick={() => !alreadyAssigned && toggleAssignSubject(s.id)}
                      disabled={alreadyAssigned}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        alreadyAssigned
                          ? 'bg-green-50 text-green-600 border-green-200 cursor-default'
                          : selected
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-sky-400'
                      }`}
                    >
                      {alreadyAssigned ? '✓ ' : ''}{s.name}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => bulkAssignMut.mutate({
                    class_id: parseInt(assignClassId),
                    subject_ids: assignSubjectIds,
                  })}
                  disabled={assignSubjectIds.length === 0 || bulkAssignMut.isPending}
                  className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
                >
                  {bulkAssignMut.isPending ? 'Assigning...' : `Assign ${assignSubjectIds.length} Subjects`}
                </button>
                <button onClick={() => { setAssignMode(false); setAssignSubjectIds([]) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Class-Subject Summary */}
      {classSubjects.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Class-Subject Assignments</h3>
          <div className="space-y-1.5">
            {classes.map(c => {
              const count = assignmentCounts[c.id] || 0
              if (count === 0) return null
              return (
                <div key={c.id} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-700">{c.name}{c.section ? ` ${c.section}` : ''}</span>
                  <span className="text-xs text-gray-500">{count} subjects</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
