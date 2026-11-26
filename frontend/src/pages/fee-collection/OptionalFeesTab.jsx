import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { financeApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import OptionalFeeModal from './OptionalFeeModal'

const listOf = (res) => res?.data?.results ?? res?.data ?? []

/**
 * Optional fees (Robotics, Karate, Koder Kids, bus...) in one place on Fee Setup: only enrolled
 * students pay them. Lists every enrolled-only fee with its price and how many are enrolled, opens
 * its students, and creates a new one in a single form that goes straight to enrolling students.
 */
export default function OptionalFeesTab({ canEdit = true }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(null) // { category, kind }
  const [form, setForm] = useState({ name: '', kind: 'MONTHLY', price: '' })
  const [error, setError] = useState('')

  const { data: monthly = [], isLoading: mLoading } = useQuery({
    queryKey: ['optional-fees', 'monthly'],
    queryFn: () => financeApi.getMonthlyCategories().then(listOf),
  })
  const { data: annual = [], isLoading: aLoading } = useQuery({
    queryKey: ['optional-fees', 'annual'],
    queryFn: () => financeApi.getAnnualCategories().then(listOf),
  })

  const rows = [
    ...monthly.filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'MONTHLY' })),
    ...annual.filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'ANNUAL' })),
  ]

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['optional-fees'] })
    queryClient.invalidateQueries({ queryKey: ['monthly-categories'] })
    queryClient.invalidateQueries({ queryKey: ['annual-categories'] })
  }

  const create = useMutation({
    mutationFn: () => {
      const data = {
        name: form.name.trim(),
        billing_mode: 'ENROLLED',
        default_amount: form.price === '' ? null : form.price,
      }
      return form.kind === 'MONTHLY' ? financeApi.createMonthlyCategory(data) : financeApi.createAnnualCategory(data)
    },
    onSuccess: (res) => {
      refresh()
      const kind = form.kind
      setForm({ name: '', kind: 'MONTHLY', price: '' })
      // Straight on to the next thing a school does with a new optional fee: enrolling students.
      setOpen({ category: res.data, kind })
    },
    onError: (err) => setError(getErrorMessage(err, 'Could not create the fee.')),
  })

  const submit = (e) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) return setError('Enter a name.')
    if (form.price !== '' && !(Number(form.price) >= 0)) return setError('Enter a price of 0 or more.')
    create.mutate()
  }

  const loading = mLoading || aLoading
  const current = open && (open.kind === 'MONTHLY' ? monthly : annual).find((c) => c.id === open.category.id)

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900">Optional fees</h2>
        <p className="mt-1 text-sm text-gray-500">
          Courses and services only some students take, such as Robotics, Karate or the school bus.
          Only enrolled students are billed when you generate fees. Joining mid-month is a full month.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No optional fees yet. Add one below.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="p-2">Fee</th><th className="p-2">Type</th><th className="p-2">Price</th>
                  <th className="p-2">Enrolled now</th><th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={`${c.kind}-${c.id}`} className="border-t">
                    <td className="p-2 font-medium text-gray-900">{c.name}</td>
                    <td className="p-2">{c.kind === 'MONTHLY' ? 'Monthly' : 'Annual'}</td>
                    <td className="p-2">{c.default_amount != null ? `Rs ${Number(c.default_amount).toLocaleString()}` : 'Per class'}</td>
                    <td className="p-2">{c.enrolled_count ?? 0} students</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setOpen({ category: c, kind: c.kind })}>
                        Students
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && (
        <form onSubmit={submit} className="card">
          <h3 className="font-semibold text-gray-900">New optional fee</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="label">Name</span>
              <input className="input" value={form.name} placeholder="e.g. Koder Kids"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="block">
              <span className="label">Charged</span>
              <select className="input" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="MONTHLY">Every month</option>
                <option value="ANNUAL">Once a year</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Price (Rs)</span>
              <input className="input" type="number" min="0" value={form.price} placeholder="e.g. 1500"
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </label>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <Button type="submit" className="mt-3" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create and enroll students'}
          </Button>
        </form>
      )}

      {open && (
        <OptionalFeeModal
          category={current || open.category}
          kind={open.kind}
          canEdit={canEdit}
          onClose={() => { setOpen(null); refresh() }}
        />
      )}
    </div>
  )
}
