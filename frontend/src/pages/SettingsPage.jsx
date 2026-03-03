import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi, financeApi, usersApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getErrorMessage } from '../utils/errorUtils'
import { useConfirmModal } from '../components/ConfirmModal'

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

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { isPrincipal, isStaffMember, isSchoolAdmin, isSuperAdmin, getAllowableRoles } = useAuth()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const isFinanceAdmin = !isPrincipal && !isStaffMember
  const canManageUsers = isSchoolAdmin && !isSuperAdmin
  const [searchParams, setSearchParams] = useSearchParams()

  const getInitialTab = () => {
    const tab = searchParams.get('tab')
    if (tab === 'profile') return 'profile'
    if (tab === 'accounts' && isFinanceAdmin) return 'accounts'
    if (tab === 'users' && canManageUsers) return 'users'
    return 'profile'
  }
  const initialTab = getInitialTab()
  const [activeTab, setActiveTab] = useState(initialTab)

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (['profile', 'accounts', 'users'].includes(tab)) {
      setSearchParams({ tab })
    } else {
      setSearchParams({})
    }
  }

  // School Profile State
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingLetterhead, setUploadingLetterhead] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [letterheadPreview, setLetterheadPreview] = useState(null)

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

  // --- School Profile Queries ---
  const { data: schoolData, isLoading: schoolLoading } = useQuery({
    queryKey: ['currentSchool'],
    queryFn: () => schoolsApi.getMySchool(),
    enabled: activeTab === 'profile',
  })
  const school = schoolData?.data

  const uploadAssetMutation = useMutation({
    mutationFn: ({ file, assetType }) => schoolsApi.uploadAsset(file, assetType),
    onSuccess: (_, { assetType }) => {
      queryClient.invalidateQueries({ queryKey: ['currentSchool'] })
      if (assetType === 'logo') {
        setLogoPreview(null)
        setUploadingLogo(false)
      } else {
        setLetterheadPreview(null)
        setUploadingLetterhead(false)
      }
    },
    onError: (_, { assetType }) => {
      if (assetType === 'logo') setUploadingLogo(false)
      else setUploadingLetterhead(false)
    },
  })

  const deleteAssetMutation = useMutation({
    mutationFn: (assetType) => schoolsApi.deleteAsset(assetType),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentSchool'] }),
  })

  const examConfigMutation = useMutation({
    mutationFn: (data) => schoolsApi.updateExamConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentSchool'] }),
  })

  const handleAssetUpload = (e, assetType) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      alert('Please upload a JPG, PNG, WebP, or SVG file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File must be under 5MB.')
      return
    }
    const previewUrl = URL.createObjectURL(file)
    if (assetType === 'logo') {
      setLogoPreview(previewUrl)
      setUploadingLogo(true)
    } else {
      setLetterheadPreview(previewUrl)
      setUploadingLetterhead(true)
    }
    uploadAssetMutation.mutate({ file, assetType })
  }

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

  const reopenMonthMutation = useMutation({
    mutationFn: (id) => financeApi.reopenMonth(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monthlyClosings'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalancesAll'] })
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
        <p className="text-sm sm:text-base text-gray-600">School profile, finance, and user settings</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto">
          <button
            onClick={() => handleTabChange('profile')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'profile'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            School Profile
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

      {/* School Profile Tab */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          {schoolLoading ? (
            <div className="card text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : school ? (
            <>
              {/* School Info */}
              <div className="card">
                <h3 className="font-medium text-gray-900 mb-4">School Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-500">Name:</span> <span className="font-medium">{school.name}</span></div>
                  <div><span className="text-gray-500">Subdomain:</span> <span className="font-medium">{school.subdomain}</span></div>
                  <div><span className="text-gray-500">Email:</span> <span className="font-medium">{school.contact_email || '-'}</span></div>
                  <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{school.contact_phone || '-'}</span></div>
                  {school.address && (
                    <div className="sm:col-span-2"><span className="text-gray-500">Address:</span> <span className="font-medium">{school.address}</span></div>
                  )}
                </div>
              </div>

              {/* Logo Upload */}
              <div className="card">
                <h3 className="font-medium text-gray-900 mb-1">School Logo</h3>
                <p className="text-sm text-gray-500 mb-4">Used in reports, receipts, and the school header. Recommended: square image, at least 200x200px.</p>
                <div className="flex items-start gap-6">
                  <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50 flex-shrink-0">
                    {(logoPreview || school.logo) ? (
                      <img src={logoPreview || school.logo} alt="School logo" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-gray-400 text-xs text-center px-2">No logo uploaded</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={`px-4 py-2 rounded-lg text-sm cursor-pointer inline-block text-center ${uploadingLogo ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                      {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                        onChange={(e) => handleAssetUpload(e, 'logo')}
                        className="hidden"
                        disabled={uploadingLogo}
                      />
                    </label>
                    {school.logo && !uploadingLogo && (
                      <button
                        onClick={async () => { const ok = await confirm({ title: 'Remove Logo', message: 'Remove the school logo?' }); if (ok) deleteAssetMutation.mutate('logo') }}
                        disabled={deleteAssetMutation.isPending}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm"
                      >
                        {deleteAssetMutation.isPending ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                    <p className="text-xs text-gray-400">JPG, PNG, WebP, or SVG. Max 5MB.</p>
                    {uploadAssetMutation.isError && uploadAssetMutation.variables?.assetType === 'logo' && (
                      <p className="text-sm text-red-600">{getErrorMessage(uploadAssetMutation.error, 'Failed to upload logo')}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Letterhead Upload */}
              <div className="card">
                <h3 className="font-medium text-gray-900 mb-1">Letterhead</h3>
                <p className="text-sm text-gray-500 mb-4">Used as the header on official documents and report cards. Recommended: wide image (e.g. 800x150px).</p>
                <div className="space-y-4">
                  <div className="w-full max-w-lg border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50" style={{ minHeight: '80px' }}>
                    {(letterheadPreview || school.letterhead_url) ? (
                      <img src={letterheadPreview || school.letterhead_url} alt="Letterhead" className="w-full h-auto object-contain" />
                    ) : (
                      <div className="flex items-center justify-center h-20">
                        <span className="text-gray-400 text-xs">No letterhead uploaded</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className={`px-4 py-2 rounded-lg text-sm cursor-pointer ${uploadingLetterhead ? 'bg-gray-400 cursor-not-allowed text-white' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                      {uploadingLetterhead ? 'Uploading...' : 'Upload Letterhead'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                        onChange={(e) => handleAssetUpload(e, 'letterhead')}
                        className="hidden"
                        disabled={uploadingLetterhead}
                      />
                    </label>
                    {school.letterhead_url && !uploadingLetterhead && (
                      <button
                        onClick={async () => { const ok = await confirm({ title: 'Remove Letterhead', message: 'Remove the letterhead?' }); if (ok) deleteAssetMutation.mutate('letterhead') }}
                        disabled={deleteAssetMutation.isPending}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm"
                      >
                        {deleteAssetMutation.isPending ? 'Removing...' : 'Remove'}
                      </button>
                    )}
                    <p className="text-xs text-gray-400">JPG, PNG, WebP, or SVG. Max 5MB.</p>
                  </div>
                  {uploadAssetMutation.isError && uploadAssetMutation.variables?.assetType === 'letterhead' && (
                    <p className="text-sm text-red-600">{getErrorMessage(uploadAssetMutation.error, 'Failed to upload letterhead')}</p>
                  )}
                </div>
              </div>

              {/* Examination Settings */}
              <div className="card">
                <h3 className="font-medium text-gray-900 mb-1">Examination Settings</h3>
                <p className="text-sm text-gray-500 mb-4">Configure how exam scores are calculated across multiple exam types.</p>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">Weighted Average</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      When enabled, each exam type's contribution to the final score is scaled by its weight
                      (e.g., Mid-term 30%, Final 70%). When disabled, simple averaging is used.
                    </p>
                  </div>
                  <button
                    onClick={() => examConfigMutation.mutate({
                      weighted_average_enabled: !school?.exam_config?.weighted_average_enabled
                    })}
                    disabled={examConfigMutation.isPending}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      school?.exam_config?.weighted_average_enabled
                        ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      school?.exam_config?.weighted_average_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                {examConfigMutation.isError && (
                  <p className="text-sm text-red-600 mt-2">{getErrorMessage(examConfigMutation.error, 'Failed to update exam config')}</p>
                )}
              </div>
            </>
          ) : (
            <div className="card text-center py-8 text-gray-500">No school data available.</div>
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
            <div className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-200">
              <span>
                Last closed: <span className="font-medium">{['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][lastClosed.month]} {lastClosed.year}</span>
              </span>
              <button
                onClick={() => {
                  if (confirm(`Reopen ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][lastClosed.month]} ${lastClosed.year}? This will delete the snapshots and allow editing transactions from that month.`)) {
                    reopenMonthMutation.mutate(lastClosed.id)
                  }
                }}
                disabled={reopenMonthMutation.isPending}
                className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium disabled:opacity-50"
              >
                {reopenMonthMutation.isPending ? 'Reopening...' : 'Reopen'}
              </button>
            </div>
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
                        <button onClick={async () => { const ok = await confirm({ title: 'Delete Account', message: 'Delete this account? This cannot be undone.' }); if (ok) deleteAccountMutation.mutate(account.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
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
                            <button onClick={async () => { const ok = await confirm({ title: 'Delete Account', message: 'Delete this account? This cannot be undone.' }); if (ok) deleteAccountMutation.mutate(account.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
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

      {/* Closed Months History */}
      {activeTab === 'accounts' && isFinanceAdmin && closingsList.length > 0 && (
        <div className="space-y-6 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Closed Months History</h3>
            <div className="space-y-2">
              {closingsList.map((closing) => (
                <div key={closing.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <span className="font-medium text-gray-900">
                      {['','January','February','March','April','May','June','July','August','September','October','November','December'][closing.month]} {closing.year}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      Closed by {closing.closed_by_name || 'N/A'} on {new Date(closing.closed_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Reopen ${['','Jan','Feb','Mar','Apr','May','June','July','August','September','October','November','December'][closing.month]} ${closing.year}? This will delete the snapshots and allow editing transactions from that month.`)) {
                        reopenMonthMutation.mutate(closing.id)
                      }
                    }}
                    disabled={reopenMonthMutation.isPending}
                    className="px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {reopenMonthMutation.isPending ? 'Reopening...' : 'Reopen'}
                  </button>
                </div>
              ))}
            </div>
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

      <ConfirmModalRoot />
    </div>
  )
}
