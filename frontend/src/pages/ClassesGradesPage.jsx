import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { classesApi, schoolsApi, gradesApi } from '../services/api'
import { useToast } from '../components/Toast'
import SectionAllocator from './sessions/SectionAllocator'

// Standard presets for Pakistani schools
const GRADE_PRESETS = [
  { name: 'Playgroup', numeric_level: 0 },
  { name: 'Nursery', numeric_level: 1 },
  { name: 'Prep', numeric_level: 2 },
  { name: 'Class 1', numeric_level: 3 },
  { name: 'Class 2', numeric_level: 4 },
  { name: 'Class 3', numeric_level: 5 },
  { name: 'Class 4', numeric_level: 6 },
  { name: 'Class 5', numeric_level: 7 },
  { name: 'Class 6', numeric_level: 8 },
  { name: 'Class 7', numeric_level: 9 },
  { name: 'Class 8', numeric_level: 10 },
  { name: 'Class 9', numeric_level: 11 },
  { name: 'Class 10', numeric_level: 12 },
]

const SECTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

const EMPTY_GRADE = { name: '', numeric_level: '' }
const EMPTY_CLASS = { name: '', grade: '', section: '', grade_level: '' }

export default function ClassesGradesPage() {
  const { user, activeSchool } = useAuth()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const showError = (msg) => addToast(msg, 'error')
  const showSuccess = (msg) => addToast(msg, 'success')
  const isSuperAdmin = user?.is_super_admin

  // School selection (super admin can switch; regular users always use activeSchool)
  const [selectedSchoolId, setSelectedSchoolId] = useState(activeSchool?.id || null)

  // Sync selectedSchoolId when activeSchool becomes available (non-super-admin)
  useEffect(() => {
    if (!isSuperAdmin && activeSchool?.id) {
      setSelectedSchoolId(activeSchool.id)
    }
  }, [activeSchool?.id, isSuperAdmin])

  // View state
  const [viewMode, setViewMode] = useState('grouped') // 'grouped' or 'grid'
  const [expandedGradeIds, setExpandedGradeIds] = useState(new Set())

  // Grade modal state
  const [showGradeModal, setShowGradeModal] = useState(false)
  const [editingGrade, setEditingGrade] = useState(null)
  const [gradeForm, setGradeForm] = useState(EMPTY_GRADE)
  const [gradeErrors, setGradeErrors] = useState({})

  // Class modal state
  const [showClassModal, setShowClassModal] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
  const [classForm, setClassForm] = useState(EMPTY_CLASS)

  // Delete confirm & section allocator
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showAllocator, setShowAllocator] = useState(false)

  // ─── Queries ────────────────────────────────────────────────

  const { data: schoolsData } = useQuery({
    queryKey: ['admin-schools'],
    queryFn: () => schoolsApi.getAdminSchools(),
    enabled: !!isSuperAdmin,
  })

  useEffect(() => {
    if (isSuperAdmin && schoolsData?.data?.results?.length > 0 && !selectedSchoolId) {
      setSelectedSchoolId(schoolsData.data.results[0].id)
    }
  }, [isSuperAdmin, schoolsData, selectedSchoolId])

  const { data: gradesRes, isLoading: gradesLoading } = useQuery({
    queryKey: ['grades'],
    queryFn: () => gradesApi.getGrades(),
  })

  const { data: classesRes, isLoading: classesLoading } = useQuery({
    queryKey: ['classes', selectedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: selectedSchoolId, page_size: 200 }),
    enabled: !!selectedSchoolId,
  })

  const grades = gradesRes?.data?.results || gradesRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []
  const schools = schoolsData?.data?.results || []
  const isLoading = gradesLoading || classesLoading

  // ─── Grade Mutations ────────────────────────────────────────

  const createGradeMut = useMutation({
    mutationFn: (data) => gradesApi.createGrade(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      closeGradeModal()
      showSuccess('Grade created!')
    },
    onError: (err) => setGradeErrors(err.response?.data || { detail: 'Failed to create' }),
  })

  const updateGradeMut = useMutation({
    mutationFn: ({ id, data }) => gradesApi.updateGrade(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      closeGradeModal()
      showSuccess('Grade updated!')
    },
    onError: (err) => setGradeErrors(err.response?.data || { detail: 'Failed to update' }),
  })

  const deleteGradeMut = useMutation({
    mutationFn: (id) => gradesApi.deleteGrade(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      showSuccess('Grade deleted!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete grade'),
  })

  // ─── Class Mutations ────────────────────────────────────────

  const createClassMut = useMutation({
    mutationFn: (data) => classesApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      closeClassModal()
      showSuccess('Class added!')
    },
    onError: (err) => {
      const msg = err.response?.data?.name?.[0] || err.response?.data?.detail || err.message || 'Failed to add class'
      showError(msg)
    },
  })

  const updateClassMut = useMutation({
    mutationFn: ({ id, data }) => classesApi.updateClass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      closeClassModal()
      showSuccess('Class updated!')
    },
    onError: (err) => {
      const msg = err.response?.data?.name?.[0] || err.response?.data?.detail || err.message || 'Failed to update class'
      showError(msg)
    },
  })

  const deleteClassMut = useMutation({
    mutationFn: (id) => classesApi.deleteClass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      setDeleteConfirm(null)
      showSuccess('Class deleted!')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to delete class'),
  })

  // Quick-add sections for a grade
  const quickAddSectionsMut = useMutation({
    mutationFn: async ({ grade, sections }) => {
      const results = []
      for (const sec of sections) {
        const name = grade.name + (sec ? `-${sec}` : '')
        try {
          const res = await classesApi.createClass({
            name,
            grade: grade.id,
            section: sec,
            grade_level: grade.numeric_level,
          })
          results.push(res.data)
        } catch (err) {
          if (!err.response?.data?.name?.[0]?.includes('already exists')) throw err
        }
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      showSuccess('Sections added!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to add sections'),
  })

  // Add standard classes (bulk)
  const addStandardMut = useMutation({
    mutationFn: async () => {
      const existingNames = classes.map(c => c.name.toLowerCase())
      const toAdd = GRADE_PRESETS.filter(p => !existingNames.includes(p.name.toLowerCase()))
      for (const cls of toAdd) {
        await classesApi.createClass({
          school: selectedSchoolId,
          name: cls.name,
          grade_level: cls.numeric_level,
        })
      }
      return toAdd.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      showSuccess(`Added ${count} standard classes!`)
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to add standard classes'),
  })

  // ─── Grade Modal Helpers ────────────────────────────────────

  const openGradeCreate = () => {
    setGradeForm(EMPTY_GRADE)
    setEditingGrade(null)
    setGradeErrors({})
    setShowGradeModal(true)
  }

  const openGradeEdit = (g) => {
    setGradeForm({ name: g.name, numeric_level: g.numeric_level })
    setEditingGrade(g)
    setGradeErrors({})
    setShowGradeModal(true)
  }

  const closeGradeModal = () => {
    setShowGradeModal(false)
    setEditingGrade(null)
    setGradeForm(EMPTY_GRADE)
    setGradeErrors({})
  }

  const handleGradeSubmit = (e) => {
    e.preventDefault()
    const payload = { ...gradeForm, numeric_level: parseInt(gradeForm.numeric_level) }
    if (editingGrade) updateGradeMut.mutate({ id: editingGrade.id, data: payload })
    else createGradeMut.mutate(payload)
  }

  const applyGradePreset = (preset) => {
    setGradeForm({ name: preset.name, numeric_level: preset.numeric_level })
  }

  const handleQuickAddSections = (grade, count) => {
    const sectionLabels = SECTION_LABELS.slice(0, count)
    quickAddSectionsMut.mutate({ grade, sections: sectionLabels })
  }

  // ─── Class Modal Helpers ────────────────────────────────────

  const openClassCreate = (presetGrade) => {
    setEditingClass(null)
    setClassForm(presetGrade
      ? { name: presetGrade.name, grade: presetGrade.id.toString(), section: '', grade_level: presetGrade.numeric_level.toString() }
      : EMPTY_CLASS
    )
    setShowClassModal(true)
  }

  const openClassEdit = (cls) => {
    setEditingClass(cls)
    setClassForm({
      name: cls.name,
      grade: cls.grade?.toString() || '',
      section: cls.section || '',
      grade_level: cls.grade_level?.toString() || '',
    })
    setShowClassModal(true)
  }

  const closeClassModal = () => {
    setShowClassModal(false)
    setEditingClass(null)
    setClassForm(EMPTY_CLASS)
  }

  const handleClassGradeChange = (gradeId) => {
    const grade = grades.find(g => g.id === parseInt(gradeId))
    setClassForm(prev => {
      const section = prev.section
      const name = grade ? (grade.name + (section ? `-${section}` : '')) : prev.name
      return { ...prev, grade: gradeId, grade_level: grade ? grade.numeric_level.toString() : prev.grade_level, name }
    })
  }

  const handleClassSectionChange = (section) => {
    setClassForm(prev => {
      const grade = grades.find(g => g.id === parseInt(prev.grade))
      const name = grade ? (grade.name + (section ? `-${section}` : '')) : prev.name
      return { ...prev, section, name }
    })
  }

  const handleClassSubmit = () => {
    const data = {
      name: classForm.name,
      grade: classForm.grade ? parseInt(classForm.grade) : null,
      section: classForm.section || '',
      grade_level: classForm.grade_level ? parseInt(classForm.grade_level) : null,
    }
    if (editingClass) updateClassMut.mutate({ id: editingClass.id, data })
    else createClassMut.mutate({ school: selectedSchoolId, ...data })
  }

  const handleDeleteClass = (cls) => {
    if (cls.student_count > 0) {
      showError(`Cannot delete class with ${cls.student_count} students. Remove students first.`)
      return
    }
    setDeleteConfirm(cls)
  }

  // ─── Derived Data ───────────────────────────────────────────

  const existingLevels = new Set(grades.map(g => g.numeric_level))
  const isGradeSubmitting = createGradeMut.isPending || updateGradeMut.isPending
  const isClassSubmitting = createClassMut.isPending || updateClassMut.isPending

  // Group classes by grade for the grouped view
  const gradeMap = {}
  for (const g of grades) gradeMap[g.id] = g

  const classesByGrade = {}
  const ungroupedClasses = []
  for (const cls of classes) {
    if (cls.grade && gradeMap[cls.grade]) {
      if (!classesByGrade[cls.grade]) classesByGrade[cls.grade] = []
      classesByGrade[cls.grade].push(cls)
    } else {
      ungroupedClasses.push(cls)
    }
  }

  const toggleExpand = (id) => {
    setExpandedGradeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Classes & Grades</h1>
          <p className="text-sm text-gray-600">Manage grade levels, classes, and sections</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {classes.length > 0 && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'grouped' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >By Grade</button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >Grid</button>
            </div>
          )}
          <button onClick={() => setShowAllocator(true)} className="text-sm px-3 py-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg font-medium transition-colors">
            AI Allocator
          </button>
          {classes.length === 0 && selectedSchoolId && (
            <button
              onClick={() => addStandardMut.mutate()}
              disabled={addStandardMut.isPending}
              className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {addStandardMut.isPending ? 'Adding...' : 'Add Standard Classes'}
            </button>
          )}
          <button onClick={() => openClassCreate()} disabled={!selectedSchoolId} className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50">
            + Class
          </button>
        </div>
      </div>

      {/* Super Admin school selector */}
      {isSuperAdmin && (
        <div className="mb-6">
          <label className="label">Select School</label>
          <select
            className="input max-w-full sm:max-w-md"
            value={selectedSchoolId || ''}
            onChange={(e) => setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">-- Select a school --</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {!selectedSchoolId && (
        <div className="card text-center py-8 text-gray-500">
          {isSuperAdmin ? 'Please select a school to manage classes.' : 'No school assigned to your account.'}
        </div>
      )}

      {/* Main Content */}
      {selectedSchoolId && (isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
        </div>
      ) : grades.length === 0 && classes.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No grades or classes found. Add a grade or use "Add Standard Classes" to get started.
        </div>
      ) : viewMode === 'grouped' ? (
        /* ───── By Grade View ───── */
        <div className="space-y-3">
          {grades.map(g => {
            const gradeClasses = classesByGrade[g.id] || []
            const isExpanded = expandedGradeIds.has(g.id)

            return (
              <div key={g.id} className="card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(g.id)}>
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-700 font-bold text-sm">{g.numeric_level}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{g.name}</h3>
                      <p className="text-xs text-gray-500">
                        Level {g.numeric_level} · {gradeClasses.length} section(s) · {gradeClasses.reduce((sum, c) => sum + (c.student_count || 0), 0)} students
                      </p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openClassCreate(g)} className="text-xs text-sky-600 hover:underline">+ Class</button>
                    <button onClick={() => openGradeEdit(g)} className="text-xs text-primary-600 hover:underline">Edit</button>
                    <button
                      onClick={() => { if (confirm(`Delete grade "${g.name}"?`)) deleteGradeMut.mutate(g.id) }}
                      className="text-xs text-red-600 hover:underline"
                    >Delete</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    {gradeClasses.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                        {gradeClasses.map(c => (
                          <div key={c.id} className="px-3 py-2 bg-gray-50 rounded-lg group relative">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{c.name}</p>
                                {c.section && <p className="text-xs text-primary-600">Section {c.section}</p>}
                                <p className="text-xs text-gray-400">{c.student_count || 0} students</p>
                              </div>
                              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => openClassEdit(c)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                <button onClick={() => handleDeleteClass(c)} className="text-xs text-red-600 hover:underline">Del</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-3">No classes assigned to this grade yet.</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">Quick add sections:</span>
                      {[1, 2, 3, 4, 5, 6].map(count => (
                        <button
                          key={count}
                          onClick={() => handleQuickAddSections(g, count)}
                          disabled={quickAddSectionsMut.isPending}
                          className="px-2 py-1 text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 rounded transition-colors disabled:opacity-50"
                        >+{count}</button>
                      ))}
                      {quickAddSectionsMut.isPending && <span className="text-xs text-gray-400">Creating...</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Ungrouped classes */}
          {ungroupedClasses.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-500 font-bold text-sm">?</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Ungrouped</h3>
                  <p className="text-xs text-gray-500">{ungroupedClasses.length} class(es) not assigned to a grade</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {ungroupedClasses.map(c => (
                  <div key={c.id} className="px-3 py-2 bg-gray-50 rounded-lg group relative">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.student_count || 0} students</p>
                      </div>
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openClassEdit(c)} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => handleDeleteClass(c)} className="text-xs text-red-600 hover:underline">Del</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ───── Grid View ───── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map(cls => (
            <div key={cls.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{cls.name}</h3>
                  {cls.grade_name && (
                    <p className="text-xs text-gray-500">{cls.grade_name}{cls.section ? ` / Section ${cls.section}` : ''}</p>
                  )}
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  cls.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {cls.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-500">
                <div className="flex justify-between">
                  <span>Students:</span>
                  <span className="font-medium text-gray-900">{cls.student_count || 0}</span>
                </div>
                {cls.section && (
                  <div className="flex justify-between">
                    <span>Section:</span>
                    <span className="font-medium text-primary-700">{cls.section}</span>
                  </div>
                )}
                {cls.grade_level !== null && cls.grade_level !== undefined && (
                  <div className="flex justify-between">
                    <span>Grade Level:</span>
                    <span className="font-medium text-gray-900">{cls.grade_level}</span>
                  </div>
                )}
              </div>
              <div className="flex justify-end space-x-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={() => openClassEdit(cls)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                <button onClick={() => handleDeleteClass(cls)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* ───── Grade Modal ───── */}
      {showGradeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeGradeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editingGrade ? 'Edit Grade' : 'Add Grade'}</h2>
              <button onClick={closeGradeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(gradeErrors.detail || gradeErrors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {gradeErrors.detail || gradeErrors.non_field_errors}
              </div>
            )}

            {!editingGrade && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">Quick presets:</p>
                <div className="flex flex-wrap gap-1">
                  {GRADE_PRESETS.filter(p => !existingLevels.has(p.numeric_level)).map(p => (
                    <button
                      key={p.numeric_level}
                      onClick={() => applyGradePreset(p)}
                      className="px-2 py-1 text-xs bg-gray-100 hover:bg-primary-100 hover:text-primary-700 rounded transition-colors"
                    >{p.name}</button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleGradeSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grade Name *</label>
                <input
                  type="text"
                  value={gradeForm.name}
                  onChange={e => setGradeForm(p => ({ ...p, name: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="e.g. Class 5"
                />
                {gradeErrors.name && <p className="text-xs text-red-600 mt-1">{gradeErrors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Numeric Level *</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={gradeForm.numeric_level}
                  onChange={e => setGradeForm(p => ({ ...p, numeric_level: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="e.g. 7 for Class 5"
                />
                <p className="text-xs text-gray-400 mt-1">0=Playgroup, 1=Nursery, 2=Prep, 3=Class 1, etc.</p>
                {gradeErrors.numeric_level && <p className="text-xs text-red-600 mt-1">{gradeErrors.numeric_level}</p>}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeGradeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isGradeSubmitting} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {isGradeSubmitting ? 'Saving...' : editingGrade ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───── Class Modal ───── */}
      {showClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeClassModal}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editingClass ? 'Edit Class' : 'Add Class'}</h2>
              <button onClick={closeClassModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Grade</label>
                <select className="input" value={classForm.grade} onChange={(e) => handleClassGradeChange(e.target.value)}>
                  <option value="">-- No grade (standalone) --</option>
                  {grades.map(g => (
                    <option key={g.id} value={g.id}>{g.name} (Level {g.numeric_level})</option>
                  ))}
                </select>
              </div>

              {classForm.grade && (
                <div>
                  <label className="label">Section</label>
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {SECTION_LABELS.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleClassSectionChange(classForm.section === s ? '' : s)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          classForm.section === s
                            ? 'bg-primary-100 border-primary-300 text-primary-700 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >{s}</button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="input mt-1"
                    placeholder="Or type custom section..."
                    value={classForm.section}
                    onChange={(e) => handleClassSectionChange(e.target.value.toUpperCase())}
                    maxLength={10}
                  />
                </div>
              )}

              <div>
                <label className="label">Class Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Class 1-A, PlayGroup"
                  value={classForm.name}
                  onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                  required
                />
                {classForm.grade && <p className="text-xs text-gray-400 mt-1">Auto-generated from grade + section</p>}
              </div>

              {!classForm.grade && (
                <div>
                  <label className="label">Grade Level (Optional)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="e.g., 5"
                    value={classForm.grade_level}
                    onChange={(e) => setClassForm({ ...classForm, grade_level: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 mt-1">Used for sorting classes</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeClassModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleClassSubmit}
                disabled={isClassSubmitting || !classForm.name}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {isClassSubmitting ? 'Saving...' : (editingClass ? 'Save Changes' : 'Add Class')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Delete Confirmation ───── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete Class</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => deleteClassMut.mutate(deleteConfirm.id)}
                disabled={deleteClassMut.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteClassMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Section Allocator Modal ───── */}
      {showAllocator && (
        <SectionAllocator onClose={() => {
          setShowAllocator(false)
          queryClient.invalidateQueries({ queryKey: ['grades'] })
          queryClient.invalidateQueries({ queryKey: ['classes'] })
        }} />
      )}
    </div>
  )
}
