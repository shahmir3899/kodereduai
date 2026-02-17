import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { academicsApi, classesApi, hrApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useDebounce } from '../../hooks/useDebounce'

const SEVERITY_STYLES = {
  red: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: 'text-red-500' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', icon: 'text-orange-500' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700', icon: 'text-yellow-500' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: 'text-blue-500' },
}

const PRESET_SUBJECTS = [
  { name: 'Mathematics', code: 'MATH' },
  { name: 'English', code: 'ENG' },
  { name: 'Urdu', code: 'URDU' },
  { name: 'Islamiat', code: 'ISL' },
  { name: 'Pakistan Studies', code: 'PST' },
  { name: 'Science', code: 'SCI' },
  { name: 'Physics', code: 'PHY' },
  { name: 'Chemistry', code: 'CHEM' },
  { name: 'Biology', code: 'BIO' },
  { name: 'Computer Science', code: 'CS' },
  { name: 'Social Studies', code: 'SST' },
  { name: 'General Knowledge', code: 'GK' },
  { name: 'Art', code: 'ART' },
  { name: 'Physical Education', code: 'PE' },
]

// Auto-generate a subject code from name
function generateCode(name) {
  if (!name) return ''
  const KNOWN = {
    mathematics: 'MATH', english: 'ENG', urdu: 'URDU', islamiat: 'ISL',
    'pakistan studies': 'PST', science: 'SCI', physics: 'PHY', chemistry: 'CHEM',
    biology: 'BIO', 'computer science': 'CS', 'social studies': 'SST',
    'general knowledge': 'GK', art: 'ART', 'physical education': 'PE',
  }
  const known = KNOWN[name.toLowerCase().trim()]
  if (known) return known
  // Multi-word: take first letter of each word
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 4)
  // Single word: take first 3-4 chars
  return name.trim().toUpperCase().slice(0, 4)
}

const EMPTY_SUBJECT = { name: '', code: '', description: '', is_elective: false }
const EMPTY_ASSIGNMENT = { class_obj: '', subjects: [], teacher: '', periods_per_week: 1 }

export default function SubjectsPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const [tab, setTab] = useState('subjects')

  // Subject state
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [showSubjectModal, setShowSubjectModal] = useState(false)
  const [editSubjectId, setEditSubjectId] = useState(null)
  const [subjectForm, setSubjectForm] = useState(EMPTY_SUBJECT)
  const [subjectErrors, setSubjectErrors] = useState({})
  const [showQuickAdd, setShowQuickAdd] = useState(true)
  const [quickAddMsg, setQuickAddMsg] = useState('')
  const [quickAddingCode, setQuickAddingCode] = useState(null)

  // Assignment state
  const [classFilter, setClassFilter] = useState('')
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [editAssignId, setEditAssignId] = useState(null)
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGNMENT)
  const [assignErrors, setAssignErrors] = useState({})

  // Queries
  const { data: subjectRes, isLoading: subjectLoading } = useQuery({
    queryKey: ['subjects', debouncedSearch],
    queryFn: () => academicsApi.getSubjects({ search: debouncedSearch || undefined, page_size: 9999 }),
  })

  const { data: assignRes, isLoading: assignLoading } = useQuery({
    queryKey: ['classSubjects', classFilter, activeAcademicYear?.id],
    queryFn: () => academicsApi.getClassSubjects({
      class_obj: classFilter || undefined,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      page_size: 9999,
    }),
    enabled: tab === 'assignments',
  })

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })

  // AI Insights queries
  const { data: workloadRes, isLoading: workloadLoading } = useQuery({
    queryKey: ['workloadAnalysis'],
    queryFn: () => academicsApi.getWorkloadAnalysis(),
    enabled: tab === 'insights',
  })

  const { data: gapRes, isLoading: gapLoading } = useQuery({
    queryKey: ['gapAnalysis'],
    queryFn: () => academicsApi.getGapAnalysis(),
    enabled: tab === 'insights',
  })

  const subjects = subjectRes?.data?.results || subjectRes?.data || []
  const assignments = assignRes?.data?.results || assignRes?.data || []
  const classes = classesData?.data?.results || classesData?.data || []
  const staffList = staffData?.data?.results || staffData?.data || []
  const workloadData = workloadRes?.data || {}
  const gapData = gapRes?.data || {}

  // Set of existing subject codes for quick-add checks
  const existingCodes = useMemo(() => new Set(subjects.map(s => s.code.toUpperCase())), [subjects])

  // Collapsible sections for gap analysis
  const [expandedGap, setExpandedGap] = useState({ red: true, orange: true, yellow: true, blue: true })

  // Subject mutations
  const createSubjectMut = useMutation({
    mutationFn: (data) => academicsApi.createSubject(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['subjects'] }); closeSubjectModal() },
    onError: (err) => setSubjectErrors(err.response?.data || { detail: 'Failed to create subject' }),
  })

  const updateSubjectMut = useMutation({
    mutationFn: ({ id, data }) => academicsApi.updateSubject(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['subjects'] }); closeSubjectModal() },
    onError: (err) => setSubjectErrors(err.response?.data || { detail: 'Failed to update subject' }),
  })

  const deleteSubjectMut = useMutation({
    mutationFn: (id) => academicsApi.deleteSubject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  })

  // Bulk create mutation (for "Add All Remaining")
  const bulkCreateMut = useMutation({
    mutationFn: (data) => academicsApi.bulkCreateSubjects(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      const { created, skipped } = res.data
      setQuickAddMsg(`${created} subjects added${skipped ? `, ${skipped} already existed` : ''}`)
      setTimeout(() => setQuickAddMsg(''), 3000)
    },
    onError: () => {
      setQuickAddMsg('Failed to create subjects')
      setTimeout(() => setQuickAddMsg(''), 3000)
    },
  })

  // Assignment mutations
  const createAssignMut = useMutation({
    mutationFn: (data) => academicsApi.bulkAssignSubjects(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classSubjects'] })
      const d = res.data
      if (d.skipped_count > 0) {
        setAssignErrors({ detail: `${d.created_count} assigned, ${d.skipped_count} skipped (already assigned): ${d.skipped_subjects.join(', ')}` })
        if (d.created_count > 0) setTimeout(closeAssignModal, 2000)
      } else {
        closeAssignModal()
      }
    },
    onError: (err) => setAssignErrors(err.response?.data || { detail: 'Failed to create assignment' }),
  })

  const updateAssignMut = useMutation({
    mutationFn: ({ id, data }) => academicsApi.updateClassSubject(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['classSubjects'] }); closeAssignModal() },
    onError: (err) => setAssignErrors(err.response?.data || { detail: 'Failed to update assignment' }),
  })

  const deleteAssignMut = useMutation({
    mutationFn: (id) => academicsApi.deleteClassSubject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classSubjects'] }),
  })

  // Subject modal helpers
  const openCreateSubject = () => { setSubjectForm(EMPTY_SUBJECT); setEditSubjectId(null); setSubjectErrors({}); setShowSubjectModal(true) }
  const openEditSubject = (s) => {
    setSubjectForm({ name: s.name, code: s.code, description: s.description || '', is_elective: s.is_elective })
    setEditSubjectId(s.id); setSubjectErrors({}); setShowSubjectModal(true)
  }
  const closeSubjectModal = () => { setShowSubjectModal(false); setEditSubjectId(null); setSubjectForm(EMPTY_SUBJECT); setSubjectErrors({}) }

  // Auto-generate code when name changes (only for new subjects)
  const handleNameChange = (name) => {
    if (editSubjectId) {
      setSubjectForm(p => ({ ...p, name }))
    } else {
      const code = generateCode(name)
      setSubjectForm(p => ({ ...p, name, code }))
    }
  }

  const handleSubjectSubmit = (e) => {
    e.preventDefault()
    const payload = { ...subjectForm, code: subjectForm.code.toUpperCase() }
    if (editSubjectId) updateSubjectMut.mutate({ id: editSubjectId, data: payload })
    else createSubjectMut.mutate(payload)
  }

  // Quick add single preset
  const handleQuickAdd = (preset) => {
    if (existingCodes.has(preset.code)) return
    setQuickAddingCode(preset.code)
    createSubjectMut.mutate(
      { name: preset.name, code: preset.code, description: '', is_elective: false },
      { onSettled: () => setQuickAddingCode(null) },
    )
  }

  // Quick add all remaining presets
  const handleAddAllRemaining = () => {
    const remaining = PRESET_SUBJECTS.filter(p => !existingCodes.has(p.code))
    if (remaining.length === 0) return
    bulkCreateMut.mutate({
      subjects: remaining.map(p => ({ name: p.name, code: p.code, is_elective: false })),
    })
  }

  const remainingPresets = PRESET_SUBJECTS.filter(p => !existingCodes.has(p.code))

  // Assignment modal helpers
  const openCreateAssign = () => { setAssignForm(EMPTY_ASSIGNMENT); setEditAssignId(null); setAssignErrors({}); setShowAssignModal(true) }
  const openEditAssign = (a) => {
    setAssignForm({
      class_obj: a.class_obj, subjects: [a.subject],
      teacher: a.teacher || '', periods_per_week: a.periods_per_week,
    })
    setEditAssignId(a.id); setAssignErrors({}); setShowAssignModal(true)
  }
  const closeAssignModal = () => { setShowAssignModal(false); setEditAssignId(null); setAssignForm(EMPTY_ASSIGNMENT); setAssignErrors({}) }

  const handleAssignSubmit = (e) => {
    e.preventDefault()
    if (editAssignId) {
      const payload = {
        class_obj: assignForm.class_obj,
        subject: assignForm.subjects[0],
        teacher: assignForm.teacher || null,
        periods_per_week: parseInt(assignForm.periods_per_week) || 1,
      }
      updateAssignMut.mutate({ id: editAssignId, data: payload })
    } else {
      if (assignForm.subjects.length === 0) {
        setAssignErrors({ detail: 'Please select at least one subject.' })
        return
      }
      const payload = {
        class_obj: assignForm.class_obj,
        subjects: assignForm.subjects,
        teacher: assignForm.teacher || null,
        periods_per_week: parseInt(assignForm.periods_per_week) || 1,
      }
      createAssignMut.mutate(payload)
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Subjects</h1>
          <p className="text-sm text-gray-600">Manage subjects and class assignments</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('subjects')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'subjects' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Subjects
        </button>
        <button
          onClick={() => setTab('assignments')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'assignments' ? 'bg-white shadow text-primary-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          Class Assignments
        </button>
        <button
          onClick={() => setTab('insights')}
          className={`px-4 py-2 text-sm rounded-md transition-colors ${tab === 'insights' ? 'bg-white shadow text-indigo-700 font-medium' : 'text-gray-600 hover:text-gray-800'}`}
        >
          AI Insights
        </button>
      </div>

      {/* ─── Subjects Tab ─── */}
      {tab === 'subjects' && (
        <>
          {/* Quick Add Section */}
          <div className="card mb-4">
            <button
              onClick={() => setShowQuickAdd(p => !p)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm font-semibold text-gray-900">Quick Add Subjects</span>
                <span className="text-xs text-gray-500">Pakistan Curriculum</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showQuickAdd ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showQuickAdd && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_SUBJECTS.map(p => {
                    const exists = existingCodes.has(p.code)
                    const isAdding = quickAddingCode === p.code
                    return (
                      <button
                        key={p.code}
                        onClick={() => handleQuickAdd(p)}
                        disabled={exists || createSubjectMut.isPending}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          exists
                            ? 'bg-green-50 text-green-600 border border-green-200 cursor-default'
                            : isAdding
                              ? 'bg-primary-100 text-primary-700 border border-primary-300 cursor-wait'
                              : 'bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 cursor-pointer'
                        }`}
                      >
                        {isAdding ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : exists ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                        <span className="font-mono text-[10px] opacity-70">{p.code}</span>
                        {p.name}
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center gap-3">
                  {remainingPresets.length > 0 && (
                    <button
                      onClick={handleAddAllRemaining}
                      disabled={bulkCreateMut.isPending}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline disabled:opacity-50"
                    >
                      {bulkCreateMut.isPending ? 'Adding...' : `+ Add All Remaining (${remainingPresets.length})`}
                    </button>
                  )}
                  {remainingPresets.length === 0 && (
                    <span className="text-xs text-green-600 font-medium">All preset subjects have been added</span>
                  )}
                  {quickAddMsg && (
                    <span className={`text-xs ${quickAddMsg.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>{quickAddMsg}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              placeholder="Search subjects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input w-full sm:w-60"
            />
            <button onClick={openCreateSubject} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              + Add Subject
            </button>
          </div>

          {subjectLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : subjects.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No subjects found. Create one to get started.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {subjects.map(s => (
                <div key={s.id} className="card">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="inline-block px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-mono font-bold mr-2">
                        {s.code}
                      </span>
                      {s.is_elective && (
                        <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          Elective
                        </span>
                      )}
                    </div>
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm">{s.name}</h3>
                  {s.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
                    <button onClick={() => openEditSubject(s)} className="text-xs text-primary-600 hover:underline">Edit</button>
                    <button
                      onClick={() => { if (confirm(`Delete subject "${s.name}"?`)) deleteSubjectMut.mutate(s.id) }}
                      className="text-xs text-red-600 hover:underline"
                    >Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Subject Modal */}
          {showSubjectModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeSubjectModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editSubjectId ? 'Edit Subject' : 'Add Subject'}</h2>
                  <button onClick={closeSubjectModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(subjectErrors.detail || subjectErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {subjectErrors.detail || subjectErrors.non_field_errors}
                  </div>
                )}

                <form onSubmit={handleSubjectSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject Name *</label>
                    <input
                      type="text"
                      value={subjectForm.name}
                      onChange={e => handleNameChange(e.target.value)}
                      className="input w-full"
                      required
                      placeholder="e.g. Mathematics"
                    />
                    {subjectErrors.name && <p className="text-xs text-red-600 mt-1">{subjectErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Code * <span className="text-xs text-gray-400 font-normal">(auto-generated, editable)</span></label>
                    <input
                      type="text"
                      value={subjectForm.code}
                      onChange={e => setSubjectForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                      className="input w-full font-mono"
                      required
                      maxLength={20}
                      placeholder="e.g. MATH"
                    />
                    {subjectErrors.code && <p className="text-xs text-red-600 mt-1">{subjectErrors.code}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      value={subjectForm.description}
                      onChange={e => setSubjectForm(p => ({ ...p, description: e.target.value }))}
                      className="input w-full"
                      rows={2}
                      placeholder="Optional description..."
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_elective"
                      checked={subjectForm.is_elective}
                      onChange={e => setSubjectForm(p => ({ ...p, is_elective: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="is_elective" className="text-sm text-gray-700">Elective subject</label>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeSubjectModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createSubjectMut.isPending || updateSubjectMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createSubjectMut.isPending || updateSubjectMut.isPending ? 'Saving...' : editSubjectId ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Class Assignments Tab ─── */}
      {tab === 'assignments' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <select
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              className="input w-full sm:w-52"
            >
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={openCreateAssign} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
              + Assign Subject
            </button>
          </div>

          {assignLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : assignments.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No class-subject assignments found.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Class</th>
                      <th className="px-4 py-3 text-left">Subject</th>
                      <th className="px-4 py-3 text-left">Teacher</th>
                      <th className="px-4 py-3 text-center">Periods/Week</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {assignments.map(a => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{a.class_name}</td>
                        <td className="px-4 py-2 text-sm">
                          <span className="inline-block px-1.5 py-0.5 bg-primary-50 text-primary-700 rounded text-xs font-mono mr-1">{a.subject_code}</span>
                          {a.subject_name}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">{a.teacher_name || <span className="text-gray-400 italic">Unassigned</span>}</td>
                        <td className="px-4 py-2 text-sm text-center">{a.periods_per_week}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => openEditAssign(a)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          <button
                            onClick={() => { if (confirm('Remove this assignment?')) deleteAssignMut.mutate(a.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {assignments.map(a => (
                  <div key={a.id} className="card">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{a.class_name}</p>
                        <p className="text-xs text-gray-600">
                          <span className="font-mono text-primary-700">{a.subject_code}</span> {a.subject_name}
                        </p>
                      </div>
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{a.periods_per_week}x/wk</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">Teacher: {a.teacher_name || 'Unassigned'}</p>
                    <div className="flex gap-2">
                      <button onClick={() => openEditAssign(a)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      <button onClick={() => { if (confirm('Remove?')) deleteAssignMut.mutate(a.id) }} className="text-xs text-red-600 hover:underline">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Assignment Modal */}
          {showAssignModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeAssignModal}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">{editAssignId ? 'Edit Assignment' : 'Assign Subject to Class'}</h2>
                  <button onClick={closeAssignModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                </div>

                {(assignErrors.detail || assignErrors.non_field_errors) && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {typeof assignErrors.detail === 'string' ? assignErrors.detail : assignErrors.non_field_errors || JSON.stringify(assignErrors.detail)}
                  </div>
                )}

                <form onSubmit={handleAssignSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
                    <select
                      value={assignForm.class_obj}
                      onChange={e => setAssignForm(p => ({ ...p, class_obj: e.target.value }))}
                      className="input w-full"
                      required
                    >
                      <option value="">Select class...</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {editAssignId ? 'Subject *' : 'Subjects *'}
                    </label>
                    {editAssignId ? (
                      <select
                        value={assignForm.subjects[0] || ''}
                        onChange={e => setAssignForm(p => ({ ...p, subjects: [e.target.value] }))}
                        className="input w-full"
                        required
                      >
                        <option value="">Select subject...</option>
                        {subjects.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
                      </select>
                    ) : (
                      <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                        {subjects.length === 0 && <p className="text-sm text-gray-400 p-1">No subjects available</p>}
                        {subjects.map(s => (
                          <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={assignForm.subjects.includes(s.id)}
                              onChange={e => {
                                setAssignForm(p => ({
                                  ...p,
                                  subjects: e.target.checked
                                    ? [...p.subjects, s.id]
                                    : p.subjects.filter(id => id !== s.id),
                                }))
                              }}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{s.code} - {s.name}</span>
                          </label>
                        ))}
                        {subjects.length > 0 && (
                          <div className="flex gap-2 pt-1 border-t mt-1">
                            <button type="button" onClick={() => setAssignForm(p => ({ ...p, subjects: subjects.map(s => s.id) }))} className="text-xs text-blue-600 hover:underline">Select All</button>
                            <button type="button" onClick={() => setAssignForm(p => ({ ...p, subjects: [] }))} className="text-xs text-gray-500 hover:underline">Clear</button>
                          </div>
                        )}
                      </div>
                    )}
                    {!editAssignId && assignForm.subjects.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">{assignForm.subjects.length} subject{assignForm.subjects.length > 1 ? 's' : ''} selected</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Teacher</label>
                    <select
                      value={assignForm.teacher}
                      onChange={e => setAssignForm(p => ({ ...p, teacher: e.target.value }))}
                      className="input w-full"
                    >
                      <option value="">Unassigned</option>
                      {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Periods per Week</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={assignForm.periods_per_week}
                      onChange={e => setAssignForm(p => ({ ...p, periods_per_week: e.target.value }))}
                      className="input w-24"
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={closeAssignModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                    <button type="submit" disabled={createAssignMut.isPending || updateAssignMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                      {createAssignMut.isPending || updateAssignMut.isPending ? 'Saving...' : editAssignId ? 'Update' : `Assign${assignForm.subjects.length > 1 ? ` (${assignForm.subjects.length})` : ''}`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── AI Insights Tab ─── */}
      {tab === 'insights' && (
        <>
          {(workloadLoading || gapLoading) ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div>
              <p className="text-sm text-gray-500">Analyzing academic data...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Left: Workload Analysis */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <h2 className="text-lg font-semibold text-gray-900">Teacher Workload</h2>
                </div>

                {(!workloadData.teachers || workloadData.teachers.length === 0) ? (
                  <div className="card text-center py-8 text-gray-500 text-sm">
                    No teacher assignments found. Assign teachers to subjects first.
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="px-3 py-2.5 text-left">Teacher</th>
                            <th className="px-3 py-2.5 text-center">Assigned</th>
                            <th className="px-3 py-2.5 text-center">Timetabled</th>
                            <th className="px-3 py-2.5 text-center">Max/Day</th>
                            <th className="px-3 py-2.5 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {workloadData.teachers.map((t, i) => {
                            const maxDay = t.periods_per_day ? Math.max(...Object.values(t.periods_per_day), 0) : 0
                            return (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-sm">
                                  <p className="font-medium text-gray-900">{t.teacher_name}</p>
                                  <p className="text-xs text-gray-500">{t.subjects_taught} subjects · {t.classes_taught} classes</p>
                                </td>
                                <td className="px-3 py-2 text-sm text-center">{t.assigned_periods_week}/wk</td>
                                <td className="px-3 py-2 text-sm text-center">{t.timetabled_periods_week}/wk</td>
                                <td className="px-3 py-2 text-sm text-center">{maxDay}</td>
                                <td className="px-3 py-2 text-center">
                                  {t.overloaded ? (
                                    <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">Overloaded</span>
                                  ) : t.underloaded ? (
                                    <span className="inline-block px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">Underloaded</span>
                                  ) : (
                                    <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">Balanced</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-2">
                      {workloadData.teachers.map((t, i) => {
                        const maxDay = t.periods_per_day ? Math.max(...Object.values(t.periods_per_day), 0) : 0
                        return (
                          <div key={i} className="card">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{t.teacher_name}</p>
                                <p className="text-xs text-gray-500">{t.subjects_taught} subjects · {t.classes_taught} classes</p>
                              </div>
                              {t.overloaded ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">Overloaded</span>
                              ) : t.underloaded ? (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs">Underloaded</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Balanced</span>
                              )}
                            </div>
                            <div className="flex gap-4 mt-2 text-xs text-gray-600">
                              <span>Assigned: {t.assigned_periods_week}/wk</span>
                              <span>Timetabled: {t.timetabled_periods_week}/wk</span>
                              <span>Max/Day: {maxDay}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Redistribution Suggestions */}
                    {workloadData.redistribution_suggestions?.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">Redistribution Suggestions</h3>
                        <div className="space-y-2">
                          {workloadData.redistribution_suggestions.map((s, i) => (
                            <div key={i} className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-800">
                              <span className="font-medium">{s.subject_name}</span> in <span className="font-medium">{s.class_name}</span>:
                              Move from <span className="text-red-600 font-medium">{s.from_teacher}</span> ({s.from_load} periods)
                              → <span className="text-green-600 font-medium">{s.to_teacher}</span> ({s.to_load} periods)
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right: Gap Analysis */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <h2 className="text-lg font-semibold text-gray-900">Curriculum Gap Analysis</h2>
                </div>

                {[
                  { key: 'red', title: 'Missing Required Subjects', items: gapData.missing_required_subjects || [], desc: (it) => `${it.class_name} is missing ${it.subject_name} (${it.subject_code})` },
                  { key: 'orange', title: 'Unmet Period Requirements', items: gapData.unmet_periods || [], desc: (it) => `${it.class_name} — ${it.subject_name}: ${it.actual} of ${it.required} periods scheduled` },
                  { key: 'yellow', title: 'Unassigned Teachers', items: gapData.unassigned_teachers || [], desc: (it) => `${it.class_name} — ${it.subject_name}: No teacher assigned` },
                  { key: 'blue', title: 'Qualification Concerns', items: gapData.qualification_mismatches || [], desc: (it) => `${it.teacher_name} teaches ${it.subject_name} in ${it.class_name} — no matching qualification found` },
                ].map(({ key, title, items, desc }) => {
                  const style = SEVERITY_STYLES[key]
                  return (
                    <div key={key} className={`mb-3 rounded-lg border ${style.border} overflow-hidden`}>
                      <button
                        onClick={() => setExpandedGap(p => ({ ...p, [key]: !p[key] }))}
                        className={`w-full flex items-center justify-between px-4 py-2.5 ${style.bg} text-left`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${style.badge.split(' ')[0]}`}></span>
                          <span className="text-sm font-medium text-gray-900">{title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${style.badge}`}>{items.length}</span>
                        </div>
                        <svg className={`w-4 h-4 text-gray-500 transition-transform ${expandedGap[key] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expandedGap[key] && (
                        <div className="px-4 py-2 bg-white">
                          {items.length === 0 ? (
                            <p className="text-xs text-gray-400 py-1">No issues found</p>
                          ) : (
                            <ul className="space-y-1">
                              {items.map((it, i) => (
                                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5 py-0.5">
                                  <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.badge.split(' ')[0]}`}></span>
                                  {desc(it)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
