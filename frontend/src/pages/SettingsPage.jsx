import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi, attendanceApi, financeApi, usersApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const ACCOUNT_TYPES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'PERSON', label: 'Person' },
]

const typeColors = {
  CASH: 'bg-green-100 text-green-800',
  BANK: 'bg-blue-100 text-blue-800',
  PERSON: 'bg-purple-100 text-purple-800',
}

const getErrorMessage = (error, fallback = 'Something went wrong') => {
  const data = error?.response?.data
  if (!data) return fallback
  if (typeof data === 'string') return data
  if (data.detail) return data.detail
  if (data.non_field_errors) return data.non_field_errors.join(', ')
  const messages = []
  for (const [key, val] of Object.entries(data)) {
    if (Array.isArray(val)) messages.push(`${key}: ${val.join(', ')}`)
    else if (typeof val === 'string') messages.push(`${key}: ${val}`)
  }
  return messages.length > 0 ? messages.join('; ') : fallback
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { isPrincipal, isStaffMember, isSchoolAdmin, isSuperAdmin, getAllowableRoles } = useAuth()
  const isFinanceAdmin = !isPrincipal && !isStaffMember
  const canManageUsers = isSchoolAdmin && !isSuperAdmin
  const [searchParams, setSearchParams] = useSearchParams()

  const getInitialTab = () => {
    const tab = searchParams.get('tab')
    if (tab === 'accounts' && isFinanceAdmin) return 'accounts'
    if (tab === 'users' && canManageUsers) return 'users'
    return 'mappings'
  }
  const initialTab = getInitialTab()
  const [activeTab, setActiveTab] = useState(initialTab)

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (tab === 'accounts' || tab === 'users') {
      setSearchParams({ tab })
    } else {
      setSearchParams({})
    }
  }

  // Mark Mappings State
  const [mappings, setMappings] = useState({
    PRESENT: ['P', 'p', '✓', '✔', '/', '1'],
    ABSENT: ['A', 'a', '✗', '✘', 'X', 'x', '0', '-'],
    LATE: ['L', 'l'],
    LEAVE: ['Le', 'LE', 'le'],
    default: 'ABSENT'
  })
  const [newSymbol, setNewSymbol] = useState({ status: 'PRESENT', symbol: '' })

  // Register Config State
  const [regConfig, setRegConfig] = useState({
    orientation: 'rows_are_students',
    date_header_row: 0,
    student_name_col: 0,
    roll_number_col: 1,
    data_start_row: 1,
    data_start_col: 2
  })

  // Finance Accounts State
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [accountForm, setAccountForm] = useState({
    name: '', account_type: 'CASH', opening_balance: '', staff_visible: true
  })
  const [showCloseMonthModal, setShowCloseMonthModal] = useState(false)
  const now = new Date()
  const [closeMonthForm, setCloseMonthForm] = useState({
    year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
    month: now.getMonth() === 0 ? 12 : now.getMonth(),
  })

  // --- Users State ---
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('')
  const EMPTY_USER_FORM = { username: '', email: '', password: '', confirm_password: '', first_name: '', last_name: '', role: 'STAFF', phone: '' }
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM)
  const [userError, setUserError] = useState('')

  // --- Attendance Queries ---
  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['markMappings'],
    queryFn: () => schoolsApi.getMarkMappings()
  })

  const { data: regConfigData, isLoading: regConfigLoading } = useQuery({
    queryKey: ['registerConfig'],
    queryFn: () => schoolsApi.getRegisterConfig()
  })

  const { data: suggestionsData } = useQuery({
    queryKey: ['mappingSuggestions'],
    queryFn: () => attendanceApi.getMappingSuggestions({})
  })

  useEffect(() => {
    if (mappingsData?.data?.mark_mappings) {
      setMappings(mappingsData.data.mark_mappings)
    }
  }, [mappingsData])

  useEffect(() => {
    if (regConfigData?.data?.register_config) {
      setRegConfig(regConfigData.data.register_config)
    }
  }, [regConfigData])

  const saveMappingsMutation = useMutation({
    mutationFn: (data) => schoolsApi.updateMarkMappings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['markMappings'] })
      queryClient.invalidateQueries({ queryKey: ['mappingSuggestions'] })
    }
  })

  const saveRegConfigMutation = useMutation({
    mutationFn: (data) => schoolsApi.updateRegisterConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registerConfig'] })
    }
  })

  // --- Finance Account Queries ---
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
    enabled: isFinanceAdmin && activeTab === 'accounts',
  })

  const { data: closingsData } = useQuery({
    queryKey: ['monthlyClosings'],
    queryFn: () => financeApi.getClosings({ page_size: 9999 }),
    enabled: isFinanceAdmin && activeTab === 'accounts',
  })

  const closingsList = closingsData?.data || []
  const lastClosed = closingsList.length > 0 ? closingsList[0] : null
  const accountList = accountsData?.data?.results || accountsData?.data || []

  // Account mutations
  const createAccountMutation = useMutation({
    mutationFn: (data) => financeApi.createAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      closeAccountModal()
    },
  })

  const updateAccountMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      closeAccountModal()
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (id) => financeApi.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
    },
  })

  const closeMonthMutation = useMutation({
    mutationFn: (data) => financeApi.closeMonth(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyClosings'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalancesAll'] })
      setShowCloseMonthModal(false)
    },
  })

  const closeAccountModal = () => {
    setShowAccountModal(false)
    setEditingAccount(null)
    setAccountForm({ name: '', account_type: 'CASH', opening_balance: '', staff_visible: true })
  }

  const openEditAccount = (account) => {
    setEditingAccount(account)
    setAccountForm({
      name: account.name,
      account_type: account.account_type,
      opening_balance: account.opening_balance,
      staff_visible: account.staff_visible !== false,
    })
    setShowAccountModal(true)
  }

  const handleAccountSubmit = (e) => {
    e.preventDefault()
    const data = {
      ...accountForm,
      opening_balance: parseFloat(accountForm.opening_balance || 0),
      staff_visible: accountForm.staff_visible,
    }
    if (editingAccount) {
      updateAccountMutation.mutate({ id: editingAccount.id, data })
    } else {
      createAccountMutation.mutate(data)
    }
  }

  // Attendance helpers
  const addSymbol = () => {
    if (!newSymbol.symbol.trim()) return
    const status = newSymbol.status
    const symbol = newSymbol.symbol.trim()
    if (!mappings[status]?.includes(symbol)) {
      setMappings(prev => ({ ...prev, [status]: [...(prev[status] || []), symbol] }))
    }
    setNewSymbol({ ...newSymbol, symbol: '' })
  }

  const removeSymbol = (status, symbol) => {
    setMappings(prev => ({ ...prev, [status]: prev[status].filter(s => s !== symbol) }))
  }

  const applySuggestion = (mark, suggestedStatus) => {
    if (!mappings[suggestedStatus]?.includes(mark)) {
      setMappings(prev => ({ ...prev, [suggestedStatus]: [...(prev[suggestedStatus] || []), mark] }))
    }
  }

  const suggestions = suggestionsData?.data?.suggestions || []

  // --- Users Queries & Mutations ---
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['schoolUsers'],
    queryFn: () => usersApi.getUsers({ page_size: 9999 }),
    enabled: canManageUsers && activeTab === 'users',
  })

  const rawUsers = usersData?.data?.results || usersData?.data || []
  const allowableRoles = canManageUsers ? getAllowableRoles() : []

  const filteredUsers = rawUsers.filter(u => {
    const matchesSearch = !userSearch ||
      u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.first_name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.last_name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase())
    const matchesRole = !userRoleFilter || u.role === userRoleFilter
    return matchesSearch && matchesRole
  })

  const createUserMutation = useMutation({
    mutationFn: (data) => usersApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schoolUsers'] })
      closeUserModal()
    },
    onError: (error) => setUserError(getErrorMessage(error, 'Failed to create user')),
  })

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => usersApi.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schoolUsers'] })
      closeUserModal()
    },
    onError: (error) => setUserError(getErrorMessage(error, 'Failed to update user')),
  })

  const toggleUserActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => usersApi.updateUser(id, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schoolUsers'] }),
  })

  const closeUserModal = () => {
    setShowUserModal(false)
    setEditingUser(null)
    setUserForm(EMPTY_USER_FORM)
    setUserError('')
  }

  const openEditUser = (user) => {
    setEditingUser(user)
    setUserForm({
      username: user.username,
      email: user.email || '',
      password: '',
      confirm_password: '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      role: user.role,
      phone: user.phone || '',
    })
    setUserError('')
    setShowUserModal(true)
  }

  const handleUserSubmit = (e) => {
    e.preventDefault()
    setUserError('')
    if (!editingUser) {
      if (!userForm.username || !userForm.password) {
        setUserError('Username and password are required.')
        return
      }
      if (userForm.password !== userForm.confirm_password) {
        setUserError("Passwords don't match.")
        return
      }
      if (userForm.password.length < 8) {
        setUserError('Password must be at least 8 characters.')
        return
      }
      createUserMutation.mutate(userForm)
    } else {
      const { password, confirm_password, username, ...updateData } = userForm
      updateUserMutation.mutate({ id: editingUser.id, data: updateData })
    }
  }

  const ROLE_LABELS = {
    SUPER_ADMIN: 'Super Admin',
    SCHOOL_ADMIN: 'School Admin',
    PRINCIPAL: 'Principal',
    HR_MANAGER: 'HR Manager',
    ACCOUNTANT: 'Accountant',
    TEACHER: 'Teacher',
    STAFF: 'Staff',
    STUDENT: 'Student',
    PARENT: 'Parent',
  }

  const ROLE_COLORS = {
    SUPER_ADMIN: 'bg-red-100 text-red-800',
    SCHOOL_ADMIN: 'bg-purple-100 text-purple-800',
    PRINCIPAL: 'bg-indigo-100 text-indigo-800',
    HR_MANAGER: 'bg-orange-100 text-orange-800',
    ACCOUNTANT: 'bg-cyan-100 text-cyan-800',
    TEACHER: 'bg-green-100 text-green-800',
    STAFF: 'bg-gray-100 text-gray-800',
    STUDENT: 'bg-blue-100 text-blue-800',
    PARENT: 'bg-yellow-100 text-yellow-800',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm sm:text-base text-gray-600">Configure attendance, finance, and user settings</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto">
          <button
            onClick={() => handleTabChange('mappings')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'mappings'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Mark Mappings
          </button>
          <button
            onClick={() => handleTabChange('register')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'register'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Register Layout
          </button>
          {isFinanceAdmin && (
            <button
              onClick={() => handleTabChange('accounts')}
              className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === 'accounts'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Finance Accounts
            </button>
          )}
          {canManageUsers && (
            <button
              onClick={() => handleTabChange('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === 'users'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Users
            </button>
          )}
        </nav>
      </div>

      {/* Mark Mappings Tab */}
      {activeTab === 'mappings' && (
        <div className="space-y-6">
          {mappingsLoading ? (
            <div className="card text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : (
            <>
              {suggestions.length > 0 && (
                <div className="card bg-blue-50 border-blue-200">
                  <h3 className="font-medium text-blue-800 mb-3 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Suggestions Based on OCR Errors
                  </h3>
                  <div className="space-y-2">
                    {suggestions.slice(0, 5).map((s, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white p-2 rounded-lg">
                        <div>
                          <span className="font-mono bg-gray-100 px-2 py-1 rounded">"{s.mark}"</span>
                          <span className="text-sm text-gray-600 ml-2">misread {s.misread_count} times</span>
                          {s.current_mapping !== 'Not mapped (using default)' && (
                            <span className="text-xs text-gray-500 ml-2">(currently: {s.current_mapping})</span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => applySuggestion(s.mark, 'PRESENT')} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Add to PRESENT</button>
                          <button onClick={() => applySuggestion(s.mark, 'ABSENT')} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Add to ABSENT</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <h3 className="font-medium text-gray-900 mb-4">Current Mark Mappings</h3>
                <p className="text-sm text-gray-500 mb-4">Define which symbols in handwritten registers map to each attendance status.</p>

                <div className="space-y-4">
                  {['PRESENT', 'ABSENT', 'LATE', 'LEAVE'].map(status => (
                    <div key={status} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className={`font-medium ${status === 'PRESENT' ? 'text-green-700' : status === 'ABSENT' ? 'text-red-700' : status === 'LATE' ? 'text-yellow-700' : 'text-blue-700'}`}>{status}</span>
                        <span className="text-sm text-gray-500">{mappings[status]?.length || 0} symbols</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {mappings[status]?.map((symbol, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm">
                            <span className="font-mono">{symbol}</span>
                            <button onClick={() => removeSymbol(status, symbol)} className="text-gray-400 hover:text-red-500">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ))}
                        {(!mappings[status] || mappings[status].length === 0) && (
                          <span className="text-sm text-gray-400 italic">No symbols defined</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default for blank/unrecognized marks:</label>
                  <select value={mappings.default || 'ABSENT'} onChange={(e) => setMappings(prev => ({ ...prev, default: e.target.value }))} className="input w-full sm:w-48">
                    <option value="PRESENT">PRESENT</option>
                    <option value="ABSENT">ABSENT</option>
                    <option value="LATE">LATE</option>
                    <option value="LEAVE">LEAVE</option>
                  </select>
                </div>

                <div className="mt-6 p-4 border border-dashed border-gray-300 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Add New Symbol</h4>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <select value={newSymbol.status} onChange={(e) => setNewSymbol({ ...newSymbol, status: e.target.value })} className="input w-full sm:w-40">
                      <option value="PRESENT">PRESENT</option>
                      <option value="ABSENT">ABSENT</option>
                      <option value="LATE">LATE</option>
                      <option value="LEAVE">LEAVE</option>
                    </select>
                    <input type="text" value={newSymbol.symbol} onChange={(e) => setNewSymbol({ ...newSymbol, symbol: e.target.value })} placeholder="Symbol (e.g., P, ✓, A)" className="input flex-1" maxLength={5} />
                    <button onClick={addSymbol} className="btn btn-secondary">Add</button>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveMappingsMutation.mutate(mappings)} disabled={saveMappingsMutation.isPending} className="btn btn-primary">
                    {saveMappingsMutation.isPending ? 'Saving...' : 'Save Mark Mappings'}
                  </button>
                </div>
                {saveMappingsMutation.isSuccess && <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">Mark mappings saved successfully!</div>}
                {saveMappingsMutation.isError && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">Failed to save: {saveMappingsMutation.error?.response?.data?.error || 'Unknown error'}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Register Layout Tab */}
      {activeTab === 'register' && (
        <div className="card">
          {regConfigLoading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div></div>
          ) : (
            <>
              <h3 className="font-medium text-gray-900 mb-4">Register Layout Configuration</h3>
              <p className="text-sm text-gray-500 mb-6">Configure how the AI interprets your attendance register format.</p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Register Orientation</label>
                  <select value={regConfig.orientation} onChange={(e) => setRegConfig(prev => ({ ...prev, orientation: e.target.value }))} className="input w-full">
                    <option value="rows_are_students">Rows are students, columns are dates</option>
                    <option value="columns_are_students">Columns are students, rows are dates</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Most registers have students in rows and dates across columns.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date Header Row</label>
                    <input type="number" min="0" value={regConfig.date_header_row} onChange={(e) => setRegConfig(prev => ({ ...prev, date_header_row: parseInt(e.target.value) || 0 }))} className="input w-full" />
                    <p className="mt-1 text-xs text-gray-500">Row containing date numbers (0-indexed)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Data Start Row</label>
                    <input type="number" min="0" value={regConfig.data_start_row} onChange={(e) => setRegConfig(prev => ({ ...prev, data_start_row: parseInt(e.target.value) || 0 }))} className="input w-full" />
                    <p className="mt-1 text-xs text-gray-500">First row with student attendance data</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Student Name Column</label>
                    <input type="number" min="0" value={regConfig.student_name_col} onChange={(e) => setRegConfig(prev => ({ ...prev, student_name_col: parseInt(e.target.value) || 0 }))} className="input w-full" />
                    <p className="mt-1 text-xs text-gray-500">Column with student names (0-indexed)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Roll Number Column</label>
                    <input type="number" min="-1" value={regConfig.roll_number_col} onChange={(e) => setRegConfig(prev => ({ ...prev, roll_number_col: parseInt(e.target.value) || 0 }))} className="input w-full" />
                    <p className="mt-1 text-xs text-gray-500">Column with roll numbers (-1 if none)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Data Start Column</label>
                    <input type="number" min="0" value={regConfig.data_start_col} onChange={(e) => setRegConfig(prev => ({ ...prev, data_start_col: parseInt(e.target.value) || 0 }))} className="input w-full" />
                    <p className="mt-1 text-xs text-gray-500">First column with attendance marks</p>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Preview Layout</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs border border-gray-300">
                      <tbody>
                        {[0, 1, 2, 3].map(row => (
                          <tr key={row}>
                            {[0, 1, 2, 3, 4, 5].map(col => {
                              const isHeader = row === regConfig.date_header_row
                              const isNameCol = col === regConfig.student_name_col
                              const isRollCol = col === regConfig.roll_number_col
                              const isDataArea = row >= regConfig.data_start_row && col >= regConfig.data_start_col
                              let content = ''
                              let bgColor = 'bg-white'
                              if (isHeader && col >= regConfig.data_start_col) { content = `Day ${col - regConfig.data_start_col + 1}`; bgColor = 'bg-blue-100' }
                              else if (isNameCol && row >= regConfig.data_start_row) { content = `Name ${row}`; bgColor = 'bg-green-100' }
                              else if (isRollCol && row >= regConfig.data_start_row) { content = `${row}`; bgColor = 'bg-yellow-100' }
                              else if (isDataArea) { content = 'P/A'; bgColor = 'bg-gray-100' }
                              return <td key={col} className={`border border-gray-300 p-2 text-center ${bgColor}`}>{content}</td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 sm:gap-4 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border"></span> Date Header</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 border"></span> Name Column</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-100 border"></span> Roll Column</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-100 border"></span> Attendance Data</span>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveRegConfigMutation.mutate(regConfig)} disabled={saveRegConfigMutation.isPending} className="btn btn-primary">
                    {saveRegConfigMutation.isPending ? 'Saving...' : 'Save Register Configuration'}
                  </button>
                </div>
                {saveRegConfigMutation.isSuccess && <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">Register configuration saved successfully!</div>}
                {saveRegConfigMutation.isError && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">Failed to save: {saveRegConfigMutation.error?.response?.data?.error || 'Unknown error'}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Finance Accounts Tab (Admin Only) */}
      {activeTab === 'accounts' && isFinanceAdmin && (
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowAccountModal(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
              Add Account
            </button>
            <button onClick={() => setShowCloseMonthModal(true)} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm">
              Close Month
            </button>
          </div>

          {lastClosed && (
            <p className="text-xs text-gray-400">
              Last closed: {['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][lastClosed.month]} {lastClosed.year}
            </p>
          )}

          {/* Account List */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Accounts</h3>
            {accountsLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : accountList.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-2">No accounts yet</p>
                <p className="text-sm text-gray-400">Click "Add Account" to create your first account</p>
              </div>
            ) : (
              <>
                {/* Mobile */}
                <div className="sm:hidden space-y-3">
                  {accountList.map((account) => (
                    <div key={account.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">{account.name}</span>
                        <div className="flex items-center gap-1">
                          {!account.staff_visible && <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Hidden</span>}
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[account.account_type]}`}>{account.account_type}</span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600">Opening Balance: {Number(account.opening_balance).toLocaleString()}</p>
                      <p className="text-xs text-gray-500">{account.is_active ? 'Active' : 'Inactive'}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => openEditAccount(account)} className="text-xs text-primary-600 hover:underline">Edit</button>
                        <button onClick={() => { if (confirm('Delete this account?')) deleteAccountMutation.mutate(account.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Opening Balance</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Staff Visible</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {accountList.map((account) => (
                        <tr key={account.id}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{account.name}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[account.account_type]}`}>{account.account_type}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 text-right">{Number(account.opening_balance).toLocaleString()}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${account.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                              {account.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${account.staff_visible ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                              {account.staff_visible ? 'Yes' : 'Hidden'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => openEditAccount(account)} className="text-sm text-primary-600 hover:underline mr-3">Edit</button>
                            <button onClick={() => { if (confirm('Delete this account?')) deleteAccountMutation.mutate(account.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Account Modal */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">{editingAccount ? 'Edit Account' : 'Add Account'}</h3>
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                  <input type="text" value={accountForm.name} onChange={(e) => setAccountForm(f => ({ ...f, name: e.target.value }))} className="input-field" required placeholder="e.g. Principal Branch 1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select value={accountForm.account_type} onChange={(e) => setAccountForm(f => ({ ...f, account_type: e.target.value }))} className="input-field">
                    {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Opening Balance (BBF)</label>
                  <input type="number" step="0.01" value={accountForm.opening_balance} onChange={(e) => setAccountForm(f => ({ ...f, opening_balance: e.target.value }))} className="input-field" placeholder="0.00" />
                </div>
                {editingAccount && (
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={accountForm.is_active !== false} onChange={(e) => setAccountForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                      Active
                    </label>
                  </div>
                )}
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={accountForm.staff_visible} onChange={(e) => setAccountForm(f => ({ ...f, staff_visible: e.target.checked }))} className="rounded" />
                    Visible to Staff
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">Staff members can see this account and its transactions</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeAccountModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button type="submit" disabled={createAccountMutation.isPending || updateAccountMutation.isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                    {(createAccountMutation.isPending || updateAccountMutation.isPending) ? 'Saving...' : 'Save'}
                  </button>
                </div>
                {(createAccountMutation.isError || updateAccountMutation.isError) && (
                  <p className="text-sm text-red-600">{getErrorMessage(createAccountMutation.error || updateAccountMutation.error, 'Failed to save account')}</p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && canManageUsers && (
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <input
                type="text"
                placeholder="Search by name, username, or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="input flex-1"
              />
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                className="input w-full sm:w-40"
              >
                <option value="">All Roles</option>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => { setUserForm({ ...EMPTY_USER_FORM }); setEditingUser(null); setUserError(''); setShowUserModal(true) }}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm whitespace-nowrap"
            >
              Add User
            </button>
          </div>

          {/* User List */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">School Users ({filteredUsers.length})</h3>
            {usersLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-2">No users found</p>
                <p className="text-sm text-gray-400">Click "Add User" to create a new user</p>
              </div>
            ) : (
              <>
                {/* Mobile */}
                <div className="sm:hidden space-y-3">
                  {filteredUsers.map((u) => (
                    <div key={u.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium text-gray-900">{u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}</span>
                          <p className="text-xs text-gray-500">{u.username}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </div>
                      {u.email && <p className="text-sm text-gray-600">{u.email}</p>}
                      <div className="flex items-center justify-between mt-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <div className="flex gap-2">
                          {allowableRoles.includes(u.role) && (
                            <button onClick={() => openEditUser(u)} className="text-xs text-primary-600 hover:underline">Edit</button>
                          )}
                          {allowableRoles.includes(u.role) && (
                            <button
                              onClick={() => toggleUserActiveMutation.mutate({ id: u.id, is_active: !u.is_active })}
                              className={`text-xs ${u.is_active ? 'text-red-600' : 'text-green-600'} hover:underline`}
                            >
                              {u.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Role</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-gray-900">{u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}</div>
                            <div className="text-xs text-gray-500">@{u.username}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{u.email || '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'}`}>
                              {ROLE_LABELS[u.role] || u.role}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {allowableRoles.includes(u.role) ? (
                              <>
                                <button onClick={() => openEditUser(u)} className="text-sm text-primary-600 hover:underline mr-3">Edit</button>
                                <button
                                  onClick={() => toggleUserActiveMutation.mutate({ id: u.id, is_active: !u.is_active })}
                                  className={`text-sm ${u.is_active ? 'text-red-600' : 'text-green-600'} hover:underline`}
                                >
                                  {u.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                              </>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
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
        </div>
      )}

      {/* Add/Edit User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">{editingUser ? 'Edit User' : 'Add User'}</h3>
              <form onSubmit={handleUserSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input type="text" value={userForm.first_name} onChange={(e) => setUserForm(f => ({ ...f, first_name: e.target.value }))} className="input-field" placeholder="First name" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input type="text" value={userForm.last_name} onChange={(e) => setUserForm(f => ({ ...f, last_name: e.target.value }))} className="input-field" placeholder="Last name" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                  <input type="text" value={userForm.username} onChange={(e) => setUserForm(f => ({ ...f, username: e.target.value }))} className="input-field" required disabled={!!editingUser} placeholder="Username for login" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={userForm.email} onChange={(e) => setUserForm(f => ({ ...f, email: e.target.value }))} className="input-field" placeholder="Email address" />
                </div>
                {!editingUser && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                      <input type="password" value={userForm.password} onChange={(e) => setUserForm(f => ({ ...f, password: e.target.value }))} className="input-field" required placeholder="Min 8 characters" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
                      <input type="password" value={userForm.confirm_password} onChange={(e) => setUserForm(f => ({ ...f, confirm_password: e.target.value }))} className="input-field" required placeholder="Confirm" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                  <select value={userForm.role} onChange={(e) => setUserForm(f => ({ ...f, role: e.target.value }))} className="input-field" required>
                    {allowableRoles.map(role => (
                      <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="text" value={userForm.phone} onChange={(e) => setUserForm(f => ({ ...f, phone: e.target.value }))} className="input-field" placeholder="Phone number" />
                </div>
                {userError && <p className="text-sm text-red-600">{userError}</p>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeUserModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button type="submit" disabled={createUserMutation.isPending || updateUserMutation.isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                    {(createUserMutation.isPending || updateUserMutation.isPending) ? 'Saving...' : editingUser ? 'Update' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Close Month Modal */}
      {showCloseMonthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Close Month</h3>
              <p className="text-sm text-gray-600 mb-4">Snapshot all account balances as of the last day of the selected month. This BBF will speed up future balance lookups.</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                    <select value={closeMonthForm.month} onChange={(e) => setCloseMonthForm(f => ({ ...f, month: parseInt(e.target.value) }))} className="input-field">
                      {['January','February','March','April','May','June','July','August','September','October','November','December'].map((name, i) => (
                        <option key={i + 1} value={i + 1}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                    <input type="number" value={closeMonthForm.year} onChange={(e) => setCloseMonthForm(f => ({ ...f, year: parseInt(e.target.value) }))} className="input-field" min={2020} max={2100} />
                  </div>
                </div>
                {lastClosed && (
                  <p className="text-xs text-gray-400">Last closed: {['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][lastClosed.month]} {lastClosed.year}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowCloseMonthModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button onClick={() => closeMonthMutation.mutate(closeMonthForm)} disabled={closeMonthMutation.isPending} className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm disabled:opacity-50">
                    {closeMonthMutation.isPending ? 'Closing...' : 'Close Month'}
                  </button>
                </div>
                {closeMonthMutation.isError && (
                  <p className="text-sm text-red-600">{getErrorMessage(closeMonthMutation.error, 'Failed to close month')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
