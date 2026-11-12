import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../../services/api'
import { useDebounce } from '../../../hooks/useDebounce'
import ParentChildrenDrawer from './ParentChildrenDrawer'

// All parents in the school, with their children. "2+ children" finds sibling groups.
export default function ParentsTab({ students }) {
  const [search, setSearch] = useState('')
  const [childrenFilter, setChildrenFilter] = useState('')
  const [openParentId, setOpenParentId] = useState(null)
  const debouncedSearch = useDebounce(search, 300)

  const { data: parents = [], isLoading } = useQuery({
    queryKey: ['parents-admin', debouncedSearch, childrenFilter],
    queryFn: async () => (await parentsApi.getParentsList({
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(childrenFilter && { children: childrenFilter }),
    })).data,
  })

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          className="input flex-1" placeholder="Search parent name, phone or child…" aria-label="Search parents"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input sm:w-48" aria-label="Children filter" value={childrenFilter} onChange={(e) => setChildrenFilter(e.target.value)}>
          <option value="">All parents</option>
          <option value="multi">2+ children</option>
          <option value="single">1 child</option>
        </select>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-gray-500">Loading parents…</div>
      ) : parents.length === 0 ? (
        <div className="py-8 text-center text-gray-500">
          No parents found. Link a parent from a student&apos;s <strong>Parents</strong> button on the Students tab.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {parents.map(({ parent, children, child_count: childCount }) => (
            <li key={parent.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">
                  {parent.full_name} <span className="font-normal text-gray-500">· {parent.phone}</span>
                </div>
                <div className="text-sm text-gray-500 truncate">
                  {children.map((c) => `${c.student_name} (${c.class_name})`).join(' · ')}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm text-gray-600">{childCount} {childCount === 1 ? 'child' : 'children'}</span>
                <button type="button" className="btn btn-secondary" onClick={() => setOpenParentId(parent.id)}>Manage</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openParentId && (
        <ParentChildrenDrawer parentId={openParentId} students={students} onClose={() => setOpenParentId(null)} />
      )}
    </div>
  )
}
