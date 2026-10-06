import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import { TONE } from '../../components/ui/statusTones'
import Button from '../../components/ui/Button'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const emptyGatePassForm = {
  student: '',
  allocation: '',
  pass_type: 'DAY',
  reason: '',
  going_to: '',
  contact_at_destination: '',
  departure_date: '',
  expected_return: '',
}

export default function GatePassesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [passTypeFilter, setPassTypeFilter] = useState('')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [gatePassForm, setGatePassForm] = useState(emptyGatePassForm)

  // Action modals
  const [actionModal, setActionModal] = useState(null) // { type: 'approve'|'reject', pass: {...} }
  const [actionRemark, setActionRemark] = useState('')

  // ---- Queries ----

  const { data: gatePassesData, isLoading } = useQuery({
    queryKey: ['hostelGatePasses', statusFilter, passTypeFilter],
    queryFn: () => hostelApi.getGatePasses({
      status: statusFilter || undefined,
      pass_type: passTypeFilter || undefined,
      page_size: 9999,
    }),
  })

  const gatePasses = gatePassesData?.data?.results || gatePassesData?.data || []

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: (data) => hostelApi.createGatePass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeModal()
    },
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.approveGatePass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeActionModal()
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.rejectGatePass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeActionModal()
    },
  })

  const checkoutMutation = useMutation({
    mutationFn: (id) => hostelApi.checkoutGatePass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
    },
  })

  const returnMutation = useMutation({
    mutationFn: (id) => hostelApi.returnGatePass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
    },
  })

  // ---- Modal Handlers ----

  const openModal = () => {
    setGatePassForm(emptyGatePassForm)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setGatePassForm(emptyGatePassForm)
  }

  const openActionModal = (type, pass) => {
    setActionModal({ type, pass })
    setActionRemark('')
  }

  const closeActionModal = () => {
    setActionModal(null)
    setActionRemark('')
  }

  useEscapeKey(closeModal, showModal)
  useEscapeKey(closeActionModal, !!actionModal)

  // ---- Submit Handler ----

  const handleSubmit = (e) => {
    e.preventDefault()
    createMutation.mutate({
      student: parseInt(gatePassForm.student),
      allocation: parseInt(gatePassForm.allocation),
      pass_type: gatePassForm.pass_type,
      reason: gatePassForm.reason,
      going_to: gatePassForm.going_to,
      contact_at_destination: gatePassForm.contact_at_destination,
      departure_date: gatePassForm.departure_date,
      expected_return: gatePassForm.expected_return,
    })
  }

  const handleAction = () => {
    if (!actionModal) return
    const { type, pass } = actionModal
    if (type === 'approve') {
      approveMutation.mutate({ id: pass.id, data: { remarks: actionRemark } })
    } else if (type === 'reject') {
      rejectMutation.mutate({ id: pass.id, data: { remarks: actionRemark } })
    }
  }

  const actionPending = approveMutation.isPending || rejectMutation.isPending
  const actionError = approveMutation.error || rejectMutation.error

  // ---- Status badge colors ----

  const statusColors = {
    PENDING: TONE.warning,
    APPROVED: TONE.info,
    REJECTED: TONE.danger,
    CHECKED_OUT: TONE.accent,
    RETURNED: TONE.success,
    EXPIRED: TONE.neutral,
  }

  const passTypeColors = {
    DAY: TONE.sky,
    OVERNIGHT: TONE.indigo,
    WEEKEND: TONE.accent,
    VACATION: TONE.teal,
  }

  // ---- Determine available actions for a pass ----

  const getActions = (pass) => {
    const status = pass.status?.toUpperCase() || ''
    const actions = []
    if (status === 'PENDING') {
      actions.push({ label: 'Approve', color: 'text-green-600 hover:text-green-800', action: () => openActionModal('approve', pass) })
      actions.push({ label: 'Reject', color: 'text-red-600 hover:text-red-800', action: () => openActionModal('reject', pass) })
    }
    if (status === 'APPROVED') {
      actions.push({
        label: 'Check Out',
        color: 'text-purple-600 hover:text-purple-800',
        action: () => checkoutMutation.mutate(pass.id),
        pending: checkoutMutation.isPending,
      })
    }
    if (status === 'CHECKED_OUT') {
      actions.push({
        label: 'Mark Returned',
        color: 'text-blue-600 hover:text-blue-800',
        action: () => returnMutation.mutate(pass.id),
        pending: returnMutation.isPending,
      })
    }
    return actions
  }

  return (
    <div>
      {/* Header */}
      <PageHeader title="Gate Passes" subtitle="Manage student gate passes and leave requests" className="mb-6" actions={<>
<button
          onClick={openModal}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
        >
          New Gate Pass
        </button>
</>} />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Status</label>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CHECKED_OUT">Checked Out</option>
              <option value="RETURNED">Returned</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Pass Type</label>
            <select
              className="input"
              value={passTypeFilter}
              onChange={(e) => setPassTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              <option value="DAY">Day</option>
              <option value="OVERNIGHT">Overnight</option>
              <option value="WEEKEND">Weekend</option>
              <option value="VACATION">Vacation</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <LoadingState label="Loading gate passes..." compact />
          </div>
        ) : gatePasses.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <p className="text-gray-500 font-medium">No gate passes found</p>
            <p className="text-gray-400 text-sm mt-1">
              {statusFilter || passTypeFilter ? 'Try adjusting your filters.' : 'Create a new gate pass to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {gatePasses.map((pass) => {
                const actions = getActions(pass)
                return (
                  <div key={pass.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">
                          {pass.student_name || pass.student?.name || '-'}
                        </p>
                        <p className="text-xs text-gray-500">
                          Room: {pass.room_number || pass.allocation?.room_number || '-'}
                        </p>
                      </div>
                      <div className="flex-shrink-0 ml-2 flex flex-col items-end gap-1">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          statusColors[pass.status?.toUpperCase()] || TONE.neutral
                        }`}>
                          {pass.status}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          passTypeColors[pass.pass_type?.toUpperCase()] || TONE.neutral
                        }`}>
                          {pass.pass_type}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>Reason: {pass.reason || '-'}</p>
                      <p>Departure: {formatDateTime(pass.departure_date)}</p>
                      <p>Return: {formatDateTime(pass.expected_return)}</p>
                    </div>
                    {actions.length > 0 && (
                      <div className="flex gap-3 mt-3 pt-2 border-t border-gray-100">
                        {actions.map((a) => (
                          <button
                            key={a.label}
                            onClick={a.action}
                            disabled={a.pending}
                            className={`text-xs font-medium ${a.color} disabled:opacity-50`}
                          >
                            {a.pending ? 'Processing...' : a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Departure</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Return</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gatePasses.map((pass) => {
                    const actions = getActions(pass)
                    return (
                      <tr key={pass.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {pass.student_name || pass.student?.name || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {pass.room_number || pass.allocation?.room_number || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            passTypeColors[pass.pass_type?.toUpperCase()] || TONE.neutral
                          }`}>
                            {pass.pass_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                          {pass.reason || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {formatDateTime(pass.departure_date)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {formatDateTime(pass.expected_return)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[pass.status?.toUpperCase()] || TONE.neutral
                          }`}>
                            {pass.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {actions.map((a, i) => (
                            <button
                              key={a.label}
                              onClick={a.action}
                              disabled={a.pending}
                              className={`text-sm font-medium ${a.color} disabled:opacity-50 ${i > 0 ? 'ml-3' : ''}`}
                            >
                              {a.pending ? '...' : a.label}
                            </button>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ New Gate Pass Modal ============ */}
      {showModal && (
        <Modal open  size="lg" closeOnBackdrop={false}>
            <h2 className="text-xl font-bold text-gray-900 mb-4">New Gate Pass</h2>

            {createMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createMutation.error.response?.data?.detail ||
                 createMutation.error.response?.data?.non_field_errors?.[0] ||
                 createMutation.error.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Student ID *</label>
                  <input
                    type="number"
                    required
                    className="input"
                    placeholder="Enter student ID"
                    value={gatePassForm.student}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, student: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Allocation ID *</label>
                  <input
                    type="number"
                    required
                    className="input"
                    placeholder="Enter allocation ID"
                    value={gatePassForm.allocation}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, allocation: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Pass Type *</label>
                <select
                  required
                  className="input"
                  value={gatePassForm.pass_type}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, pass_type: e.target.value })}
                >
                  <option value="DAY">Day</option>
                  <option value="OVERNIGHT">Overnight</option>
                  <option value="WEEKEND">Weekend</option>
                  <option value="VACATION">Vacation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Reason *</label>
                <textarea
                  rows={2}
                  required
                  className="input"
                  placeholder="Reason for leave"
                  value={gatePassForm.reason}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, reason: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Going To *</label>
                  <input
                    type="text"
                    required
                    className="input"
                    placeholder="Destination"
                    value={gatePassForm.going_to}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, going_to: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Contact at Destination</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Phone number"
                    value={gatePassForm.contact_at_destination}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, contact_at_destination: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Departure Date *</label>
                  <input
                    type="datetime-local"
                    required
                    className="input"
                    value={gatePassForm.departure_date}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, departure_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Expected Return *</label>
                  <input
                    type="datetime-local"
                    required
                    className="input"
                    value={gatePassForm.expected_return}
                    onChange={(e) => setGatePassForm({ ...gatePassForm, expected_return: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button variant="secondary"
 type="button"
 onClick={closeModal}>
                  Cancel
                </Button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Gate Pass'}
                </button>
              </div>
            </form>
          </Modal>
      )}

      {/* ============ Approve/Reject Modal ============ */}
      {actionModal && (
        <Modal open  size="sm" closeOnBackdrop={false}>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {actionModal.type === 'approve' ? 'Approve' : 'Reject'} Gate Pass
            </h2>
            <p className="text-gray-600 mb-4">
              {actionModal.type === 'approve'
                ? 'Approve this gate pass request?'
                : 'Reject this gate pass request?'}
            </p>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Student:</span>
                <span className="font-medium text-gray-900">
                  {actionModal.pass.student_name || actionModal.pass.student?.name || '-'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Type:</span>
                <span className="font-medium text-gray-900">{actionModal.pass.pass_type}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Departure:</span>
                <span className="font-medium text-gray-900">{formatDateTime(actionModal.pass.departure_date)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Remarks</label>
              <textarea
                rows={2}
                className="input"
                placeholder="Optional remarks..."
                value={actionRemark}
                onChange={(e) => setActionRemark(e.target.value)}
              />
            </div>

            {actionError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {actionError.response?.data?.detail || actionError.message || 'An error occurred.'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="secondary"
 onClick={closeActionModal}>
                Cancel
              </Button>
              <button
                onClick={handleAction}
                disabled={actionPending}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                  actionModal.type === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {actionPending
                  ? 'Processing...'
                  : actionModal.type === 'approve'
                    ? 'Approve'
                    : 'Reject'}
              </button>
            </div>
          </Modal>
      )}
    </div>
  )
}
