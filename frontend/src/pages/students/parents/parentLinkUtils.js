export const RELATIONS = [
  { value: 'FATHER', label: 'Father' },
  { value: 'MOTHER', label: 'Mother' },
  { value: 'GUARDIAN', label: 'Guardian' },
  { value: 'OTHER', label: 'Other' },
]

export const relationLabel = (value) => RELATIONS.find((r) => r.value === value)?.label || value

// Query keys touched by any link change; one list so every mutation refreshes the same views.
export const PARENT_QUERY_KEYS = [['parents-admin'], ['parent-status'], ['student-invites'], ['sibling-suggestions']]

// {linked, pending} from /admin/parent-status/ (missing key = neither) -> pill tone and text.
export function parentStatusPill(status) {
  const linked = status?.linked || 0
  const pending = status?.pending || 0
  if (linked > 0) return { key: 'linked', tone: 'success', label: linked === 1 ? '1 parent linked' : `${linked} parents linked` }
  if (pending > 0) return { key: 'pending', tone: 'warning', label: 'Invite pending' }
  return { key: 'none', tone: 'neutral', label: 'Not linked' }
}

export const PARENT_STATUS_FILTERS = [
  { value: 'all', label: 'Parent portal: all' },
  { value: 'none', label: 'Not linked' },
  { value: 'pending', label: 'Invite pending' },
  { value: 'linked', label: 'Linked' },
]

export function invalidateParentQueries(queryClient) {
  PARENT_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }))
}
