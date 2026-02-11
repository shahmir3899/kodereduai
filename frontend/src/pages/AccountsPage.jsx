import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../services/api'
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

export default function AccountsPage() {
  const queryClient = useQueryClient()
  const { isStaffMember } = useAuth()
  const canWrite = !isStaffMember
  const [activeTab, setActiveTab] = useState('balances')

  // Balance filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Account modal
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [accountForm, setAccountForm] = useState({
    name: '', account_type: 'CASH', opening_balance: '', staff_visible: true
  })

  // Transfer modal
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferForm, setTransferForm] = useState({
    from_account: '', to_account: '', amount: '', date: new Date().toISOString().split('T')[0], description: ''
  })

  // Transfer filters
  const [tfrDateFrom, setTfrDateFrom] = useState('')
  const [tfrDateTo, setTfrDateTo] = useState('')

  // Queries
  const { data: balancesData, isLoading: balancesLoading } = useQuery({
    queryKey: ['accountBalances', dateFrom, dateTo],
    queryFn: () => financeApi.getAccountBalances({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
    }),
  })

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts(),
  })

  const { data: transfersData, isLoading: transfersLoading } = useQuery({
    queryKey: ['transfers', tfrDateFrom, tfrDateTo],
    queryFn: () => financeApi.getTransfers({
      ...(tfrDateFrom && { date_from: tfrDateFrom }),
      ...(tfrDateTo && { date_to: tfrDateTo }),
    }),
  })

  // Mutations
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

  const createTransferMutation = useMutation({
    mutationFn: (data) => financeApi.createTransfer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      closeTransferModal()
    },
  })

  const deleteTransferMutation = useMutation({
    mutationFn: (id) => financeApi.deleteTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
    },
  })

  const closeAccountModal = () => {
    setShowAccountModal(false)
    setEditingAccount(null)
    setAccountForm({ name: '', account_type: 'CASH', opening_balance: '', staff_visible: true })
  }

  const closeTransferModal = () => {
    setShowTransferModal(false)
    setTransferForm({ from_account: '', to_account: '', amount: '', date: new Date().toISOString().split('T')[0], description: '' })
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

  const handleTransferSubmit = (e) => {
    e.preventDefault()
    createTransferMutation.mutate({
      ...transferForm,
      from_account: parseInt(transferForm.from_account),
      to_account: parseInt(transferForm.to_account),
      amount: parseFloat(transferForm.amount),
    })
  }

  const balances = balancesData?.data?.accounts || []
  const grandTotal = balancesData?.data?.grand_total || 0
  const accountList = accountsData?.data?.results || accountsData?.data || []
  const transferList = transfersData?.data?.results || transfersData?.data || []

  const tabs = [
    { key: 'balances', label: 'Balance Summary' },
    { key: 'manage', label: 'Manage Accounts' },
    { key: 'transfers', label: 'Transfers' },
  ]

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-600">Track where money flows</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && activeTab === 'manage' && (
            <button
              onClick={() => setShowAccountModal(true)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
            >
              Add Account
            </button>
          )}
          {canWrite && activeTab === 'transfers' && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
            >
              Record Transfer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Balance Summary */}
      {activeTab === 'balances' && (
        <div>
          <div className="card mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field text-sm" />
              </div>
            </div>
          </div>

          <div className="card">
            {balancesLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : balances.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-2">No accounts created yet</p>
                <p className="text-sm text-gray-400">Go to "Manage Accounts" to add your first account</p>
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-3">
                  {balances.map((acct, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">{acct.name}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[acct.account_type] || 'bg-gray-100'}`}>
                          {acct.account_type_display || acct.account_type}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><span className="text-gray-500">BBF:</span> <span className="font-medium">{Number(acct.opening_balance).toLocaleString()}</span></div>
                        <div><span className="text-gray-500">Receipts:</span> <span className="font-medium text-green-700">{Number(acct.receipts).toLocaleString()}</span></div>
                        <div><span className="text-gray-500">Payments:</span> <span className="font-medium text-red-700">{Number(acct.payments).toLocaleString()}</span></div>
                        <div><span className="text-gray-500">Tfr In:</span> <span className="font-medium text-blue-700">{Number(acct.transfers_in).toLocaleString()}</span></div>
                        <div><span className="text-gray-500">Tfr Out:</span> <span className="font-medium text-orange-700">{Number(acct.transfers_out).toLocaleString()}</span></div>
                        <div><span className="text-gray-500">Net:</span> <span className="font-bold">{Number(acct.net_balance).toLocaleString()}</span></div>
                      </div>
                    </div>
                  ))}
                  <div className="border-t pt-3 flex items-center justify-between">
                    <span className="font-semibold text-gray-700">Grand Total</span>
                    <span className="text-lg font-bold text-gray-900">{Number(grandTotal).toLocaleString()}</span>
                  </div>
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">BBF</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Receipts</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Payments</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tfr In</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tfr Out</th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Balance</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {balances.map((acct, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-3 text-sm font-medium text-gray-900">{acct.name}</td>
                          <td className="px-3 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[acct.account_type] || 'bg-gray-100'}`}>
                              {acct.account_type_display || acct.account_type}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-700 text-right">{Number(acct.opening_balance).toLocaleString()}</td>
                          <td className="px-3 py-3 text-sm text-green-700 text-right">{Number(acct.receipts).toLocaleString()}</td>
                          <td className="px-3 py-3 text-sm text-red-700 text-right">{Number(acct.payments).toLocaleString()}</td>
                          <td className="px-3 py-3 text-sm text-blue-700 text-right">{Number(acct.transfers_in).toLocaleString()}</td>
                          <td className="px-3 py-3 text-sm text-orange-700 text-right">{Number(acct.transfers_out).toLocaleString()}</td>
                          <td className="px-3 py-3 text-sm font-bold text-gray-900 text-right">{Number(acct.net_balance).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={7} className="px-3 py-3 text-sm font-semibold text-gray-700 text-right">Grand Total</td>
                        <td className="px-3 py-3 text-sm font-bold text-gray-900 text-right">{Number(grandTotal).toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab: Manage Accounts */}
      {activeTab === 'manage' && (
        <div className="card">
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
                        {canWrite && !account.staff_visible && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Hidden</span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[account.account_type]}`}>
                          {account.account_type}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600">Opening Balance: {Number(account.opening_balance).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{account.is_active ? 'Active' : 'Inactive'}</p>
                    {canWrite && (
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => openEditAccount(account)} className="text-xs text-primary-600 hover:underline">Edit</button>
                        <button onClick={() => { if (confirm('Delete this account?')) deleteAccountMutation.mutate(account.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                      </div>
                    )}
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
                      {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Staff Visible</th>}
                      {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {accountList.map((account) => (
                      <tr key={account.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{account.name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[account.account_type]}`}>
                            {account.account_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-right">{Number(account.opening_balance).toLocaleString()}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${account.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                            {account.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {canWrite && (
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${account.staff_visible ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                              {account.staff_visible ? 'Yes' : 'Hidden'}
                            </span>
                          </td>
                        )}
                        {canWrite && (
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => openEditAccount(account)} className="text-sm text-primary-600 hover:underline mr-3">Edit</button>
                            <button onClick={() => { if (confirm('Delete this account?')) deleteAccountMutation.mutate(account.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Transfers */}
      {activeTab === 'transfers' && (
        <div>
          <div className="card mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
                <input type="date" value={tfrDateFrom} onChange={(e) => setTfrDateFrom(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
                <input type="date" value={tfrDateTo} onChange={(e) => setTfrDateTo(e.target.value)} className="input-field text-sm" />
              </div>
            </div>
          </div>

          <div className="card">
            {transfersLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : transferList.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-2">No transfers recorded</p>
                <p className="text-sm text-gray-400">Click "Record Transfer" to move funds between accounts</p>
              </div>
            ) : (
              <>
                {/* Mobile */}
                <div className="sm:hidden space-y-3">
                  {transferList.map((tfr) => (
                    <div key={tfr.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">{tfr.from_account_name} &rarr; {tfr.to_account_name}</span>
                        <span className="font-bold text-gray-900">{Number(tfr.amount).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-500">{tfr.date} {tfr.description && `— ${tfr.description}`}</p>
                      {canWrite && (
                        <button
                          onClick={() => { if (confirm('Delete this transfer?')) deleteTransferMutation.mutate(tfr.id) }}
                          className="mt-2 text-xs text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {transferList.map((tfr) => (
                        <tr key={tfr.id}>
                          <td className="px-4 py-3 text-sm text-gray-500">{tfr.date}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{tfr.from_account_name}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{tfr.to_account_name}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{Number(tfr.amount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{tfr.description || '—'}</td>
                          {canWrite && (
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => { if (confirm('Delete this transfer?')) deleteTransferMutation.mutate(tfr.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                            </td>
                          )}
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
                  <input
                    type="text"
                    value={accountForm.name}
                    onChange={(e) => setAccountForm(f => ({ ...f, name: e.target.value }))}
                    className="input-field"
                    required
                    placeholder="e.g. Principal Branch 1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={accountForm.account_type}
                    onChange={(e) => setAccountForm(f => ({ ...f, account_type: e.target.value }))}
                    className="input-field"
                  >
                    {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Opening Balance (BBF)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={accountForm.opening_balance}
                    onChange={(e) => setAccountForm(f => ({ ...f, opening_balance: e.target.value }))}
                    className="input-field"
                    placeholder="0.00"
                  />
                </div>
                {editingAccount && (
                  <div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={accountForm.is_active !== false}
                        onChange={(e) => setAccountForm(f => ({ ...f, is_active: e.target.checked }))}
                        className="rounded"
                      />
                      Active
                    </label>
                  </div>
                )}
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={accountForm.staff_visible}
                      onChange={(e) => setAccountForm(f => ({ ...f, staff_visible: e.target.checked }))}
                      className="rounded"
                    />
                    Visible to Staff
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">Staff members can see this account and its transactions</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeAccountModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createAccountMutation.isPending || updateAccountMutation.isPending}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
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

      {/* Record Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Record Transfer</h3>
              <form onSubmit={handleTransferSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From Account</label>
                  <select
                    value={transferForm.from_account}
                    onChange={(e) => setTransferForm(f => ({ ...f, from_account: e.target.value }))}
                    className="input-field"
                    required
                  >
                    <option value="">-- Select Account --</option>
                    {accountList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To Account</label>
                  <select
                    value={transferForm.to_account}
                    onChange={(e) => setTransferForm(f => ({ ...f, to_account: e.target.value }))}
                    className="input-field"
                    required
                  >
                    <option value="">-- Select Account --</option>
                    {accountList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm(f => ({ ...f, amount: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={transferForm.date}
                    onChange={(e) => setTransferForm(f => ({ ...f, date: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                  <textarea
                    value={transferForm.description}
                    onChange={(e) => setTransferForm(f => ({ ...f, description: e.target.value }))}
                    className="input-field"
                    rows={2}
                    placeholder="Reason for transfer..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeTransferModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createTransferMutation.isPending}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
                    {createTransferMutation.isPending ? 'Saving...' : 'Record Transfer'}
                  </button>
                </div>
                {createTransferMutation.isError && (
                  <p className="text-sm text-red-600">{getErrorMessage(createTransferMutation.error, 'Failed to record transfer')}</p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
