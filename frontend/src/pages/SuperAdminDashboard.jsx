import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi, usersApi, organizationsApi, membershipsApi } from '../services/api'

export default function SuperAdminDashboard() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('overview')

  // ── School state ──────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingSchool, setEditingSchool] = useState(null)
  const [newSchool, setNewSchool] = useState({
    name: '',
    subdomain: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    organization: '',
  })

  // ── User state ────────────────────────────────────────────────────────────
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    confirm_password: '',
    first_name: '',
    last_name: '',
    role: 'SCHOOL_ADMIN',
    schools: [],
    phone: '',
  })

  // ── Organization state ────────────────────────────────────────────────────
  const [showOrgModal, setShowOrgModal] = useState(false)
  const [editingOrg, setEditingOrg] = useState(null)
  const [newOrg, setNewOrg] = useState({ name: '', slug: '', logo: '' })

  // ── Membership state ──────────────────────────────────────────────────────
  const [showMemModal, setShowMemModal] = useState(false)
  const [editingMem, setEditingMem] = useState(null)
  const [newMembership, setNewMembership] = useState({
    user: '',
    school: '',
    role: 'STAFF',
    is_default: false,
  })

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: platformStatsData } = useQuery({
    queryKey: ['platformStats'],
    queryFn: () => schoolsApi.getPlatformStats(),
  })
  const pStats = platformStatsData?.data || {}

  const { data: schoolsData, isLoading: schoolsLoading } = useQuery({
    queryKey: ['adminSchools'],
    queryFn: () => schoolsApi.getAllSchools({ page_size: 9999 }),
  })

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => usersApi.getUsers({ page_size: 100 }),
  })

  const { data: orgsData, isLoading: orgsLoading } = useQuery({
    queryKey: ['adminOrgs'],
    queryFn: () => organizationsApi.getAll({ page_size: 9999 }),
  })

  const { data: membershipsData, isLoading: membershipsLoading } = useQuery({
    queryKey: ['adminMemberships'],
    queryFn: () => membershipsApi.getAll({ page_size: 9999 }),
  })

  const { data: moduleRegistryData } = useQuery({
    queryKey: ['moduleRegistry'],
    queryFn: () => schoolsApi.getModuleRegistry(),
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  // School
  const createSchoolMutation = useMutation({
    mutationFn: (data) => schoolsApi.createSchool(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSchools'] })
      setShowAddModal(false)
      setEditingSchool(null)
      setNewSchool({ name: '', subdomain: '', contact_email: '', contact_phone: '', address: '', organization: '' })
    },
  })

  const updateSchoolMutation = useMutation({
    mutationFn: ({ id, data }) => schoolsApi.updateSchool(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSchools'] })
      setShowAddModal(false)
      setEditingSchool(null)
      setNewSchool({ name: '', subdomain: '', contact_email: '', contact_phone: '', address: '', organization: '' })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) =>
      isActive ? schoolsApi.deactivateSchool(id) : schoolsApi.activateSchool(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminSchools'] }),
  })

  // User
  const userDefaults = { username: '', email: '', password: '', confirm_password: '', first_name: '', last_name: '', role: 'SCHOOL_ADMIN', schools: [], phone: '' }

  const createUserMutation = useMutation({
    mutationFn: async ({ selectedSchools, ...userData }) => {
      const role = userData.role
      // Set first school as primary
      if (selectedSchools.length > 0) {
        userData.school = selectedSchools[0]
      }
      const response = await usersApi.createUser(userData)
      const userId = response.data.id

      // Auto-create memberships for all selected schools
      if (selectedSchools.length > 0) {
        await Promise.all(selectedSchools.map((schoolId, i) =>
          membershipsApi.create({
            user: userId,
            school: Number(schoolId),
            role: role,
            is_default: i === 0,
          }).catch(() => {}) // Ignore if membership already exists
        ))
      }
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
      queryClient.invalidateQueries({ queryKey: ['adminMemberships'] })
      setShowUserModal(false)
      setEditingUser(null)
      setNewUser(userDefaults)
    },
  })

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => usersApi.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
      setShowUserModal(false)
      setEditingUser(null)
      setNewUser(userDefaults)
    },
  })

  const toggleUserMutation = useMutation({
    mutationFn: ({ id, isActive }) => usersApi.updateUser(id, { is_active: !isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  })

  // Organization
  const createOrgMutation = useMutation({
    mutationFn: (data) => organizationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminOrgs'] })
      setShowOrgModal(false)
      setEditingOrg(null)
      setNewOrg({ name: '', slug: '', logo: '' })
    },
  })

  const updateOrgMutation = useMutation({
    mutationFn: ({ id, data }) => organizationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminOrgs'] })
      setShowOrgModal(false)
      setEditingOrg(null)
      setNewOrg({ name: '', slug: '', logo: '' })
    },
  })

  const deleteOrgMutation = useMutation({
    mutationFn: (id) => organizationsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminOrgs'] }),
  })

  // Membership
  const createMemMutation = useMutation({
    mutationFn: (data) => membershipsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMemberships'] })
      setShowMemModal(false)
      setEditingMem(null)
      setNewMembership({ user: '', school: '', role: 'STAFF', is_default: false })
    },
  })

  const updateMemMutation = useMutation({
    mutationFn: ({ id, data }) => membershipsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminMemberships'] })
      setShowMemModal(false)
      setEditingMem(null)
      setNewMembership({ user: '', school: '', role: 'STAFF', is_default: false })
    },
  })

  const deleteMemMutation = useMutation({
    mutationFn: (id) => membershipsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminMemberships'] }),
  })

  // Module toggles — optimistic updates for instant UI feel
  const [moduleMsg, setModuleMsg] = useState(null)

  const setQueryItem = (queryKey, id, patch) => {
    queryClient.setQueryData(queryKey, (old) => {
      if (!old?.data) return old
      const list = Array.isArray(old.data) ? old.data : old.data.results
      if (!list) return old
      const updated = list.map(item => item.id === id ? { ...item, ...patch } : item)
      return { ...old, data: Array.isArray(old.data) ? updated : { ...old.data, results: updated } }
    })
  }

  const toggleOrgModuleMutation = useMutation({
    mutationFn: ({ id, allowed_modules }) =>
      organizationsApi.update(id, { allowed_modules }),
    onMutate: async ({ id, allowed_modules }) => {
      await queryClient.cancelQueries({ queryKey: ['adminOrgs'] })
      const prev = queryClient.getQueryData(['adminOrgs'])
      setQueryItem(['adminOrgs'], id, { allowed_modules })
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['adminOrgs'], ctx.prev)
      const detail = err.response?.data?.allowed_modules || err.response?.data?.detail || err.message
      setModuleMsg({ type: 'error', text: `Failed: ${detail}` })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['adminOrgs'] })
      queryClient.invalidateQueries({ queryKey: ['adminSchools'] })
    },
  })

  const toggleSchoolModuleMutation = useMutation({
    mutationFn: ({ id, enabled_modules }) =>
      schoolsApi.updateSchool(id, { enabled_modules }),
    onMutate: async ({ id, enabled_modules }) => {
      await queryClient.cancelQueries({ queryKey: ['adminSchools'] })
      const prev = queryClient.getQueryData(['adminSchools'])
      setQueryItem(['adminSchools'], id, { enabled_modules })
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['adminSchools'], ctx.prev)
      const detail = err.response?.data?.enabled_modules || err.response?.data?.detail || err.message
      setModuleMsg({ type: 'error', text: `Failed: ${detail}` })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSchools'] })
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSaveSchool = () => {
    const payload = { ...newSchool }
    if (!payload.organization) payload.organization = null
    if (editingSchool) {
      updateSchoolMutation.mutate({ id: editingSchool.id, data: payload })
    } else {
      // Set all modules enabled by default for new schools
      const defaultModules = {}
      moduleRegistry.forEach(mod => { defaultModules[mod.key] = true })
      payload.enabled_modules = defaultModules
      createSchoolMutation.mutate(payload)
    }
  }

  const openEditSchool = (school) => {
    setEditingSchool(school)
    setNewSchool({
      name: school.name,
      subdomain: school.subdomain,
      contact_email: school.contact_email || '',
      contact_phone: school.contact_phone || '',
      address: school.address || '',
      organization: school.organization || '',
    })
    setShowAddModal(true)
  }

  const handleSaveUser = () => {
    if (editingUser) {
      updateUserMutation.mutate({
        id: editingUser.id,
        data: {
          email: newUser.email,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          role: newUser.role,
          phone: newUser.phone,
        },
      })
    } else {
      const { schools: selectedSchools, ...rest } = newUser
      createUserMutation.mutate({
        ...rest,
        selectedSchools,
      })
    }
  }

  const openEditUser = (user) => {
    setEditingUser(user)
    setNewUser({
      username: user.username,
      email: user.email || '',
      password: '',
      confirm_password: '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      role: user.role,
      schools: [],
      phone: user.phone || '',
    })
    setShowUserModal(true)
  }

  const handleSaveOrg = () => {
    const payload = { ...newOrg }
    if (!payload.logo) delete payload.logo
    if (editingOrg) {
      updateOrgMutation.mutate({ id: editingOrg.id, data: payload })
    } else {
      createOrgMutation.mutate(payload)
    }
  }

  const handleSaveMembership = () => {
    if (editingMem) {
      updateMemMutation.mutate({
        id: editingMem.id,
        data: {
          user: editingMem.user,
          school: editingMem.school,
          role: newMembership.role,
          is_default: newMembership.is_default,
        },
      })
    } else {
      createMemMutation.mutate({
        ...newMembership,
        user: Number(newMembership.user),
        school: Number(newMembership.school),
      })
    }
  }

  const openEditMem = (mem) => {
    setEditingMem(mem)
    setNewMembership({
      user: String(mem.user),
      school: String(mem.school),
      role: mem.role,
      is_default: mem.is_default,
    })
    setShowMemModal(true)
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const schools = schoolsData?.data?.results || schoolsData?.data || []
  const users = usersData?.data?.results || usersData?.data || []
  const orgs = orgsData?.data?.results || orgsData?.data || []
  const memberships = membershipsData?.data?.results || membershipsData?.data || []
  const moduleRegistry = moduleRegistryData?.data || []

  // ── Module toggle handlers ──────────────────────────────────────────────
  const handleOrgModuleToggle = (org, moduleKey) => {
    const current = org.allowed_modules || {}
    const updated = { ...current, [moduleKey]: !current[moduleKey] }
    toggleOrgModuleMutation.mutate({ id: org.id, allowed_modules: updated })
  }

  const handleSchoolModuleToggle = (school, moduleKey) => {
    const current = school.enabled_modules || {}
    const updated = { ...current, [moduleKey]: !current[moduleKey] }
    toggleSchoolModuleMutation.mutate({ id: school.id, enabled_modules: updated })
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'schools', label: 'Schools' },
    { key: 'users', label: 'Users' },
    { key: 'organizations', label: 'Organizations' },
    { key: 'memberships', label: 'Memberships' },
    { key: 'modules', label: 'Modules' },
  ]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Platform Administration</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage schools, users, and organizations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ════════════════════ Overview Tab ════════════════════ */}
      {activeTab === 'overview' && (
        <div>
          {/* Platform Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="card">
              <p className="text-sm text-gray-500">Active Schools</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{pStats.active_schools || 0}</p>
              <p className="text-xs text-gray-400">{pStats.total_schools || 0} total</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500">Total Students</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{(pStats.total_students || 0).toLocaleString()}</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500">Total Users</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{pStats.total_users || 0}</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500">Uploads This Month</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{pStats.uploads_this_month || 0}</p>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="card mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Activity (30 days)</h3>
            <div className="flex gap-6 text-sm text-gray-600">
              <span>{pStats.recent_schools || 0} new schools</span>
              <span>{pStats.recent_users || 0} new users</span>
            </div>
          </div>

          {/* Per-school breakdown */}
          {pStats.school_breakdown?.length > 0 && (
            <div className="card">
              <h3 className="text-base font-semibold text-gray-900 mb-4">School Breakdown</h3>
              {/* Mobile */}
              <div className="sm:hidden space-y-3">
                {pStats.school_breakdown.map((s) => (
                  <div key={s.id} className="p-3 border border-gray-200 rounded-lg">
                    <p className="font-medium text-sm text-gray-900">{s.name}</p>
                    <div className="flex gap-4 mt-1 text-xs text-gray-600">
                      <span>{s.student_count} students</span>
                      <span>{s.user_count} users</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <TH>School</TH>
                      <TH>Students</TH>
                      <TH>Users</TH>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pStats.school_breakdown.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{s.student_count}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{s.user_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════ Schools Tab ════════════════════ */}
      {activeTab === 'schools' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Schools</h2>
            <button onClick={() => {
              setEditingSchool(null)
              setNewSchool({ name: '', subdomain: '', contact_email: '', contact_phone: '', address: '', organization: '' })
              setShowAddModal(true)
            }} className="btn btn-primary">
              Add School
            </button>
          </div>

          {schoolsLoading ? (
            <Spinner />
          ) : schools.length === 0 ? (
            <Empty text="No schools yet. Add your first school to get started." />
          ) : (
            <>
              {/* Mobile card view */}
              <div className="sm:hidden space-y-3">
                {schools.map((school) => (
                  <div key={school.id} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm text-gray-900">{school.name}</p>
                      <StatusBadge active={school.is_active} />
                    </div>
                    <p className="text-xs text-gray-500">{school.subdomain}.kodereduai.pk</p>
                    {school.organization_name && (
                      <p className="text-xs text-purple-600 mt-0.5">{school.organization_name}</p>
                    )}
                    <div className="flex gap-4 mt-1 text-xs text-gray-600">
                      <span>{school.student_count || 0} students</span>
                      <span>{school.user_count || 0} users</span>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => openEditSchool(school)}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleMutation.mutate({ id: school.id, isActive: school.is_active })}
                        disabled={toggleMutation.isPending}
                        className={`text-xs font-medium disabled:opacity-50 ${school.is_active ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {toggleMutation.isPending ? 'Saving...' : school.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <TH>School</TH>
                      <TH>Subdomain</TH>
                      <TH>Organization</TH>
                      <TH>Students</TH>
                      <TH>Users</TH>
                      <TH>Status</TH>
                      <TH>Actions</TH>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {schools.map((school) => (
                      <tr key={school.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{school.name}</p>
                          <p className="text-sm text-gray-500">{school.contact_email}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{school.subdomain}.kodereduai.pk</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{school.organization_name || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{school.student_count || 0}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{school.user_count || 0}</td>
                        <td className="px-4 py-3"><StatusBadge active={school.is_active} /></td>
                        <td className="px-4 py-3 flex gap-3">
                          <button
                            onClick={() => openEditSchool(school)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggleMutation.mutate({ id: school.id, isActive: school.is_active })}
                            disabled={toggleMutation.isPending}
                            className={`text-sm font-medium disabled:opacity-50 ${school.is_active ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}`}
                          >
                            {toggleMutation.isPending ? 'Saving...' : school.is_active ? 'Deactivate' : 'Activate'}
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

      {/* ════════════════════ Users Tab ════════════════════ */}
      {activeTab === 'users' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
            <button onClick={() => {
              setEditingUser(null)
              setNewUser(userDefaults)
              setShowUserModal(true)
            }} className="btn btn-primary">
              Add User
            </button>
          </div>

          {usersLoading ? (
            <Spinner />
          ) : users.length === 0 ? (
            <Empty text="No users yet." />
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden space-y-3">
                {users.map((user) => (
                  <div key={user.id} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{user.first_name} {user.last_name}</p>
                        <p className="text-xs text-gray-500 truncate">{user.email || user.username}</p>
                      </div>
                      <StatusBadge active={user.is_active} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <RoleBadge role={user.role} display={user.role_display} />
                      {user.school_name && <span className="text-xs text-gray-500">{user.school_name}</span>}
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => openEditUser(user)}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Edit
                      </button>
                      {user.role !== 'SUPER_ADMIN' && (
                        <button
                          onClick={() => toggleUserMutation.mutate({ id: user.id, isActive: user.is_active })}
                          disabled={toggleUserMutation.isPending}
                          className={`text-xs font-medium disabled:opacity-50 ${user.is_active ? 'text-red-600' : 'text-green-600'}`}
                        >
                          {toggleUserMutation.isPending ? 'Saving...' : user.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <TH>User</TH>
                      <TH>Role</TH>
                      <TH>School</TH>
                      <TH>Status</TH>
                      <TH>Actions</TH>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{user.first_name} {user.last_name}</p>
                          <p className="text-sm text-gray-500">{user.email || user.username}</p>
                        </td>
                        <td className="px-4 py-3"><RoleBadge role={user.role} display={user.role_display} /></td>
                        <td className="px-4 py-3 text-sm text-gray-500">{user.school_name || '-'}</td>
                        <td className="px-4 py-3"><StatusBadge active={user.is_active} /></td>
                        <td className="px-4 py-3 flex gap-3">
                          <button
                            onClick={() => openEditUser(user)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Edit
                          </button>
                          {user.role !== 'SUPER_ADMIN' && (
                            <button
                              onClick={() => toggleUserMutation.mutate({ id: user.id, isActive: user.is_active })}
                              disabled={toggleUserMutation.isPending}
                              className={`text-sm font-medium disabled:opacity-50 ${user.is_active ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}`}
                            >
                              {toggleUserMutation.isPending ? 'Saving...' : user.is_active ? 'Deactivate' : 'Activate'}
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

      {/* ════════════════════ Organizations Tab ════════════════════ */}
      {activeTab === 'organizations' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
            <button
              onClick={() => {
                setEditingOrg(null)
                setNewOrg({ name: '', slug: '', logo: '' })
                setShowOrgModal(true)
              }}
              className="btn btn-primary"
            >
              Add Organization
            </button>
          </div>

          {orgsLoading ? (
            <Spinner />
          ) : orgs.length === 0 ? (
            <Empty text="No organizations yet. Create one to group schools." />
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden space-y-3">
                {orgs.map((org) => (
                  <div key={org.id} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm text-gray-900">{org.name}</p>
                      <StatusBadge active={org.is_active} />
                    </div>
                    <p className="text-xs text-gray-500">{org.slug}</p>
                    <p className="text-xs text-gray-600 mt-1">{org.school_count || 0} school(s)</p>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => {
                          setEditingOrg(org)
                          setNewOrg({ name: org.name, slug: org.slug, logo: org.logo || '' })
                          setShowOrgModal(true)
                        }}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete "${org.name}"?`)) deleteOrgMutation.mutate(org.id) }}
                        disabled={deleteOrgMutation.isPending}
                        className="text-xs text-red-600 font-medium disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <TH>Name</TH>
                      <TH>Slug</TH>
                      <TH>Schools</TH>
                      <TH>Status</TH>
                      <TH>Actions</TH>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orgs.map((org) => (
                      <tr key={org.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{org.slug}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{org.school_count || 0}</td>
                        <td className="px-4 py-3"><StatusBadge active={org.is_active} /></td>
                        <td className="px-4 py-3 flex gap-3">
                          <button
                            onClick={() => {
                              setEditingOrg(org)
                              setNewOrg({ name: org.name, slug: org.slug, logo: org.logo || '' })
                              setShowOrgModal(true)
                            }}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${org.name}"?`)) deleteOrgMutation.mutate(org.id) }}
                            disabled={deleteOrgMutation.isPending}
                            className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
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
      )}

      {/* ════════════════════ Memberships Tab ════════════════════ */}
      {activeTab === 'memberships' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">User-School Memberships</h2>
            <button onClick={() => {
              setEditingMem(null)
              setNewMembership({ user: '', school: '', role: 'STAFF', is_default: false })
              setShowMemModal(true)
            }} className="btn btn-primary">
              Add Membership
            </button>
          </div>

          {membershipsLoading ? (
            <Spinner />
          ) : memberships.length === 0 ? (
            <Empty text="No memberships yet. Assign a user to a school." />
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden space-y-3">
                {memberships.map((mem) => (
                  <div key={mem.id} className="p-3 border border-gray-200 rounded-lg">
                    <p className="font-medium text-sm text-gray-900">{mem.user_full_name || mem.user_username}</p>
                    <p className="text-xs text-gray-500">{mem.school_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <RoleBadge role={mem.role} />
                      {mem.is_default && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">Default</span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => openEditMem(mem)}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { if (confirm('Remove this membership?')) deleteMemMutation.mutate(mem.id) }}
                        disabled={deleteMemMutation.isPending}
                        className="text-xs text-red-600 font-medium disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <TH>User</TH>
                      <TH>School</TH>
                      <TH>Role</TH>
                      <TH>Default</TH>
                      <TH>Actions</TH>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {memberships.map((mem) => (
                      <tr key={mem.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{mem.user_full_name || mem.user_username}</p>
                          <p className="text-sm text-gray-500">{mem.user_username}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{mem.school_name}</td>
                        <td className="px-4 py-3"><RoleBadge role={mem.role} /></td>
                        <td className="px-4 py-3 text-sm">
                          {mem.is_default ? (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">Default</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 flex gap-3">
                          <button
                            onClick={() => openEditMem(mem)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { if (confirm('Remove this membership?')) deleteMemMutation.mutate(mem.id) }}
                            disabled={deleteMemMutation.isPending}
                            className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                          >
                            Remove
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

      {/* ════════════════════ Modules Tab ════════════════════ */}
      {activeTab === 'modules' && (
        <div className="space-y-6">
          {/* Error banner (only shown on failure — optimistic UI handles success) */}
          {moduleMsg?.type === 'error' && (
            <div className="px-4 py-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
              {moduleMsg.text}
              <button onClick={() => setModuleMsg(null)} className="float-right font-bold hover:opacity-70">&times;</button>
            </div>
          )}

          {/* Organization Module Ceiling */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Organization Module Control</h2>
            <p className="text-sm text-gray-500 mb-4">Set which modules are available to all schools in each organization. Disabling a module here removes it from all schools in the org.</p>

            {orgsLoading ? (
              <Spinner />
            ) : orgs.length === 0 ? (
              <Empty text="No organizations yet. Create one in the Organizations tab." />
            ) : (
              <div className="space-y-4">
                {orgs.map((org) => (
                  <div key={org.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium text-gray-900">{org.name}</p>
                        <p className="text-xs text-gray-500">{org.school_count || 0} school(s)</p>
                      </div>
                      <StatusBadge active={org.is_active} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {moduleRegistry.map((mod) => {
                        const isOn = org.allowed_modules?.[mod.key] ?? true
                        return (
                          <label key={mod.key} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => handleOrgModuleToggle(org, mod.key)}
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className={isOn ? 'text-gray-700' : 'text-gray-400'}>{mod.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-School Module Toggles */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Per-School Module Control</h2>
            <p className="text-sm text-gray-500 mb-4">Enable or disable modules for individual schools. Greyed-out modules are blocked by the organization ceiling above.</p>

            {schoolsLoading ? (
              <Spinner />
            ) : schools.length === 0 ? (
              <Empty text="No schools yet." />
            ) : (
              <div className="space-y-4">
                {schools.map((school) => {
                  const org = orgs.find(o => o.id === school.organization)
                  return (
                    <div key={school.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-medium text-gray-900">{school.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {school.organization_name && (
                              <span className="text-xs text-purple-600">{school.organization_name}</span>
                            )}
                            {!school.organization && (
                              <span className="text-xs text-gray-400">Standalone (no org)</span>
                            )}
                          </div>
                        </div>
                        <StatusBadge active={school.is_active} />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {moduleRegistry.map((mod) => {
                          const orgBlocked = org && !(org.allowed_modules?.[mod.key] ?? true)
                          const isOn = school.enabled_modules?.[mod.key] ?? false
                          const effectiveOn = isOn && !orgBlocked
                          return (
                            <label
                              key={mod.key}
                              className={`flex items-center gap-2 text-sm p-1.5 rounded ${
                                orgBlocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'
                              }`}
                              title={orgBlocked ? `Blocked by ${org?.name} organization` : mod.description}
                            >
                              <input
                                type="checkbox"
                                checked={effectiveOn}
                                onChange={() => !orgBlocked && handleSchoolModuleToggle(school, mod.key)}
                                disabled={orgBlocked}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span className={effectiveOn ? 'text-gray-700' : 'text-gray-400'}>
                                {mod.label}
                              </span>
                              {orgBlocked && (
                                <span className="text-xs text-red-400 ml-auto">org</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════ MODALS ════════════════════ */}

      {/* Add/Edit School Modal */}
      {showAddModal && (
        <Modal title={editingSchool ? 'Edit School' : 'Add School'} onClose={() => { setShowAddModal(false); setEditingSchool(null) }} scroll>
          <div className="space-y-4">
            <Field label="School Name *">
              <input type="text" className="input" value={newSchool.name}
                onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })} required />
            </Field>

            <Field label="Subdomain">
              <div className="flex flex-col sm:flex-row">
                <input type="text" className={`input rounded-b-none sm:rounded-b-lg sm:rounded-r-none ${editingSchool ? 'bg-gray-50 text-gray-500' : ''}`}
                  placeholder="focus"
                  value={newSchool.subdomain}
                  onChange={(e) => setNewSchool({ ...newSchool, subdomain: e.target.value.toLowerCase() })}
                  disabled={!!editingSchool}
                  required />
                <span className="inline-flex items-center px-3 py-2 bg-gray-100 border border-t-0 sm:border-t sm:border-l-0 border-gray-300 rounded-b-lg sm:rounded-b-none sm:rounded-r-lg text-sm text-gray-500">
                  .kodereduai.pk
                </span>
              </div>
              {editingSchool && <p className="text-xs text-gray-400 mt-1">Subdomain cannot be changed after creation</p>}
            </Field>

            <Field label="Organization">
              <select className="input" value={newSchool.organization}
                onChange={(e) => setNewSchool({ ...newSchool, organization: e.target.value })}>
                <option value="">None (standalone)</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Contact Email">
              <input type="email" className="input" value={newSchool.contact_email}
                onChange={(e) => setNewSchool({ ...newSchool, contact_email: e.target.value })} />
            </Field>

            <Field label="Contact Phone">
              <input type="text" className="input" value={newSchool.contact_phone}
                onChange={(e) => setNewSchool({ ...newSchool, contact_phone: e.target.value })} />
            </Field>

            <Field label="Address">
              <textarea className="input" rows={2} value={newSchool.address}
                onChange={(e) => setNewSchool({ ...newSchool, address: e.target.value })} />
            </Field>
          </div>

          <MutationError mutation={editingSchool ? updateSchoolMutation : createSchoolMutation} fields={['subdomain', 'name']} />

          <ModalFooter
            onCancel={() => { setShowAddModal(false); setEditingSchool(null) }}
            onSubmit={handleSaveSchool}
            disabled={(editingSchool ? updateSchoolMutation : createSchoolMutation).isPending || !newSchool.name || (!editingSchool && !newSchool.subdomain)}
            loading={(editingSchool ? updateSchoolMutation : createSchoolMutation).isPending}
            label={editingSchool ? 'Save Changes' : 'Create School'}
          />
        </Modal>
      )}

      {/* Add/Edit User Modal */}
      {showUserModal && (
        <Modal title={editingUser ? 'Edit User' : 'Add User'} onClose={() => { setShowUserModal(false); setEditingUser(null) }} scroll>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <Field label="First Name">
                <input type="text" className="input" value={newUser.first_name}
                  onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })} />
              </Field>
              <Field label="Last Name">
                <input type="text" className="input" value={newUser.last_name}
                  onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })} />
              </Field>
            </div>

            <Field label="Username *">
              <input type="text" className={`input ${editingUser ? 'bg-gray-50 text-gray-500' : ''}`}
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                disabled={!!editingUser} required />
              {editingUser && <p className="text-xs text-gray-400 mt-1">Username cannot be changed</p>}
            </Field>

            <Field label="Email">
              <input type="email" className="input" value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
            </Field>

            <Field label="Role *">
              <select className="input" value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                <option value="SCHOOL_ADMIN">School Admin</option>
                <option value="PRINCIPAL">Principal</option>
                <option value="STAFF">Staff</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </Field>

            {!editingUser && (
              <>
                <Field label="Password *">
                  <input type="password" className="input" value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required />
                </Field>

                <Field label="Confirm Password *">
                  <input type="password" className="input" value={newUser.confirm_password}
                    onChange={(e) => setNewUser({ ...newUser, confirm_password: e.target.value })} required />
                </Field>

                {newUser.role !== 'SUPER_ADMIN' && (
                  <Field label="Schools * (select one or more)">
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-3">
                      {schools.length === 0 ? (
                        <p className="text-sm text-gray-400">No schools available</p>
                      ) : schools.map((school) => (
                        <label key={school.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newUser.schools.includes(String(school.id))}
                            onChange={(e) => {
                              const id = String(school.id)
                              setNewUser({
                                ...newUser,
                                schools: e.target.checked
                                  ? [...newUser.schools, id]
                                  : newUser.schools.filter(s => s !== id)
                              })
                            }}
                            className="rounded border-gray-300"
                          />
                          {school.name}
                        </label>
                      ))}
                    </div>
                    {newUser.schools.length > 1 && (
                      <p className="text-xs text-blue-600 mt-1">
                        Memberships will be auto-created for all {newUser.schools.length} selected schools
                      </p>
                    )}
                  </Field>
                )}
              </>
            )}

            <Field label="Phone">
              <input type="text" className="input" value={newUser.phone}
                onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} />
            </Field>
          </div>

          <MutationError mutation={editingUser ? updateUserMutation : createUserMutation} fields={['username', 'email', 'password', 'confirm_password']} />

          <ModalFooter
            onCancel={() => { setShowUserModal(false); setEditingUser(null) }}
            onSubmit={handleSaveUser}
            disabled={
              (editingUser ? updateUserMutation : createUserMutation).isPending ||
              (!editingUser && (!newUser.username || !newUser.password || !newUser.confirm_password || (newUser.role !== 'SUPER_ADMIN' && newUser.schools.length === 0)))
            }
            loading={(editingUser ? updateUserMutation : createUserMutation).isPending}
            label={editingUser ? 'Save Changes' : 'Create User'}
          />
        </Modal>
      )}

      {/* Add/Edit Organization Modal */}
      {showOrgModal && (
        <Modal title={editingOrg ? 'Edit Organization' : 'Add Organization'} onClose={() => { setShowOrgModal(false); setEditingOrg(null) }}>
          <div className="space-y-4">
            <Field label="Organization Name *">
              <input type="text" className="input" value={newOrg.name}
                onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })} required />
            </Field>

            <Field label="Slug">
              <input type="text" className="input" placeholder="auto-generated from name"
                value={newOrg.slug}
                onChange={(e) => setNewOrg({ ...newOrg, slug: e.target.value.toLowerCase() })} />
              <p className="text-xs text-gray-400 mt-1">Leave empty to auto-generate from name</p>
            </Field>

            <Field label="Logo URL">
              <input type="url" className="input" placeholder="https://..." value={newOrg.logo}
                onChange={(e) => setNewOrg({ ...newOrg, logo: e.target.value })} />
            </Field>
          </div>

          <MutationError mutation={editingOrg ? updateOrgMutation : createOrgMutation} fields={['name', 'slug']} />

          <ModalFooter
            onCancel={() => { setShowOrgModal(false); setEditingOrg(null) }}
            onSubmit={handleSaveOrg}
            disabled={(editingOrg ? updateOrgMutation : createOrgMutation).isPending || !newOrg.name}
            loading={(editingOrg ? updateOrgMutation : createOrgMutation).isPending}
            label={editingOrg ? 'Save Changes' : 'Create Organization'}
          />
        </Modal>
      )}

      {/* Add/Edit Membership Modal */}
      {showMemModal && (
        <Modal title={editingMem ? 'Edit Membership' : 'Add Membership'} onClose={() => { setShowMemModal(false); setEditingMem(null) }}>
          <div className="space-y-4">
            {editingMem ? (
              <>
                <Field label="User">
                  <input type="text" className="input bg-gray-50 text-gray-500"
                    value={editingMem.user_full_name || editingMem.user_username} disabled />
                </Field>
                <Field label="School">
                  <input type="text" className="input bg-gray-50 text-gray-500"
                    value={editingMem.school_name} disabled />
                </Field>
              </>
            ) : (
              <>
                <Field label="User *">
                  <select className="input" value={newMembership.user}
                    onChange={(e) => setNewMembership({ ...newMembership, user: e.target.value })}>
                    <option value="">Select a user...</option>
                    {users.filter(u => u.role !== 'SUPER_ADMIN').map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.first_name} {user.last_name} ({user.username})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="School *">
                  <select className="input" value={newMembership.school}
                    onChange={(e) => setNewMembership({ ...newMembership, school: e.target.value })}>
                    <option value="">Select a school...</option>
                    {schools.map((school) => (
                      <option key={school.id} value={school.id}>{school.name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            <Field label="Role *">
              <select className="input" value={newMembership.role}
                onChange={(e) => setNewMembership({ ...newMembership, role: e.target.value })}>
                <option value="SCHOOL_ADMIN">School Admin</option>
                <option value="PRINCIPAL">Principal</option>
                <option value="STAFF">Staff</option>
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={newMembership.is_default}
                onChange={(e) => setNewMembership({ ...newMembership, is_default: e.target.checked })}
                className="rounded border-gray-300" />
              Set as default school (loads on login)
            </label>
          </div>

          <MutationError mutation={editingMem ? updateMemMutation : createMemMutation} fields={['user', 'school', 'non_field_errors']} />

          <ModalFooter
            onCancel={() => { setShowMemModal(false); setEditingMem(null) }}
            onSubmit={handleSaveMembership}
            disabled={(editingMem ? updateMemMutation : createMemMutation).isPending || (!editingMem && (!newMembership.user || !newMembership.school))}
            loading={(editingMem ? updateMemMutation : createMemMutation).isPending}
            label={editingMem ? 'Save Changes' : 'Create Membership'}
          />
        </Modal>
      )}
    </div>
  )
}

// ── Shared Components ─────────────────────────────────────────────────────────

function TH({ children }) {
  return <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{children}</th>
}

function Spinner() {
  return (
    <div className="text-center py-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
    </div>
  )
}

function Empty({ text }) {
  return <div className="text-center py-8 text-gray-500">{text}</div>
}

function StatusBadge({ active }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function RoleBadge({ role, display }) {
  const cls = role === 'SUPER_ADMIN' ? 'bg-purple-100 text-purple-800'
    : role === 'SCHOOL_ADMIN' ? 'bg-blue-100 text-blue-800'
    : 'bg-gray-100 text-gray-800'
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
      {display || (role === 'SCHOOL_ADMIN' ? 'School Admin' : role === 'STAFF' ? 'Staff' : role)}
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children, scroll }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={`bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4 ${scroll ? 'max-h-[90vh] overflow-y-auto' : ''}`}>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function MutationError({ mutation, fields = [] }) {
  if (!mutation.error) return null
  const data = mutation.error.response?.data
  const msg = fields.map(f => data?.[f]?.[0]).find(Boolean)
    || data?.non_field_errors?.[0]
    || data?.detail
    || 'An error occurred'
  return (
    <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
      {msg}
    </div>
  )
}

function ModalFooter({ onCancel, onSubmit, disabled, loading, label }) {
  return (
    <div className="flex justify-end space-x-3 mt-6">
      <button onClick={onCancel} disabled={loading} className="btn btn-secondary">Cancel</button>
      <button onClick={onSubmit} disabled={disabled || loading} className="btn btn-primary disabled:opacity-60">
        {loading && <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2 align-middle" />}
        {loading ? 'Saving...' : label}
      </button>
    </div>
  )
}
