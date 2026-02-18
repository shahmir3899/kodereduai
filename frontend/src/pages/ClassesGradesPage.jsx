import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { classesApi, schoolsApi } from '../services/api'
import { useToast } from '../components/Toast'
import SectionAllocator from './sessions/SectionAllocator'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../constants/gradePresets'

const SECTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

const EMPTY_CLASS = { name: '', section: '', grade_level: '' }

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
  const [expandedLevels, setExpandedLevels] = useState(new Set())

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

  const { data: classesRes, isLoading } = useQuery({
    queryKey: ['classes', selectedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: selectedSchoolId, page_size: 200 }),
    enabled: !!selectedSchoolId,
  })

  const classes = classesRes?.data?.results || classesRes?.data || []
  const schools = schoolsData?.data?.results || []

  // ─── Class Mutations ────────────────────────────────────────

  const createClassMut = useMutation({
    mutationFn: (data) => classesApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
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
      setDeleteConfirm(null)
      showSuccess('Class deleted!')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to delete class'),
  })

  // Quick-add sections for a grade level
  const quickAddSectionsMut = useMutation({
    mutationFn: async ({ level, sections }) => {
      const baseName = GRADE_LEVEL_LABELS[level] || `Level ${level}`
      const results = []
      for (const sec of sections) {
        try {
          const res = await classesApi.createClass({
            school: selectedSchoolId,
            name: baseName,
            section: sec,
            grade_level: level,
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

  // ─── Class Modal Helpers ────────────────────────────────────

  const openClassCreate = (presetLevel) => {
    setEditingClass(null)
    if (presetLevel !== undefined && presetLevel !== null) {
      const baseName = GRADE_LEVEL_LABELS[presetLevel] || ''
      setClassForm({ name: baseName, section: '', grade_level: presetLevel.toString() })
    } else {
      setClassForm(EMPTY_CLASS)
    }
    setShowClassModal(true)
  }

  const openClassEdit = (cls) => {
    setEditingClass(cls)
    setClassForm({
      name: cls.name,
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

  const handleGradeLevelChange = (levelStr) => {
    const level = parseInt(levelStr)
    setClassForm(prev => {
      const baseName = GRADE_LEVEL_LABELS[level] || ''
      const name = baseName || prev.name
      return { ...prev, grade_level: levelStr, name }
    })
  }

  const handleClassSectionChange = (section) => {
    setClassForm(prev => {
      const level = parseInt(prev.grade_level)
      const baseName = GRADE_LEVEL_LABELS[level]
      // Name stays as the base grade level name; section is stored separately
      const name = baseName || prev.name
      return { ...prev, section, name }
    })
  }

  const handleClassSubmit = () => {
    const data = {
      name: classForm.name,
      section: classForm.section || '',
      grade_level: classForm.grade_level ? parseInt(classForm.grade_level) : 0,
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

  const handleQuickAddSections = (level, count) => {
    const sectionLabels = SECTION_LABELS.slice(0, count)
    quickAddSectionsMut.mutate({ level, sections: sectionLabels })
  }

  // ─── Derived Data ───────────────────────────────────────────

  const isClassSubmitting = createClassMut.isPending || updateClassMut.isPending

  // Group classes by grade_level for the grouped view
  const classesByLevel = {}
  for (const cls of classes) {
    const level = cls.grade_level ?? -1
    if (!classesByLevel[level]) classesByLevel[level] = []
    classesByLevel[level].push(cls)
  }

  const sortedLevels = Object.keys(classesByLevel).map(Number).sort((a, b) => a - b)

  const toggleExpand = (level) => {
    setExpandedLevels(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Classes</h1>
          <p className="text-sm text-gray-600">Manage classes and sections</p>
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
      ) : classes.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No classes found. Use "Add Standard Classes" to get started or add classes manually.
        </div>
      ) : viewMode === 'grouped' ? (
        /* ───── By Grade Level View ───── */
        <div className="space-y-3">
          {sortedLevels.map(level => {
            const levelClasses = classesByLevel[level] || []
            const isExpanded = expandedLevels.has(level)
            const label = GRADE_LEVEL_LABELS[level] || `Level ${level}`

            return (
              <div key={level} className="card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(level)}>
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-700 font-bold text-sm">{level}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{label}</h3>
                      <p className="text-xs text-gray-500">
                        Level {level} · {levelClasses.length} section(s) · {levelClasses.reduce((sum, c) => sum + (c.student_count || 0), 0)} students
                      </p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openClassCreate(level)} className="text-xs text-sky-600 hover:underline">+ Class</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    {levelClasses.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                        {levelClasses.map(c => (
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
                      <p className="text-xs text-gray-400 mb-3">No classes at this level yet.</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">Quick add sections:</span>
                      {[1, 2, 3, 4, 5, 6].map(count => (
                        <button
                          key={count}
                          onClick={() => handleQuickAddSections(level, count)}
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
        </div>
      ) : (
        /* ───── Grid View ───── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map(cls => (
            <div key={cls.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{cls.name}</h3>
                  <p className="text-xs text-gray-500">
                    {GRADE_LEVEL_LABELS[cls.grade_level] || `Level ${cls.grade_level}`}
                    {cls.section ? ` / Section ${cls.section}` : ''}
                  </p>
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
                <div className="flex justify-between">
                  <span>Grade Level:</span>
                  <span className="font-medium text-gray-900">{cls.grade_level}</span>
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={() => openClassEdit(cls)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                <button onClick={() => handleDeleteClass(cls)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ))}

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
                <label className="label">Grade Level</label>
                <select className="input" value={classForm.grade_level} onChange={(e) => handleGradeLevelChange(e.target.value)}>
                  <option value="">-- Select grade level --</option>
                  {GRADE_PRESETS.map(p => (
                    <option key={p.numeric_level} value={p.numeric_level}>{p.name} (Level {p.numeric_level})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Section (Optional)</label>
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
                {classForm.grade_level && <p className="text-xs text-gray-400 mt-1">Auto-generated from grade level</p>}
              </div>
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
          queryClient.invalidateQueries({ queryKey: ['classes'] })
        }} />
      )}
    </div>
  )
}
