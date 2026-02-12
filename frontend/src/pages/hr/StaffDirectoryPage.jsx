import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const statusBadge = {
  ACTIVE: 'bg-green-100 text-green-800',
  ON_LEAVE: 'bg-yellow-100 text-yellow-800',
  TERMINATED: 'bg-red-100 text-red-800',
  RESIGNED: 'bg-gray-100 text-gray-800',
  RETIRED: 'bg-blue-100 text-blue-800',
}

const typeBadge = {
  FULL_TIME: 'bg-blue-100 text-blue-800',
  PART_TIME: 'bg-purple-100 text-purple-800',
  CONTRACT: 'bg-orange-100 text-orange-800',
  TEMPORARY: 'bg-yellow-100 text-yellow-800',
  INTERN: 'bg-teal-100 text-teal-800',
}

export default function StaffDirectoryPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Fetch staff
  const { data: staffData, isLoading } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff(),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch departments for filter
  const { data: deptData } = useQuery({
    queryKey: ['hrDepartments'],
    queryFn: () => hrApi.getDepartments(),
    staleTime: 5 * 60 * 1000,
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => hrApi.deleteStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['hrStaff'])
      queryClient.invalidateQueries(['hrDashboardStats'])
      setDeleteConfirm(null)
      showSuccess('Staff member deactivated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete staff member')
    },
  })

  const allStaff = staffData?.data?.results || staffData?.data || []
  const departments = deptData?.data?.results || deptData?.data || []

  // Client-side filtering
  const filteredStaff = useMemo(() => {
    let result = allStaff

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(
        (m) =>
          m.first_name?.toLowerCase().includes(s) ||
          m.last_name?.toLowerCase().includes(s) ||
          m.email?.toLowerCase().includes(s) ||
          m.employee_id?.toLowerCase().includes(s)
      )
    }

    if (departmentFilter) {
      result = result.filter((m) => String(m.department) === departmentFilter)
    }

    if (statusFilter) {
      result = result.filter((m) => m.employment_status === statusFilter)
    }

    return result
  }, [allStaff, search, departmentFilter, statusFilter])

  // Stats
  const totalActive = allStaff.filter((m) => m.is_active && m.employment_status === 'ACTIVE').length

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Staff Directory</h1>
          <p className="text-sm text-gray-600">
            {filteredStaff.length} staff member{filteredStaff.length !== 1 ? 's' : ''} &middot; {totalActive} active
          </p>
        </div>
        <Link to="/hr/staff/new" className="btn btn-primary">
          Add Staff Member
        </Link>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            className="input"
            placeholder="Search by name, email, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On Leave</option>
            <option value="TERMINATED">Terminated</option>
            <option value="RESIGNED">Resigned</option>
            <option value="RETIRED">Retired</option>
          </select>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          {allStaff.length === 0
            ? 'No staff members found. Add your first staff member to get started.'
            : 'No staff members match your filters.'}
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="sm:hidden space-y-3">
            {filteredStaff.map((member) => (
              <div key={member.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {member.first_name} {member.last_name}
                    </p>
                    {member.employee_id && (
                      <p className="text-xs text-gray-500">ID: {member.employee_id}</p>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[member.employment_status] || 'bg-gray-100 text-gray-800'}`}>
                    {member.employment_status}
                  </span>
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  {member.department_name && <p>Dept: {member.department_name}</p>}
                  {member.designation_name && <p>Role: {member.designation_name}</p>}
                  {member.email && <p>{member.email}</p>}
                  {member.phone && <p>{member.phone}</p>}
                </div>
                <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-gray-100">
                  <Link
                    to={`/hr/staff/${member.id}/edit`}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => setDeleteConfirm(member)}
                    className="text-sm text-red-600 hover:text-red-800 font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 pr-4">Designation</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Contact</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStaff.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="py-3 pr-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.first_name} {member.last_name}
                        </p>
                        {member.employee_id && (
                          <p className="text-xs text-gray-500">{member.employee_id}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-600">
                      {member.department_name || '—'}
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-600">
                      {member.designation_name || '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge[member.employment_type] || 'bg-gray-100 text-gray-800'}`}>
                        {member.employment_type}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[member.employment_status] || 'bg-gray-100 text-gray-800'}`}>
                        {member.employment_status}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-sm">
                        {member.email && <p className="text-gray-600 truncate max-w-[180px]">{member.email}</p>}
                        {member.phone && <p className="text-gray-400 text-xs">{member.phone}</p>}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <Link
                          to={`/hr/staff/${member.id}/edit`}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => setDeleteConfirm(member)}
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
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Deactivate Staff Member</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to deactivate <strong>{deleteConfirm.first_name} {deleteConfirm.last_name}</strong>?
              This will mark them as inactive.
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
                {deleteMutation.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
