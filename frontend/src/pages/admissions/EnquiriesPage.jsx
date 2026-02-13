import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { admissionsApi, gradesApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const ALL_STAGES = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'VISIT_SCHEDULED', label: 'Visit Scheduled' },
  { key: 'VISIT_DONE', label: 'Visit Done' },
  { key: 'FORM_SUBMITTED', label: 'Form Submitted' },
  { key: 'TEST_SCHEDULED', label: 'Test Scheduled' },
  { key: 'TEST_DONE', label: 'Test Done' },
  { key: 'OFFERED', label: 'Offered' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'ENROLLED', label: 'Enrolled' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'WITHDRAWN', label: 'Withdrawn' },
  { key: 'LOST', label: 'Lost' },
]

const KANBAN_STAGES = ['NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'VISIT_DONE', 'OFFERED', 'ACCEPTED']

const STAGE_BADGE_COLORS = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-indigo-100 text-indigo-800',
  VISIT_SCHEDULED: 'bg-purple-100 text-purple-800',
  VISIT_DONE: 'bg-purple-100 text-purple-800',
  FORM_SUBMITTED: 'bg-orange-100 text-orange-800',
  TEST_SCHEDULED: 'bg-amber-100 text-amber-800',
  TEST_DONE: 'bg-amber-100 text-amber-800',
  OFFERED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  ENROLLED: 'bg-teal-100 text-teal-800',
  REJECTED: 'bg-red-100 text-red-800',
  WITHDRAWN: 'bg-gray-100 text-gray-800',
  LOST: 'bg-gray-100 text-gray-600',
}

const KANBAN_HEADER_COLORS = {
  NEW: 'bg-blue-500',
  CONTACTED: 'bg-indigo-500',
  VISIT_SCHEDULED: 'bg-purple-500',
  VISIT_DONE: 'bg-purple-600',
  OFFERED: 'bg-emerald-500',
  ACCEPTED: 'bg-green-500',
}

const PRIORITY_COLORS = {
  HIGH: 'text-red-600',
  MEDIUM: 'text-amber-600',
  LOW: 'text-green-600',
}

const SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'NEWSPAPER', 'OTHER']
const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW']

export default function EnquiriesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [searchParams] = useSearchParams()

  // View toggle
  const [viewMode, setViewMode] = useState('list')

  // Filters
  const [stageFilter, setStageFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Grades for filter dropdown
  const { data: gradesRes } = useQuery({
    queryKey: ['grades'],
    queryFn: () => gradesApi.getGrades(),
    staleTime: 5 * 60 * 1000,
  })
  const grades = gradesRes?.data?.results || gradesRes?.data || []

  // Build query params
  const queryParams = useMemo(() => {
    const params = { page, page_size: pageSize }
    if (stageFilter) params.stage = stageFilter
    if (gradeFilter) params.grade_applied = gradeFilter
    if (sourceFilter) params.source = sourceFilter
    if (priorityFilter) params.priority = priorityFilter
    if (search) params.search = search
    return params
  }, [stageFilter, gradeFilter, sourceFilter, priorityFilter, search, page])

  // Enquiries query
  const { data: enquiriesRes, isLoading } = useQuery({
    queryKey: ['enquiries', queryParams],
    queryFn: () => admissionsApi.getEnquiries(queryParams),
  })

  const enquiries = enquiriesRes?.data?.results || enquiriesRes?.data || []
  const totalCount = enquiriesRes?.data?.count || enquiries.length
  const totalPages = Math.ceil(totalCount / pageSize)

  // Stage update mutation (for kanban drag-like quick update)
  const stageUpdateMut = useMutation({
    mutationFn: ({ id, stage }) => admissionsApi.updateStage(id, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      queryClient.invalidateQueries({ queryKey: ['admissionPipeline'] })
      showSuccess('Stage updated successfully')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to update stage')
    },
  })

  // Group enquiries by stage for kanban
  const kanbanColumns = useMemo(() => {
    const columns = {}
    KANBAN_STAGES.forEach((stage) => {
      columns[stage] = enquiries.filter((e) => e.stage === stage)
    })
    return columns
  }, [enquiries])

  // For kanban view, fetch all enquiries without pagination
  const { data: allEnquiriesRes } = useQuery({
    queryKey: ['enquiries', 'kanban', stageFilter, gradeFilter, sourceFilter, priorityFilter, search],
    queryFn: () => admissionsApi.getEnquiries({
      page_size: 200,
      ...(gradeFilter && { grade_applied: gradeFilter }),
      ...(sourceFilter && { source: sourceFilter }),
      ...(priorityFilter && { priority: priorityFilter }),
      ...(search && { search }),
    }),
    enabled: viewMode === 'kanban',
  })

  const kanbanEnquiries = allEnquiriesRes?.data?.results || allEnquiriesRes?.data || []
  const kanbanData = useMemo(() => {
    const columns = {}
    KANBAN_STAGES.forEach((stage) => {
      columns[stage] = kanbanEnquiries.filter((e) => e.stage === stage)
    })
    return columns
  }, [kanbanEnquiries])

  const daysSince = (dateStr) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    const now = new Date()
    return Math.floor((now - d) / (1000 * 60 * 60 * 24))
  }

  const clearFilters = () => {
    setStageFilter('')
    setGradeFilter('')
    setSourceFilter('')
    setPriorityFilter('')
    setSearch('')
    setPage(1)
  }

  const hasFilters = stageFilter || gradeFilter || sourceFilter || priorityFilter || search

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/admissions" className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Enquiries</h1>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            {totalCount} total enquir{totalCount === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              List
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-800'}`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              Kanban
            </button>
          </div>
          <Link
            to="/admissions/enquiries/new"
            className="btn-primary text-sm px-4 py-2 inline-flex items-center"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Enquiry
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Stage</label>
            <select
              value={stageFilter}
              onChange={(e) => { setStageFilter(e.target.value); setPage(1) }}
              className="input w-full text-sm"
            >
              <option value="">All Stages</option>
              {ALL_STAGES.map((s) => (
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
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => { setPriorityFilter(e.target.value); setPage(1) }}
              className="input w-full text-sm"
            >
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
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
      {isLoading && viewMode === 'list' && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && enquiries.length === 0 && viewMode === 'list' && (
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
            <Link to="/admissions/enquiries/new" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Add your first enquiry
            </Link>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'list' && !isLoading && enquiries.length > 0 && (
        <>
          {/* Mobile card view */}
          <div className="sm:hidden space-y-2 mb-4">
            {enquiries.map((enquiry) => (
              <Link
                key={enquiry.id}
                to={`/admissions/enquiries/${enquiry.id}`}
                className="block card !p-3 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-gray-900 truncate">{enquiry.child_name}</p>
                    <p className="text-xs text-gray-500">{enquiry.parent_name} | {enquiry.parent_phone}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${STAGE_BADGE_COLORS[enquiry.stage] || 'bg-gray-100 text-gray-700'}`}>
                    {(enquiry.stage || '').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <span>{enquiry.grade_applied_name || 'N/A'}</span>
                  <span className="text-gray-300">|</span>
                  <span className="capitalize">{(enquiry.source || '').replace(/_/g, ' ').toLowerCase()}</span>
                  {enquiry.priority && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className={PRIORITY_COLORS[enquiry.priority] || ''}>{enquiry.priority}</span>
                    </>
                  )}
                  {enquiry.next_followup_date && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className={new Date(enquiry.next_followup_date) < new Date() ? 'text-red-600 font-medium' : ''}>
                        FU: {enquiry.next_followup_date}
                      </span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block card overflow-x-auto mb-4">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Child Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Parent</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grade</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Followup</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {enquiries.map((enquiry) => (
                  <tr
                    key={enquiry.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/admissions/enquiries/${enquiry.id}`)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{enquiry.child_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.parent_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.parent_phone}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{enquiry.grade_applied_name || 'N/A'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STAGE_BADGE_COLORS[enquiry.stage] || 'bg-gray-100 text-gray-700'}`}>
                        {(enquiry.stage || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{(enquiry.source || '').replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={PRIORITY_COLORS[enquiry.priority] || 'text-gray-500'}>
                        {enquiry.priority || '-'}
                      </span>
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
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/admissions/enquiries/${enquiry.id}`}
                        className="text-xs text-primary-600 hover:text-primary-800 font-medium mr-2"
                      >
                        View
                      </Link>
                      <Link
                        to={`/admissions/enquiries/${enquiry.id}/edit`}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </Link>
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

      {/* KANBAN VIEW */}
      {viewMode === 'kanban' && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4" style={{ minWidth: `${KANBAN_STAGES.length * 280}px` }}>
            {KANBAN_STAGES.map((stage) => {
              const stageLabel = ALL_STAGES.find((s) => s.key === stage)?.label || stage
              const cards = kanbanData[stage] || []
              return (
                <div key={stage} className="flex-1 min-w-[260px]">
                  {/* Column header */}
                  <div className={`${KANBAN_HEADER_COLORS[stage] || 'bg-gray-500'} text-white rounded-t-lg px-3 py-2 flex items-center justify-between`}>
                    <span className="text-sm font-medium">{stageLabel}</span>
                    <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                      {cards.length}
                    </span>
                  </div>
                  {/* Column body */}
                  <div className="bg-gray-50 rounded-b-lg p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-350px)] overflow-y-auto">
                    {cards.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">No enquiries</p>
                    )}
                    {cards.map((enquiry) => (
                      <Link
                        key={enquiry.id}
                        to={`/admissions/enquiries/${enquiry.id}`}
                        className="block bg-white rounded-lg p-3 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <p className="text-sm font-medium text-gray-900 truncate flex-1">{enquiry.child_name}</p>
                          {enquiry.priority && (
                            <span className={`text-xs font-medium ml-1 ${PRIORITY_COLORS[enquiry.priority] || ''}`}>
                              {enquiry.priority === 'HIGH' ? '!!!' : enquiry.priority === 'MEDIUM' ? '!!' : '!'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{enquiry.parent_name}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                          <span>{enquiry.grade_applied_name || 'N/A'}</span>
                          <span className="text-gray-300">|</span>
                          <span className="capitalize">{(enquiry.source || '').replace(/_/g, ' ').toLowerCase()}</span>
                        </div>
                        {enquiry.created_at && (
                          <p className="text-xs text-gray-400 mt-1">
                            {daysSince(enquiry.created_at)}d ago
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
