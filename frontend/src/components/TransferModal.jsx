import { useEffect, useState } from 'react'
import Field from './ui/Field'
import Button from './ui/Button'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getErrorMessage } from '../utils/errorUtils'
import { useEscapeKey } from '../hooks/useEscapeKey'

const buildInitialForm = (transfer = null) => ({
  from_account: transfer?.from_account ? String(transfer.from_account) : '',
  to_account: transfer?.to_account ? String(transfer.to_account) : '',
  amount: transfer?.amount ?? '',
  date: transfer?.date || new Date().toISOString().split('T')[0],
  description: transfer?.description || '',
})

export default function TransferModal({ isOpen, onClose, onSuccess, initialData = null }) {
  const queryClient = useQueryClient()
  const { isPrincipal } = useAuth()
  const isEditing = Boolean(initialData?.id)
  const [form, setForm] = useState(buildInitialForm(initialData))

  useEffect(() => {
    if (!isOpen) {
      return
    }
    setForm(buildInitialForm(initialData))
  }, [initialData, isOpen])

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
    enabled: isOpen,
  })

  const accountListAll = accountsData?.data?.results || accountsData?.data || []
  const fromAccountList = isPrincipal
    ? accountListAll.filter(a => a.school !== null)
    : accountListAll

  const transferMutation = useMutation({
    mutationFn: (data) => (
      isEditing
        ? financeApi.updateTransfer(initialData.id, data)
        : financeApi.createTransfer(data)
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalances'] })
      queryClient.invalidateQueries({ queryKey: ['accountBalancesAll'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setForm(buildInitialForm())
      onSuccess?.()
      onClose()
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    transferMutation.mutate({
      ...form,
      from_account: parseInt(form.from_account),
      to_account: parseInt(form.to_account),
      amount: parseFloat(form.amount),
    })
  }

  useEscapeKey(onClose, isOpen)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">{isEditing ? 'Edit Transfer' : 'Record Transfer'}</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="From Account">
<select
                value={form.from_account}
                onChange={(e) => setForm(f => ({ ...f, from_account: e.target.value }))}
                className="input-field"
                required
              >
                <option value="">-- Select Account --</option>
                {fromAccountList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
</Field>
            <Field label="To Account">
<select
                value={form.to_account}
                onChange={(e) => setForm(f => ({ ...f, to_account: e.target.value }))}
                className="input-field"
                required
              >
                <option value="">-- Select Account --</option>
                {accountListAll.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
</Field>
            <Field label="Amount">
<input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                className="input-field"
                required
              />
</Field>
            <Field label="Date">
<input
                type="date"
                value={form.date}
                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                className="input-field"
                required
              />
</Field>
            <div>
              <label className="label">Description (optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                className="input-field"
                rows={2}
                placeholder="Reason for transfer..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
 type="submit"
 disabled={transferMutation.isPending}
 className="flex-1"
 >
                {transferMutation.isPending ? 'Saving...' : isEditing ? 'Update Transfer' : 'Record Transfer'}
              </Button>
            </div>
            {transferMutation.isError && (
              <p className="text-sm text-red-600">
                {getErrorMessage(transferMutation.error, isEditing ? 'Failed to update transfer' : 'Failed to record transfer')}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
