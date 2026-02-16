import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useDebounce } from '../../hooks/useDebounce'

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

const QUICK_ROLE_LABELS = { HR_MANAGER: 'HR Manager', ACCOUNTANT: 'Accountant', TEACHER: 'Teacher', STAFF: 'Staff' }

export default function StaffDirectoryPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { getAllowableRoles } = useAuth()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Quick add state
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickForm, setQuickForm] = useState({ first_name: '', last_name: '', phone: '', department: '', designation: '' })
  const [quickErrors, setQuickErrors] = useState('')
  const [quickCreateUser, setQuickCreateUser] = useState(false)
  const [quickUserForm, setQuickUserForm] = useState({ username: '', password: '', confirm_password: '', user_role: 'STAFF' })
  const quickStaffRoleOptions = getAllowableRoles().filter(r => !['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(r))

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [bulkFile, setBulkFile] = useState(null)
  const [bulkParsed, setBulkParsed] = useState(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  const fileInputRef = useRef(null)

  // Convert existing staff to users
  const [selectedStaff, setSelectedStaff] = useState(new Set())
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertMember, setConvertMember] = useState(null)
  const [convertForm, setConvertForm] = useState({ username: '', password: '', confirm_password: '', user_role: 'STAFF' })
  const [convertError, setConvertError] = useState('')
  const [showBulkConvertModal, setShowBulkConvertModal] = useState(false)
  const [bulkConvertPassword, setBulkConvertPassword] = useState('')
  const [bulkConvertRole, setBulkConvertRole] = useState('TEACHER')
  const [bulkConvertError, setBulkConvertError] = useState('')
  const [convertResults, setConvertResults] = useState(null)
  const [isConverting, setIsConverting] = useState(false)
  const convertRoleOptions = getAllowableRoles().filter(r => !['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(r))

  // Fetch staff
  const { data: staffData, isLoading } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch departments for filter
  const { data: deptData } = useQuery({
    queryKey: ['hrDepartments'],
    queryFn: () => hrApi.getDepartments({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch designations for quick add
  const { data: desigData } = useQuery({
    queryKey: ['hrDesignations'],
    queryFn: () => hrApi.getDesignations({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => hrApi.deleteStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      setDeleteConfirm(null)
      showSuccess('Staff member deactivated successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete staff member')
    },
  })

  // Quick add mutation
  const quickAddMutation = useMutation({
    mutationFn: (data) => hrApi.createStaff(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Staff member added!')
      setQuickForm({ first_name: '', last_name: '', phone: '', department: '', designation: '' })
      setQuickErrors('')
      setShowQuickAdd(false)
    },
    onError: (error) => {
      const data = error.response?.data
      setQuickErrors(data?.employee_id?.[0] || data?.detail || data?.non_field_errors?.[0] || 'Failed to add staff member')
    },
  })

  const handleQuickDesigChange = (desigId) => {
    const desig = designations.find(d => String(d.id) === desigId)
    setQuickForm(p => ({
      ...p,
      designation: desigId,
      // Auto-fill department from designation's linked department (only if user hasn't manually picked one)
      ...(desig?.department && !p.department ? { department: String(desig.department) } : {}),
    }))
  }

  const handleQuickSubmit = (e) => {
    e.preventDefault()
    setQuickErrors('')
    if (!quickForm.first_name || !quickForm.last_name) {
      setQuickErrors('First name and last name are required.')
      return
    }
    if (quickCreateUser) {
      if (!quickUserForm.username || !quickUserForm.password) {
        setQuickErrors('Username and password are required for user account.')
        return
      }
      if (quickUserForm.password.length < 8) {
        setQuickErrors('Password must be at least 8 characters.')
        return
      }
      if (quickUserForm.password !== quickUserForm.confirm_password) {
        setQuickErrors("Passwords don't match.")
        return
      }
    }
    const payload = {
      first_name: quickForm.first_name,
      last_name: quickForm.last_name,
      phone: quickForm.phone || '',
      department: quickForm.department || null,
      designation: quickForm.designation || null,
    }
    if (quickCreateUser) {
      payload.create_user_account = true
      payload.username = quickUserForm.username
      payload.password = quickUserForm.password
      payload.confirm_password = quickUserForm.confirm_password
      payload.user_role = quickUserForm.user_role
    }
    quickAddMutation.mutate(payload)
  }

  // Bulk CSV import
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBulkFile(file)
    setBulkResult(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) {
        setBulkParsed({ error: 'File must have a header row and at least one data row.' })
        return
      }
      const header = lines[0].split(',').map(h => h.trim().toLowerCase())
      const fnIdx = header.findIndex(h => h === 'first_name' || h === 'first name' || h === 'firstname')
      const lnIdx = header.findIndex(h => h === 'last_name' || h === 'last name' || h === 'lastname')
      if (fnIdx === -1 || lnIdx === -1) {
        setBulkParsed({ error: 'CSV must have "first_name" and "last_name" columns.' })
        return
      }
      const phoneIdx = header.findIndex(h => h === 'phone' || h === 'phone_number' || h === 'mobile')
      const emailIdx = header.findIndex(h => h === 'email')
      const deptIdx = header.findIndex(h => h === 'department')
      const desigIdx = header.findIndex(h => h === 'designation')
      const genderIdx = header.findIndex(h => h === 'gender')

      const rows = []
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim())
        const fn = cols[fnIdx]
        const ln = cols[lnIdx]
        if (!fn || !ln) continue
        rows.push({
          first_name: fn,
          last_name: ln,
          phone: phoneIdx >= 0 ? cols[phoneIdx] || '' : '',
          email: emailIdx >= 0 ? cols[emailIdx] || '' : '',
          department_name: deptIdx >= 0 ? cols[deptIdx] || '' : '',
          designation_name: desigIdx >= 0 ? cols[desigIdx] || '' : '',
          gender: genderIdx >= 0 ? (cols[genderIdx] || '').toUpperCase() : '',
        })
      }
      setBulkParsed({ rows, header })
    }
    reader.readAsText(file)
  }

  const handleBulkImport = async () => {
    if (!bulkParsed?.rows?.length) return
    setBulkImporting(true)
    setBulkResult(null)

    const deptMap = {}
    departments.forEach(d => { deptMap[d.name.toLowerCase()] = d.id })
    const desigList = desigData?.data?.results || desigData?.data || []
    const desigMap = {}
    desigList.forEach(d => { desigMap[d.name.toLowerCase()] = d.id })

    let success = 0, failed = 0
    const errors = []
    for (const row of bulkParsed.rows) {
      try {
        const payload = {
          first_name: row.first_name,
          last_name: row.last_name,
          phone: row.phone,
          email: row.email,
          department: row.department_name ? (deptMap[row.department_name.toLowerCase()] || null) : null,
          designation: row.designation_name ? (desigMap[row.designation_name.toLowerCase()] || null) : null,
          gender: ['MALE', 'FEMALE', 'OTHER'].includes(row.gender) ? row.gender : null,
        }
        await hrApi.createStaff(payload)
        success++
      } catch (err) {
        failed++
        errors.push(`${row.first_name} ${row.last_name}: ${err.response?.data?.detail || err.response?.data?.employee_id?.[0] || 'Failed'}`)
      }
    }

    queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
    queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
    setBulkResult({ success, failed, errors })
    setBulkImporting(false)
    if (success > 0) showSuccess(`${success} staff member${success > 1 ? 's' : ''} imported!`)
  }

  const closeBulkImport = () => {
    setShowBulkImport(false)
    setBulkFile(null)
    setBulkParsed(null)
    setBulkResult(null)
  }

  // Individual convert handler
  const handleIndividualConvert = async () => {
    setConvertError('')
    if (!convertForm.username || !convertForm.password) {
      setConvertError('Username and password are required.')
      return
    }
    if (convertForm.password.length < 8) {
      setConvertError('Password must be at least 8 characters.')
      return
    }
    if (convertForm.password !== convertForm.confirm_password) {
      setConvertError("Passwords don't match.")
      return
    }
    setIsConverting(true)
    try {
      await hrApi.createStaffUserAccount(convertMember.id, convertForm)
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      setShowConvertModal(false)
      setConvertMember(null)
      showSuccess('User account created successfully!')
    } catch (err) {
      setConvertError(err?.response?.data?.error || err?.response?.data?.detail || 'Failed to create user account')
    } finally {
      setIsConverting(false)
    }
  }

  // Bulk convert handler
  const handleBulkConvert = async () => {
    setBulkConvertError('')
    if (!bulkConvertPassword || bulkConvertPassword.length < 8) {
      setBulkConvertError('Default password must be at least 8 characters.')
      return
    }
    setIsConverting(true)
    try {
      const response = await hrApi.bulkCreateStaffAccounts({
        staff_ids: Array.from(selectedStaff),
        default_password: bulkConvertPassword,
        default_role: bulkConvertRole,
      })
      setConvertResults(response.data)
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      setSelectedStaff(new Set())
      showSuccess(`Created ${response.data.created_count} user account(s)!`)
    } catch (err) {
      setBulkConvertError(err?.response?.data?.error || err?.response?.data?.detail || 'Bulk conversion failed')
    } finally {
      setIsConverting(false)
    }
  }

  const openConvertModal = (member) => {
    setConvertMember(member)
    const suggestedUsername = `${member.first_name}_${member.last_name}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    setConvertForm({ username: suggestedUsername, password: '', confirm_password: '', user_role: 'STAFF' })
    setConvertError('')
    setShowConvertModal(true)
  }

  const toggleStaffSelection = useCallback((id) => {
    setSelectedStaff(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allStaff = staffData?.data?.results || staffData?.data || []
  const departments = deptData?.data?.results || deptData?.data || []
  const designations = desigData?.data?.results || desigData?.data || []

  // Client-side filtering
  const filteredStaff = useMemo(() => {
    let result = allStaff

    if (debouncedSearch) {
      const s = debouncedSearch.toLowerCase()
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
  }, [allStaff, debouncedSearch, departmentFilter, statusFilter])

  // Staff without accounts (for bulk select)
  const staffWithoutAccounts = useMemo(() => {
    return filteredStaff.filter(m => !m.user)
  }, [filteredStaff])

  const toggleSelectAllStaff = useCallback(() => {
    if (selectedStaff.size === staffWithoutAccounts.length && staffWithoutAccounts.length > 0) {
      setSelectedStaff(new Set())
    } else {
      setSelectedStaff(new Set(staffWithoutAccounts.map(m => m.id)))
    }
  }, [staffWithoutAccounts, selectedStaff.size])

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
        <div className="flex gap-2">
          <button
            onClick={() => setShowBulkImport(true)}
            className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Import CSV
          </button>
          <button
            onClick={() => { setShowQuickAdd(true); setQuickForm({ first_name: '', last_name: '', phone: '', department: '', designation: '' }); setQuickErrors('') }}
            className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Quick Add
          </button>
          <Link to="/hr/staff/new" className="btn btn-primary">
            Full Form
          </Link>
        </div>
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
                  <div className="flex items-center gap-2">
                    {!member.user && (
                      <input
                        type="checkbox"
                        checked={selectedStaff.has(member.id)}
                        onChange={() => toggleStaffSelection(member.id)}
                        className="rounded flex-shrink-0"
                      />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">
                        {member.first_name} {member.last_name}
                      </p>
                      {member.employee_id && (
                        <p className="text-xs text-gray-500">ID: {member.employee_id}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {member.user ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700" title={member.user_username}>User</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">No Account</span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[member.employment_status] || 'bg-gray-100 text-gray-800'}`}>
                      {member.employment_status}
                    </span>
                  </div>
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
                  {!member.user && (
                    <button
                      onClick={() => openConvertModal(member)}
                      className="text-sm text-purple-600 hover:text-purple-800 font-medium"
                    >
                      Create Account
                    </button>
                  )}
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
                  <th className="pb-3 pr-2 w-10">
                    <input
                      type="checkbox"
                      checked={staffWithoutAccounts.length > 0 && selectedStaff.size === staffWithoutAccounts.length}
                      onChange={toggleSelectAllStaff}
                      className="rounded"
                      title="Select all staff without accounts"
                    />
                  </th>
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Department</th>
                  <th className="pb-3 pr-4">Designation</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Account</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Contact</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStaff.map((member) => (
                  <tr key={member.id} className={`hover:bg-gray-50 ${selectedStaff.has(member.id) ? 'bg-purple-50' : ''}`}>
                    <td className="py-3 pr-2">
                      {!member.user ? (
                        <input
                          type="checkbox"
                          checked={selectedStaff.has(member.id)}
                          onChange={() => toggleStaffSelection(member.id)}
                          className="rounded"
                        />
                      ) : <span className="w-4 h-4 block" />}
                    </td>
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
                      {member.user ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700" title={member.user_username}>
                          {member.user_username || 'User'}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">No Account</span>
                      )}
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
                    <td className="py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-3">
                        <Link
                          to={`/hr/staff/${member.id}/edit`}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </Link>
                        {!member.user && (
                          <button
                            onClick={() => openConvertModal(member)}
                            className="text-sm text-purple-600 hover:text-purple-800 font-medium"
                          >
                            Create Account
                          </button>
                        )}
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

      {/* Quick Add Modal */}
      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowQuickAdd(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Quick Add Staff</h2>
                <p className="text-xs text-gray-500">Add basic info now, fill details later</p>
              </div>
              <button onClick={() => setShowQuickAdd(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {quickErrors && (
              <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{quickErrors}</div>
            )}

            <form onSubmit={handleQuickSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Ahmed"
                    value={quickForm.first_name}
                    onChange={e => setQuickForm(p => ({ ...p, first_name: e.target.value }))}
                    autoFocus
                    required
                  />
                </div>
                <div>
                  <label className="label">Last Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Khan"
                    value={quickForm.last_name}
                    onChange={e => setQuickForm(p => ({ ...p, last_name: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Phone</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 0300-1234567"
                  value={quickForm.phone}
                  onChange={e => setQuickForm(p => ({ ...p, phone: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Department</label>
                  <select className="input" value={quickForm.department} onChange={e => setQuickForm(p => ({ ...p, department: e.target.value }))}>
                    <option value="">-- None --</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Designation</label>
                  <select className="input" value={quickForm.designation} onChange={e => handleQuickDesigChange(e.target.value)}>
                    <option value="">-- None --</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Create User Account */}
              <div className="border-t border-gray-200 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={quickCreateUser}
                    onChange={(e) => {
                      setQuickCreateUser(e.target.checked)
                      if (e.target.checked && quickForm.first_name) {
                        const suggested = `${quickForm.first_name}_${quickForm.last_name}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
                        setQuickUserForm(f => ({ ...f, username: suggested }))
                      }
                    }}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Create User Account</span>
                </label>

                {quickCreateUser && (
                  <div className="mt-2 space-y-2 p-3 bg-gray-50 rounded-lg ml-6">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Username *</label>
                        <input type="text" className="input text-sm" value={quickUserForm.username} onChange={e => setQuickUserForm(f => ({ ...f, username: e.target.value }))} placeholder="Login username" required />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Role *</label>
                        <select className="input text-sm" value={quickUserForm.user_role} onChange={e => setQuickUserForm(f => ({ ...f, user_role: e.target.value }))}>
                          {quickStaffRoleOptions.map(r => <option key={r} value={r}>{QUICK_ROLE_LABELS[r] || r}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Password *</label>
                        <input type="password" className="input text-sm" value={quickUserForm.password} onChange={e => setQuickUserForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 chars" required />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Confirm *</label>
                        <input type="password" className="input text-sm" value={quickUserForm.confirm_password} onChange={e => setQuickUserForm(f => ({ ...f, confirm_password: e.target.value }))} placeholder="Confirm" required />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowQuickAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={quickAddMutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {quickAddMutation.isPending ? 'Adding...' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Bulk Convert Action Bar */}
      {selectedStaff.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-purple-600 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4">
          <span className="text-sm font-medium">{selectedStaff.size} staff selected</span>
          <button
            onClick={() => {
              setBulkConvertPassword('')
              setBulkConvertRole('TEACHER')
              setBulkConvertError('')
              setConvertResults(null)
              setShowBulkConvertModal(true)
            }}
            className="bg-white text-purple-700 px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-purple-50"
          >
            Create Accounts
          </button>
          <button
            onClick={() => setSelectedStaff(new Set())}
            className="text-purple-200 hover:text-white text-sm"
          >
            Clear
          </button>
        </div>
      )}

      {/* Individual Convert Modal */}
      {showConvertModal && convertMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Create User Account</h2>
            <p className="text-sm text-gray-500 mb-4">
              For: <strong>{convertMember.first_name} {convertMember.last_name}</strong> ({convertMember.employee_id})
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                <input
                  type="text"
                  className="input"
                  value={convertForm.username}
                  onChange={(e) => setConvertForm(f => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  className="input"
                  value={convertForm.user_role}
                  onChange={(e) => setConvertForm(f => ({ ...f, user_role: e.target.value }))}
                >
                  {convertRoleOptions.map(r => (
                    <option key={r} value={r}>{QUICK_ROLE_LABELS[r] || r}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                  <input
                    type="password"
                    className="input"
                    value={convertForm.password}
                    onChange={(e) => setConvertForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Min 8 chars"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm *</label>
                  <input
                    type="password"
                    className="input"
                    value={convertForm.confirm_password}
                    onChange={(e) => setConvertForm(f => ({ ...f, confirm_password: e.target.value }))}
                    placeholder="Confirm"
                  />
                </div>
              </div>
              {convertError && <p className="text-sm text-red-600">{convertError}</p>}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => { setShowConvertModal(false); setConvertMember(null) }}
                className="btn btn-secondary"
                disabled={isConverting}
              >
                Cancel
              </button>
              <button
                onClick={handleIndividualConvert}
                className="btn btn-primary"
                disabled={isConverting}
              >
                {isConverting ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Convert Modal */}
      {showBulkConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Bulk Create User Accounts</h2>

            {!convertResults ? (
              <>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                  <p className="text-purple-800 text-sm">
                    Create user accounts for <strong>{selectedStaff.size}</strong> selected staff member(s).
                    Usernames will be auto-generated from names.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Default Role *</label>
                    <select
                      className="input"
                      value={bulkConvertRole}
                      onChange={(e) => setBulkConvertRole(e.target.value)}
                    >
                      {convertRoleOptions.map(r => (
                        <option key={r} value={r}>{QUICK_ROLE_LABELS[r] || r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Default Password *</label>
                    <input
                      type="password"
                      className="input"
                      value={bulkConvertPassword}
                      onChange={(e) => setBulkConvertPassword(e.target.value)}
                      placeholder="Min 8 characters — same for all accounts"
                    />
                    <p className="text-xs text-gray-500 mt-1">Staff can change their password after first login.</p>
                  </div>
                </div>
                {bulkConvertError && <p className="text-sm text-red-600 mt-2">{bulkConvertError}</p>}

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => setShowBulkConvertModal(false)}
                    className="btn btn-secondary"
                    disabled={isConverting}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkConvert}
                    className="btn btn-primary"
                    disabled={isConverting}
                  >
                    {isConverting ? 'Creating...' : `Create ${selectedStaff.size} Account(s)`}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3 mb-6">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-green-800 text-sm font-medium">Created: {convertResults.created_count} account(s)</p>
                  </div>
                  {convertResults.skipped_count > 0 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-yellow-800 text-sm font-medium">Skipped: {convertResults.skipped_count} (already have accounts)</p>
                    </div>
                  )}
                  {convertResults.error_count > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-red-800 text-sm font-medium">Errors: {convertResults.error_count}</p>
                      <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                        {convertResults.errors?.map((e, i) => (
                          <li key={i}>{e.name}: {e.error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {convertResults.created?.length > 0 && (
                    <div className="max-h-40 overflow-y-auto">
                      <p className="text-xs font-medium text-gray-600 mb-1">Created usernames:</p>
                      <div className="space-y-1">
                        {convertResults.created.map((c, i) => (
                          <div key={i} className="flex justify-between text-xs bg-gray-50 px-2 py-1 rounded">
                            <span className="text-gray-700">{c.name}</span>
                            <span className="font-mono text-gray-900">{c.username}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setShowBulkConvertModal(false); setConvertResults(null) }}
                    className="btn btn-primary"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeBulkImport}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Import Staff from CSV</h2>
                <p className="text-xs text-gray-500">Upload a CSV file with staff details</p>
              </div>
              <button onClick={closeBulkImport} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {/* CSV Format Guide */}
            <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-600">
              <p className="font-medium text-gray-700 mb-1">CSV Format (first row must be headers):</p>
              <p className="font-mono bg-white px-2 py-1 rounded border text-[11px] break-all">first_name,last_name,phone,email,department,designation,gender</p>
              <p className="mt-1 text-gray-500">Required: <strong>first_name, last_name</strong>. All other columns are optional.</p>
              <p className="text-gray-500">Department/Designation must match existing names. Gender: MALE, FEMALE, or OTHER.</p>
            </div>

            {/* File Input */}
            <div className="mb-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            {/* Parse error */}
            {bulkParsed?.error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{bulkParsed.error}</div>
            )}

            {/* Preview */}
            {bulkParsed?.rows && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Preview: {bulkParsed.rows.length} staff member{bulkParsed.rows.length !== 1 ? 's' : ''} found
                </p>
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Phone</th>
                        <th className="px-3 py-2 text-left">Department</th>
                        <th className="px-3 py-2 text-left">Designation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkParsed.rows.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 font-medium">{row.first_name} {row.last_name}</td>
                          <td className="px-3 py-1.5 text-gray-600">{row.phone || '—'}</td>
                          <td className="px-3 py-1.5 text-gray-600">{row.department_name || '—'}</td>
                          <td className="px-3 py-1.5 text-gray-600">{row.designation_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bulkParsed.rows.length > 10 && (
                    <p className="text-xs text-gray-400 text-center py-1">...and {bulkParsed.rows.length - 10} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Import Result */}
            {bulkResult && (
              <div className={`mb-4 p-3 rounded-lg text-sm ${bulkResult.failed > 0 ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800'}`}>
                <p className="font-medium">{bulkResult.success} imported, {bulkResult.failed} failed</p>
                {bulkResult.errors.length > 0 && (
                  <ul className="mt-1 text-xs list-disc list-inside">
                    {bulkResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                    {bulkResult.errors.length > 5 && <li>...and {bulkResult.errors.length - 5} more errors</li>}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={closeBulkImport} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                {bulkResult ? 'Close' : 'Cancel'}
              </button>
              {bulkParsed?.rows && !bulkResult && (
                <button
                  onClick={handleBulkImport}
                  disabled={bulkImporting}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {bulkImporting ? `Importing... ` : `Import ${bulkParsed.rows.length} Staff`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
