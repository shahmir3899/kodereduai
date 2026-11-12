import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { getApiErrorMessage } from '../profile/profileUtils'
import DrawerShell, { Section } from './DrawerShell'
import { RELATIONS, invalidateParentQueries } from './parentLinkUtils'

// Parent-centred: see all of a parent's children, tick several students and link
// them in one go (siblings). `students` is the page's already-loaded list. Mount only while open.
export default function ParentChildrenDrawer({ parentId, students, onClose }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [relation, setRelation] = useState(null)
  const [isPrimary, setIsPrimary] = useState(false)

  const { data: parents = [] } = useQuery({
    queryKey: ['parents-admin', ''],
    queryFn: async () => (await parentsApi.getParentsList()).data,
  })
  const entry = parents.find((e) => e.parent.id === parentId)

  const linkedStudentIds = useMemo(() => new Set((entry?.children || []).map((c) => c.student_id)), [entry])
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students
      .filter((s) => !linkedStudentIds.has(s.id))
      .filter((s) => !q || `${s.name} ${s.class_name} ${s.roll_number}`.toLowerCase().includes(q))
      .slice(0, 50)
  }, [students, linkedStudentIds, search])

  const refresh = () => invalidateParentQueries(queryClient)
  const fail = (fallback) => (error) => showError(getApiErrorMessage(error, fallback))

  const linkMutation = useMutation({
    mutationFn: () => parentsApi.linkChildren({
      parent_profile_id: parentId, student_ids: [...picked],
      relation: relation || entry.parent.relation_to_default || 'FATHER', is_primary: isPrimary,
    }),
    onSuccess: (res) => {
      showSuccess(`Linked ${res.data.linked.length} child${res.data.linked.length === 1 ? '' : 'ren'}.`)
      setPicked(new Set()); setIsPrimary(false); refresh()
    },
    onError: fail('Failed to link children'),
  })
  const unlinkMutation = useMutation({
    mutationFn: (linkId) => parentsApi.unlinkChild(linkId),
    onSuccess: () => { showSuccess('Child unlinked.'); refresh() },
    onError: fail('Failed to unlink'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ linkId, data }) => parentsApi.updateLink(linkId, data),
    onSuccess: refresh,
    onError: fail('Failed to update link'),
  })

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  if (!entry) {
    return <DrawerShell title="Parent" onClose={onClose}><p className="text-sm text-gray-500">Loading…</p></DrawerShell>
  }
  const { parent, children } = entry
  const effectiveRelation = relation || parent.relation_to_default || 'FATHER'

  return (
    <DrawerShell title={parent.full_name} subtitle={`${parent.phone}${parent.email ? ` · ${parent.email}` : ''}`} onClose={onClose}>
      <Section title={`Children (${children.length})`}>
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {children.map((c) => (
            <li key={c.link_id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium text-gray-900 truncate">{c.student_name} <span className="font-normal text-gray-500">· {c.class_name}</span></div>
                <div className="mt-1 flex items-center gap-3">
                  <select
                    className="text-xs border border-gray-300 rounded px-1 py-0.5" aria-label={`Relation for ${c.student_name}`}
                    value={c.relation}
                    onChange={(e) => updateMutation.mutate({ linkId: c.link_id, data: { relation: e.target.value } })}
                  >
                    {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox" className="rounded" checked={c.is_primary}
                      onChange={(e) => updateMutation.mutate({ linkId: c.link_id, data: { is_primary: e.target.checked } })}
                    /> Primary
                  </label>
                </div>
              </div>
              <button
                type="button" className="text-sm text-red-600 hover:text-red-800"
                onClick={() => window.confirm(`Unlink ${c.student_name} from ${parent.full_name}?`) && unlinkMutation.mutate(c.link_id)}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Add children">
        <input className="input" placeholder="Search student by name, class or roll no…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="mt-2 max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
          {candidates.length === 0 && <li className="p-3 text-sm text-gray-500">No matching students.</li>}
          {candidates.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                <input type="checkbox" className="rounded" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="text-gray-900">{s.name}</span>
                <span className="text-gray-500">{s.class_name} · #{s.roll_number}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-3">
          <select className="input" aria-label="Relation" value={effectiveRelation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm text-gray-700 whitespace-nowrap">
            <input type="checkbox" className="rounded" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary
          </label>
        </div>
        <button
          type="button" className="btn btn-primary mt-3" disabled={picked.size === 0 || linkMutation.isPending}
          onClick={() => linkMutation.mutate()}
        >
          {linkMutation.isPending ? 'Linking…' : `Link ${picked.size} selected`}
        </button>
      </Section>
    </DrawerShell>
  )
}
