import { useQuery } from '@tanstack/react-query'
import { financeApi } from '../../services/api'

const listOf = (res) => res?.data?.results ?? res?.data ?? []

/**
 * Which fees a discount or scholarship cuts: any monthly or annual fee category, optional fees
 * included. Nothing ticked = it cuts nothing (that is how every discount made before per-fee
 * discounts behaves, since none ever reduced a bill).
 *
 * value: { monthly: number[], annual: number[] }
 */
export default function FeeTypePicker({ value, onChange }) {
  const { data: monthly = [] } = useQuery({
    queryKey: ['fee-type-picker', 'monthly'],
    queryFn: () => financeApi.getMonthlyCategories().then(listOf),
  })
  const { data: annual = [] } = useQuery({
    queryKey: ['fee-type-picker', 'annual'],
    queryFn: () => financeApi.getAnnualCategories().then(listOf),
  })

  const toggle = (kind, id) => {
    const current = value[kind] || []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    onChange({ ...value, [kind]: next })
  }

  const group = (title, kind, rows) => (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase text-gray-500">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-gray-400">None set up.</p> : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {rows.filter((c) => c.is_active !== false).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(value[kind] || []).includes(c.id)}
                onChange={() => toggle(kind, c.id)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600"
              />
              {c.name}
              {c.billing_mode === 'ENROLLED' && <span className="text-xs text-purple-600">(optional)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  )

  const none = !(value.monthly || []).length && !(value.annual || []).length
  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700">Applies to fees</legend>
      {group('Monthly', 'monthly', monthly)}
      {group('Annual', 'annual', annual)}
      {none && <p className="text-xs text-amber-700">Pick at least one fee. With none picked it reduces no bill.</p>}
    </fieldset>
  )
}

/** "Tuition, Transport" or a warning when no fee is picked. */
export function FeeTypesLabel({ feeTypes }) {
  if (!feeTypes?.length) {
    return <span className="text-[11px] text-amber-700">No fees picked: not applied</span>
  }
  return <span className="text-[11px] text-gray-500">On: {feeTypes.map((f) => f.name).join(', ')}</span>
}
