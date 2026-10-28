import { useState, useMemo } from 'react'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { admissionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../../constants/gradePresets'
import BatchConvertModal from '../../components/BatchConvertModal'
import Spinner from '../../components/ui/Spinner'
import { RecordCard, CardGrid, ViewToggle, Avatar } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const STATUSES = [
  { key: 'NEW', label: 'New', color: TONE.info },
  { key: 'CONFIRMED', label: 'Confirmed', color: TONE.success },
  { key: 'CONVERTED', label: 'Converted', color: TONE.accent },
  { key: 'CANCELLED', label: 'Cancelled', color: TONE.danger },
]

// Classes are written out in full so Tailwind's scanner sees them.
const FUNNEL_STAGES = [
  { key: 'NEW', label: 'New', hint: 'Awaiting confirmation', bar: 'bg-blue-500', ring: 'border-blue-400 bg-blue-50/60' },
  { key: 'CONFIRMED', label: 'Confirmed', hint: 'Ready to convert', bar: 'bg-green-500', ring: 'border-green-400 bg-green-50/60' },
  { key: 'CONVERTED', label: 'Converted', hint: 'Now students', bar: 'bg-purple-500', ring: 'border-purple-400 bg-purple-50/60' },
  { key: 'CANCELLED', label: 'Cancelled', hint: 'Dropped out', bar: 'bg-red-400', ring: 'border-red-300 bg-red-50/60' },
]

const STATUS_COLORS = Object.fromEntries(STATUSES.map((s) => [s.key, s.color]))

const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'REFERRAL', 'WHATSAPP', 'SOCIAL_MEDIA', 'AD_CAMPAIGN', 'OTHER']

export default function EnquiriesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()

  // Selection state for batch convert
  const [view, setView] = useViewPreference('admissions-enquiries')
  const [selected, setSelected] = useState(new Set())
  const [showConvertModal, setShowConvertModal] = useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Build query params
  const queryParams = useMemo(() => {
    const params = { page, page_size: pageSize }
    if (statusFilter) params.status = statusFilter
    if (gradeFilter) params.grade_level = gradeFilter
    if (sourceFilter) params.source = sourceFilter
    if (search) params.search = search
    return params
  }, [statusFilter, gradeFilter, sourceFilter, search, page])

  // Enquiries query
  const { data: enquiriesRes, isLoading } = useQuery({
    queryKey: ['enquiries', queryParams],
    queryFn: () => admissionsApi.getEnquiries(queryParams),
  })

  const enquiries = enquiriesRes?.data?.results || enquiriesRes?.data || []
  const totalCount = enquiriesRes?.data?.count || enquiries.length
  const totalPages = Math.ceil(totalCount / pageSize)

  // One grouped request for all four counts (was a list request per status).
  const { data: countsRes } = useQuery({
    queryKey: ['enquiries', 'status-counts'],
    queryFn: () => admissionsApi.getEnquiryStatusCounts(),
  })

  const statusCounts = {
    NEW: countsRes?.data?.NEW ?? 0,
    CONFIRMED: countsRes?.data?.CONFIRMED ?? 0,
    CONVERTED: countsRes?.data?.CONVERTED ?? 0,
    CANCELLED: countsRes?.data?.CANCELLED ?? 0,
  }

  const funnelTotal = statusCounts.NEW + statusCounts.CONFIRMED + statusCounts.CONVERTED + statusCounts.CANCELLED
  const conversionRate = funnelTotal ? Math.round((statusCounts.CONVERTED / funnelTotal) * 100) : 0

  // Cancel has no undo in the UI (no reopen action, the edit form has no status),
  // and on a phone it sits right next to Confirm, so it asks first.
  const cancelEnquiry = async (enquiry) => {
    const ok = await confirm({
      title: 'Cancel Enquiry',
      message: `Mark the enquiry for ${enquiry.name} as cancelled? It stays in the list but cannot be reopened from this page.`,
      confirmLabel: 'Cancel enquiry',
    })
    if (ok) statusMut.mutate({ id: enquiry.id, status: 'CANCELLED' })
  }

  // Quick status update
  const statusMut = useMutation({
    mutationFn: ({ id, status, note }) => admissionsApi.updateStatus(id, { status, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess('Status updated')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to update status'),
  })

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: (id) => admissionsApi.deleteEnquiry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess('Enquiry deleted')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete'),
  })

  // Selection handlers
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const confirmable = enquiries.filter((e) => e.status === 'CONFIRMED')
    if (confirmable.every((e) => selected.has(e.id))) {
      setSelected((prev) => {
        const next = new Set(prev)
        confirmable.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        confirmable.forEach((e) => next.add(e.id))
        return next
      })
    }
  }

  const selectedConfirmed = enquiries.filter(
    (e) => selected.has(e.id) && e.status === 'CONFIRMED'
  )

  const clearFilters = () => {
    setStatusFilter('')
    setGradeFilter('')
    setSourceFilter('')
    setSearch('')
    setPage(1)
  }

  const hasFilters = statusFilter || gradeFilter || sourceFilter || search

  return (
    <div>
      {/* Header */}
      <PageHeader title="Admissions" subtitle={<>{totalCount} enquir{totalCount === 1 ? 'y' : 'ies'}</>} className="mb-6" actions={<>
          <Link
            to="/admissions/new"
            className="btn-primary text-sm px-4 py-2 inline-flex items-center"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Enquiry
          </Link>
</>} />

      {/* Funnel */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Admission funnel</h2>
            <p className="text-xs text-gray-500">Click a stage to filter the list</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{conversionRate}%</p>
            <p className="text-xs text-gray-500">of enquiries converted</p>
          </div>
        </div>

        {/* Proportional bar */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 mb-4" aria-hidden="true">
          {FUNNEL_STAGES.map((st) => (
            <div
              key={st.key}
              className={`${st.bar} transition-all`}
              style={{ width: funnelTotal ? `${(statusCounts[st.key] / funnelTotal) * 100}%` : 0 }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {FUNNEL_STAGES.map((st) => {
            const active = statusFilter === st.key
            return (
              <button
                key={st.key}
                onClick={() => { setStatusFilter(active ? '' : st.key); setPage(1) }}
                className={`rounded-xl border p-3 text-left transition ${
                  active ? `${st.ring} shadow-sm` : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${st.bar}`} />
                  <span className="text-xs font-medium text-gray-500">{st.label}</span>
                </div>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{statusCounts[st.key]}</p>
                <p className="text-xs text-gray-400">{st.hint}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative md:flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="input w-full text-sm pl-9"
              placeholder="Search by child name or phone"
              aria-label="Search enquiries"
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <select
            value={gradeFilter}
            onChange={(e) => { setGradeFilter(e.target.value); setPage(1) }}
            className="input text-sm md:w-44"
            aria-label="Filter by grade"
          >
            <option value="">All grades</option>
            {GRADE_PRESETS.map((p) => (
              <option key={p.numeric_level} value={p.numeric_level}>{p.name}</option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
            className="input text-sm md:w-44"
            aria-label="Filter by source"
          >
            <option value="">All sources</option>
            {SOURCES.map((src) => (
              <option key={src} value={src}>{src.replace(/_/g, ' ')}</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedConfirmed.length > 0 && (
        <div className="sticky top-2 z-20 mb-4 flex items-center justify-between gap-3 rounded-xl bg-gray-900 px-4 py-3 text-white shadow-lg">
          <p className="text-sm">
            <span className="font-semibold">{selectedConfirmed.length}</span> confirmed enquir{selectedConfirmed.length === 1 ? 'y' : 'ies'} selected
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10">
              Clear
            </button>
            <button
              onClick={() => setShowConvertModal(true)}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-100"
            >
              Convert to students
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && enquiries.length === 0 && (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-gray-500 text-sm mb-3">No enquiries found</p>
          {hasFilters ? (
            <button onClick={clearFilters} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Clear filters
            </button>
          ) : (
            <Link to="/admissions/new" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Add your first enquiry
            </Link>
          )}
        </div>
      )}

      {/* Enquiries list */}
      {!isLoading && enquiries.length > 0 && (
        <>
          <div className="flex justify-end mb-3">
            <ViewToggle view={view} onChange={setView} />
          </div>

          {view === 'cards' ? (
          <CardGrid className="mb-4">
            {enquiries.map((enquiry) => (
              <RecordCard
                key={enquiry.id}
                highlighted={selected.has(enquiry.id)}
                leading={
                  enquiry.status === 'CONFIRMED' ? (
                    <input
                      type="checkbox"
                      checked={selected.has(enquiry.id)}
                      onChange={() => toggleSelect(enquiry.id)}
                      className="rounded border-gray-300 mt-1"
                    />
                  ) : null
                }
                title={enquiry.name}
                meta={`${enquiry.father_name} · ${enquiry.mobile}`}
                status={
                  <Badge colors={STATUS_COLORS[enquiry.status] || TONE.neutral}>
                    {enquiry.status_display || enquiry.status}
                  </Badge>
                }
                fields={[
                  { label: 'Grade', value: GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A' },
                  { label: 'Source', value: enquiry.source_display || (enquiry.source || '').replace(/_/g, ' ') },
                  ...(enquiry.next_followup_date ? [{
                    label: 'Follow-up',
                    value: (
                      <span className={new Date(enquiry.next_followup_date) < new Date() ? 'text-red-600 font-medium' : ''}>
                        {enquiry.next_followup_date}
                      </span>
                    ),
                  }] : []),
                ]}
                actions={[
                  { label: 'Edit', tone: 'info', to: `/admissions/${enquiry.id}/edit` },
                  ...(enquiry.status === 'NEW' ? [{ label: 'Confirm', tone: 'success', onClick: () => statusMut.mutate({ id: enquiry.id, status: 'CONFIRMED' }) }] : []),
                  ...((enquiry.status === 'NEW' || enquiry.status === 'CONFIRMED') ? [{ label: 'Cancel', tone: 'danger', onClick: () => cancelEnquiry(enquiry) }] : []),
                  ...(enquiry.status !== 'CONVERTED' && enquiry.status !== 'CANCELLED' ? [{
                    label: 'Delete',
                    tone: 'muted',
                    onClick: async () => {
                      const ok = await confirm({ title: 'Delete Enquiry', message: 'Delete this enquiry?' })
                      if (ok) deleteMut.mutate(enquiry.id)
                    },
                  }] : []),
                ]}
              />
            ))}
          </CardGrid>
          ) : (
          <div className="card !p-0 overflow-x-auto mb-4">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/70">
                <tr>
                  <th className="px-3 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={
                        enquiries.filter((e) => e.status === 'CONFIRMED').length > 0 &&
                        enquiries.filter((e) => e.status === 'CONFIRMED').every((e) => selected.has(e.id))
                      }
                      className="rounded border-gray-300"
                      title="Select all confirmed enquiries"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Child</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Mobile</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Grade</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Follow-up</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-wide text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {enquiries.map((enquiry) => (
                  <tr key={enquiry.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      {enquiry.status === 'CONFIRMED' ? (
                        <input
                          type="checkbox"
                          checked={selected.has(enquiry.id)}
                          onChange={() => toggleSelect(enquiry.id)}
                          className="rounded border-gray-300"
                        />
                      ) : (
                        <span />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={enquiry.name} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{enquiry.name}</p>
                          <p className="text-xs text-gray-500 truncate">S/O {enquiry.father_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.mobile}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge colors={STATUS_COLORS[enquiry.status] || TONE.neutral}>
                        {enquiry.status_display || enquiry.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {enquiry.source_display || (enquiry.source || '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {enquiry.next_followup_date ? (
                        <span className={new Date(enquiry.next_followup_date) < new Date() ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {enquiry.next_followup_date}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/admissions/${enquiry.id}/edit`}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </Link>
                        {enquiry.status === 'NEW' && (
                          <button
                            onClick={() => statusMut.mutate({ id: enquiry.id, status: 'CONFIRMED' })}
                            className="text-xs text-green-600 hover:text-green-800 font-medium ml-2"
                          >
                            Confirm
                          </button>
                        )}
                        {(enquiry.status === 'NEW' || enquiry.status === 'CONFIRMED') && (
                          <button
                            onClick={() => cancelEnquiry(enquiry)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium ml-2"
                          >
                            Cancel
                          </button>
                        )}
                        {enquiry.status !== 'CONVERTED' && enquiry.status !== 'CANCELLED' && (
                          <button
                            onClick={async () => {
                              const ok = await confirm({ title: 'Delete Enquiry', message: 'Delete this enquiry?' })
                              if (ok) deleteMut.mutate(enquiry.id)
                            }}
                            className="text-xs text-gray-400 hover:text-red-600 font-medium ml-2"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Page {page} of {totalPages} ({totalCount} total)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Batch Convert Modal */}
      {showConvertModal && (
        <BatchConvertModal
          enquiries={enquiries}
          enquiryIds={[...selected].filter((id) =>
            enquiries.find((e) => e.id === id && e.status === 'CONFIRMED')
          )}
          onClose={() => setShowConvertModal(false)}
          onSuccess={() => {
            setShowConvertModal(false)
            setSelected(new Set())
            queryClient.invalidateQueries({ queryKey: ['enquiries'] })
          }}
        />
      )}

      <ConfirmModalRoot />
    </div>
  )
}
