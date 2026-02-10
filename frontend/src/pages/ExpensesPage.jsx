import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { financeApi } from '../services/api'

const CATEGORIES = [
  { value: 'SALARY', label: 'Salary' },
  { value: 'RENT', label: 'Rent' },
  { value: 'UTILITIES', label: 'Utilities' },
  { value: 'SUPPLIES', label: 'Supplies' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'MISC', label: 'Miscellaneous' },
]

const categoryColors = {
  SALARY: 'bg-blue-100 text-blue-800',
  RENT: 'bg-purple-100 text-purple-800',
  UTILITIES: 'bg-yellow-100 text-yellow-800',
  SUPPLIES: 'bg-green-100 text-green-800',
  MAINTENANCE: 'bg-orange-100 text-orange-800',
  MISC: 'bg-gray-100 text-gray-800',
}

export default function ExpensesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [form, setForm] = useState({
    category: 'SALARY', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: ''
  })

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts(),
  })

  const { data: expenses, isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo, categoryFilter],
    queryFn: () => financeApi.getExpenses({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
      ...(categoryFilter && { category: categoryFilter }),
    }),
  })

  const { data: categorySummary } = useQuery({
    queryKey: ['expenseCategorySummary', dateFrom, dateTo],
    queryFn: () => financeApi.getExpenseCategorySummary({
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
    }),
  })

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

  const closeModal = () => {
    setShowModal(false)
    setEditingExpense(null)
    setForm({ category: 'SALARY', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: '' })
  }

  const openEdit = (expense) => {
    setEditingExpense(expense)
    setForm({
      category: expense.category,
      amount: expense.amount,
      date: expense.date,
      description: expense.description || '',
      account: expense.account || '',
    })
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.account) {
      alert('Please select account')
      return
    }
    const data = { ...form, amount: parseFloat(form.amount), account: parseInt(form.account) }
    if (editingExpense) {
      updateMutation.mutate({ id: editingExpense.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const expenseList = expenses?.data?.results || expenses?.data || []
  const summaryCategories = categorySummary?.data?.categories || []
  const summaryTotal = categorySummary?.data?.total || 0
  const accountsList = accountsData?.data?.results || accountsData?.data || []

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-600">Track school expenditures</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
        >
          Add Expense
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input-field text-sm">
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
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
                  <span className={`px-2 py-0.5 rounded text-xs font-medium w-24 text-center ${categoryColors[cat.category] || 'bg-gray-100'}`}>
                    {cat.category_display}
                  </span>
                  <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-primary-500 h-full rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
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
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[expense.category]}`}>
                      {expense.category_display}
                    </span>
                    <span className="text-sm text-gray-500">{expense.date}</span>
                  </div>
                  <p className="text-lg font-bold text-gray-900">{Number(expense.amount).toLocaleString()}</p>
                  {expense.description && <p className="text-sm text-gray-600 mt-1">{expense.description}</p>}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => openEdit(expense)} className="text-xs text-primary-600 hover:underline">Edit</button>
                    <button onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(expense.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {expenseList.map((expense) => (
                    <tr key={expense.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{expense.date}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[expense.category]}`}>
                          {expense.category_display}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{Number(expense.amount).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{expense.description || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{expense.recorded_by_name || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => openEdit(expense)} className="text-sm text-primary-600 hover:underline mr-3">Edit</button>
                        <button onClick={() => { if (confirm('Delete this expense?')) deleteMutation.mutate(expense.id) }} className="text-sm text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Add/Edit Expense Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">{editingExpense ? 'Edit Expense' : 'Add Expense'}</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                    className="input-field"
                    required
                  >
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
                  <select
                    value={form.account}
                    onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))}
                    className="input-field"
                    required
                  >
                    <option value="">-- Select Account --</option>
                    {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                    className="input-field"
                    rows={3}
                    placeholder="Brief description of the expense..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeModal} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
                    {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save'}
                  </button>
                </div>
                {(createMutation.isError || updateMutation.isError) && (
                  <p className="text-sm text-red-600">Failed to save expense. Please try again.</p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
