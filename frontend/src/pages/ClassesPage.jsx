import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { classesApi, schoolsApi } from '../services/api'
import { useToast } from '../components/Toast'

// Standard classes for Pakistani schools
const STANDARD_CLASSES = [
  { name: 'Playgroup', grade_level: 0 },
  { name: 'Nursery', grade_level: 1 },
  { name: 'Prep', grade_level: 2 },
  { name: 'Class 1', grade_level: 3 },
  { name: 'Class 2', grade_level: 4 },
  { name: 'Class 3', grade_level: 5 },
  { name: 'Class 4', grade_level: 6 },
  { name: 'Class 5', grade_level: 7 },
  { name: 'Class 6', grade_level: 8 },
  { name: 'Class 7', grade_level: 9 },
  { name: 'Class 8', grade_level: 10 },
  { name: 'Class 9', grade_level: 11 },
  { name: 'Class 10', grade_level: 12 },
]

export default function ClassesPage() {
  const { user, activeSchool } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [selectedSchoolId, setSelectedSchoolId] = useState(activeSchool?.id || null)
  const [showModal, setShowModal] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
  const [classForm, setClassForm] = useState({ name: '', grade_level: '' })
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Fetch schools for Super Admin
  const { data: schoolsData } = useQuery({
    queryKey: ['admin-schools'],
    queryFn: () => schoolsApi.getAdminSchools(),
    enabled: isSuperAdmin,
  })

  // Set first school as default for Super Admin
  useEffect(() => {
    if (isSuperAdmin && schoolsData?.data?.results?.length > 0 && !selectedSchoolId) {
      setSelectedSchoolId(schoolsData.data.results[0].id)
    }
  }, [isSuperAdmin, schoolsData, selectedSchoolId])

  // Fetch classes (cached)
  const { data: classesData, isLoading } = useQuery({
    queryKey: ['classes', selectedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: selectedSchoolId, page_size: 100 }),
    enabled: !!selectedSchoolId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Add class mutation
  const addMutation = useMutation({
    mutationFn: (data) => classesApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['classes'])
      closeModal()
      showSuccess('Class added successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.name?.[0] ||
                      error.response?.data?.detail ||
                      error.message ||
                      'Failed to add class'
      showError(message)
    },
  })

  // Update class mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => classesApi.updateClass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['classes'])
      closeModal()
      showSuccess('Class updated successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.name?.[0] ||
                      error.response?.data?.detail ||
                      error.message ||
                      'Failed to update class'
      showError(message)
    },
  })

  // Delete class mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => classesApi.deleteClass(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['classes'])
      setDeleteConfirm(null)
      showSuccess('Class deleted successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.detail ||
                      error.message ||
                      'Failed to delete class'
      showError(message)
    },
  })

  // Add standard classes mutation
  const addStandardClassesMutation = useMutation({
    mutationFn: async () => {
      const existingClassNames = classes.map(c => c.name.toLowerCase())
      const classesToAdd = STANDARD_CLASSES.filter(
        sc => !existingClassNames.includes(sc.name.toLowerCase())
      )

      for (const cls of classesToAdd) {
        await classesApi.createClass({
          school: selectedSchoolId,
          name: cls.name,
          grade_level: cls.grade_level,
        })
      }
      return classesToAdd.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries(['classes'])
      showSuccess(`Added ${count} standard classes!`)
    },
    onError: (error) => {
      const message = error.response?.data?.detail ||
                      error.message ||
                      'Failed to add standard classes'
      showError(message)
    },
  })

  const openAddModal = () => {
    setEditingClass(null)
    setClassForm({ name: '', grade_level: '' })
    setShowModal(true)
  }

  const openEditModal = (cls) => {
    setEditingClass(cls)
    setClassForm({ name: cls.name, grade_level: cls.grade_level?.toString() || '' })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingClass(null)
    setClassForm({ name: '', grade_level: '' })
  }

  const handleSubmit = () => {
    const data = {
      name: classForm.name,
      grade_level: classForm.grade_level ? parseInt(classForm.grade_level) : null,
    }

    if (editingClass) {
      updateMutation.mutate({ id: editingClass.id, data })
    } else {
      addMutation.mutate({ school: selectedSchoolId, ...data })
    }
  }

  const handleDelete = (cls) => {
    if (cls.student_count > 0) {
      showError(`Cannot delete class with ${cls.student_count} students. Remove students first.`)
      return
    }
    setDeleteConfirm(cls)
  }

  const classes = classesData?.data?.results || classesData?.data || []
  const schools = schoolsData?.data?.results || []
  const isSubmitting = addMutation.isPending || updateMutation.isPending

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Classes</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage classes in your school</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {classes.length === 0 && selectedSchoolId && (
            <button
              onClick={() => addStandardClassesMutation.mutate()}
              disabled={addStandardClassesMutation.isPending}
              className="btn btn-secondary"
            >
              {addStandardClassesMutation.isPending ? 'Adding...' : 'Add Standard Classes'}
            </button>
          )}
          <button
            onClick={openAddModal}
            disabled={!selectedSchoolId}
            className="btn btn-primary"
          >
            Add Class
          </button>
        </div>
      </div>

      {/* School Selector for Super Admin */}
      {isSuperAdmin && (
        <div className="mb-6">
          <label className="label">Select School</label>
          <select
            className="input max-w-full sm:max-w-md"
            value={selectedSchoolId || ''}
            onChange={(e) => setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">-- Select a school --</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!selectedSchoolId && (
        <div className="card text-center py-8 text-gray-500">
          {isSuperAdmin ? 'Please select a school to manage classes.' : 'No school assigned to your account.'}
        </div>
      )}

      {/* Classes Grid */}
      {selectedSchoolId && (isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : classes.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No classes found. Add your first class to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls) => (
            <div key={cls.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{cls.name}</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  cls.is_active
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {cls.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-500">
                <div className="flex justify-between">
                  <span>Students:</span>
                  <span className="font-medium text-gray-900">{cls.student_count || 0}</span>
                </div>
                {cls.grade_level !== null && cls.grade_level !== undefined && (
                  <div className="flex justify-between">
                    <span>Grade Level:</span>
                    <span className="font-medium text-gray-900">{cls.grade_level}</span>
                  </div>
                )}
              </div>
              {/* Action Buttons */}
              <div className="flex justify-end space-x-2 mt-4 pt-4 border-t border-gray-100">
                <button
                  onClick={() => openEditModal(cls)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(cls)}
                  className="text-sm text-red-600 hover:text-red-800 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Add/Edit Class Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingClass ? 'Edit Class' : 'Add Class'}
            </h2>

            <div className="space-y-4">
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
              </div>

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
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={closeModal}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !classForm.name}
                className="btn btn-primary"
              >
                {isSubmitting ? 'Saving...' : (editingClass ? 'Save Changes' : 'Add Class')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Class</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="btn btn-secondary"
              >
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
