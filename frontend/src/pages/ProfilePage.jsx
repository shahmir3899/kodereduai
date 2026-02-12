import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { authApi } from '../services/api'
import { useToast } from '../components/Toast'

// ---- Profile Tab ----
function ProfileTab() {
  const { user, refreshUser } = useAuth()
  const { showSuccess, showError } = useToast()

  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    email: user?.email || '',
    phone: user?.phone || '',
  })

  const updateMutation = useMutation({
    mutationFn: (data) => authApi.updateProfile(data),
    onSuccess: async () => {
      await refreshUser()
      showSuccess('Profile updated successfully!')
    },
    onError: (error) => {
      const data = error?.response?.data
      if (data && typeof data === 'object') {
        const messages = Object.entries(data)
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
          .join('; ')
        showError(messages || 'Failed to update profile')
      } else {
        showError(data?.detail || 'Failed to update profile')
      }
    },
  })

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    updateMutation.mutate(form)
  }

  return (
    <div className="card max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="first_name">First Name</label>
            <input
              id="first_name"
              className="input"
              value={form.first_name}
              onChange={handleChange('first_name')}
              placeholder="First name"
            />
          </div>
          <div>
            <label className="label" htmlFor="last_name">Last Name</label>
            <input
              id="last_name"
              className="input"
              value={form.last_name}
              onChange={handleChange('last_name')}
              placeholder="Last name"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            value={form.email}
            onChange={handleChange('email')}
            placeholder="Email address"
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input
            id="phone"
            className="input"
            value={form.phone}
            onChange={handleChange('phone')}
            placeholder="Phone number"
          />
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="btn btn-primary disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---- Security Tab ----
function SecurityTab() {
  const { showSuccess, showError } = useToast()

  const [form, setForm] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  })

  const passwordMutation = useMutation({
    mutationFn: (data) => authApi.changePassword(data),
    onSuccess: () => {
      showSuccess('Password changed successfully!')
      setForm({ old_password: '', new_password: '', confirm_password: '' })
    },
    onError: (error) => {
      const data = error?.response?.data
      if (data && typeof data === 'object') {
        const messages = Object.entries(data)
          .map(([key, val]) => `${key}: ${Array.isArray(val) ? val.join(', ') : val}`)
          .join('; ')
        showError(messages || 'Failed to change password')
      } else {
        showError('Failed to change password')
      }
    },
  })

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (form.new_password !== form.confirm_password) {
      showError("New passwords don't match")
      return
    }
    if (form.new_password.length < 8) {
      showError('New password must be at least 8 characters')
      return
    }
    passwordMutation.mutate(form)
  }

  return (
    <div className="card max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="old_password">Current Password</label>
          <input
            id="old_password"
            type="password"
            className="input"
            value={form.old_password}
            onChange={handleChange('old_password')}
            placeholder="Enter current password"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="new_password">New Password</label>
          <input
            id="new_password"
            type="password"
            className="input"
            value={form.new_password}
            onChange={handleChange('new_password')}
            placeholder="Enter new password (min 8 characters)"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm_password">Confirm New Password</label>
          <input
            id="confirm_password"
            type="password"
            className="input"
            value={form.confirm_password}
            onChange={handleChange('confirm_password')}
            placeholder="Confirm new password"
            required
          />
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={passwordMutation.isPending}
            className="btn btn-primary disabled:opacity-50"
          >
            {passwordMutation.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---- Account Info Section ----
function AccountInfoSection() {
  const { user } = useAuth()

  const infoItems = [
    { label: 'Username', value: user?.username },
    { label: 'Role', value: user?.role_display },
    { label: 'Organization', value: user?.organization_name || 'N/A' },
    {
      label: 'School(s)',
      value: user?.schools?.length > 0
        ? user.schools.map(s => s.name).join(', ')
        : 'N/A',
    },
    {
      label: 'Member Since',
      value: user?.created_at
        ? new Date(user.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
          })
        : 'N/A',
    },
    {
      label: 'Last Login',
      value: user?.last_login
        ? new Date(user.last_login).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : 'Never',
    },
  ]

  return (
    <div className="card max-w-2xl mt-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h2>
      <p className="text-sm text-gray-500 mb-4">
        These details are managed by your administrator and cannot be changed here.
      </p>
      <dl className="divide-y divide-gray-100">
        {infoItems.map(({ label, value }) => (
          <div key={label} className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">{label}</dt>
            <dd className="mt-1 sm:mt-0 sm:col-span-2 text-sm text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ---- Main Page ----
export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState('profile')

  const tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'security', label: 'Security' },
  ]

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Profile & Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your personal information and security</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && <ProfileTab />}
      {activeTab === 'security' && <SecurityTab />}

      {/* Account Info (always visible) */}
      <AccountInfoSection />
    </div>
  )
}
