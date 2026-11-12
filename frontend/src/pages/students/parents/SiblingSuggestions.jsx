import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { getApiErrorMessage } from '../profile/profileUtils'
import { invalidateParentQueries } from './parentLinkUtils'

// Likely siblings of `student` (guardian name AND phone match). Ticking and
// linking attaches them to the same `parent`; nothing links on its own.
export default function SiblingSuggestions({ student, parent, relation }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [picked, setPicked] = useState(new Set())

  const { data: suggestions = [] } = useQuery({
    queryKey: ['sibling-suggestions', student.id, parent.id],
    queryFn: async () => (await parentsApi.getSiblingSuggestions({ student_id: student.id, parent_profile_id: parent.id })).data,
  })

  const link = useMutation({
    mutationFn: () => parentsApi.linkChildren({
      parent_profile_id: parent.id, student_ids: [...picked], relation,
    }),
    onSuccess: (res) => {
      showSuccess(`Linked ${res.data.linked.length} sibling${res.data.linked.length === 1 ? '' : 's'}.`)
      setPicked(new Set())
      invalidateParentQueries(queryClient)
    },
    onError: (error) => showError(getApiErrorMessage(error, 'Failed to link siblings')),
  })

  if (suggestions.length === 0) return null

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="sibling-suggestions">
      <p className="text-sm font-medium text-amber-900">
        Possible siblings of {student.name} (same guardian name and phone)
      </p>
      <ul className="mt-2 space-y-1">
        {suggestions.map((s) => (
          <li key={s.student_id}>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" className="rounded" checked={picked.has(s.student_id)} onChange={() => toggle(s.student_id)} />
              {s.student_name} <span className="text-gray-500">({s.class_name})</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button" className="btn btn-primary mt-3" disabled={picked.size === 0 || link.isPending}
        onClick={() => link.mutate()}
      >
        {link.isPending ? 'Linking…' : `Link ${picked.size || ''} to ${parent.full_name || parent.username}`.replace('  ', ' ')}
      </button>
    </div>
  )
}
