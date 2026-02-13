import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi, classesApi, academicsApi, hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'

const STATUS_BADGES = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
}

const EMPTY_FORM = {
  title: '',
  description: '',
  objectives: '',
  class_obj: '',
  subject: '',
  teacher: '',
  lesson_date: '',
  duration_minutes: 45,
  materials_needed: '',
  teaching_methods: '',
  status: 'DRAFT',
}

export default function LessonPlansPage() {
  const { user, isSchoolAdmin, isTeacher } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })

  // -- Data fetching --

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => academicsApi.getSubjects(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff({ role: 'TEACHER' }),
    staleTime: 5 * 60 * 1000,
  })

  const { data: plansData, isLoading } = useQuery({
    queryKey: ['lessonPlans', filterClass, filterSubject],
    queryFn: () =>
      lmsApi.getLessonPlans({
        ...(filterClass && { class_obj: filterClass }),
        ...(filterSubject && { subject: filterSubject }),
      }),
  })

  const classes = classesData?.data?.results || classesData?.data || []
  const subjects = subjectsData?.data?.results || subjectsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []
  const allPlans = plansData?.data?.results || plansData?.data || []

  // Client-side search
  const plans = useMemo(() => {
    if (!search) return allPlans
    const q = search.toLowerCase()
    return allPlans.filter((p) => p.title?.toLowerCase().includes(q))
  }, [allPlans, search])

  // -- Mutations --

  const createMutation = useMutation({
    mutationFn: (data) => lmsApi.createLessonPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      closeModal()
      showSuccess('Lesson plan created successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to create lesson plan'
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateLessonPlan(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      closeModal()
      showSuccess('Lesson plan updated successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to update lesson plan'
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteLessonPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      setDeleteConfirm(null)
      showSuccess('Lesson plan deleted successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete lesson plan')
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id) => lmsApi.publishLessonPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      showSuccess('Lesson plan published!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to publish lesson plan')
    },
  })

  // -- Handlers --

  const openAddModal = () => {
    setEditingPlan(null)
    setForm({ ...EMPTY_FORM })
    setShowModal(true)
  }

  const openEditModal = (plan) => {
    setEditingPlan(plan)
    setForm({
      title: plan.title || '',
      description: plan.description || '',
      objectives: plan.objectives || '',
      class_obj: plan.class_obj ? String(plan.class_obj) : '',
      subject: plan.subject ? String(plan.subject) : '',
      teacher: plan.teacher ? String(plan.teacher) : '',
      lesson_date: plan.lesson_date || '',
      duration_minutes: plan.duration_minutes || 45,
      materials_needed: plan.materials_needed || '',
      teaching_methods: plan.teaching_methods || '',
      status: plan.status || 'DRAFT',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingPlan(null)
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
      duration_minutes: parseInt(form.duration_minutes) || 45,
    }

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: payload })
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

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Lesson Plans</h1>
          <p className="text-sm text-gray-600">Create and manage lesson plans for your classes</p>
        </div>
        <button onClick={openAddModal} className="btn btn-primary">
          Add Lesson Plan
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
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
            <p className="text-gray-500 mt-2">Loading lesson plans...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {allPlans.length === 0
              ? 'No lesson plans found. Create your first lesson plan.'
              : 'No lesson plans match your search.'}
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {plans.map((plan) => (
                <div key={plan.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">{plan.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {plan.class_name || 'N/A'} | {plan.subject_name || 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(plan.lesson_date)} | {plan.duration_minutes || '--'} min
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                        STATUS_BADGES[plan.status] || STATUS_BADGES.DRAFT
                      }`}
                    >
                      {plan.status}
                    </span>
                  </div>
                  <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => openEditModal(plan)}
                      className="text-xs text-blue-600 font-medium"
                    >
                      Edit
                    </button>
                    {plan.status === 'DRAFT' && (
                      <button
                        onClick={() => publishMutation.mutate(plan.id)}
                        className="text-xs text-green-600 font-medium"
                      >
                        Publish
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteConfirm(plan)}
                      className="text-xs text-red-600 font-medium"
                    >
                      Delete
                    </button>
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
                      Teacher
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {plans.map((plan) => (
                    <tr key={plan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[200px] truncate">
                        {plan.title}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.class_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.subject_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.teacher_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(plan.lesson_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.duration_minutes ? `${plan.duration_minutes} min` : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_BADGES[plan.status] || STATUS_BADGES.DRAFT
                          }`}
                        >
                          {plan.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(plan)}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                        >
                          Edit
                        </button>
                        {plan.status === 'DRAFT' && (
                          <button
                            onClick={() => publishMutation.mutate(plan.id)}
                            disabled={publishMutation.isPending}
                            className="text-sm text-green-600 hover:text-green-800 font-medium mr-3"
                          >
                            Publish
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteConfirm(plan)}
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
              {editingPlan ? 'Edit Lesson Plan' : 'Create Lesson Plan'}
            </h2>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Introduction to Photosynthesis"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>

              {/* Class & Subject row */}
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

              {/* Teacher & Date row */}
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
                  <label className="label">Lesson Date</label>
                  <input
                    type="date"
                    className="input"
                    value={form.lesson_date}
                    onChange={(e) => setForm({ ...form, lesson_date: e.target.value })}
                  />
                </div>
              </div>

              {/* Duration & Status row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Duration (minutes)</label>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    value={form.duration_minutes}
                    onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Brief description of the lesson..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {/* Objectives */}
              <div>
                <label className="label">Objectives</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Learning objectives for this lesson..."
                  value={form.objectives}
                  onChange={(e) => setForm({ ...form, objectives: e.target.value })}
                />
              </div>

              {/* Materials Needed */}
              <div>
                <label className="label">Materials Needed</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Textbook, whiteboard, projector..."
                  value={form.materials_needed}
                  onChange={(e) => setForm({ ...form, materials_needed: e.target.value })}
                />
              </div>

              {/* Teaching Methods */}
              <div>
                <label className="label">Teaching Methods</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Lecture, group discussion, hands-on activity..."
                  value={form.teaching_methods}
                  onChange={(e) => setForm({ ...form, teaching_methods: e.target.value })}
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
                  : editingPlan
                  ? 'Save Changes'
                  : 'Create Lesson Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Lesson Plan</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.title}</strong>? This action
              cannot be undone.
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
