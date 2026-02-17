import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { admissionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../../constants/gradePresets'
import BatchConvertModal from '../../components/BatchConvertModal'

const STATUSES = [
  { key: 'NEW', label: 'New', color: 'bg-blue-100 text-blue-800' },
  { key: 'CONFIRMED', label: 'Confirmed', color: 'bg-green-100 text-green-800' },
  { key: 'CONVERTED', label: 'Converted', color: 'bg-purple-100 text-purple-800' },
  { key: 'CANCELLED', label: 'Cancelled', color: 'bg-red-100 text-red-700' },
]

const STATUS_COLORS = Object.fromEntries(STATUSES.map((s) => [s.key, s.color]))

const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'NEWSPAPER', 'OTHER']

export default function EnquiriesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  // Selection state for batch convert
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

  // Status counts (fetch all without pagination to get real counts)
  const { data: allRes } = useQuery({
    queryKey: ['enquiries', 'counts'],
    queryFn: () => admissionsApi.getEnquiries({ page_size: 1 }),
  })
  // Per-status queries for counts
  const { data: newRes } = useQuery({
    queryKey: ['enquiries', 'count', 'NEW'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }),
  })
  const { data: confirmedRes } = useQuery({
    queryKey: ['enquiries', 'count', 'CONFIRMED'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'CONFIRMED', page_size: 1 }),
  })
  const { data: convertedRes } = useQuery({
    queryKey: ['enquiries', 'count', 'CONVERTED'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'CONVERTED', page_size: 1 }),
  })
  const { data: cancelledRes } = useQuery({
    queryKey: ['enquiries', 'count', 'CANCELLED'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'CANCELLED', page_size: 1 }),
  })

  const statusCounts = {
    NEW: newRes?.data?.count ?? 0,
    CONFIRMED: confirmedRes?.data?.count ?? 0,
    CONVERTED: convertedRes?.data?.count ?? 0,
    CANCELLED: cancelledRes?.data?.count ?? 0,
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
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Admissions</h1>
          <p className="text-sm text-gray-600 mt-1">
            {totalCount} enquir{totalCount === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedConfirmed.length > 0 && (
            <button
              onClick={() => setShowConvertModal(true)}
              className="btn-primary text-sm px-4 py-2 inline-flex items-center bg-purple-600 hover:bg-purple-700"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Convert {selectedConfirmed.length} to Students
            </button>
          )}
          <Link
            to="/admissions/new"
            className="btn-primary text-sm px-4 py-2 inline-flex items-center"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Enquiry
          </Link>
        </div>
      </div>

      {/* Flow Pipeline */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pipeline</h2>
        </div>
        <div className="flex items-center gap-0 overflow-x-auto">
          {/* NEW */}
          <button
            onClick={() => { setStatusFilter(statusFilter === 'NEW' ? '' : 'NEW'); setPage(1) }}
            className={`flex-1 min-w-[100px] px-4 py-3 rounded-l-lg border-2 transition-all text-center ${
              statusFilter === 'NEW'
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-2xl font-bold text-blue-600">{statusCounts.NEW}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">New</p>
          </button>

          {/* Arrow */}
          <div className="flex-shrink-0 text-gray-300 -mx-1 z-10">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          {/* CONFIRMED */}
          <button
            onClick={() => { setStatusFilter(statusFilter === 'CONFIRMED' ? '' : 'CONFIRMED'); setPage(1) }}
            className={`flex-1 min-w-[100px] px-4 py-3 border-2 transition-all text-center ${
              statusFilter === 'CONFIRMED'
                ? 'border-green-500 bg-green-50 ring-2 ring-green-200'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-2xl font-bold text-green-600">{statusCounts.CONFIRMED}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">Confirmed</p>
          </button>

          {/* Arrow */}
          <div className="flex-shrink-0 text-gray-300 -mx-1 z-10">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

          {/* CONVERTED */}
          <button
            onClick={() => { setStatusFilter(statusFilter === 'CONVERTED' ? '' : 'CONVERTED'); setPage(1) }}
            className={`flex-1 min-w-[100px] px-4 py-3 border-2 transition-all text-center ${
              statusFilter === 'CONVERTED'
                ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-2xl font-bold text-purple-600">{statusCounts.CONVERTED}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">Converted</p>
          </button>

          {/* Divider */}
          <div className="flex-shrink-0 mx-3 h-10 border-l-2 border-dashed border-gray-300" />

          {/* CANCELLED */}
          <button
            onClick={() => { setStatusFilter(statusFilter === 'CANCELLED' ? '' : 'CANCELLED'); setPage(1) }}
            className={`min-w-[100px] px-4 py-3 rounded-r-lg border-2 transition-all text-center ${
              statusFilter === 'CANCELLED'
                ? 'border-red-500 bg-red-50 ring-2 ring-red-200'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-2xl font-bold text-red-500">{statusCounts.CANCELLED}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">Cancelled</p>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          New → Confirm → Select confirmed → Convert to Students (batch) &nbsp;|&nbsp; Cancel anytime
        </p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="input w-full text-sm"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Grade</label>
            <select
              value={gradeFilter}
              onChange={(e) => { setGradeFilter(e.target.value); setPage(1) }}
              className="input w-full text-sm"
            >
              <option value="">All Grades</option>
              {GRADE_PRESETS.map((p) => (
                <option key={p.numeric_level} value={p.numeric_level}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
              className="input w-full text-sm"
            >
              <option value="">All Sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                className="input w-full text-sm pl-8"
                placeholder="Name or phone..."
              />
              <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="mt-3 text-xs text-primary-600 hover:text-primary-700 font-medium">
            Clear all filters
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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
          {/* Mobile card view */}
          <div className="sm:hidden space-y-2 mb-4">
            {enquiries.map((enquiry) => (
              <div
                key={enquiry.id}
                className="card !p-3 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-2">
                  {enquiry.status === 'CONFIRMED' && (
                    <input
                      type="checkbox"
                      checked={selected.has(enquiry.id)}
                      onChange={() => toggleSelect(enquiry.id)}
                      className="mt-1 rounded border-gray-300"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{enquiry.name}</p>
                        <p className="text-xs text-gray-500">{enquiry.father_name} | {enquiry.mobile}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${STATUS_COLORS[enquiry.status] || 'bg-gray-100 text-gray-700'}`}>
                        {enquiry.status_display || enquiry.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                      <span>{GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A'}</span>
                      <span className="text-gray-300">|</span>
                      <span>{enquiry.source_display || (enquiry.source || '').replace(/_/g, ' ')}</span>
                      {enquiry.next_followup_date && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className={new Date(enquiry.next_followup_date) < new Date() ? 'text-red-600 font-medium' : ''}>
                            FU: {enquiry.next_followup_date}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-2">
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
                          onClick={() => statusMut.mutate({ id: enquiry.id, status: 'CANCELLED' })}
                          className="text-xs text-red-600 hover:text-red-800 font-medium ml-2"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block card overflow-x-auto mb-4">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Father Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mobile</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grade</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Follow-up</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
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
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{enquiry.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.father_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.mobile}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[enquiry.status] || 'bg-gray-100 text-gray-700'}`}>
                        {enquiry.status_display || enquiry.status}
                      </span>
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
                            onClick={() => statusMut.mutate({ id: enquiry.id, status: 'CANCELLED' })}
                            className="text-xs text-red-600 hover:text-red-800 font-medium ml-2"
                          >
                            Cancel
                          </button>
                        )}
                        {enquiry.status !== 'CONVERTED' && enquiry.status !== 'CANCELLED' && (
                          <button
                            onClick={() => {
                              if (confirm('Delete this enquiry?')) deleteMut.mutate(enquiry.id)
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
    </div>
  )
}
