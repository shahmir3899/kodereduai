import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

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

export default function TransferModal({ isOpen, onClose, onSuccess }) {
  const queryClient = useQueryClient()
  const { isPrincipal } = useAuth()
  const [form, setForm] = useState({
    from_account: '', to_account: '', amount: '',
    date: new Date().toISOString().split('T')[0], description: ''
  })

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
    enabled: isOpen,
  })

  const accountListAll = accountsData?.data?.results || accountsData?.data || []
  const fromAccountList = isPrincipal
    ? accountListAll.filter(a => a.school !== null)
    : accountListAll

  const createTransferMutation = useMutation({
    mutationFn: (data) => financeApi.createTransfer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalancesAll'] })
      setForm({
        from_account: '', to_account: '', amount: '',
        date: new Date().toISOString().split('T')[0], description: ''
      })
      onSuccess?.()
      onClose()
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    createTransferMutation.mutate({
      ...form,
      from_account: parseInt(form.from_account),
      to_account: parseInt(form.to_account),
      amount: parseFloat(form.amount),
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Record Transfer</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Account</label>
              <select
                value={form.from_account}
                onChange={(e) => setForm(f => ({ ...f, from_account: e.target.value }))}
                className="input-field"
                required
              >
                <option value="">-- Select Account --</option>
                {fromAccountList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Account</label>
              <select
                value={form.to_account}
                onChange={(e) => setForm(f => ({ ...f, to_account: e.target.value }))}
                className="input-field"
                required
              >
                <option value="">-- Select Account --</option>
                {accountListAll.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                className="input-field"
                rows={2}
                placeholder="Reason for transfer..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
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
  )
}
