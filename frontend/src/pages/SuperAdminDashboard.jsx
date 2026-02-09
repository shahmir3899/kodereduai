import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi, usersApi } from '../services/api'

export default function SuperAdminDashboard() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('schools')

  const [showAddModal, setShowAddModal] = useState(false)
  const [newSchool, setNewSchool] = useState({
    name: '',
    subdomain: '',
    contact_email: '',
    contact_phone: '',
    address: '',
  })

  // User management state
  const [showUserModal, setShowUserModal] = useState(false)
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    confirm_password: '',
    first_name: '',
    last_name: '',
    role: 'SCHOOL_ADMIN',
    school: '',
    phone: '',
  })

  // Fetch all schools
  const { data: schoolsData, isLoading: schoolsLoading } = useQuery({
    queryKey: ['adminSchools'],
    queryFn: () => schoolsApi.getAllSchools(),
  })

  // Fetch all users
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => usersApi.getUsers({ page_size: 100 }),
  })

  // Create school mutation
  const createSchoolMutation = useMutation({
    mutationFn: (data) => schoolsApi.createSchool(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['adminSchools'])
      setShowAddModal(false)
      setNewSchool({ name: '', subdomain: '', contact_email: '', contact_phone: '', address: '' })
    },
  })

  // Toggle school status mutation
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) =>
      isActive ? schoolsApi.deactivateSchool(id) : schoolsApi.activateSchool(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['adminSchools'])
    },
  })

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: (data) => usersApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['adminUsers'])
      setShowUserModal(false)
      setNewUser({
        username: '',
        email: '',
        password: '',
        confirm_password: '',
        first_name: '',
        last_name: '',
        role: 'SCHOOL_ADMIN',
        school: '',
        phone: '',
      })
    },
  })

  // Toggle user active status mutation
  const toggleUserMutation = useMutation({
    mutationFn: ({ id, isActive }) =>
      usersApi.updateUser(id, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries(['adminUsers'])
    },
  })

  const handleCreateSchool = () => {
    createSchoolMutation.mutate({
      ...newSchool,
      enabled_modules: { attendance_ai: true, whatsapp: false },
    })
  }

  const handleCreateUser = () => {
    const userData = { ...newUser }
    if (!userData.school) {
      delete userData.school
    }
    createUserMutation.mutate(userData)
  }

  const schools = schoolsData?.data?.results || schoolsData?.data || []
  const users = usersData?.data?.results || usersData?.data || []

  // Calculate stats
  const activeSchools = schools.filter((s) => s.is_active).length
  const totalStudents = schools.reduce((acc, s) => acc + (s.student_count || 0), 0)
  const totalUsers = schools.reduce((acc, s) => acc + (s.user_count || 0), 0)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage all schools and users on the platform</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <div className="card">
          <p className="text-sm text-gray-500">Total Schools</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{schools.length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Active Schools</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600">{activeSchools}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Total Students</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{totalStudents}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Total Users</p>
          <p className="text-2xl sm:text-3xl font-bold text-gray-900">{users.length || totalUsers}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto">
          <button
            onClick={() => setActiveTab('schools')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'schools'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Schools
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'users'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Users
          </button>
        </nav>
      </div>

      {/* Schools Tab */}
      {activeTab === 'schools' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Schools</h2>
            <button
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary"
            >
              Add School
            </button>
          </div>

          {schoolsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : schools.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No schools yet. Add your first school to get started.
            </div>
          ) : (
            <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-3">
              {schools.map((school) => (
                <div key={school.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm text-gray-900">{school.name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      school.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {school.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{school.subdomain}.kodereduai.pk</p>
                  <div className="flex gap-4 mt-1 text-xs text-gray-600">
                    <span>{school.student_count || 0} students</span>
                    <span>{school.user_count || 0} users</span>
                  </div>
                  <button
                    onClick={() => toggleMutation.mutate({ id: school.id, isActive: school.is_active })}
                    className={`mt-2 text-xs font-medium ${school.is_active ? 'text-red-600' : 'text-green-600'}`}
                  >
                    {school.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              ))}
            </div>
            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">School</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subdomain</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Students</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {schools.map((school) => (
                    <tr key={school.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">{school.name}</p>
                          <p className="text-sm text-gray-500">{school.contact_email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {school.subdomain}.kodereduai.pk
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{school.student_count || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{school.user_count || 0}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          school.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {school.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleMutation.mutate({ id: school.id, isActive: school.is_active })}
                          className={`text-sm font-medium ${
                            school.is_active
                              ? 'text-red-600 hover:text-red-700'
                              : 'text-green-600 hover:text-green-700'
                          }`}
                        >
                          {school.is_active ? 'Deactivate' : 'Activate'}
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
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
            <button
              onClick={() => setShowUserModal(true)}
              className="btn btn-primary"
            >
              Add User
            </button>
          </div>

          {usersLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No users yet. Add your first user to get started.
            </div>
          ) : (
            <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-3">
              {users.map((user) => (
                <div key={user.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">{user.first_name} {user.last_name}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email || user.username}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ml-2 ${
                      user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-800' :
                      user.role === 'SCHOOL_ADMIN' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {user.role_display || user.role}
                    </span>
                    {user.school_name && <span className="text-xs text-gray-500">{user.school_name}</span>}
                  </div>
                  {user.role !== 'SUPER_ADMIN' && (
                    <button
                      onClick={() => toggleUserMutation.mutate({ id: user.id, isActive: user.is_active })}
                      className={`mt-2 text-xs font-medium ${user.is_active ? 'text-red-600' : 'text-green-600'}`}
                    >
                      {user.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">School</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">
                            {user.first_name} {user.last_name}
                          </p>
                          <p className="text-sm text-gray-500">{user.email || user.username}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          user.role === 'SUPER_ADMIN'
                            ? 'bg-purple-100 text-purple-800'
                            : user.role === 'SCHOOL_ADMIN'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {user.role_display || user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {user.school_name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          user.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {user.role !== 'SUPER_ADMIN' && (
                          <button
                            onClick={() => toggleUserMutation.mutate({ id: user.id, isActive: user.is_active })}
                            className={`text-sm font-medium ${
                              user.is_active
                                ? 'text-red-600 hover:text-red-700'
                                : 'text-green-600 hover:text-green-700'
                            }`}
                          >
                            {user.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {/* Add School Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add School</h2>

            <div className="space-y-4">
              <div>
                <label className="label">School Name</label>
                <input
                  type="text"
                  className="input"
                  value={newSchool.name}
                  onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Subdomain</label>
                <div className="flex flex-col sm:flex-row">
                  <input
                    type="text"
                    className="input rounded-b-none sm:rounded-b-lg sm:rounded-r-none"
                    placeholder="focus"
                    value={newSchool.subdomain}
                    onChange={(e) => setNewSchool({ ...newSchool, subdomain: e.target.value.toLowerCase() })}
                    required
                  />
                  <span className="inline-flex items-center px-3 py-2 bg-gray-100 border border-t-0 sm:border-t sm:border-l-0 border-gray-300 rounded-b-lg sm:rounded-b-none sm:rounded-r-lg text-sm text-gray-500">
                    .kodereduai.pk
                  </span>
                </div>
              </div>

              <div>
                <label className="label">Contact Email</label>
                <input
                  type="email"
                  className="input"
                  value={newSchool.contact_email}
                  onChange={(e) => setNewSchool({ ...newSchool, contact_email: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Contact Phone</label>
                <input
                  type="text"
                  className="input"
                  value={newSchool.contact_phone}
                  onChange={(e) => setNewSchool({ ...newSchool, contact_phone: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Address</label>
                <textarea
                  className="input"
                  rows={2}
                  value={newSchool.address}
                  onChange={(e) => setNewSchool({ ...newSchool, address: e.target.value })}
                />
              </div>
            </div>

            {createSchoolMutation.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {createSchoolMutation.error.response?.data?.subdomain?.[0] || 'Failed to create school'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSchool}
                disabled={createSchoolMutation.isPending || !newSchool.name || !newSchool.subdomain}
                className="btn btn-primary"
              >
                {createSchoolMutation.isPending ? 'Creating...' : 'Create School'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Add User</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="label">First Name</label>
                  <input
                    type="text"
                    className="input"
                    value={newUser.first_name}
                    onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Last Name</label>
                  <input
                    type="text"
                    className="input"
                    value={newUser.last_name}
                    onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Username *</label>
                <input
                  type="text"
                  className="input"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Password *</label>
                <input
                  type="password"
                  className="input"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Confirm Password *</label>
                <input
                  type="password"
                  className="input"
                  value={newUser.confirm_password}
                  onChange={(e) => setNewUser({ ...newUser, confirm_password: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Role *</label>
                <select
                  className="input"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="SCHOOL_ADMIN">School Admin</option>
                  <option value="STAFF">Staff</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </div>

              {newUser.role !== 'SUPER_ADMIN' && (
                <div>
                  <label className="label">School *</label>
                  <select
                    className="input"
                    value={newUser.school}
                    onChange={(e) => setNewUser({ ...newUser, school: e.target.value })}
                  >
                    <option value="">Select a school...</option>
                    {schools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">Phone</label>
                <input
                  type="text"
                  className="input"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                />
              </div>
            </div>

            {createUserMutation.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {createUserMutation.error.response?.data?.username?.[0] ||
                  createUserMutation.error.response?.data?.email?.[0] ||
                  createUserMutation.error.response?.data?.password?.[0] ||
                  createUserMutation.error.response?.data?.confirm_password?.[0] ||
                  createUserMutation.error.response?.data?.detail ||
                  'Failed to create user'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowUserModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                disabled={
                  createUserMutation.isPending ||
                  !newUser.username ||
                  !newUser.password ||
                  !newUser.confirm_password ||
                  (newUser.role !== 'SUPER_ADMIN' && !newUser.school)
                }
                className="btn btn-primary"
              >
                {createUserMutation.isPending ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
