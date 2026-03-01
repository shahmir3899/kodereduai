import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi, sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const ACCOUNT_TYPES = [
  { value: 'CASH', label: 'Cash', color: 'bg-green-100 text-green-800' },
  { value: 'BANK', label: 'Bank', color: 'bg-blue-100 text-blue-800' },
  { value: 'PERSON', label: 'Person', color: 'bg-purple-100 text-purple-800' },
]

const FEE_TYPES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'ADMISSION', label: 'Admission' },
  { value: 'BOOKS', label: 'Books' },
  { value: 'FINE', label: 'Fine' },
]

const EMPTY_ACCOUNT = { name: '', account_type: 'CASH', opening_balance: '', staff_visible: true }
const EMPTY_FEE = { monthly_amount: '', fee_type: 'MONTHLY', class_obj: '', effective_from: '' }

export default function FinanceStep({ onNext, refetchCompletion }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('accounts')
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT)
  const [feeForm, setFeeForm] = useState(EMPTY_FEE)
  const [showForm, setShowForm] = useState(false)
  const [errors, setErrors] = useState({})

  // Queries
  const { data: accountsRes } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 100 }),
  })
  const accounts = accountsRes?.data?.results || accountsRes?.data || []

  const { data: feeStructuresRes } = useQuery({
    queryKey: ['feeStructures'],
    queryFn: () => financeApi.getFeeStructures({ page_size: 100 }),
  })
  const feeStructures = feeStructuresRes?.data?.results || feeStructuresRes?.data || []

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 200 }),
  })
  const classes = classesRes?.data?.results || classesRes?.data || []

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 100 }),
  })
  const currentYear = (yearsRes?.data?.results || yearsRes?.data || []).find(y => y.is_current)

  // Mutations
  const createAccountMut = useMutation({
    mutationFn: (data) => financeApi.createAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      refetchCompletion()
      addToast('Account created!', 'success')
      setAccountForm(EMPTY_ACCOUNT)
      setShowForm(false)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const createFeeMut = useMutation({
    mutationFn: (data) => financeApi.createFeeStructure(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      refetchCompletion()
      addToast('Fee structure created!', 'success')
      setFeeForm(EMPTY_FEE)
      setShowForm(false)
      setErrors({})
    },
    onError: (err) => {
      const d = err.response?.data
      if (typeof d === 'object') setErrors(d)
      else addToast(d?.detail || 'Failed', 'error')
    },
  })

  const tabs = [
    { key: 'accounts', label: 'Accounts', count: accounts.length, target: 2 },
    { key: 'fees', label: 'Fee Structures', count: feeStructures.length, target: 1 },
  ]

  const formatAmount = (val) => {
    const num = parseFloat(val)
    return isNaN(num) ? '—' : `Rs. ${num.toLocaleString()}`
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Finance Setup</h2>
      <p className="text-sm text-gray-500 mb-6">Create financial accounts and define fee structures.</p>

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setShowForm(false); setErrors({}) }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === t.key ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${t.count >= t.target ? 'text-green-600' : 'text-gray-400'}`}>
              {t.count >= t.target ? `✓ ${t.count}` : `${t.count} of ${t.target}`}
            </span>
          </button>
        ))}
      </div>

      {/* Accounts Tab */}
      {activeTab === 'accounts' && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Financial Accounts ({accounts.length})</h3>
            <button onClick={() => setShowForm(true)} className="text-xs text-sky-600 hover:text-sky-700">+ Add Account</button>
          </div>

          {accounts.length > 0 && (
            <div className="space-y-2 mb-4">
              {accounts.map(a => {
                const typeInfo = ACCOUNT_TYPES.find(t => t.value === a.account_type)
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{a.name}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${typeInfo?.color || 'bg-gray-100 text-gray-600'}`}>
                        {a.account_type}
                      </span>
                      {a.is_default && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-sky-100 text-sky-700">Default</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {accounts.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 mb-3">No accounts yet. Create at least a Cash and Bank account.</p>
          )}

          {showForm && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Main Cash"
                    value={accountForm.name}
                    onChange={e => { setAccountForm(p => ({ ...p, name: e.target.value })); setErrors({}) }}
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type *</label>
                  <select
                    className="input"
                    value={accountForm.account_type}
                    onChange={e => setAccountForm(p => ({ ...p, account_type: e.target.value }))}
                  >
                    {ACCOUNT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Opening Balance</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="0"
                    value={accountForm.opening_balance}
                    onChange={e => setAccountForm(p => ({ ...p, opening_balance: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => createAccountMut.mutate(accountForm)}
                  disabled={createAccountMut.isPending}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  {createAccountMut.isPending ? 'Creating...' : 'Create Account'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fee Structures Tab */}
      {activeTab === 'fees' && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Fee Structures ({feeStructures.length})</h3>
            <button onClick={() => {
              setShowForm(true)
              setFeeForm(p => ({
                ...p,
                effective_from: currentYear?.start_date || new Date().toISOString().split('T')[0],
              }))
            }} className="text-xs text-sky-600 hover:text-sky-700">+ Add Fee Structure</button>
          </div>

          {feeStructures.length > 0 && (
            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {feeStructures.map(f => (
                <div key={f.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">
                      {f.class_name || f.student_name || 'All Classes'}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-600">
                      {f.fee_type_display || f.fee_type}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{formatAmount(f.monthly_amount)}</span>
                </div>
              ))}
            </div>
          )}

          {feeStructures.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 mb-3">No fee structures yet. Define your monthly tuition fees, admission fees, etc.</p>
          )}

          {showForm && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Fee Type *</label>
                  <select
                    className="input"
                    value={feeForm.fee_type}
                    onChange={e => setFeeForm(p => ({ ...p, fee_type: e.target.value }))}
                  >
                    {FEE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (Rs.) *</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="e.g. 5000"
                    value={feeForm.monthly_amount}
                    onChange={e => { setFeeForm(p => ({ ...p, monthly_amount: e.target.value })); setErrors({}) }}
                  />
                  {errors.monthly_amount && <p className="text-xs text-red-600 mt-1">{errors.monthly_amount[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Class *</label>
                  <select
                    className="input"
                    value={feeForm.class_obj}
                    onChange={e => setFeeForm(p => ({ ...p, class_obj: e.target.value }))}
                  >
                    <option value="">Select class</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.section ? ` ${c.section}` : ''}</option>
                    ))}
                  </select>
                  {errors.class_obj && <p className="text-xs text-red-600 mt-1">{errors.class_obj[0]}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Effective From *</label>
                  <input
                    type="date"
                    className="input"
                    value={feeForm.effective_from}
                    onChange={e => setFeeForm(p => ({ ...p, effective_from: e.target.value }))}
                  />
                  {errors.effective_from && <p className="text-xs text-red-600 mt-1">{errors.effective_from[0]}</p>}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    const e = {}
                    if (!feeForm.monthly_amount) e.monthly_amount = ['Amount is required']
                    if (!feeForm.class_obj) e.class_obj = ['Class is required']
                    if (!feeForm.effective_from) e.effective_from = ['Effective date is required']
                    if (Object.keys(e).length) { setErrors(e); return }
                    createFeeMut.mutate({
                      ...feeForm,
                      class_obj: parseInt(feeForm.class_obj),
                      academic_year: currentYear?.id || null,
                    })
                  }}
                  disabled={createFeeMut.isPending}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  {createFeeMut.isPending ? 'Creating...' : 'Create Fee Structure'}
                </button>
                <button onClick={() => { setShowForm(false); setErrors({}) }} className="text-sm text-gray-500 px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
