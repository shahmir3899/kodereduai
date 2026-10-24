import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useDebounce } from '../../hooks/useDebounce'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

function formatDateTime(dateStr) {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Values match hostel.models.GatePass.STATUS_CHOICES / PASS_TYPES.
const STATUSES = [
  { value: 'PENDING', label: 'Pending Approval', colors: TONE.warning },
  { value: 'APPROVED', label: 'Approved', colors: TONE.info },
  { value: 'REJECTED', label: 'Rejected', colors: TONE.danger },
  { value: 'USED', label: 'Checked Out', colors: TONE.accent },
  { value: 'RETURNED', label: 'Returned', colors: TONE.success },
  { value: 'EXPIRED', label: 'Expired', colors: TONE.neutral },
]

const PASS_TYPES = [
  { value: 'DAY', label: 'Day Pass', colors: TONE.sky },
  { value: 'OVERNIGHT', label: 'Overnight', colors: TONE.indigo },
  { value: 'WEEKEND', label: 'Weekend', colors: TONE.accent },
  { value: 'VACATION', label: 'Vacation Leave', colors: TONE.teal },
]

const statusInfo = (value) => STATUSES.find((s) => s.value === value) || { label: value, colors: TONE.neutral }
const typeInfo = (value) => PASS_TYPES.find((t) => t.value === value) || { label: value, colors: TONE.neutral }

const emptyGatePassForm = {
  allocation: '',
  pass_type: 'DAY',
  reason: '',
  going_to: '',
  contact_at_destination: '',
  departure_date: '',
  expected_return: '',
}

// datetime-local wants local time as YYYY-MM-DDTHH:mm. Most passes are same-day, so start at the
// next full hour and expect the student back eight hours later; the admin edits if that is wrong.
function defaultTimes() {
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000)
  return { departure_date: fmt(start), expected_return: fmt(end) }
}

export default function GatePassesPage() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [view, setView] = useViewPreference('hostel-gate-passes')
  const [statusFilter, setStatusFilter] = useState('')
  const [passTypeFilter, setPassTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const [showModal, setShowModal] = useState(false)
  const [gatePassForm, setGatePassForm] = useState(emptyGatePassForm)

  const [actionModal, setActionModal] = useState(null) // { type: 'approve'|'reject', pass }
  const [actionRemark, setActionRemark] = useState('')

  const { data: gatePassesData, isLoading, error } = useQuery({
    queryKey: ['hostelGatePasses', statusFilter, passTypeFilter, debouncedSearch],
    queryFn: () => hostelApi.getGatePasses({
      status: statusFilter || undefined,
      pass_type: passTypeFilter || undefined,
      search: debouncedSearch || undefined,
      page_size: 9999,
    }),
  })

  // A pass is issued to a student who currently holds a bed, so the picker lists active allocations.
  const { data: allocationsData } = useQuery({
    queryKey: ['hostelAllocations', 'for-gate-pass'],
    queryFn: () => hostelApi.getAllocations({ is_active: 'true', page_size: 9999 }),
    enabled: showModal,
  })

  const gatePasses = gatePassesData?.data?.results || gatePassesData?.data || []
  const allocations = allocationsData?.data?.results || allocationsData?.data || []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hostelGatePasses'] })
    queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
  }

  const createMutation = useMutation({
    mutationFn: (data) => hostelApi.createGatePass(data),
    onSuccess: () => {
      refresh()
      toast.showSuccess('Gate pass created')
      closeModal()
    },
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.approveGatePass(id, data),
    onSuccess: () => {
      refresh()
      toast.showSuccess('Gate pass approved')
      closeActionModal()
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.rejectGatePass(id, data),
    onSuccess: () => {
      refresh()
      toast.showSuccess('Gate pass rejected')
      closeActionModal()
    },
  })

  const checkoutMutation = useMutation({
    mutationFn: (id) => hostelApi.checkoutGatePass(id),
    onSuccess: () => {
      refresh()
      toast.showSuccess('Student checked out')
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to check out')),
  })

  const returnMutation = useMutation({
    mutationFn: (id) => hostelApi.returnGatePass(id),
    onSuccess: () => {
      refresh()
      toast.showSuccess('Student marked as returned')
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to mark as returned')),
  })

  const openModal = () => {
    setGatePassForm({ ...emptyGatePassForm, ...defaultTimes() })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setGatePassForm(emptyGatePassForm)
    createMutation.reset()
  }

  const openActionModal = (type, pass) => {
    setActionModal({ type, pass })
    setActionRemark('')
  }

  const closeActionModal = () => {
    setActionModal(null)
    setActionRemark('')
    approveMutation.reset()
    rejectMutation.reset()
  }

  useEscapeKey(closeModal, showModal)
  useEscapeKey(closeActionModal, !!actionModal)

  const handleSubmit = (e) => {
    e.preventDefault()
    const allocation = allocations.find((a) => String(a.id) === String(gatePassForm.allocation))
    if (!allocation) {
      toast.showError('Choose a student')
      return
    }
    createMutation.mutate({
      student: allocation.student,
      allocation: allocation.id,
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
    const mutation = type === 'approve' ? approveMutation : rejectMutation
    mutation.mutate({ id: pass.id, data: { remarks: actionRemark } })
  }

  const actionPending = approveMutation.isPending || rejectMutation.isPending
  const actionError = approveMutation.error || rejectMutation.error

  const getActions = (pass) => {
    const actions = []
    if (pass.status === 'PENDING') {
      actions.push({ label: 'Approve', tone: 'success', onClick: () => openActionModal('approve', pass) })
      actions.push({ label: 'Reject', tone: 'danger', onClick: () => openActionModal('reject', pass) })
    }
    if (pass.status === 'APPROVED') {
      actions.push({ label: 'Check Out', tone: 'accent', disabled: checkoutMutation.isPending, onClick: () => checkoutMutation.mutate(pass.id) })
    }
    if (pass.status === 'USED') {
      actions.push({ label: 'Mark Returned', tone: 'info', disabled: returnMutation.isPending, onClick: () => returnMutation.mutate(pass.id) })
    }
    return actions
  }

  const filtersActive = !!(statusFilter || passTypeFilter || search)

  return (
    <div>
      <PageHeader title="Gate Passes" subtitle="Manage student gate passes and leave requests" className="mb-6" actions={
        <button onClick={openModal} className="btn btn-primary">New Gate Pass</button>
      } />

      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Search">
            <input
              type="search"
              className="input"
              placeholder="Student name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Pass Type">
            <select className="input" value={passTypeFilter} onChange={(e) => setPassTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              {PASS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {error ? (
        <div className="card text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load gate passes</h3>
          <p className="text-gray-500">{getErrorMessage(error, 'Something went wrong.')}</p>
        </div>
      ) : (
        <div className="card">
          {isLoading ? (
            <div className="text-center py-8">
              <LoadingState label="Loading gate passes..." compact />
            </div>
          ) : gatePasses.length === 0 ? (
            <EmptyState
              title="No gate passes found"
              description={filtersActive ? 'Try adjusting your filters.' : 'Create a new gate pass to get started.'}
            />
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <ViewToggle view={view} onChange={setView} />
              </div>

              {view === 'cards' ? (
                <CardGrid>
                  {gatePasses.map((pass) => (
                    <RecordCard
                      key={pass.id}
                      title={pass.student_name}
                      meta={`${pass.hostel_name} · Room ${pass.room_number}`}
                      status={<Badge colors={statusInfo(pass.status).colors}>{statusInfo(pass.status).label}</Badge>}
                      fields={[
                        { label: 'Type', value: <Badge colors={typeInfo(pass.pass_type).colors}>{typeInfo(pass.pass_type).label}</Badge> },
                        { label: 'Going to', value: pass.going_to },
                        { label: 'Reason', value: pass.reason || '--' },
                        { label: 'Departure', value: formatDateTime(pass.departure_date) },
                        { label: 'Return', value: formatDateTime(pass.expected_return) },
                      ]}
                      actions={getActions(pass)}
                    />
                  ))}
                </CardGrid>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Leaves / Returns</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {gatePasses.map((pass) => (
                        <tr key={pass.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">
                            <p className="font-medium text-gray-900">{pass.student_name}</p>
                            <p className="text-xs text-gray-500">{pass.hostel_name} / {pass.room_number}</p>
                          </td>
                          <td className="px-4 py-3">
                            <Badge colors={typeInfo(pass.pass_type).colors}>{typeInfo(pass.pass_type).label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 max-w-[10rem] truncate">{pass.reason || '--'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            <p>{formatDateTime(pass.departure_date)}</p>
                            <p>{formatDateTime(pass.expected_return)}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge colors={statusInfo(pass.status).colors}>{statusInfo(pass.status).label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {getActions(pass).map((a, i) => (
                              <button
                                key={a.label}
                                onClick={a.onClick}
                                disabled={a.disabled}
                                className={`text-sm font-medium disabled:opacity-50 ${i > 0 ? 'ml-3' : ''} ${
                                  { success: 'text-green-600 hover:text-green-800', danger: 'text-red-600 hover:text-red-800', accent: 'text-purple-600 hover:text-purple-800', info: 'text-blue-600 hover:text-blue-800' }[a.tone]
                                }`}
                              >
                                {a.label}
                              </button>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============ New Gate Pass Modal ============ */}
      {showModal && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">New Gate Pass</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Student" required hint="Only students who currently hold a hostel bed are listed.">
              <select
                required
                className="input"
                value={gatePassForm.allocation}
                onChange={(e) => setGatePassForm({ ...gatePassForm, allocation: e.target.value })}
              >
                <option value="">-- Select Student --</option>
                {allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.student_name} ({a.hostel_name}, Room {a.room_number})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Pass Type" required>
              <select
                required
                className="input"
                value={gatePassForm.pass_type}
                onChange={(e) => setGatePassForm({ ...gatePassForm, pass_type: e.target.value })}
              >
                {PASS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>

            <Field label="Reason" required>
              <textarea
                rows={2}
                required
                className="input"
                placeholder="Reason for leave"
                value={gatePassForm.reason}
                onChange={(e) => setGatePassForm({ ...gatePassForm, reason: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Going To" required>
                <input
                  type="text"
                  required
                  className="input"
                  placeholder="Destination"
                  value={gatePassForm.going_to}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, going_to: e.target.value })}
                />
              </Field>
              <Field label="Contact at Destination">
                <input
                  type="text"
                  className="input"
                  placeholder="Phone number"
                  value={gatePassForm.contact_at_destination}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, contact_at_destination: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Departure Date" required>
                <input
                  type="datetime-local"
                  required
                  className="input"
                  value={gatePassForm.departure_date}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, departure_date: e.target.value })}
                />
              </Field>
              <Field label="Expected Return" required>
                <input
                  type="datetime-local"
                  required
                  className="input"
                  value={gatePassForm.expected_return}
                  onChange={(e) => setGatePassForm({ ...gatePassForm, expected_return: e.target.value })}
                />
              </Field>
            </div>

            {createMutation.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {getErrorMessage(createMutation.error, 'Failed to create gate pass. Please try again.')}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={closeModal} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={createMutation.isPending} className="btn btn-primary">
                {createMutation.isPending ? 'Creating...' : 'Create Gate Pass'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ============ Approve/Reject Modal ============ */}
      {actionModal && (
        <Modal open size="sm" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {actionModal.type === 'approve' ? 'Approve' : 'Reject'} Gate Pass
          </h2>
          <p className="text-gray-600 mb-4">
            {actionModal.type === 'approve' ? 'Approve this gate pass request?' : 'Reject this gate pass request?'}
          </p>

          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Student:</span>
              <span className="font-medium text-gray-900">{actionModal.pass.student_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Type:</span>
              <span className="font-medium text-gray-900">{typeInfo(actionModal.pass.pass_type).label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Departure:</span>
              <span className="font-medium text-gray-900">{formatDateTime(actionModal.pass.departure_date)}</span>
            </div>
          </div>

          <Field label="Remarks" className="mb-4">
            <textarea
              rows={2}
              className="input"
              placeholder="Optional remarks..."
              value={actionRemark}
              onChange={(e) => setActionRemark(e.target.value)}
            />
          </Field>

          {actionError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {getErrorMessage(actionError, 'An error occurred.')}
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button onClick={closeActionModal} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleAction}
              disabled={actionPending}
              className={`btn ${actionModal.type === 'approve' ? 'btn-primary' : 'btn-danger'}`}
            >
              {actionPending ? 'Processing...' : actionModal.type === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
