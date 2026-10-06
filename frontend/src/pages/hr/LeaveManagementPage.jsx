import { useState, useMemo } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import Spinner from '../../components/ui/Spinner'
import StaffFilter from '../../components/StaffFilter'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const STRIPE_TONE_BY_STATUS = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
}

const statusBadge = {
  PENDING: TONE.warning,
  APPROVED: TONE.success,
  REJECTED: TONE.danger,
  CANCELLED: TONE.neutral,
}

const leaveTypeBadge = {
  ANNUAL: TONE.info,
  SICK: TONE.danger,
  CASUAL: TONE.accent,
  MATERNITY: TONE.pink,
  UNPAID: TONE.neutral,
  OTHER: TONE.teal,
}

const EMPTY_APPLICATION = {
  staff_member: '',
  leave_policy: '',
  start_date: '',
  end_date: '',
  reason: '',
}

const EMPTY_POLICY = {
  name: '',
  leave_type: 'ANNUAL',
  days_allowed: '',
  carry_forward: false,
}

export default function LeaveManagementPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { isTeacher, isStaffMember, isManager } = useAuth()

  // Self-service (2026-09): a Teacher, Staff member, or Manager only ever
  // sees/applies for their own leave — the backend already scopes the list
  // and forces staff_member on create (hr/views.py LeaveApplicationViewSet),
  // this just matches the UI to what's actually allowed instead of showing
  // controls (Staff Member picker, Policies tab) that would 403. Manager
  // joined this tier 2026-09 after losing full HR access.
  const isSelfService = isTeacher || isStaffMember || isManager
  const [tab, setTab] = useState('applications')

  // ── Applications State ──
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useViewPreference('leave-management')
  const [applyModal, setApplyModal] = useState(false)
  const [appForm, setAppForm] = useState(EMPTY_APPLICATION)
  const [actionModal, setActionModal] = useState(null) // { type: 'approve'|'reject', leave }
  const [adminRemarks, setAdminRemarks] = useState('')

  // ── Policies State ──
  const [policyModal, setPolicyModal] = useState(false)
  const [policyEditId, setPolicyEditId] = useState(null)
  const [policyForm, setPolicyForm] = useState(EMPTY_POLICY)

  // ── Queries ──
  const { data: appData, isLoading: appsLoading } = useQuery({
    queryKey: ['hrLeaveApplications'],
    queryFn: () => hrApi.getLeaveApplications({ page_size: 9999 }),
  })

  const { data: policyData, isLoading: policiesLoading } = useQuery({
    queryKey: ['hrLeavePolicies'],
    queryFn: () => hrApi.getLeavePolicies({ page_size: 9999 }),
  })

  const allApplications = appData?.data?.results || appData?.data || []
  const allPolicies = policyData?.data?.results || policyData?.data || []

  // ── Filtered applications ──
  const filteredApps = useMemo(() => {
    let result = allApplications
    if (statusFilter) {
      result = result.filter((a) => a.status === statusFilter)
    }
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(
        (a) =>
          a.staff_member_name?.toLowerCase().includes(s) ||
          a.staff_employee_id?.toLowerCase().includes(s)
      )
    }
    return result
  }, [allApplications, statusFilter, search])

  // ── Mutations ──
  const createAppMutation = useMutation({
    mutationFn: (data) => hrApi.createLeaveApplication(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveApplications'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Leave application submitted!')
      setApplyModal(false)
      setAppForm(EMPTY_APPLICATION)
    },
    onError: (err) => {
      const d = err.response?.data
      showError(d?.end_date?.[0] || d?.detail || d?.non_field_errors?.[0] || 'Failed to submit leave application')
    },
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.approveLeave(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveApplications'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Leave approved!')
      setActionModal(null)
      setAdminRemarks('')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to approve'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.rejectLeave(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveApplications'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Leave rejected!')
      setActionModal(null)
      setAdminRemarks('')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to reject'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id) => hrApi.cancelLeave(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeaveApplications'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      showSuccess('Leave cancelled!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to cancel'),
  })

  const createPolicyMutation = useMutation({
    mutationFn: (data) => hrApi.createLeavePolicy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeavePolicies'] })
      showSuccess('Leave policy created!')
      closePolicyModal()
    },
    onError: (err) => showError(err.response?.data?.name?.[0] || err.response?.data?.detail || 'Failed to create policy'),
  })

  const updatePolicyMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateLeavePolicy(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeavePolicies'] })
      showSuccess('Leave policy updated!')
      closePolicyModal()
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to update policy'),
  })

  const deletePolicyMutation = useMutation({
    mutationFn: (id) => hrApi.deleteLeavePolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrLeavePolicies'] })
      showSuccess('Leave policy deactivated!')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete'),
  })

  // ── Handlers ──
  const handleApplySubmit = (e) => {
    e.preventDefault()
    // Teacher/Staff applies for themselves — no staff_member to pick; the
    // backend forces it to their own profile regardless of what's sent.
    if ((!isSelfService && !appForm.staff_member) || !appForm.leave_policy || !appForm.start_date || !appForm.end_date || !appForm.reason) {
      showError('All fields are required.')
      return
    }
    createAppMutation.mutate({
      staff_member: isSelfService ? undefined : parseInt(appForm.staff_member),
      leave_policy: parseInt(appForm.leave_policy),
      start_date: appForm.start_date,
      end_date: appForm.end_date,
      reason: appForm.reason,
    })
  }

  const handleActionSubmit = () => {
    if (!actionModal) return
    const payload = { admin_remarks: adminRemarks }
    if (actionModal.type === 'approve') {
      approveMutation.mutate({ id: actionModal.leave.id, data: payload })
    } else {
      rejectMutation.mutate({ id: actionModal.leave.id, data: payload })
    }
  }

  const openPolicyCreate = () => {
    setPolicyEditId(null)
    setPolicyForm(EMPTY_POLICY)
    setPolicyModal(true)
  }

  const openPolicyEdit = (policy) => {
    setPolicyEditId(policy.id)
    setPolicyForm({
      name: policy.name,
      leave_type: policy.leave_type,
      days_allowed: policy.days_allowed,
      carry_forward: policy.carry_forward,
    })
    setPolicyModal(true)
  }

  const closePolicyModal = () => {
    setPolicyModal(false)
    setPolicyEditId(null)
    setPolicyForm(EMPTY_POLICY)
  }

  useEscapeKey(() => { setApplyModal(false); setAppForm(EMPTY_APPLICATION) }, applyModal)
  useEscapeKey(() => { setActionModal(null); setAdminRemarks('') }, !!actionModal)
  useEscapeKey(closePolicyModal, policyModal)

  const handlePolicySubmit = (e) => {
    e.preventDefault()
    if (!policyForm.name || !policyForm.days_allowed) {
      showError('Name and days allowed are required.')
      return
    }
    const payload = {
      ...policyForm,
      days_allowed: parseInt(policyForm.days_allowed),
    }
    if (policyEditId) {
      updatePolicyMutation.mutate({ id: policyEditId, data: payload })
    } else {
      createPolicyMutation.mutate(payload)
    }
  }

  const calcDays = (start, end) => {
    if (!start || !end) return 0
    const d1 = new Date(start)
    const d2 = new Date(end)
    return Math.max(0, Math.round((d2 - d1) / 86400000) + 1)
  }

  return (
    <div>
      <PageHeader title={isSelfService ? 'My Leave' : 'Leave Management'} subtitle={isSelfService ? 'Apply for and track your own leave' : 'Manage leave applications and policies'} className="mb-6" />

      {/* Tabs — Policies management is admin/Manager-only */}
      {!isSelfService && (
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('applications')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'applications' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Applications
          </button>
          <button
            onClick={() => setTab('policies')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'policies' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Policies
          </button>
        </div>
      )}

      {/* ───── APPLICATIONS TAB ───── */}
      {tab === 'applications' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={() => setApplyModal(true)} className="btn btn-primary">
              Apply Leave
            </button>
          </div>

          {/* Filters */}
          <div className="card mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                className="input"
                placeholder="Search by staff name or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="input"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {appsLoading ? (
            <div className="text-center py-8">
              <Spinner size="md" className="mx-auto" />
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">
              {allApplications.length === 0
                ? 'No leave applications found.'
                : 'No applications match your filters.'}
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <ViewToggle view={view} onChange={setView} />
              </div>

              {view === 'cards' ? (
              <CardGrid>
                {filteredApps.map((a) => (
                  <RecordCard
                    key={a.id}
                    stripeTone={STRIPE_TONE_BY_STATUS[a.status] || 'neutral'}
                    title={a.staff_member_name}
                    meta={a.leave_policy_name}
                    status={
                      <Badge colors={statusBadge[a.status]}>
                        {a.status_display}
                      </Badge>
                    }
                    fields={[
                      ...(a.leave_type ? [{ label: 'Type', value: a.leave_type_display || a.leave_type }] : []),
                      { label: 'Dates', value: `${a.start_date} to ${a.end_date}` },
                      { label: 'Days', value: `${a.total_days} day${a.total_days !== 1 ? 's' : ''}` },
                    ]}
                    actions={[
                      ...(!isSelfService && a.status === 'PENDING' ? [
                        { label: 'Approve', tone: 'success', onClick: () => { setActionModal({ type: 'approve', leave: a }); setAdminRemarks('') } },
                        { label: 'Reject', tone: 'danger', onClick: () => { setActionModal({ type: 'reject', leave: a }); setAdminRemarks('') } },
                      ] : []),
                      ...((a.status === 'PENDING' || a.status === 'APPROVED') ? [{ label: 'Cancel', tone: 'muted', onClick: () => cancelMutation.mutate(a.id) }] : []),
                    ]}
                  >
                    {a.reason && <p className="text-sm text-gray-500 truncate">{a.reason}</p>}
                  </RecordCard>
                ))}
              </CardGrid>
              ) : (
              <div className="card overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="pb-3 pr-4">Staff</th>
                      <th className="pb-3 pr-4">Leave Type</th>
                      <th className="pb-3 pr-4">Dates</th>
                      <th className="pb-3 pr-4">Days</th>
                      <th className="pb-3 pr-4">Reason</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredApps.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="py-3 pr-4">
                          <p className="text-sm font-medium text-gray-900">{a.staff_member_name}</p>
                          {a.staff_employee_id && <p className="text-xs text-gray-500">{a.staff_employee_id}</p>}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge colors={leaveTypeBadge[a.leave_type] || 'bg-gray-100'}>
                            {a.leave_type_display || a.leave_policy_name || '—'}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-sm text-gray-600">
                          {a.start_date} — {a.end_date}
                        </td>
                        <td className="py-3 pr-4 text-sm text-gray-900 font-medium">{a.total_days}</td>
                        <td className="py-3 pr-4 text-sm text-gray-600 max-w-[200px] truncate">{a.reason}</td>
                        <td className="py-3 pr-4">
                          <Badge colors={statusBadge[a.status]}>
                            {a.status_display}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {!isSelfService && a.status === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => { setActionModal({ type: 'approve', leave: a }); setAdminRemarks('') }}
                                  className="text-sm text-green-600 hover:text-green-800 font-medium"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => { setActionModal({ type: 'reject', leave: a }); setAdminRemarks('') }}
                                  className="text-sm text-red-600 hover:text-red-800 font-medium"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {(a.status === 'PENDING' || a.status === 'APPROVED') && (
                              <button
                                onClick={() => cancelMutation.mutate(a.id)}
                                className="text-sm text-gray-600 hover:text-gray-800 font-medium"
                              >
                                Cancel
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
            </>
          )}

          {/* Apply Leave Modal */}
          {applyModal && (
            <Modal open  closeOnBackdrop={false}>
                <h2 className="text-xl font-bold text-gray-900 mb-4">Apply Leave</h2>
                <form onSubmit={handleApplySubmit} className="space-y-4">
                  {!isSelfService && (
                    <div>
                      <label className="label">Staff Member *</label>
                      <StaffFilter
                        status="ACTIVE"
                        value={appForm.staff_member}
                        onChange={(e) => setAppForm({ ...appForm, staff_member: e.target.value })}
                        placeholder="Select Staff"
                      />
                    </div>
                  )}
                  <Field label="Leave Policy" required>
<select
                      className="input"
                      value={appForm.leave_policy}
                      onChange={(e) => setAppForm({ ...appForm, leave_policy: e.target.value })}
                    >
                      <option value="">Select Policy</option>
                      {allPolicies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.leave_type_display} — {p.days_allowed} days)
                        </option>
                      ))}
                    </select>
</Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Start Date" required>
<input
                        type="date"
                        className="input"
                        value={appForm.start_date}
                        onChange={(e) => setAppForm({ ...appForm, start_date: e.target.value })}
                      />
</Field>
                    <Field label="End Date" required>
<input
                        type="date"
                        className="input"
                        value={appForm.end_date}
                        onChange={(e) => setAppForm({ ...appForm, end_date: e.target.value })}
                      />
</Field>
                  </div>
                  {appForm.start_date && appForm.end_date && (
                    <p className="text-sm text-gray-500">
                      Duration: {calcDays(appForm.start_date, appForm.end_date)} day(s)
                    </p>
                  )}
                  <div>
                    <label className="label">Reason *</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={appForm.reason}
                      onChange={(e) => setAppForm({ ...appForm, reason: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => { setApplyModal(false); setAppForm(EMPTY_APPLICATION) }} className="btn btn-secondary">Cancel</button>
                    <button type="submit" disabled={createAppMutation.isPending} className="btn btn-primary">
                      {createAppMutation.isPending ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
              </Modal>
          )}

          {/* Approve/Reject Modal */}
          {actionModal && (
            <Modal open  size="sm" closeOnBackdrop={false}>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {actionModal.type === 'approve' ? 'Approve Leave' : 'Reject Leave'}
                </h2>
                <p className="text-gray-600 mb-4">
                  {actionModal.type === 'approve' ? 'Approve' : 'Reject'} leave for{' '}
                  <strong>{actionModal.leave.staff_member_name}</strong>?
                  <br />
                  <span className="text-sm">{actionModal.leave.start_date} to {actionModal.leave.end_date} ({actionModal.leave.total_days} days)</span>
                </p>
                <div className="mb-4">
                  <label className="label">Remarks (optional)</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={adminRemarks}
                    onChange={(e) => setAdminRemarks(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setActionModal(null); setAdminRemarks('') }} className="btn btn-secondary">Cancel</button>
                  <button
                    onClick={handleActionSubmit}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                    className={actionModal.type === 'approve' ? 'btn btn-primary' : 'btn btn-danger'}
                  >
                    {(approveMutation.isPending || rejectMutation.isPending) ? 'Processing...' : actionModal.type === 'approve' ? 'Approve' : 'Reject'}
                  </button>
                </div>
              </Modal>
          )}
        </>
      )}

      {/* ───── POLICIES TAB ───── */}
      {tab === 'policies' && (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={openPolicyCreate} className="btn btn-primary">
              Add Leave Policy
            </button>
          </div>

          {policiesLoading ? (
            <div className="text-center py-8">
              <Spinner size="md" className="mx-auto" />
            </div>
          ) : allPolicies.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">
              No leave policies found. Add your first policy to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allPolicies.map((p) => (
                <div key={p.id} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
                    <Badge colors={leaveTypeBadge[p.leave_type] || 'bg-gray-100'}>
                      {p.leave_type_display}
                    </Badge>
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex justify-between">
                      <span>Days Allowed</span>
                      <span className="font-medium text-gray-900">{p.days_allowed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Carry Forward</span>
                      <span className={`font-medium ${p.carry_forward ? 'text-green-700' : 'text-gray-400'}`}>
                        {p.carry_forward ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Applications</span>
                      <span className="font-medium text-gray-900">{p.applications_count}</span>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-gray-100">
                    <button onClick={() => openPolicyEdit(p)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                    <button onClick={() => deletePolicyMutation.mutate(p.id)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Policy Create/Edit Modal */}
          {policyModal && (
            <Modal open  size="sm" closeOnBackdrop={false}>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  {policyEditId ? 'Edit Leave Policy' : 'Add Leave Policy'}
                </h2>
                <form onSubmit={handlePolicySubmit} className="space-y-4">
                  <Field label="Policy Name" required>
<input
                      type="text"
                      className="input"
                      value={policyForm.name}
                      onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
                    />
</Field>
                  <Field label="Leave Type" required>
<select
                      className="input"
                      value={policyForm.leave_type}
                      onChange={(e) => setPolicyForm({ ...policyForm, leave_type: e.target.value })}
                    >
                      <option value="ANNUAL">Annual Leave</option>
                      <option value="SICK">Sick Leave</option>
                      <option value="CASUAL">Casual Leave</option>
                      <option value="MATERNITY">Maternity Leave</option>
                      <option value="UNPAID">Unpaid Leave</option>
                      <option value="OTHER">Other</option>
                    </select>
</Field>
                  <Field label="Days Allowed" required>
<input
                      type="number"
                      className="input"
                      value={policyForm.days_allowed}
                      onChange={(e) => setPolicyForm({ ...policyForm, days_allowed: e.target.value })}
                    />
</Field>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="carry_forward"
                      checked={policyForm.carry_forward}
                      onChange={(e) => setPolicyForm({ ...policyForm, carry_forward: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <label htmlFor="carry_forward" className="text-sm text-gray-700">Allow carry forward</label>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={closePolicyModal} className="btn btn-secondary">Cancel</button>
                    <button
                      type="submit"
                      disabled={createPolicyMutation.isPending || updatePolicyMutation.isPending}
                      className="btn btn-primary"
                    >
                      {(createPolicyMutation.isPending || updatePolicyMutation.isPending) ? 'Saving...' : policyEditId ? 'Save Changes' : 'Create'}
                    </button>
                  </div>
                </form>
              </Modal>
          )}
        </>
      )}
    </div>
  )
}
