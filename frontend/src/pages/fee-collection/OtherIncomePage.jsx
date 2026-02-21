import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useOtherIncome } from './useOtherIncome'
import { IncomeModal, DeleteConfirmModal } from './FeeModals'
import { MONTHS } from './FeeFilters'
import { useToast } from '../../components/Toast'

export default function OtherIncomePage() {
  const { isStaffMember } = useAuth()
  const { showWarning } = useToast()
  const canWrite = !isStaffMember
  const now = new Date()

  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [showIncomeModal, setShowIncomeModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const [incomeForm, setIncomeForm] = useState({
    category: '', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: ''
  })

  const data = useOtherIncome({ month, year })

  const handleAddIncome = (e) => {
    e.preventDefault()
    if (!incomeForm.account) {
      showWarning('Please select an account')
      return
    }
    data.incomeMutation.mutate({
      ...incomeForm,
      amount: parseFloat(incomeForm.amount),
      account: parseInt(incomeForm.account),
      category: parseInt(incomeForm.category),
    }, {
      onSuccess: () => {
        setShowIncomeModal(false)
        setIncomeForm({ category: '', amount: '', date: new Date().toISOString().split('T')[0], description: '', account: '' })
      },
    })
  }

  const handleDeleteConfirm = () => {
    data.deleteIncomeMutation.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    })
  }

  const totalIncome = data.incomeList.reduce((sum, i) => sum + Number(i.amount), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Other Income</h1>
          <p className="text-sm text-gray-600">Track non-fee income like sales, donations, and other revenue</p>
        </div>
        {canWrite && (
          <button onClick={() => setShowIncomeModal(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
            Add Income
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="input-field text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="input-field text-sm">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary card */}
      {data.incomeList.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Other Income</p>
              <p className="text-sm text-gray-400">{MONTHS[month - 1]} {year}</p>
            </div>
            <p className="text-2xl font-bold text-green-700">{totalIncome.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Income list */}
      <div className="card">
        {data.isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : data.incomeList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-2">No other income recorded for {MONTHS[month - 1]} {year}</p>
            <p className="text-sm text-gray-400">Click "Add Income" to record sales, donations, or other income</p>
          </div>
        ) : (
          <>
            {/* Mobile view */}
            <div className="sm:hidden space-y-3">
              {data.incomeList.map((item) => (
                <div key={item.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{item.category_name}</span>
                    <span className="font-bold text-green-700">{Number(item.amount).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-500">{item.date} {item.description && `\u2014 ${item.description}`}</p>
                  {item.account_name && <p className="text-xs text-gray-400 mt-1">Account: {item.account_name}</p>}
                  {canWrite && <button onClick={() => setDeleteTarget(item.id)} className="mt-2 text-xs text-red-600 hover:text-red-800">Delete</button>}
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    {canWrite && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.incomeList.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.date}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.category_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.description || '\u2014'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.account_name || '\u2014'}</td>
                      <td className="px-4 py-3 text-sm font-medium text-green-700 text-right">{Number(item.amount).toLocaleString()}</td>
                      {canWrite && (
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => setDeleteTarget(item.id)} className="text-sm text-red-600 hover:text-red-800">Delete</button>
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

      {/* Modals */}
      <IncomeModal
        show={showIncomeModal}
        onClose={() => setShowIncomeModal(false)}
        form={incomeForm} setForm={setIncomeForm}
        onSubmit={handleAddIncome}
        isPending={data.incomeMutation.isPending}
        error={data.incomeMutation.isError ? data.incomeMutation.error : null}
        accountsList={data.accountsList}
        incomeCategories={data.incomeCategories}
      />

      <DeleteConfirmModal
        show={deleteTarget !== null}
        message="Delete this income record? This cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        isPending={data.deleteIncomeMutation.isPending}
      />
    </div>
  )
}
