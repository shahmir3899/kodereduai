import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const PRESET_DEPARTMENTS = [
  { name: 'Teaching', description: 'Academic teaching staff' },
  { name: 'Administration', description: 'School administration and office staff' },
  { name: 'Finance & Accounts', description: 'Fee collection, accounts and payroll' },
  { name: 'IT / Lab', description: 'IT support and laboratory staff' },
  { name: 'Library', description: 'Library management staff' },
  { name: 'Transport', description: 'School transport and logistics' },
  { name: 'Security', description: 'Campus security and gatekeeping' },
  { name: 'Maintenance', description: 'Cleaning, maintenance and support staff' },
  { name: 'Sports', description: 'Physical education and sports coaching' },
  { name: 'Medical / Health', description: 'School nurse and health services' },
]

const PRESET_DESIGNATIONS = [
  { name: 'Principal', dept: 'Administration' },
  { name: 'Vice Principal', dept: 'Administration' },
  { name: 'Head Teacher', dept: 'Teaching' },
  { name: 'Senior Teacher', dept: 'Teaching' },
  { name: 'Teacher', dept: 'Teaching' },
  { name: 'Subject Coordinator', dept: 'Teaching' },
  { name: 'Office Manager', dept: 'Administration' },
  { name: 'Receptionist', dept: 'Administration' },
  { name: 'Clerk', dept: 'Administration' },
  { name: 'Accountant', dept: 'Finance & Accounts' },
  { name: 'Cashier', dept: 'Finance & Accounts' },
  { name: 'Librarian', dept: 'Library' },
  { name: 'Lab Assistant', dept: 'IT / Lab' },
  { name: 'IT Administrator', dept: 'IT / Lab' },
  { name: 'Sports Coach', dept: 'Sports' },
  { name: 'School Nurse', dept: 'Medical / Health' },
  { name: 'Security Guard', dept: 'Security' },
  { name: 'Driver', dept: 'Transport' },
  { name: 'Peon', dept: 'Maintenance' },
]

export default function DepartmentsPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  // Department state
  const [showDeptModal, setShowDeptModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [deptForm, setDeptForm] = useState({ name: '', description: '' })
  const [deleteDeptConfirm, setDeleteDeptConfirm] = useState(null)

  // Designation state
  const [showDesigModal, setShowDesigModal] = useState(false)
  const [editingDesig, setEditingDesig] = useState(null)
  const [desigForm, setDesigForm] = useState({ name: '', department: '' })
  const [deleteDesigConfirm, setDeleteDesigConfirm] = useState(null)

  // Fetch departments
  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['hrDepartments'],
    queryFn: () => hrApi.getDepartments({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch designations
  const { data: desigData, isLoading: desigLoading } = useQuery({
    queryKey: ['hrDesignations'],
    queryFn: () => hrApi.getDesignations({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  const departments = deptData?.data?.results || deptData?.data || []
  const designations = desigData?.data?.results || desigData?.data || []

  // ── Department Mutations ──────────────────────────────────────────────

  const addDeptMutation = useMutation({
    mutationFn: (data) => hrApi.createDepartment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDepartments'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      closeDeptModal()
      showSuccess('Department created successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.name?.[0] || error.response?.data?.detail || 'Failed to create department')
    },
  })

  const updateDeptMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateDepartment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDepartments'] })
      closeDeptModal()
      showSuccess('Department updated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.name?.[0] || error.response?.data?.detail || 'Failed to update department')
    },
  })

  const deleteDeptMutation = useMutation({
    mutationFn: (id) => hrApi.deleteDepartment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDepartments'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      setDeleteDeptConfirm(null)
      showSuccess('Department deactivated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete department')
    },
  })

  // ── Designation Mutations ─────────────────────────────────────────────

  const addDesigMutation = useMutation({
    mutationFn: (data) => hrApi.createDesignation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDesignations'] })
      closeDesigModal()
      showSuccess('Designation created successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.name?.[0] || error.response?.data?.detail || 'Failed to create designation')
    },
  })

  const updateDesigMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateDesignation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDesignations'] })
      closeDesigModal()
      showSuccess('Designation updated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.name?.[0] || error.response?.data?.detail || 'Failed to update designation')
    },
  })

  const deleteDesigMutation = useMutation({
    mutationFn: (id) => hrApi.deleteDesignation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrDesignations'] })
      setDeleteDesigConfirm(null)
      showSuccess('Designation deactivated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete designation')
    },
  })

  // ── Department Handlers ───────────────────────────────────────────────

  const openAddDeptModal = () => {
    setEditingDept(null)
    setDeptForm({ name: '', description: '' })
    setShowDeptModal(true)
  }

  const openEditDeptModal = (dept) => {
    setEditingDept(dept)
    setDeptForm({ name: dept.name, description: dept.description || '' })
    setShowDeptModal(true)
  }

  const closeDeptModal = () => {
    setShowDeptModal(false)
    setEditingDept(null)
    setDeptForm({ name: '', description: '' })
  }

  const handleDeptSubmit = () => {
    if (!deptForm.name) {
      showError('Department name is required.')
      return
    }
    if (editingDept) {
      updateDeptMutation.mutate({ id: editingDept.id, data: deptForm })
    } else {
      addDeptMutation.mutate(deptForm)
    }
  }

  const handleDeleteDept = (dept) => {
    if (dept.staff_count > 0) {
      showError(`Cannot delete department with ${dept.staff_count} staff members. Reassign them first.`)
      return
    }
    setDeleteDeptConfirm(dept)
  }

  // ── Designation Handlers ──────────────────────────────────────────────

  const openAddDesigModal = () => {
    setEditingDesig(null)
    setDesigForm({ name: '', department: '' })
    setShowDesigModal(true)
  }

  const openEditDesigModal = (desig) => {
    setEditingDesig(desig)
    setDesigForm({ name: desig.name, department: desig.department ? String(desig.department) : '' })
    setShowDesigModal(true)
  }

  const closeDesigModal = () => {
    setShowDesigModal(false)
    setEditingDesig(null)
    setDesigForm({ name: '', department: '' })
  }

  const handleDesigSubmit = () => {
    if (!desigForm.name) {
      showError('Designation name is required.')
      return
    }
    const payload = { ...desigForm }
    if (!payload.department) payload.department = null

    if (editingDesig) {
      updateDesigMutation.mutate({ id: editingDesig.id, data: payload })
    } else {
      addDesigMutation.mutate(payload)
    }
  }

  // Quick-add presets
  const [quickAdding, setQuickAdding] = useState({})
  const existingDeptNames = new Set(departments.map(d => d.name.toLowerCase()))
  const existingDesigNames = new Set(designations.map(d => d.name.toLowerCase()))
  const remainingDepts = PRESET_DEPARTMENTS.filter(p => !existingDeptNames.has(p.name.toLowerCase()))
  const remainingDesigs = PRESET_DESIGNATIONS.filter(p => !existingDesigNames.has(p.name.toLowerCase()))

  const quickAddDept = async (preset) => {
    setQuickAdding(p => ({ ...p, [`dept-${preset.name}`]: true }))
    try {
      await hrApi.createDepartment({ name: preset.name, description: preset.description })
      queryClient.invalidateQueries({ queryKey: ['hrDepartments'] })
      showSuccess(`"${preset.name}" department added!`)
    } catch (err) {
      showError(err.response?.data?.name?.[0] || 'Failed to add department')
    }
    setQuickAdding(p => ({ ...p, [`dept-${preset.name}`]: false }))
  }

  const quickAddAllDepts = async () => {
    setQuickAdding(p => ({ ...p, allDepts: true }))
    let added = 0
    for (const preset of remainingDepts) {
      try {
        await hrApi.createDepartment({ name: preset.name, description: preset.description })
        added++
      } catch { /* skip duplicates */ }
    }
    queryClient.invalidateQueries({ queryKey: ['hrDepartments'] })
    if (added > 0) showSuccess(`${added} department${added > 1 ? 's' : ''} added!`)
    setQuickAdding(p => ({ ...p, allDepts: false }))
  }

  // Build dept name → id map for linking designations
  const deptNameToId = {}
  departments.forEach(d => { deptNameToId[d.name.toLowerCase()] = d.id })

  const quickAddDesig = async (preset) => {
    setQuickAdding(p => ({ ...p, [`desig-${preset.name}`]: true }))
    try {
      const deptId = preset.dept ? (deptNameToId[preset.dept.toLowerCase()] || null) : null
      await hrApi.createDesignation({ name: preset.name, department: deptId })
      queryClient.invalidateQueries({ queryKey: ['hrDesignations'] })
      showSuccess(`"${preset.name}" designation added!`)
    } catch (err) {
      showError(err.response?.data?.name?.[0] || 'Failed to add designation')
    }
    setQuickAdding(p => ({ ...p, [`desig-${preset.name}`]: false }))
  }

  const quickAddAllDesigs = async () => {
    setQuickAdding(p => ({ ...p, allDesigs: true }))
    let added = 0
    for (const preset of remainingDesigs) {
      try {
        const deptId = preset.dept ? (deptNameToId[preset.dept.toLowerCase()] || null) : null
        await hrApi.createDesignation({ name: preset.name, department: deptId })
        added++
      } catch { /* skip duplicates */ }
    }
    queryClient.invalidateQueries({ queryKey: ['hrDesignations'] })
    if (added > 0) showSuccess(`${added} designation${added > 1 ? 's' : ''} added!`)
    setQuickAdding(p => ({ ...p, allDesigs: false }))
  }

  const isDeptSubmitting = addDeptMutation.isPending || updateDeptMutation.isPending
  const isDesigSubmitting = addDesigMutation.isPending || updateDesigMutation.isPending

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Departments & Designations</h1>
        <p className="text-sm text-gray-600">Manage organizational structure</p>
      </div>

      {/* ── Departments Section ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Departments</h2>
          <button onClick={openAddDeptModal} className="btn btn-primary">
            Add Department
          </button>
        </div>

        {/* Quick Add Departments */}
        {!deptLoading && remainingDepts.length > 0 && (
          <div className="card mb-4 bg-blue-50 border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-blue-800">Quick Add Common Departments</p>
              {remainingDepts.length > 1 && (
                <button
                  onClick={quickAddAllDepts}
                  disabled={quickAdding.allDepts}
                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50"
                >
                  {quickAdding.allDepts ? 'Adding...' : `Add All (${remainingDepts.length})`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {remainingDepts.map(p => (
                <button
                  key={p.name}
                  onClick={() => quickAddDept(p)}
                  disabled={quickAdding[`dept-${p.name}`]}
                  className="px-3 py-1.5 text-sm bg-white border border-blue-300 text-blue-700 rounded-full hover:bg-blue-100 disabled:opacity-50 transition-colors"
                >
                  {quickAdding[`dept-${p.name}`] ? '...' : `+ ${p.name}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {deptLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : departments.length === 0 ? (
          <div className="card text-center py-8 text-gray-500">
            No departments created yet. Use the quick add buttons above or add manually.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => (
              <div key={dept.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-semibold text-gray-900">{dept.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {dept.staff_count || 0} staff
                  </span>
                </div>
                {dept.description && (
                  <p className="text-sm text-gray-500 mb-3">{dept.description}</p>
                )}
                <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openEditDeptModal(dept)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteDept(dept)}
                    className="text-sm text-red-600 hover:text-red-800 font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Designations Section ────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Designations</h2>
          <button onClick={openAddDesigModal} className="btn btn-primary">
            Add Designation
          </button>
        </div>

        {/* Quick Add Designations */}
        {!desigLoading && remainingDesigs.length > 0 && (
          <div className="card mb-4 bg-green-50 border border-green-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-green-800">Quick Add Common Designations</p>
              {remainingDesigs.length > 1 && (
                <button
                  onClick={quickAddAllDesigs}
                  disabled={quickAdding.allDesigs}
                  className="text-xs px-3 py-1 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50"
                >
                  {quickAdding.allDesigs ? 'Adding...' : `Add All (${remainingDesigs.length})`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {remainingDesigs.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => quickAddDesig(preset)}
                  disabled={quickAdding[`desig-${preset.name}`]}
                  className="px-3 py-1.5 text-sm bg-white border border-green-300 text-green-700 rounded-full hover:bg-green-100 disabled:opacity-50 transition-colors"
                  title={preset.dept ? `Department: ${preset.dept}` : ''}
                >
                  {quickAdding[`desig-${preset.name}`] ? '...' : `+ ${preset.name}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {desigLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : designations.length === 0 ? (
          <div className="card text-center py-8 text-gray-500">
            No designations created yet. Use the quick add buttons above or add manually.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {designations.map((desig) => (
                  <tr key={desig.id} className="hover:bg-gray-50">
                    <td className="py-3 pr-4 text-sm font-medium text-gray-900">{desig.name}</td>
                    <td className="py-3 pr-4 text-sm text-gray-600">{desig.department_name || '—'}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openEditDesigModal(desig)}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteDesigConfirm(desig)}
                          className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Department Modal ────────────────────────────────────────────── */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingDept ? 'Edit Department' : 'Add Department'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Department Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Science, Administration"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Description (Optional)</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Brief description of the department"
                  value={deptForm.description}
                  onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeDeptModal} className="btn btn-secondary">Cancel</button>
              <button
                onClick={handleDeptSubmit}
                disabled={isDeptSubmitting || !deptForm.name}
                className="btn btn-primary"
              >
                {isDeptSubmitting ? 'Saving...' : (editingDept ? 'Save Changes' : 'Add Department')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Designation Modal ───────────────────────────────────────────── */}
      {showDesigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingDesig ? 'Edit Designation' : 'Add Designation'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Designation Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Senior Teacher, Lab Technician"
                  value={desigForm.name}
                  onChange={(e) => setDesigForm({ ...desigForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Department (Optional)</label>
                <select
                  className="input"
                  value={desigForm.department}
                  onChange={(e) => setDesigForm({ ...desigForm, department: e.target.value })}
                >
                  <option value="">No Department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeDesigModal} className="btn btn-secondary">Cancel</button>
              <button
                onClick={handleDesigSubmit}
                disabled={isDesigSubmitting || !desigForm.name}
                className="btn btn-primary"
              >
                {isDesigSubmitting ? 'Saving...' : (editingDesig ? 'Save Changes' : 'Add Designation')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Department Confirmation ──────────────────────────────── */}
      {deleteDeptConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Department</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteDeptConfirm.name}</strong>? This will deactivate it.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteDeptConfirm(null)} className="btn btn-secondary">Cancel</button>
              <button
                onClick={() => deleteDeptMutation.mutate(deleteDeptConfirm.id)}
                disabled={deleteDeptMutation.isPending}
                className="btn btn-danger"
              >
                {deleteDeptMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Designation Confirmation ─────────────────────────────── */}
      {deleteDesigConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Designation</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteDesigConfirm.name}</strong>? This will deactivate it.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteDesigConfirm(null)} className="btn btn-secondary">Cancel</button>
              <button
                onClick={() => deleteDesigMutation.mutate(deleteDesigConfirm.id)}
                disabled={deleteDesigMutation.isPending}
                className="btn btn-danger"
              >
                {deleteDesigMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
