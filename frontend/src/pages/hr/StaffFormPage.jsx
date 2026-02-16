import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  gender: '',
  date_of_birth: '',
  department: '',
  designation: '',
  employee_id: '',
  employment_type: 'FULL_TIME',
  employment_status: 'ACTIVE',
  date_of_joining: '',
  address: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  notes: '',
}

export default function StaffFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { getAllowableRoles } = useAuth()
  const isEdit = !!id

  const [form, setForm] = useState(EMPTY_FORM)
  const [createUserAccount, setCreateUserAccount] = useState(false)
  const [staffUserForm, setStaffUserForm] = useState({
    username: '', password: '', confirm_password: '', user_role: 'STAFF',
  })
  const [staffUserError, setStaffUserError] = useState('')
  const staffRoleOptions = getAllowableRoles().filter(r => !['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(r))

  const ROLE_LABELS = {
    HR_MANAGER: 'HR Manager', ACCOUNTANT: 'Accountant', TEACHER: 'Teacher', STAFF: 'Staff',
  }

  // Fetch existing staff member for edit
  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['hrStaffMember', id],
    queryFn: () => hrApi.getStaffMember(id),
    enabled: isEdit,
  })

  // Fetch departments
  const { data: deptData } = useQuery({
    queryKey: ['hrDepartments'],
    queryFn: () => hrApi.getDepartments({ page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch designations (filtered by selected department)
  const { data: desigData } = useQuery({
    queryKey: ['hrDesignations', form.department],
    queryFn: () => hrApi.getDesignations(form.department ? { department: form.department, page_size: 9999 } : { page_size: 9999 }),
    staleTime: 5 * 60 * 1000,
  })

  // Auto-generate employee ID for new staff
  const { data: nextIdData } = useQuery({
    queryKey: ['hrNextEmployeeId'],
    queryFn: () => hrApi.getNextEmployeeId(),
    enabled: !isEdit,
  })

  useEffect(() => {
    if (!isEdit && nextIdData?.data?.next_employee_id) {
      setForm(p => ({ ...p, employee_id: nextIdData.data.next_employee_id }))
    }
  }, [nextIdData, isEdit])

  // Populate form on edit
  useEffect(() => {
    if (staffData?.data) {
      const s = staffData.data
      setForm({
        first_name: s.first_name || '',
        last_name: s.last_name || '',
        email: s.email || '',
        phone: s.phone || '',
        gender: s.gender || '',
        date_of_birth: s.date_of_birth || '',
        department: s.department ? String(s.department) : '',
        designation: s.designation ? String(s.designation) : '',
        employee_id: s.employee_id || '',
        employment_type: s.employment_type || 'FULL_TIME',
        employment_status: s.employment_status || 'ACTIVE',
        date_of_joining: s.date_of_joining || '',
        address: s.address || '',
        emergency_contact_name: s.emergency_contact_name || '',
        emergency_contact_phone: s.emergency_contact_phone || '',
        notes: s.notes || '',
      })
    }
  }, [staffData])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data) => hrApi.createStaff(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Staff member created successfully!')
      navigate('/hr/staff')
    },
    onError: (error) => {
      const data = error.response?.data
      const message = data?.employee_id?.[0] || data?.detail || data?.non_field_errors?.[0] || error.message || 'Failed to create staff member'
      showError(message)
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data) => hrApi.updateStaff(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrStaff'] })
      queryClient.invalidateQueries({ queryKey: ['hrStaffMember', id] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Staff member updated successfully!')
      navigate('/hr/staff')
    },
    onError: (error) => {
      const data = error.response?.data
      const message = data?.employee_id?.[0] || data?.detail || data?.non_field_errors?.[0] || error.message || 'Failed to update staff member'
      showError(message)
    },
  })

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      // Clear designation when department changes
      if (field === 'department') {
        next.designation = ''
      }
      // Auto-fill department when designation is selected (if department is empty)
      if (field === 'designation' && value && !prev.department) {
        const allDesigs = desigData?.data?.results || desigData?.data || []
        const desig = allDesigs.find(d => String(d.id) === value)
        if (desig?.department) {
          next.department = String(desig.department)
        }
      }
      return next
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setStaffUserError('')

    if (!form.first_name || !form.last_name) {
      showError('First name and last name are required.')
      return
    }

    // Validate user account fields if checkbox is checked
    if (createUserAccount && !isEdit) {
      if (!staffUserForm.username || !staffUserForm.password) {
        setStaffUserError('Username and password are required.')
        return
      }
      if (staffUserForm.password.length < 8) {
        setStaffUserError('Password must be at least 8 characters.')
        return
      }
      if (staffUserForm.password !== staffUserForm.confirm_password) {
        setStaffUserError("Passwords don't match.")
        return
      }
    }

    const payload = { ...form }
    // Convert empty strings to null for nullable fields
    if (!payload.department) payload.department = null
    if (!payload.designation) payload.designation = null
    if (!payload.date_of_birth) payload.date_of_birth = null
    if (!payload.date_of_joining) payload.date_of_joining = null
    if (!payload.gender) payload.gender = null

    // Add user account fields if checkbox is checked
    if (createUserAccount && !isEdit) {
      payload.create_user_account = true
      payload.username = staffUserForm.username
      payload.password = staffUserForm.password
      payload.confirm_password = staffUserForm.confirm_password
      payload.user_role = staffUserForm.user_role
    }

    if (isEdit) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const departments = deptData?.data?.results || deptData?.data || []
  const designations = desigData?.data?.results || desigData?.data || []
  const isSubmitting = createMutation.isPending || updateMutation.isPending

  if (isEdit && staffLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          {isEdit ? 'Edit Staff Member' : 'Add Staff Member'}
        </h1>
        <p className="text-sm text-gray-600">
          {isEdit ? 'Update staff member details' : 'Fill in the details to add a new staff member'}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Personal Information */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Information</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.first_name}
                    onChange={(e) => handleChange('first_name', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Last Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.last_name}
                    onChange={(e) => handleChange('last_name', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone</label>
                  <input
                    type="text"
                    className="input"
                    value={form.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select
                    className="input"
                    value={form.gender}
                    onChange={(e) => handleChange('gender', e.target.value)}
                  >
                    <option value="">Select</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Date of Birth</label>
                <input
                  type="date"
                  className="input"
                  value={form.date_of_birth}
                  onChange={(e) => handleChange('date_of_birth', e.target.value)}
                />
              </div>

              <div>
                <label className="label">Address</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Employment Details */}
          <div className="space-y-6">
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Employment Details</h2>
              <div className="space-y-4">
                <div>
                  <label className="label">Employee ID {!isEdit && <span className="text-xs text-gray-400 font-normal">(Auto-generated)</span>}</label>
                  <input
                    type="text"
                    className={`input ${!isEdit ? 'bg-gray-50 text-gray-500' : ''}`}
                    placeholder="e.g., EMP-001"
                    value={form.employee_id}
                    onChange={(e) => handleChange('employee_id', e.target.value)}
                    readOnly={!isEdit}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Department <span className="text-xs text-gray-400 font-normal">(Optional)</span></label>
                    <select
                      className="input"
                      value={form.department}
                      onChange={(e) => handleChange('department', e.target.value)}
                    >
                      <option value="">Select Department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Designation <span className="text-xs text-gray-400 font-normal">(Optional)</span></label>
                    <select
                      className="input"
                      value={form.designation}
                      onChange={(e) => handleChange('designation', e.target.value)}
                    >
                      <option value="">Select Designation</option>
                      {designations.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Employment Type</label>
                    <select
                      className="input"
                      value={form.employment_type}
                      onChange={(e) => handleChange('employment_type', e.target.value)}
                    >
                      <option value="FULL_TIME">Full Time</option>
                      <option value="PART_TIME">Part Time</option>
                      <option value="CONTRACT">Contract</option>
                      <option value="TEMPORARY">Temporary</option>
                      <option value="INTERN">Intern</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Employment Status</label>
                    <select
                      className="input"
                      value={form.employment_status}
                      onChange={(e) => handleChange('employment_status', e.target.value)}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="ON_LEAVE">On Leave</option>
                      <option value="TERMINATED">Terminated</option>
                      <option value="RESIGNED">Resigned</option>
                      <option value="RETIRED">Retired</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Date of Joining</label>
                  <input
                    type="date"
                    className="input"
                    value={form.date_of_joining}
                    onChange={(e) => handleChange('date_of_joining', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Emergency Contact</h2>
              <div className="space-y-4">
                <div>
                  <label className="label">Contact Name</label>
                  <input
                    type="text"
                    className="input"
                    value={form.emergency_contact_name}
                    onChange={(e) => handleChange('emergency_contact_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Contact Phone</label>
                  <input
                    type="text"
                    className="input"
                    value={form.emergency_contact_phone}
                    onChange={(e) => handleChange('emergency_contact_phone', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Notes</h2>
              <textarea
                className="input"
                rows={3}
                placeholder="Any additional notes..."
                value={form.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Create User Account */}
        {!isEdit && (
          <div className="card mt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">User Account</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={createUserAccount}
                onChange={(e) => {
                  setCreateUserAccount(e.target.checked)
                  if (e.target.checked && form.first_name) {
                    const suggested = `${form.first_name}_${form.last_name}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
                    setStaffUserForm(f => ({ ...f, username: suggested }))
                  }
                }}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">Create User Account</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">Create login credentials so this staff member can access the system</p>

            {createUserAccount && (
              <div className="mt-4 ml-6 space-y-3 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Username *</label>
                    <input
                      type="text"
                      className="input"
                      value={staffUserForm.username}
                      onChange={(e) => setStaffUserForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="Login username"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">User Role *</label>
                    <select
                      className="input"
                      value={staffUserForm.user_role}
                      onChange={(e) => setStaffUserForm(f => ({ ...f, user_role: e.target.value }))}
                    >
                      {staffRoleOptions.map(role => (
                        <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Password *</label>
                    <input
                      type="password"
                      className="input"
                      value={staffUserForm.password}
                      onChange={(e) => setStaffUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Min 8 characters"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Confirm Password *</label>
                    <input
                      type="password"
                      className="input"
                      value={staffUserForm.confirm_password}
                      onChange={(e) => setStaffUserForm(f => ({ ...f, confirm_password: e.target.value }))}
                      placeholder="Confirm password"
                      required
                    />
                  </div>
                </div>
                {staffUserError && <p className="text-sm text-red-600">{staffUserError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={() => navigate('/hr/staff')}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
          >
            {isSubmitting ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Staff Member')}
          </button>
        </div>
      </form>
    </div>
  )
}
