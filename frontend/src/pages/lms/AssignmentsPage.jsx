import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { lmsApi, classesApi, academicsApi, hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'

const STATUS_BADGES = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-red-100 text-red-800',
}

const TYPE_BADGES = {
  HOMEWORK: 'bg-blue-100 text-blue-800',
  PROJECT: 'bg-purple-100 text-purple-800',
  CLASSWORK: 'bg-green-100 text-green-800',
  LAB: 'bg-orange-100 text-orange-800',
}

const ASSIGNMENT_TYPES = ['HOMEWORK', 'PROJECT', 'CLASSWORK', 'LAB']
const STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED']

const EMPTY_FORM = {
  title: '',
  description: '',
  instructions: '',
  class_obj: '',
  subject: '',
  teacher: '',
  assignment_type: 'HOMEWORK',
  due_date: '',
  total_marks: 100,
  attachments_allowed: true,
  status: 'DRAFT',
}

export default function AssignmentsPage() {
  const { user, isSchoolAdmin, isTeacher } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showError, showSuccess } = useToast()

  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })

  // -- Data fetching --

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => academicsApi.getSubjects({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff({ role: 'TEACHER', page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  const { data: assignmentsData, isLoading } = useQuery({
    queryKey: ['assignments', filterClass, filterSubject, filterStatus, filterType],
    queryFn: () =>
      lmsApi.getAssignments({
        ...(filterClass && { class_obj: filterClass }),
        ...(filterSubject && { subject: filterSubject }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterType && { assignment_type: filterType }),
        page_size: 9999,
      }),
  })

  const classes = classesData?.data?.results || classesData?.data || []
  const subjects = subjectsData?.data?.results || subjectsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []
  const allAssignments = assignmentsData?.data?.results || assignmentsData?.data || []

  // Client-side search
  const assignments = useMemo(() => {
    if (!search) return allAssignments
    const q = search.toLowerCase()
    return allAssignments.filter((a) => a.title?.toLowerCase().includes(q))
  }, [allAssignments, search])

  // -- Mutations --

  const createMutation = useMutation({
    mutationFn: (data) => lmsApi.createAssignment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
      showSuccess('Assignment created successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to create assignment'
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateAssignment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      closeModal()
      showSuccess('Assignment updated successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to update assignment'
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      setDeleteConfirm(null)
      showSuccess('Assignment deleted successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete assignment')
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id) => lmsApi.publishAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      showSuccess('Assignment published!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to publish assignment')
    },
  })

  const closeMutation = useMutation({
    mutationFn: (id) => lmsApi.closeAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      showSuccess('Assignment closed!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to close assignment')
    },
  })

  // -- Handlers --

  const openAddModal = () => {
    setEditingAssignment(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  const openEditModal = (assignment) => {
    setEditingAssignment(assignment)
    setForm({
      title: assignment.title || '',
      description: assignment.description || '',
      instructions: assignment.instructions || '',
      class_obj: assignment.class_obj ? String(assignment.class_obj) : '',
      subject: assignment.subject ? String(assignment.subject) : '',
      teacher: assignment.teacher ? String(assignment.teacher) : '',
      assignment_type: assignment.assignment_type || 'HOMEWORK',
      due_date: assignment.due_date || '',
      total_marks: assignment.total_marks ?? 100,
      attachments_allowed: assignment.attachments_allowed ?? true,
      status: assignment.status || 'DRAFT',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingAssignment(null)
    setForm({ ...EMPTY_FORM })
  }

  const handleSubmit = () => {
    if (!form.title) {
      showError('Title is required')
      return
    }
    if (!form.class_obj) {
      showError('Please select a class')
      return
    }
    if (!form.subject) {
      showError('Please select a subject')
      return
    }

    const payload = {
      ...form,
      class_obj: parseInt(form.class_obj),
      subject: parseInt(form.subject),
      teacher: form.teacher ? parseInt(form.teacher) : null,
      total_marks: parseInt(form.total_marks) || 100,
    }

    if (editingAssignment) {
      updateMutation.mutate({ id: editingAssignment.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const formatDate = (dateStr) => {
    if (!dateStr) return '--'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const isDueDatePast = (dateStr) => {
    if (!dateStr) return false
    return new Date(dateStr) < new Date()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Assignments</h1>
          <p className="text-sm text-gray-600">
            Create and manage homework, projects, classwork, and labs
          </p>
        </div>
        <button onClick={openAddModal} className="btn btn-primary">
          Create Assignment
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <div>
            <label className="label">Class</label>
            <select
              className="input"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Subject</label>
            <select
              className="input"
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
            >
              <option value="">All Subjects</option>
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">All Types</option>
              {ASSIGNMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Search</label>
            <input
              type="text"
              className="input"
              placeholder="Search by title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading assignments...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {allAssignments.length === 0
              ? 'No assignments found. Create your first assignment.'
              : 'No assignments match your filters.'}
          </div>
        ) : (
          <>
            {/* Results count */}
            <div className="mb-4 text-sm text-gray-500">
              Showing {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
            </div>

            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">{a.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {a.class_name || 'N/A'} | {a.subject_name || 'N/A'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          TYPE_BADGES[a.assignment_type] || TYPE_BADGES.HOMEWORK
                        }`}
                      >
                        {a.assignment_type}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_BADGES[a.status] || STATUS_BADGES.DRAFT
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                    <span className={isDueDatePast(a.due_date) && a.status !== 'CLOSED' ? 'text-red-600 font-medium' : ''}>
                      Due: {formatDate(a.due_date)}
                    </span>
                    <span>Marks: {a.total_marks ?? '--'}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => navigate(`/academics/assignments/${a.id}/submissions`)}
                      className="text-xs text-primary-600 font-medium"
                    >
                      Submissions ({a.submissions_count ?? 0})
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => openEditModal(a)}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Edit
                      </button>
                      {a.status === 'DRAFT' && (
                        <button
                          onClick={() => publishMutation.mutate(a.id)}
                          className="text-xs text-green-600 font-medium"
                        >
                          Publish
                        </button>
                      )}
                      {a.status === 'PUBLISHED' && (
                        <button
                          onClick={() => closeMutation.mutate(a.id)}
                          className="text-xs text-orange-600 font-medium"
                        >
                          Close
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteConfirm(a)}
                        className="text-xs text-red-600 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Class
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Subject
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Due Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Marks
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Submissions
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {assignments.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[180px] truncate">
                        {a.title}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {a.class_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {a.subject_name || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            TYPE_BADGES[a.assignment_type] || TYPE_BADGES.HOMEWORK
                          }`}
                        >
                          {a.assignment_type}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm ${
                        isDueDatePast(a.due_date) && a.status !== 'CLOSED'
                          ? 'text-red-600 font-medium'
                          : 'text-gray-500'
                      }`}>
                        {formatDate(a.due_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {a.total_marks ?? '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_BADGES[a.status] || STATUS_BADGES.DRAFT
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() =>
                            navigate(`/academics/assignments/${a.id}/submissions`)
                          }
                          className="text-sm text-primary-600 hover:text-primary-800 font-medium underline"
                        >
                          {a.submissions_count ?? 0}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openEditModal(a)}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                        >
                          Edit
                        </button>
                        {a.status === 'DRAFT' && (
                          <button
                            onClick={() => publishMutation.mutate(a.id)}
                            disabled={publishMutation.isPending}
                            className="text-sm text-green-600 hover:text-green-800 font-medium mr-3"
                          >
                            Publish
                          </button>
                        )}
                        {a.status === 'PUBLISHED' && (
                          <button
                            onClick={() => closeMutation.mutate(a.id)}
                            disabled={closeMutation.isPending}
                            className="text-sm text-orange-600 hover:text-orange-800 font-medium mr-3"
                          >
                            Close
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteConfirm(a)}
                          className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingAssignment ? 'Edit Assignment' : 'Create Assignment'}
            </h2>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Chapter 5 Homework"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>

              {/* Class & Subject */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Class *</label>
                  <select
                    className="input"
                    value={form.class_obj}
                    onChange={(e) => setForm({ ...form, class_obj: e.target.value })}
                  >
                    <option value="">Select Class</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Subject *</label>
                  <select
                    className="input"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  >
                    <option value="">Select Subject</option>
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Teacher & Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Teacher</label>
                  <select
                    className="input"
                    value={form.teacher}
                    onChange={(e) => setForm({ ...form, teacher: e.target.value })}
                  >
                    <option value="">Select Teacher</option>
                    {staff.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name || t.user_name || `Staff #${t.id}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Assignment Type</label>
                  <select
                    className="input"
                    value={form.assignment_type}
                    onChange={(e) => setForm({ ...form, assignment_type: e.target.value })}
                  >
                    {ASSIGNMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Due Date, Total Marks, Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Due Date</label>
                  <input
                    type="date"
                    className="input"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Total Marks</label>
                  <input
                    type="number"
                    className="input"
                    min="0"
                    value={form.total_marks}
                    onChange={(e) => setForm({ ...form, total_marks: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Attachments Allowed toggle */}
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={form.attachments_allowed}
                    onChange={(e) =>
                      setForm({ ...form, attachments_allowed: e.target.checked })
                    }
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
                <span className="text-sm text-gray-700">Allow file attachments</span>
              </div>

              {/* Description */}
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Brief description of the assignment..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {/* Instructions */}
              <div>
                <label className="label">Instructions</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Detailed instructions for students..."
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingAssignment
                  ? 'Save Changes'
                  : 'Create Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Assignment</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.title}</strong>? This will also
              remove all associated submissions. This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
