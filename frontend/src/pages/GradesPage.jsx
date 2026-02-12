import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { gradesApi, classesApi } from '../services/api'

const EMPTY_GRADE = { name: '', numeric_level: '' }

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

export default function GradesPage() {
  const queryClient = useQueryClient()

  // State
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_GRADE)
  const [errors, setErrors] = useState({})
  const [expandedGradeId, setExpandedGradeId] = useState(null)

  // Queries
  const { data: gradesRes, isLoading } = useQuery({
    queryKey: ['grades'],
    queryFn: () => gradesApi.getGrades(),
  })

  const { data: gradeClassesRes } = useQuery({
    queryKey: ['gradeClasses', expandedGradeId],
    queryFn: () => gradesApi.getGradeClasses(expandedGradeId),
    enabled: !!expandedGradeId,
  })

  const grades = gradesRes?.data?.results || gradesRes?.data || []
  const gradeClasses = gradeClassesRes?.data || []

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => gradesApi.createGrade(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['grades'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed to create' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => gradesApi.updateGrade(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['grades'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed to update' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => gradesApi.deleteGrade(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grades'] }),
  })

  // Modal helpers
  const openCreate = () => { setForm(EMPTY_GRADE); setEditId(null); setErrors({}); setShowModal(true) }
  const openEdit = (g) => {
    setForm({ name: g.name, numeric_level: g.numeric_level })
    setEditId(g.id); setErrors({}); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(EMPTY_GRADE); setErrors({}) }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { ...form, numeric_level: parseInt(form.numeric_level) }
    if (editId) updateMut.mutate({ id: editId, data: payload })
    else createMut.mutate(payload)
  }

  const applyPreset = (preset) => {
    setForm({ name: preset.name, numeric_level: preset.numeric_level })
  }

  const existingLevels = new Set(grades.map(g => g.numeric_level))

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Grades & Sections</h1>
          <p className="text-sm text-gray-600">Manage grade levels and view their class sections</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">+ Add Grade</button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : grades.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">No grades found. Create one to get started.</div>
      ) : (
        <div className="space-y-3">
          {grades.map(g => (
            <div key={g.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <span className="text-primary-700 font-bold text-sm">{g.numeric_level}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{g.name}</h3>
                    <p className="text-xs text-gray-500">
                      Level {g.numeric_level}
                      {g.class_count !== undefined && ` · ${g.class_count} section(s)`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpandedGradeId(expandedGradeId === g.id ? null : g.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >{expandedGradeId === g.id ? 'Hide Sections' : 'View Sections'}</button>
                  <button onClick={() => openEdit(g)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  <button
                    onClick={() => { if (confirm(`Delete grade "${g.name}"?`)) deleteMut.mutate(g.id) }}
                    className="text-xs text-red-600 hover:underline"
                  >Delete</button>
                </div>
              </div>

              {/* Expanded sections */}
              {expandedGradeId === g.id && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  {gradeClasses.length === 0 ? (
                    <p className="text-xs text-gray-400">No sections/classes assigned to this grade yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {gradeClasses.map(c => (
                        <div key={c.id} className="px-3 py-2 bg-gray-50 rounded-lg">
                          <p className="text-sm font-medium text-gray-900">{c.name}</p>
                          {c.section && (
                            <p className="text-xs text-gray-500">Section: {c.section}</p>
                          )}
                          <p className="text-xs text-gray-400">{c.student_count || 0} students</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? 'Edit Grade' : 'Add Grade'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            {/* Quick presets */}
            {!editId && (
              <div className="mb-4">
                <p className="text-xs text-gray-500 mb-2">Quick presets:</p>
                <div className="flex flex-wrap gap-1">
                  {GRADE_PRESETS.filter(p => !existingLevels.has(p.numeric_level)).map(p => (
                    <button
                      key={p.numeric_level}
                      onClick={() => applyPreset(p)}
                      className="px-2 py-1 text-xs bg-gray-100 hover:bg-primary-100 hover:text-primary-700 rounded transition-colors"
                    >{p.name}</button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grade Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="e.g. Class 5"
                />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Numeric Level *</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={form.numeric_level}
                  onChange={e => setForm(p => ({ ...p, numeric_level: e.target.value }))}
                  className="input w-full"
                  required
                  placeholder="e.g. 7 for Class 5"
                />
                <p className="text-xs text-gray-400 mt-1">0=Playgroup, 1=Nursery, 2=Prep, 3=Class1, etc.</p>
                {errors.numeric_level && <p className="text-xs text-red-600 mt-1">{errors.numeric_level}</p>}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {createMut.isPending || updateMut.isPending ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
