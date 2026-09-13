import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrApi } from '../services/api'

/**
 * Shared staff/teacher picker. Centralizes the hrApi.getStaff query so
 * role/status params can't drift between pages the way they had (one page
 * sent `status` instead of `employment_status` and silently got everyone —
 * see LessonPlansPage.jsx history). Renders name + employee ID + designation
 * + a colour-coded role badge so "which Ahmed" is answerable without opening
 * the staff directory in another tab.
 *
 * Kept as a single controlled value/onChange pair (id as string) so it drops
 * into the same spot as the inline <select> it replaces.
 */

const ROLE_BADGE_STYLES = {
  TEACHER: 'bg-blue-100 text-blue-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  PRINCIPAL: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-purple-100 text-purple-700',
  ACCOUNTANT: 'bg-green-100 text-green-700',
  STAFF: 'bg-gray-100 text-gray-700',
  DRIVER: 'bg-orange-100 text-orange-700',
}

const ROLE_AVATAR_STYLES = {
  TEACHER: 'bg-blue-100 text-blue-700',
  SCHOOL_ADMIN: 'bg-purple-100 text-purple-700',
  PRINCIPAL: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-purple-100 text-purple-700',
  ACCOUNTANT: 'bg-green-100 text-green-700',
  STAFF: 'bg-gray-100 text-gray-700',
  DRIVER: 'bg-orange-100 text-orange-700',
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function roleLabel(role) {
  if (!role) return null
  return role
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')
}

export default function StaffFilter({
  value,
  onChange,
  role,
  status,
  options,
  placeholder = 'Select staff',
  showAllOption = false,
  allOptionLabel = 'All staff',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)

  // Callers that already fetch the staff list for their own purposes (e.g. a
  // page-level stat like "reviewed X / Y staff") pass it via `options` so we
  // don't issue a second, differently-keyed request for the same rows.
  const { data, isLoading } = useQuery({
    queryKey: ['staffFilter', role, status],
    queryFn: async () => {
      const res = await hrApi.getStaff({
        ...(role && { role }),
        ...(status && { employment_status: status }),
        page_size: 9999,
      })
      // A role filter can legitimately come back empty when a school's
      // teachers were added as StaffMember rows without a linked User
      // account (role lives on User, see hr/views.py get_queryset) — fall
      // back to the unfiltered list rather than showing an empty picker.
      if (role) {
        const list = Array.isArray(res?.data) ? res.data : res?.data?.results ?? []
        if (list.length === 0) {
          return hrApi.getStaff({
            ...(status && { employment_status: status }),
            page_size: 9999,
          })
        }
      }
      return res
    },
    enabled: !options,
  })

  const staff = options ?? (data?.data?.results || data?.data || [])

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const filteredStaff = useMemo(() => {
    if (!search.trim()) return staff
    const q = search.trim().toLowerCase()
    return staff.filter((s) => {
      const name = (s.full_name || s.user_name || '').toLowerCase()
      return name.includes(q) || (s.employee_id || '').toLowerCase().includes(q)
    })
  }, [staff, search])

  const selected = staff.find((s) => String(s.id) === String(value))

  const selectStaff = (id) => {
    onChange?.({ target: { value: id === null ? '' : String(id) } })
    setOpen(false)
    setSearch('')
  }

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input w-full flex items-center justify-between gap-2 text-left disabled:opacity-50"
      >
        <span className={selected ? 'text-gray-900 truncate' : 'text-gray-400 truncate'}>
          {selected
            ? `${selected.full_name || selected.user_name || `Staff #${selected.id}`}${
                selected.employee_id ? ` (${selected.employee_id})` : ''
              }`
            : showAllOption
            ? allOptionLabel
            : placeholder}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-[70] mt-1 w-full min-w-[280px] bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              autoFocus
              className="input w-full text-sm"
              placeholder="Search by name or employee ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {(showAllOption || !role) && (
              <button
                type="button"
                onClick={() => selectStaff(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                {showAllOption ? allOptionLabel : placeholder}
              </button>
            )}
            {isLoading ? (
              <p className="px-3 py-4 text-sm text-gray-500 text-center">Loading staff...</p>
            ) : filteredStaff.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500 text-center">No staff found.</p>
            ) : (
              filteredStaff.map((s) => {
                const name = s.full_name || s.user_name || `Staff #${s.id}`
                const badgeStyle = ROLE_BADGE_STYLES[s.user_role] || 'bg-gray-100 text-gray-700'
                const avatarStyle = ROLE_AVATAR_STYLES[s.user_role] || 'bg-gray-100 text-gray-700'
                const isSelected = String(s.id) === String(value)
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => selectStaff(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 ${
                      isSelected ? 'bg-primary-50' : ''
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${avatarStyle}`}
                    >
                      {initials(name)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{name}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {[s.employee_id, s.designation_name].filter(Boolean).join(' · ') || '--'}
                      </span>
                    </span>
                    {s.user_role && (
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${badgeStyle}`}>
                        {roleLabel(s.user_role)}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
