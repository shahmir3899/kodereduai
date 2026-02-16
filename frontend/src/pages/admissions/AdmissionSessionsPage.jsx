import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { admissionsApi, sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const EMPTY_SESSION = {
  name: '',
  academic_year: '',
  start_date: '',
  end_date: '',
  is_active: true,
  grade_levels_open: [],
}

export default function AdmissionSessionsPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_SESSION)
  const [formErrors, setFormErrors] = useState({})
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Admission sessions
  const { data: sessionsRes, isLoading } = useQuery({
    queryKey: ['admissionSessions'],
    queryFn: () => admissionsApi.getSessions({ page_size: 9999 }),
  })

  // Academic years for dropdown
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  const sessions = sessionsRes?.data?.results || sessionsRes?.data || []
  const years = yearsRes?.data?.results || yearsRes?.data || []

  // Create mutation
  const createMut = useMutation({
    mutationFn: (data) => admissionsApi.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissionSessions'] })
      closeModal()
      showSuccess('Admission session created successfully!')
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') setFormErrors(data)
      showError(data?.detail || data?.non_field_errors?.[0] || 'Failed to create session')
    },
  })

  // Update mutation
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => admissionsApi.updateSession(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissionSessions'] })
      closeModal()
      showSuccess('Admission session updated successfully!')
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') setFormErrors(data)
      showError(data?.detail || data?.non_field_errors?.[0] || 'Failed to update session')
    },
  })

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: (id) => admissionsApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissionSessions'] })
      setDeleteConfirm(null)
      showSuccess('Admission session deleted')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to delete session')
    },
  })

  // Toggle active
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }) => admissionsApi.updateSession(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissionSessions'] })
      showSuccess('Session status updated')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to update status')
    },
  })

  const openCreateModal = () => {
    setForm(EMPTY_SESSION)
    setEditId(null)
    setFormErrors({})
    setShowModal(true)
  }

  const openEditModal = (session) => {
    setForm({
      name: session.name || '',
      academic_year: session.academic_year ? String(session.academic_year) : '',
      start_date: session.start_date || '',
      end_date: session.end_date || '',
      is_active: session.is_active !== undefined ? session.is_active : true,
      grade_levels_open: session.grade_levels_open || [],
    })
    setEditId(session.id)
    setFormErrors({})
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditId(null)
    setForm(EMPTY_SESSION)
    setFormErrors({})
  }

  const handleGradeLevelToggle = (level) => {
    setForm((prev) => ({
      ...prev,
      grade_levels_open: prev.grade_levels_open.includes(level)
        ? prev.grade_levels_open.filter((l) => l !== level)
        : [...prev.grade_levels_open, level],
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setFormErrors({})

    // Validation
    if (!form.name.trim()) {
      setFormErrors({ name: 'Session name is required' })
      return
    }

    const payload = {
      name: form.name.trim(),
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
      is_active: form.is_active,
      grade_levels_open: form.grade_levels_open,
    }
    if (form.academic_year) {
      payload.academic_year = parseInt(form.academic_year)
    }

    if (editId) {
      updateMut.mutate({ id: editId, data: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const isPending = createMut.isPending || updateMut.isPending

  const formatGradeLevels = (levels) => {
    if (!levels || levels.length === 0) return '-'
    return levels.map(l => GRADE_LEVEL_LABELS[l] || `Level ${l}`).join(', ')
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/admissions" className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admission Sessions</h1>
          </div>
          <p className="text-sm text-gray-600 mt-1">Manage admission windows and open grade levels</p>
        </div>
        <button
          onClick={openCreateModal}
          className="btn-primary text-sm px-4 py-2 inline-flex items-center"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sessions.length === 0 && (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-500 text-sm mb-3">No admission sessions created yet</p>
          <button onClick={openCreateModal} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            Create your first session
          </button>
        </div>
      )}

      {/* Sessions Table - Desktop */}
      {!isLoading && sessions.length > 0 && (
        <>
          <div className="hidden md:block card overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">End Date</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Active</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grades Open</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Enquiries</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{session.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {session.academic_year_name || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{session.start_date || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{session.end_date || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActiveMut.mutate({ id: session.id, is_active: !session.is_active })}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          session.is_active
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {session.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatGradeLevels(session.grade_levels_open)}
                    </td>
                    <td className="px-4 py-3 text-sm text-center font-medium text-gray-900">
                      {session.enquiry_count ?? session.enquiries_count ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEditModal(session)}
                        className="text-xs text-primary-600 hover:text-primary-800 font-medium mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(session)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Sessions Cards - Mobile */}
          <div className="md:hidden space-y-3">
            {sessions.map((session) => (
              <div key={session.id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{session.name}</h3>
                    <p className="text-xs text-gray-500">{session.academic_year_name || 'No academic year'}</p>
                  </div>
                  <button
                    onClick={() => toggleActiveMut.mutate({ id: session.id, is_active: !session.is_active })}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      session.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {session.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
                <div className="text-xs text-gray-500 space-y-1 mb-2">
                  <p>
                    {session.start_date || 'No start date'} - {session.end_date || 'No end date'}
                  </p>
                  {(session.grade_levels_open || []).length > 0 && (
                    <p>Grades: {formatGradeLevels(session.grade_levels_open)}</p>
                  )}
                  <p>Enquiries: {session.enquiry_count ?? session.enquiries_count ?? 0}</p>
                </div>
                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button onClick={() => openEditModal(session)} className="text-xs text-primary-600 font-medium">
                    Edit
                  </button>
                  <button onClick={() => setDeleteConfirm(session)} className="text-xs text-red-600 font-medium">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editId ? 'Edit Admission Session' : 'New Admission Session'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(formErrors.detail || formErrors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {formErrors.detail || formErrors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={`input w-full ${formErrors.name ? 'border-red-300' : ''}`}
                  placeholder="e.g. Admissions 2026-2027"
                  required
                />
                {formErrors.name && <p className="text-xs text-red-600 mt-1">{formErrors.name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year</label>
                <select
                  value={form.academic_year}
                  onChange={(e) => setForm({ ...form, academic_year: e.target.value })}
                  className="input w-full"
                >
                  <option value="">Select academic year...</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{y.name}</option>
                  ))}
                </select>
                {formErrors.academic_year && <p className="text-xs text-red-600 mt-1">{formErrors.academic_year}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="input w-full"
                  />
                  {formErrors.start_date && <p className="text-xs text-red-600 mt-1">{formErrors.start_date}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="input w-full"
                  />
                  {formErrors.end_date && <p className="text-xs text-red-600 mt-1">{formErrors.end_date}</p>}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Active Status</label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      form.is_active ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        form.is_active ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {form.is_active ? 'Session is accepting new enquiries' : 'Session is closed for new enquiries'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Grade Levels Open for Admission</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                  {GRADE_PRESETS.map((preset) => {
                    const isSelected = form.grade_levels_open.includes(preset.numeric_level)
                    return (
                      <button
                        key={preset.numeric_level}
                        type="button"
                        onClick={() => handleGradeLevelToggle(preset.numeric_level)}
                        className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                          isSelected
                            ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                            isSelected ? 'bg-primary-500 border-primary-500' : 'border-gray-300'
                          }`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          {preset.name}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {form.grade_levels_open.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">{form.grade_levels_open.length} grade level(s) selected</p>
                )}
                {formErrors.grade_levels_open && <p className="text-xs text-red-600 mt-1">{formErrors.grade_levels_open}</p>}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : editId ? 'Update Session' : 'Create Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete Session</h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
              {(deleteConfirm.enquiry_count > 0 || deleteConfirm.enquiries_count > 0) && (
                <span className="block mt-2 text-red-600 font-medium">
                  This session has {deleteConfirm.enquiry_count || deleteConfirm.enquiries_count} enquiries linked to it.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteConfirm.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
