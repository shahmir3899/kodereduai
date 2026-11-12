import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { getApiErrorMessage } from '../profile/profileUtils'
import DrawerShell, { Section } from './DrawerShell'
import SiblingSuggestions from './SiblingSuggestions'
import { RELATIONS, invalidateParentQueries, relationLabel } from './parentLinkUtils'

// Student-centred: who is linked to this child, link an existing parent (the
// sibling case: one parent, several children), or invite a new one. Mount only while open.
export default function ParentLinksDrawer({ student, onClose }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [parentId, setParentId] = useState('')
  const [relation, setRelation] = useState('FATHER')
  const [isPrimary, setIsPrimary] = useState(false)
  const [invRelation, setInvRelation] = useState('FATHER')
  const [invPhone, setInvPhone] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  const { data: parents = [] } = useQuery({
    queryKey: ['parents-admin', ''],
    queryFn: async () => (await parentsApi.getParentsList()).data,
  })
  const { data: invites = [] } = useQuery({
    queryKey: ['student-invites', student.id],
    queryFn: async () => (await parentsApi.getStudentInvites(student.id)).data,
  })

  const linked = parents
    .map((entry) => ({ parent: entry.parent, link: entry.children.find((c) => c.student_id === student.id) }))
    .filter((x) => x.link)
  const linkedIds = new Set(linked.map((x) => x.parent.id))
  const available = parents.filter((e) => !linkedIds.has(e.parent.id))

  const done = (message) => { if (message) showSuccess(message); invalidateParentQueries(queryClient) }
  const fail = (fallback) => (error) => showError(getApiErrorMessage(error, fallback))

  const linkMutation = useMutation({
    mutationFn: () => parentsApi.linkChildren({
      parent_profile_id: Number(parentId), student_ids: [student.id], relation, is_primary: isPrimary,
    }),
    onSuccess: () => { setParentId(''); setIsPrimary(false); done('Parent linked.') },
    onError: fail('Failed to link parent'),
  })
  const unlinkMutation = useMutation({
    mutationFn: (linkId) => parentsApi.unlinkChild(linkId),
    onSuccess: () => done('Parent unlinked.'),
    onError: fail('Failed to unlink parent'),
  })
  const inviteMutation = useMutation({
    mutationFn: () => parentsApi.generateInvite({ student_id: student.id, relation: invRelation, parent_phone: invPhone }),
    onSuccess: () => { setInvPhone(''); done('Invite created.') },
    onError: fail('Failed to create invite'),
  })
  const revokeMutation = useMutation({
    mutationFn: (id) => parentsApi.revokeInvite(id),
    onSuccess: () => done('Invite revoked.'),
    onError: fail('Failed to revoke invite'),
  })

  const confirmUnlink = ({ parent, link }) => {
    if (window.confirm(`Unlink ${parent.full_name} from ${student.name}? ${student.name} will no longer appear in their portal.`)) {
      unlinkMutation.mutate(link.link_id)
    }
  }
  const copyInvite = (invite) => {
    navigator.clipboard.writeText(`${window.location.origin}/parent/register?code=${invite.invite_code}`)
    setCopiedId(invite.id)
  }

  return (
    <DrawerShell title={student.name} subtitle="Parent portal links" onClose={onClose}>
      <Section title="Linked parents">
        {linked.length === 0 ? (
          <p className="text-sm text-gray-500">No parent is linked to this student yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {linked.map((x) => (
              <li key={x.link.link_id} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-gray-900 truncate">
                    {x.parent.full_name} <span className="font-normal text-gray-500">· {relationLabel(x.link.relation)}</span>
                    {x.link.is_primary && <span className="ml-2 text-xs text-amber-700">★ Primary</span>}
                  </div>
                  <div className="text-gray-500">{x.parent.phone}</div>
                </div>
                <button type="button" className="text-sm text-red-600 hover:text-red-800" onClick={() => confirmUnlink(x)}>Unlink</button>
              </li>
            ))}
          </ul>
        )}
        {linked.map((x) => (
          <div key={`sib-${x.parent.id}`} className="mt-3">
            <SiblingSuggestions student={student} parent={x.parent} relation={x.link.relation} />
          </div>
        ))}
      </Section>

      <Section title="Link an existing parent">
        <div className="space-y-2">
          <select className="input" aria-label="Parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Select a parent…</option>
            {available.map((e) => (
              <option key={e.parent.id} value={e.parent.id}>
                {e.parent.full_name} · {e.parent.phone} ({e.child_count} {e.child_count === 1 ? 'child' : 'children'})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3">
            <select className="input" aria-label="Relation" value={relation} onChange={(e) => setRelation(e.target.value)}>
              {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-sm text-gray-700 whitespace-nowrap">
              <input type="checkbox" className="rounded" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={!parentId || linkMutation.isPending} onClick={() => linkMutation.mutate()}>
            {linkMutation.isPending ? 'Linking…' : 'Link parent'}
          </button>
          <p className="text-xs text-gray-400">For a parent with several children, link the same parent to each child.</p>
        </div>
      </Section>

      <Section title="Parent not registered yet?">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <select className="input" aria-label="Invite relation" value={invRelation} onChange={(e) => setInvRelation(e.target.value)}>
              {RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input className="input" aria-label="Parent phone" placeholder="Phone (optional)" value={invPhone} onChange={(e) => setInvPhone(e.target.value)} />
          </div>
          <button type="button" className="btn btn-secondary" disabled={inviteMutation.isPending} onClick={() => inviteMutation.mutate()}>
            {inviteMutation.isPending ? 'Generating…' : 'Generate invite'}
          </button>
        </div>
        {invites.length > 0 && (
          <ul className="mt-3 space-y-1">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 text-sm border border-gray-200 rounded-lg px-3 py-2">
                <span><span className="font-mono">{inv.invite_code}</span> <span className="text-gray-500">· {relationLabel(inv.relation)}</span></span>
                <span className="flex gap-3">
                  <button type="button" className="text-primary-600 hover:text-primary-800" onClick={() => copyInvite(inv)}>
                    {copiedId === inv.id ? 'Copied!' : 'Copy link'}
                  </button>
                  <button type="button" className="text-red-600 hover:text-red-800" onClick={() => revokeMutation.mutate(inv.id)}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </DrawerShell>
  )
}
