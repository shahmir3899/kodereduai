import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
}

const TABS = ['Apply for Leave', 'My Requests']

export default function LeaveApplication() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('Apply for Leave')

  // Form state
  const [formData, setFormData] = useState({
    student_id: '',
    start_date: '',
    end_date: '',
    reason: '',
    document_url: '',
  })
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Fetch children for the dropdown
  const { data: childrenData } = useQuery({
    queryKey: ['myChildren'],
    queryFn: () => parentsApi.getMyChildren(),
  })

  // Fetch leave requests
  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ['parentLeaveRequests'],
    queryFn: () => parentsApi.getLeaveRequests(),
  })

  const children = childrenData?.data?.results || childrenData?.data || []
  const requests = requestsData?.data?.results || requestsData?.data || []

  // Create leave request mutation
  const createMutation = useMutation({
    mutationFn: (data) => parentsApi.createLeaveRequest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parentLeaveRequests'] })
      setFormData({ student_id: '', start_date: '', end_date: '', reason: '', document_url: '' })
      setFormError('')
      setFormSuccess('Leave request submitted successfully.')
      setTimeout(() => setFormSuccess(''), 4000)
    },
    onError: (error) => {
      setFormError(error.response?.data?.detail || error.response?.data?.message || 'Failed to submit leave request. Please try again.')
    },
  })

  // Cancel leave request mutation
  const cancelMutation = useMutation({
    mutationFn: (id) => parentsApi.cancelLeaveRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parentLeaveRequests'] })
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    setFormError('')
    setFormSuccess('')

    if (!formData.student_id) {
      setFormError('Please select a child.')
      return
    }
    if (!formData.start_date) {
      setFormError('Please select a start date.')
      return
    }
    if (!formData.end_date) {
      setFormError('Please select an end date.')
      return
    }
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      setFormError('End date cannot be before start date.')
      return
    }
    if (!formData.reason.trim()) {
      setFormError('Please provide a reason for the leave.')
      return
    }

    createMutation.mutate({
      student: formData.student_id,
      start_date: formData.start_date,
      end_date: formData.end_date,
      reason: formData.reason.trim(),
      document_url: formData.document_url || undefined,
    })
  }

  const getDayCount = (start, end) => {
    if (!start || !end) return 0
    const diff = new Date(end) - new Date(start)
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1)
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to="/parent/dashboard" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Leave Application</h1>
        <p className="text-sm text-gray-500 mt-1">Apply for leave and track your requests</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Apply for Leave Tab */}
      {activeTab === 'Apply for Leave' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
            {/* Success */}
            {formSuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-green-700">{formSuccess}</p>
              </div>
            )}

            {/* Error */}
            {formError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-700">{formError}</p>
              </div>
            )}

            {/* Child Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Child</label>
              <select
                value={formData.student_id}
                onChange={(e) => setFormData({ ...formData, student_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">-- Select child --</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name} ({child.class_name || 'N/A'})
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  min={formData.start_date || undefined}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {formData.start_date && formData.end_date && (
              <p className="text-xs text-gray-500">
                Duration: {getDayCount(formData.start_date, formData.end_date)} day(s)
              </p>
            )}

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={3}
                placeholder="Please provide the reason for leave..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              />
            </div>

            {/* Document URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supporting Document URL <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="url"
                value={formData.document_url}
                onChange={(e) => setFormData({ ...formData, document_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">Upload your document to a cloud service and paste the link here.</p>
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {createMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Submitting...
                  </span>
                ) : (
                  'Submit Leave Request'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* My Requests Tab */}
      {activeTab === 'My Requests' && (
        <>
          {requestsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : requests.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-base font-medium text-gray-900 mb-1">No leave requests</h3>
              <p className="text-sm text-gray-500">
                You haven't submitted any leave requests yet.{' '}
                <button
                  onClick={() => setActiveTab('Apply for Leave')}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  Apply now
                </button>
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="sm:hidden space-y-3">
                {requests.map((req) => (
                  <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">{req.student_name || 'Child'}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-800'}`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        {new Date(req.start_date).toLocaleDateString()} - {new Date(req.end_date).toLocaleDateString()}
                        <span className="text-gray-400 ml-1">
                          ({getDayCount(req.start_date, req.end_date)} days)
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 line-clamp-2">{req.reason}</p>
                    </div>
                    {req.status === 'PENDING' && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <button
                          onClick={() => cancelMutation.mutate(req.id)}
                          disabled={cancelMutation.isPending}
                          className="text-xs text-red-600 hover:text-red-700 font-medium"
                        >
                          Cancel Request
                        </button>
                      </div>
                    )}
                    {req.admin_remarks && (
                      <div className="mt-2 p-2 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">Remarks:</span> {req.admin_remarks}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Child</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Days</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {requests.map((req) => (
                        <tr key={req.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {req.student_name || 'Child'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {new Date(req.start_date).toLocaleDateString()} - {new Date(req.end_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {getDayCount(req.start_date, req.end_date)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                            {req.reason}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[req.status] || 'bg-gray-100 text-gray-800'}`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {req.status === 'PENDING' ? (
                              <button
                                onClick={() => cancelMutation.mutate(req.id)}
                                disabled={cancelMutation.isPending}
                                className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
