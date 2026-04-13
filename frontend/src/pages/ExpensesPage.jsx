import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { financeApi } from '../services/api'
import TransferModal from '../components/TransferModal'
import { useConfirmModal } from '../components/ConfirmModal'
import ExpenseCategoryManagerModal from './ExpenseCategoryManagerModal'

const COLOR_PALETTE = [
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
  'bg-yellow-100 text-yellow-800',
  'bg-green-100 text-green-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-red-100 text-red-800',
  'bg-gray-100 text-gray-800',
]

export default function ExpensesPage() {
  const { user, isStaffMember } = useAuth()
  const canWrite = !isStaffMember
  const queryClient = useQueryClient()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialTab = searchParams.get('tab') === 'transfers' ? 'transfers' : 'expenses'
  const [activeTab, setActiveTab] = useState(initialTab)

  // Expense state
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [form, setForm] = useState({
    category: '', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: '', is_sensitive: false
  })
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showCategoryModal, setShowCategoryModal] = useState(false)

  // Transfer state
  const [tfrDateFrom, setTfrDateFrom] = useState('')
  const [tfrDateTo, setTfrDateTo] = useState('')
  const [showTransferModal, setShowTransferModal] = useState(false)

  const toDateInputValue = (date) => date.toISOString().split('T')[0]

  const applyExpenseDatePreset = (preset) => {
    const today = new Date()
    const todayStr = toDateInputValue(today)

    if (preset === 'today') {
      setDateFrom(todayStr)
      setDateTo(todayStr)
      return
    }

    if (preset === 'thisMonth') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      setDateFrom(toDateInputValue(monthStart))
      setDateTo(todayStr)
      return
    }

    if (preset === 'last30') {
      const last30 = new Date(today)
      last30.setDate(last30.getDate() - 29)
      setDateFrom(toDateInputValue(last30))
      setDateTo(todayStr)
      return
    }

    setDateFrom('')
    setDateTo('')
  }

  const applyTransferDatePreset = (preset) => {
    const today = new Date()
    const todayStr = toDateInputValue(today)

    if (preset === 'today') {
      setTfrDateFrom(todayStr)
      setTfrDateTo(todayStr)
      return
    }

    if (preset === 'thisMonth') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      setTfrDateFrom(toDateInputValue(monthStart))
      setTfrDateTo(todayStr)
      return
    }

    if (preset === 'last30') {
      const last30 = new Date(today)
      last30.setDate(last30.getDate() - 29)
      setTfrDateFrom(toDateInputValue(last30))
      setTfrDateTo(todayStr)
      return
    }

    setTfrDateFrom('')
    setTfrDateTo('')
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (tab === 'transfers') {
      setSearchParams({ tab: 'transfers' })
    } else {
      setSearchParams({})
    }
  }

  // --- Expense Categories ---
  const { data: categoriesData } = useQuery({
    queryKey: ['expenseCategories'],
    queryFn: () => financeApi.getExpenseCategories({ page_size: 9999 }),
  })
  const categories = categoriesData?.data?.results || categoriesData?.data || []

  const getCategoryColor = (categoryId) => {
    const idx = categories.findIndex(c => c.id === categoryId)
    return COLOR_PALETTE[idx % COLOR_PALETTE.length] || COLOR_PALETTE[COLOR_PALETTE.length - 1]
  }

  const addCategoryMutation = useMutation({
    mutationFn: (data) => financeApi.createExpenseCategory(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
      const newCat = res?.data
      if (newCat?.id) setForm(f => ({ ...f, category: newCat.id }))
      setNewCategoryName('')
    },
  })

  // --- Expense Queries ---
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
  })

  const { data: expenses, isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo, categoryFilter, accountFilter],
    queryFn: () => financeApi.getExpenses({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(categoryFilter && { category: categoryFilter }),
      ...(accountFilter && { account: accountFilter }),
      page_size: 9999,
    }),
  })

  const { data: categorySummary } = useQuery({
    queryKey: ['expenseCategorySummary', dateFrom, dateTo],
    queryFn: () => financeApi.getExpenseCategorySummary({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
    }),
    enabled: activeTab === 'expenses',
  })

  // --- Transfer Queries ---
  const { data: transfersData, isLoading: transfersLoading } = useQuery({
    queryKey: ['transfers', tfrDateFrom, tfrDateTo],
    queryFn: () => financeApi.getTransfers({
      ...(tfrDateFrom && { date_from: tfrDateFrom }),
      ...(tfrDateTo && { date_to: tfrDateTo }),
      page_size: 9999,
    }),
    enabled: activeTab === 'transfers',
  })

  // --- Expense Mutations ---
  const createMutation = useMutation({
    mutationFn: (data) => financeApi.createExpense(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenseCategorySummary'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.updateExpense(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenseCategorySummary'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.deleteExpense(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] })
      queryClient.invalidateQueries({ queryKey: ['expenseCategorySummary'] })
    },
  })

  // --- Transfer Mutations ---
  const deleteTransferMutation = useMutation({
    mutationFn: (id) => financeApi.deleteTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
    },
  })

  const closeModal = () => {
    setShowModal(false)
    setEditingExpense(null)
    setForm({ category: categories[0]?.id || '', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: '', is_sensitive: false })
    setNewCategoryName('')
  }

  const openEdit = (expense) => {
    setEditingExpense(expense)
    setForm({
      category: expense.category,
      amount: expense.amount,
      date: expense.date,
      description: expense.description || '',
      account: expense.account || '',
      is_sensitive: expense.is_sensitive || false,
    })
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.account) {
      alert('Please select account')
      return
    }
    if (!form.category) {
      alert('Please select a category')
      return
    }
    const data = { ...form, amount: parseFloat(form.amount), account: parseInt(form.account), category: parseInt(form.category) }
    if (editingExpense) {
      updateMutation.mutate({ id: editingExpense.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const handleAddCategory = () => {
    const name = newCategoryName.trim()
    if (!name) return
    addCategoryMutation.mutate({ name })
  }

  const expenseList = expenses?.data?.results || expenses?.data || []
  const summaryCategories = categorySummary?.data?.categories || []
  const summaryTotal = categorySummary?.data?.total || 0
  const accountsList = accountsData?.data?.results || accountsData?.data || []
  const transferList = transfersData?.data?.results || transfersData?.data || []

  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user?.role)
  const canEditExpense = (expense) => isAdmin || Number(expense?.recorded_by) === Number(user?.id)
  const canEditTransfer = (transfer) => isAdmin || Number(transfer?.recorded_by) === Number(user?.id)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Expenses & Transfers</h1>
          <p className="text-sm text-gray-600">Track expenditures and fund movements</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && activeTab === 'expenses' && (
            <>
              <button onClick={() => setShowCategoryModal(true)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm">
                ⚙ Categories
              </button>
              <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                Add Expense
              </button>
            </>
          )}
          {canWrite && activeTab === 'transfers' && (
            <button onClick={() => setShowTransferModal(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
              Record Transfer
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => handleTabChange('expenses')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'expenses' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Expenses
        </button>
        <button
          onClick={() => handleTabChange('transfers')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'transfers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Transfers
        </button>
      </div>

      {/* === Expenses Tab === */}
      {activeTab === 'expenses' && (
        <>
          {/* Filters */}
          <div className="card mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input-field text-sm">
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Account</label>
                <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="input-field text-sm">
                  <option value="">All Accounts</option>
                  {accountsList.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => applyExpenseDatePreset('today')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Today</button>
              <button type="button" onClick={() => applyExpenseDatePreset('thisMonth')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">This Month</button>
              <button type="button" onClick={() => applyExpenseDatePreset('last30')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Last 30 Days</button>
              <button type="button" onClick={() => applyExpenseDatePreset('clear')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Clear Dates</button>
            </div>
          </div>

          {/* Category Summary */}
          {summaryCategories.length > 0 && (
            <div className="card mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</h2>
              <div className="space-y-2">
                {summaryCategories.map((cat) => {
                  const pct = summaryTotal > 0 ? (cat.total_amount / summaryTotal * 100) : 0
                  return (
                    <div key={cat.category} className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium w-24 text-center ${getCategoryColor(cat.category)}`}>
                        {cat.category_display}
                      </span>
                      <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                        <div className="bg-primary-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-28 text-right">
                        {Number(cat.total_amount).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-sm font-bold text-gray-900">{Number(summaryTotal).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Expenses Table */}
          <div className="card">
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : expenseList.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No expenses recorded yet</p>
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-3">
                  {expenseList.map((expense) => (
                    <div key={expense.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(expense.category)}`}>
                          {expense.category_name || 'Uncategorized'}
                        </span>
                        <span className="text-sm text-gray-500">{expense.date}</span>
                      </div>
                      <p className="text-lg font-bold text-gray-900">{Number(expense.amount).toLocaleString()}</p>
                      <p className="text-sm text-gray-600 mt-1">Account: {expense.account_name || '-'}</p>
                      {expense.description && <p className="text-sm text-gray-600 mt-1">{expense.description}</p>}
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                        <span>By: {expense.recorded_by_name || '-'}</span>
                        <span>{expense.created_at ? new Date(expense.created_at).toLocaleDateString() : '-'}</span>
                      </div>
                      {canWrite && canEditExpense(expense) && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => openEdit(expense)} className="text-xs text-primary-600 hover:underline">Edit</button>
                          <button onClick={async () => { const ok = await confirm({ title: 'Delete Expense', message: 'Delete this expense? This cannot be undone.' }); if (ok) deleteMutation.mutate(expense.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
                        {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {expenseList.map((expense) => (
                        <tr key={expense.id}>
                          <td className="px-4 py-3 text-sm text-gray-900">{expense.date}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCategoryColor(expense.category)}`}>{expense.category_name || 'Uncategorized'}</span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{Number(expense.amount).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{expense.account_name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{expense.description || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{expense.recorded_by_name || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {expense.created_at ? new Date(expense.created_at).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            }) : '-'}
                          </td>
                          {canWrite && (
                            <td className="px-4 py-3 text-center">
                              {canEditExpense(expense) ? (
                                <>
                                  <button onClick={() => openEdit(expense)} className="text-sm text-primary-600 hover:underline mr-3">Edit</button>
                                  <button onClick={async () => { const ok = await confirm({ title: 'Delete Expense', message: 'Delete this expense? This cannot be undone.' }); if (ok) deleteMutation.mutate(expense.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                                </>
                              ) : (
                                <span className="text-xs text-gray-400">No access</span>
                              )}
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
        </>
      )}

      {/* === Transfers Tab === */}
      {activeTab === 'transfers' && (
        <>
          <div className="card mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
                <input type="date" value={tfrDateFrom} max={tfrDateTo || undefined} onChange={(e) => setTfrDateFrom(e.target.value)} className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
                <input type="date" value={tfrDateTo} min={tfrDateFrom || undefined} onChange={(e) => setTfrDateTo(e.target.value)} className="input-field text-sm" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => applyTransferDatePreset('today')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Today</button>
              <button type="button" onClick={() => applyTransferDatePreset('thisMonth')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">This Month</button>
              <button type="button" onClick={() => applyTransferDatePreset('last30')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Last 30 Days</button>
              <button type="button" onClick={() => applyTransferDatePreset('clear')} className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Clear Dates</button>
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
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                        <span>By: {tfr.recorded_by_name || '-'}</span>
                        <span>{tfr.created_at ? new Date(tfr.created_at).toLocaleDateString() : '-'}</span>
                      </div>
                      {canWrite && canEditTransfer(tfr) && (
                        <button
                          onClick={async () => { const ok = await confirm({ title: 'Delete Transfer', message: 'Delete this transfer? This cannot be undone.' }); if (ok) deleteTransferMutation.mutate(tfr.id) }}
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created At</th>
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
                          <td className="px-4 py-3 text-sm text-gray-500">{tfr.recorded_by_name || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {tfr.created_at ? new Date(tfr.created_at).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            }) : '-'}
                          </td>
                          {canWrite && (
                            <td className="px-4 py-3 text-center">
                              {canEditTransfer(tfr) ? (
                                <button onClick={async () => { const ok = await confirm({ title: 'Delete Transfer', message: 'Delete this transfer? This cannot be undone.' }); if (ok) deleteTransferMutation.mutate(tfr.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                              ) : (
                                <span className="text-xs text-gray-400">No access</span>
                              )}
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
        </>
      )}

      {/* Add/Edit Expense Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={closeModal}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
              <h3 className="text-lg font-semibold text-gray-900">{editingExpense ? 'Edit Expense' : 'New Expense'}</h3>
              <button
                type="button"
                onClick={closeModal}
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4 sm:px-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Amount — hero field */}
                <div>
                  <label className="label">Amount</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-semibold text-gray-400">PKR</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.amount}
                      onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                      className="input pl-12 text-lg font-semibold"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>

                {/* Category + Date row */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Category</label>
                    <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="input" required>
                      <option value="">Select category</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Date</label>
                    <input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} className="input" required />
                  </div>
                </div>

                {/* Quick add category */}
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="New category..."
                      className="input flex-1 !py-1.5 text-sm"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory() } }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
                      className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
                    >
                      + Add
                    </button>
                  </div>
                )}

                {/* Account */}
                <div>
                  <label className="label">Account <span className="text-red-500">*</span></label>
                  <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input" required>
                    <option value="">Select account</option>
                    {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>

                {/* Description */}
                <div>
                  <label className="label">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="input" rows={2} placeholder="What was this expense for?" />
                </div>

                {/* Sensitive toggle */}
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 transition hover:bg-gray-50">
                  <input type="checkbox" checked={form.is_sensitive} onChange={(e) => setForm(f => ({ ...f, is_sensitive: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Mark as Sensitive</span>
                    <p className="text-xs text-gray-400">Hidden from staff members</p>
                  </div>
                </label>

                {(createMutation.isError || updateMutation.isError) && (
                  <p className="text-sm text-red-600">Failed to save expense. Please try again.</p>
                )}
              </form>
            </div>

            {/* Footer */}
            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
              <button type="button" onClick={closeModal} className="btn btn-secondary w-full sm:w-auto">Cancel</button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="btn btn-primary w-full sm:w-auto"
                onClick={handleSubmit}
              >
                {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editingExpense ? 'Update Expense' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal (reusable component) */}
      <TransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['transfers'] })}
      />

      <ConfirmModalRoot />
      {showCategoryModal && <ExpenseCategoryManagerModal onClose={() => setShowCategoryModal(false)} />}
    </div>
  )
}
