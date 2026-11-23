import { useMutation } from '@tanstack/react-query'

export const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'READY', label: 'Ready' },
  { value: 'PUBLISHED', label: 'Published' },
]

export function statusErrorMessage(error) {
  const data = error?.response?.data
  const first = (value) => (Array.isArray(value) ? value[0] : value)
  return first(data?.status) || first(data?.document) || first(data?.non_field_errors) || data?.detail || 'Could not change the status.'
}

/**
 * Draft / Ready / Published for a worksheet (the paper page has the same bar inline). A Ready or Published one is
 * locked; "Edit again" makes it a draft. The server refuses Ready while parts are still to fill, and says why.
 */
export default function StatusBar({ status, noun = 'worksheet', save, onChanged, onError }) {
  const mutation = useMutation({
    mutationFn: (next) => save(next),
    onSuccess: (_, next) => onChanged?.(next),
    onError: (error) => onError?.(statusErrorMessage(error)),
  })
  const locked = status !== 'DRAFT'
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg border text-sm ${locked ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-gray-200 text-gray-700'}`}>
      <label htmlFor={`${noun}-status`} className="font-medium">Status</label>
      <select id={`${noun}-status`} value={status} disabled={mutation.isPending} onChange={(e) => mutation.mutate(e.target.value)}
        className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white">
        {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {locked ? (
        <>
          <span>This {noun} is {status === 'PUBLISHED' ? 'published' : 'ready'}, so it is locked.</span>
          <button type="button" onClick={() => mutation.mutate('DRAFT')} disabled={mutation.isPending}
            className="ml-auto px-3 py-1.5 rounded-md bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50">
            Edit again
          </button>
        </>
      ) : (
        <span className="text-gray-500">Changes save by themselves. Set Ready when the {noun} is finished.</span>
      )}
    </div>
  )
}
