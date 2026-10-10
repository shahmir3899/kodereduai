import { useEffect, useState } from 'react'
import Button from '../../../components/ui/Button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { getErrorMessage } from '../../../utils/errorUtils'

const ORDERS = [
  ['alphabetical', 'Alphabetical (A to Z)'],
  ['roll', 'Current roll order (closes gaps)'],
  ['admission', 'Admission date (oldest first)'],
  ['manual', 'Manual: I will set the order'],
]

// Numbers a section's students 1..n in the chosen order, after a preview. Never
// automatic: roll numbers are on registers, report cards and fee slips. Students who
// have left keep their old number. In manual mode the admin moves students up and down
// and the numbers follow the list. Mount only while open.
export default function RenumberSectionModal({ section, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const [order, setOrder] = useState('alphabetical')
  const [manualIds, setManualIds] = useState(null)
  const [error, setError] = useState('')

  useEscapeKey(onClose, true)

  // Manual mode starts from the current roll order, which the server previews for us.
  const previewOrder = order === 'manual' ? 'roll' : order
  const { data, isLoading } = useQuery({
    queryKey: ['renumber-preview', section.id, previewOrder],
    queryFn: () => sessionsApi.renumberSection(section.id, { action: 'preview', order: previewOrder }),
  })
  const preview = data?.data
  const base = preview?.changes || []

  useEffect(() => {
    if (order === 'manual' && manualIds === null && base.length > 0) {
      setManualIds(base.map((row) => row.student_id))
    }
  }, [order, manualIds, base])

  const byStudent = Object.fromEntries(base.map((row) => [row.student_id, row]))
  const rows = order === 'manual' && manualIds
    ? manualIds.filter((id) => byStudent[id]).map((id, index) => ({ ...byStudent[id], new_roll: String(index + 1) }))
    : base
  const changes = rows.filter((row) => row.old_roll !== row.new_roll)

  const move = (index, delta) => {
    setManualIds((ids) => {
      const next = [...ids]
      const target = index + delta
      if (target < 0 || target >= next.length) return ids
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const mutation = useMutation({
    mutationFn: () => sessionsApi.renumberSection(section.id, {
      action: 'apply',
      order,
      ...(order === 'manual' && { student_ids: manualIds }),
    }),
    onSuccess: (res) => {
      showSuccess(`Re-numbered ${res.data.changed} student${res.data.changed === 1 ? '' : 's'}`)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['renumber-preview'] })
      onClose()
    },
    onError: (err) => setError(err?.response?.data?.detail || getErrorMessage(err, 'Failed to re-number the section')),
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Re-number section</h2>
          <p className="text-sm text-gray-500 mt-1">{section.label}: students on the roll are numbered 1, 2, 3 &hellip; in the order you choose.</p>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div>
            <label htmlFor="renumber-order" className="block text-sm font-medium text-gray-700 mb-1">Order</label>
            <select id="renumber-order" className="input" value={order} onChange={(e) => setOrder(e.target.value)}>
              {ORDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {isLoading && <p className="text-sm text-gray-500">Building the preview…</p>}

          {order !== 'manual' && preview && changes.length === 0 && (
            <p className="text-sm text-gray-600">Nothing would change: every student already has the number this order gives.</p>
          )}

          {order === 'manual' && manualIds && (
            <ol className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm" aria-label="Student order">
              {rows.map((row, index) => (
                <li key={row.student_id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-8 text-right font-medium text-primary-700">{row.new_roll}</span>
                  <span className="flex-1 text-gray-900">{row.name}</span>
                  <span className="text-xs text-gray-500">now {row.old_roll}</span>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                    aria-label={`Move ${row.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                    aria-label={`Move ${row.name} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    &darr;
                  </button>
                </li>
              ))}
            </ol>
          )}

          {order !== 'manual' && changes.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Now</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {changes.map((row) => (
                    <tr key={row.enrollment_id}>
                      <td className="px-3 py-2 text-gray-900">{row.name}</td>
                      <td className="px-3 py-2 text-gray-600">{row.old_roll}</td>
                      <td className="px-3 py-2 font-medium text-primary-700">{row.new_roll}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {order !== 'manual' && preview && changes.length > 0 && preview.unchanged > 0 && (
            <p className="text-xs text-gray-500">{preview.unchanged} student(s) keep their number.</p>
          )}

          {preview?.attendance_records > 0 && (
            <p role="note" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This year already has {preview.attendance_records} attendance record(s) for these students. They stay with
              the student; only the number printed beside the name changes.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || changes.length === 0}>
            {mutation.isPending ? 'Applying...' : 'Apply new numbers'}
          </Button>
        </div>
      </div>
    </div>
  )
}
