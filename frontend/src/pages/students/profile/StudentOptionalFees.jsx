import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Button from '../../../components/ui/Button'
import { financeApi } from '../../../services/api'
import { schoolToday } from '../../../utils/schoolTime'
import { getErrorMessage } from '../../../utils/errorUtils'

const listOf = (res) => res?.data?.results ?? res?.data ?? []

/**
 * A student's optional fees (Robotics, Karate, Koder Kids...) on their profile, so the front desk can
 * sign a child up while the parent is there instead of hunting for the fee in Fee Setup.
 */
export default function StudentOptionalFees({ studentId, canEdit }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ fee: '', start: schoolToday(), price: '' })
  const [message, setMessage] = useState(null)

  const { data: enrollments = [], isLoading } = useQuery({
    queryKey: ['fee-enrollments', 'student', studentId],
    queryFn: () => financeApi.getFeeEnrollments({ student: studentId, status: 'all' }).then((r) => r.data),
    enabled: !!studentId,
  })
  const { data: options = [] } = useQuery({
    queryKey: ['optional-fees', 'student-picker'],
    queryFn: async () => {
      const [m, a] = await Promise.all([financeApi.getMonthlyCategories(), financeApi.getAnnualCategories()])
      return [
        ...listOf(m).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'MONTHLY' })),
        ...listOf(a).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'ANNUAL' })),
      ]
    },
    enabled: canEdit,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fee-enrollments'] })
    queryClient.invalidateQueries({ queryKey: ['optional-fees'] })
  }

  const add = useMutation({
    mutationFn: () => {
      const fee = options.find((o) => `${o.kind}-${o.id}` === form.fee)
      return financeApi.createFeeEnrollment({
        student: studentId,
        [fee.kind === 'MONTHLY' ? 'monthly_category' : 'annual_category']: fee.id,
        start_date: form.start,
        amount: form.price === '' ? null : form.price,
      })
    },
    onSuccess: () => {
      refresh()
      setForm((f) => ({ ...f, fee: '', price: '' }))
      setMessage({ ok: true, text: 'Enrolled.' })
    },
    onError: (err) => setMessage({ ok: false, text: getErrorMessage(err, 'Could not enroll.') }),
  })

  const end = useMutation({
    mutationFn: (id) => financeApi.endFeeEnrollments({ ids: [id], end_date: schoolToday() }),
    onSuccess: () => { refresh(); setMessage({ ok: true, text: 'Ended. No more months are billed.' }) },
    onError: (err) => setMessage({ ok: false, text: getErrorMessage(err, 'Could not end.') }),
  })

  const current = enrollments.filter((e) => !e.end_date || e.is_active)
  const taken = new Set(current.map((e) => `${e.fee_type}-${e.monthly_category || e.annual_category}`))
  const offer = options.filter((o) => !taken.has(`${o.kind}-${o.id}`))

  return (
    <div className="card mb-4" aria-label="Optional fees">
      <h3 className="font-semibold text-gray-900">Optional fees</h3>
      <p className="text-xs text-gray-500">Courses and services this student takes. Only these are billed on top of the normal fees.</p>
      {isLoading ? <p className="mt-2 text-sm text-gray-500">Loading…</p> : current.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">None.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {current.map((e) => (
            <li key={e.id} className="flex items-center gap-3">
              <span className="font-medium">{e.category_name}</span>
              <span className="text-gray-500">from {e.start_date}{e.end_date ? ` to ${e.end_date}` : ''}</span>
              <span className="text-gray-500">{e.amount != null ? `Rs ${Number(e.amount).toLocaleString()}` : 'Default price'}</span>
              {canEdit && !e.end_date && (
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => end.mutate(e.id)}>End</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && offer.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Add optional fee</span>
            <select className="input" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}>
              <option value="">Choose…</option>
              {offer.map((o) => <option key={`${o.kind}-${o.id}`} value={`${o.kind}-${o.id}`}>{o.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Starts on</span>
            <input type="date" className="input" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
          </label>
          <label className="block">
            <span className="label">Own price (optional)</span>
            <input type="number" min="0" className="input w-32" value={form.price} placeholder="Default"
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          </label>
          <Button size="sm" disabled={!form.fee || !form.start || add.isPending} onClick={() => { setMessage(null); add.mutate() }}>
            {add.isPending ? 'Enrolling…' : 'Enroll'}
          </Button>
        </div>
      )}
      {message && <p className={`mt-2 text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
    </div>
  )
}
