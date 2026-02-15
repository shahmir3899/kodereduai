import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../services/api'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const CONDITION_CHOICES = [
  { value: 'NEW', label: 'New' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
  { value: 'POOR', label: 'Poor' },
]

const emptyAssignForm = {
  item: '', assigned_to: '', quantity: 1, condition_on_assign: 'NEW', notes: '',
}

export default function ItemAssignmentsPage() {
  const queryClient = useQueryClient()

  // Filters & tab
  const [activeTab, setActiveTab] = useState('active') // 'active' | 'returned'
  const [searchUser, setSearchUser] = useState('')

  // Modals
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState(emptyAssignForm)

  const [returnConfirm, setReturnConfirm] = useState(null)
  const [returnCondition, setReturnCondition] = useState('GOOD')

  // ---- Queries ----
  const { data: assignmentsData, isLoading } = useQuery({
    queryKey: ['inventoryAssignments', activeTab, searchUser],
    queryFn: () => inventoryApi.getAssignments({
      is_active: activeTab === 'active' ? 'true' : 'false',
      search: searchUser || undefined,
    }),
  })

  const { data: itemsData } = useQuery({
    queryKey: ['inventoryItemsAll'],
    queryFn: () => inventoryApi.getItems({ page_size: 1000 }),
  })

  const { data: usersData } = useQuery({
    queryKey: ['usersAll'],
    queryFn: () => inventoryApi.searchUsers({ page_size: 1000 }),
  })

  const assignments = assignmentsData?.data?.results || assignmentsData?.data || []
  const items = itemsData?.data?.results || itemsData?.data || []
  const users = usersData?.data?.results || usersData?.data || []

  // ---- Mutations ----
  const createAssignmentMutation = useMutation({
    mutationFn: (data) => inventoryApi.createAssignment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryAssignments'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
      closeAssignModal()
    },
  })

  const returnItemMutation = useMutation({
    mutationFn: ({ id, data }) => inventoryApi.returnItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryAssignments'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
      setReturnConfirm(null)
    },
  })

  // ---- Modal Handlers ----
  const openAssignModal = () => {
    setAssignForm(emptyAssignForm)
    setShowAssignModal(true)
  }
  const closeAssignModal = () => { setShowAssignModal(false); setAssignForm(emptyAssignForm) }

  const handleAssignSubmit = (e) => {
    e.preventDefault()
    createAssignmentMutation.mutate({
      item: parseInt(assignForm.item),
      assigned_to: parseInt(assignForm.assigned_to),
      quantity: Number(assignForm.quantity),
      condition_on_assign: assignForm.condition_on_assign,
      notes: assignForm.notes || '',
    })
  }

  const handleReturn = () => {
    if (!returnConfirm) return
    returnItemMutation.mutate({
      id: returnConfirm.id,
      data: { condition_on_return: returnCondition },
    })
  }

  const conditionColors = {
    NEW: 'bg-green-100 text-green-700',
    GOOD: 'bg-blue-100 text-blue-700',
    FAIR: 'bg-amber-100 text-amber-700',
    POOR: 'bg-red-100 text-red-700',
  }

  const errorMessage = (err) => {
    const d = err?.response?.data
    if (typeof d === 'string') return d
    if (d?.detail) return d.detail
    if (d?.non_field_errors) return d.non_field_errors[0]
    if (d) return Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join(', ')
    return err?.message || 'An error occurred.'
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Item Assignments</h1>
          <p className="text-sm sm:text-base text-gray-600">Assign inventory items to staff & track returns</p>
        </div>
        <button
          onClick={openAssignModal}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Assign Item
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'active' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setActiveTab('returned')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'returned' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Returned
            </button>
          </div>
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by user or item..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={searchUser}
              onChange={(e) => setSearchUser(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Assignments Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3">Loading assignments...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 font-medium">No {activeTab} assignments found</p>
            <p className="text-gray-400 text-sm mt-1">
              {activeTab === 'active' ? 'Assign items to staff to see them here.' : 'Returned items will appear here.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {assignments.map((a) => (
                <div key={a.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">
                        {a.item_name || a.item?.name || '-'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Assigned to: {a.assigned_to_name || a.assigned_to?.username || '-'}
                      </p>
                    </div>
                    <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                      a.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {a.is_active ? 'Active' : 'Returned'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>Qty: {a.quantity} | Condition: {a.condition_on_assign}</p>
                    <p>Assigned: {formatDate(a.assigned_date)}</p>
                    {a.returned_date && <p>Returned: {formatDate(a.returned_date)} | Condition: {a.condition_on_return}</p>}
                    {a.notes && <p>Notes: {a.notes}</p>}
                  </div>
                  {a.is_active && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => { setReturnConfirm(a); setReturnCondition('GOOD') }}
                        className="text-xs text-orange-600 font-medium"
                      >
                        Mark Returned
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned To</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Condition</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned Date</th>
                    {activeTab === 'returned' && (
                      <>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Returned Date</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Return Cond.</th>
                      </>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                    {activeTab === 'active' && (
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {assignments.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.item_name || a.item?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{a.assigned_to_name || a.assigned_to?.username || '-'}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{a.quantity}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${conditionColors[a.condition_on_assign] || 'bg-gray-100 text-gray-700'}`}>
                          {a.condition_on_assign}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(a.assigned_date)}</td>
                      {activeTab === 'returned' && (
                        <>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatDate(a.returned_date)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${conditionColors[a.condition_on_return] || 'bg-gray-100 text-gray-700'}`}>
                              {a.condition_on_return || '-'}
                            </span>
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate">{a.notes || '-'}</td>
                      {activeTab === 'active' && (
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => { setReturnConfirm(a); setReturnCondition('GOOD') }}
                            className="text-sm text-orange-600 hover:text-orange-800 font-medium"
                          >
                            Return
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Assign Item Modal ============ */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Assign Item</h2>

            {createAssignmentMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(createAssignmentMutation.error)}
              </div>
            )}

            <form onSubmit={handleAssignSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Item *</label>
                <select required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={assignForm.item} onChange={(e) => setAssignForm({ ...assignForm, item: e.target.value })}>
                  <option value="">-- Select Item --</option>
                  {items.filter(i => i.current_stock > 0).map((i) => (
                    <option key={i.id} value={i.id}>{i.name} (Available: {i.current_stock} {i.unit})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Assign To *</label>
                <select required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={assignForm.assigned_to} onChange={(e) => setAssignForm({ ...assignForm, assigned_to: e.target.value })}>
                  <option value="">-- Select User --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.username} ({u.role_display || u.role || 'User'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Quantity *</label>
                  <input type="number" required min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={assignForm.quantity} onChange={(e) => setAssignForm({ ...assignForm, quantity: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Condition</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={assignForm.condition_on_assign} onChange={(e) => setAssignForm({ ...assignForm, condition_on_assign: e.target.value })}>
                    {CONDITION_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notes</label>
                <textarea rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. Laptop serial number, purpose of assignment..."
                  value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={closeAssignModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={createAssignmentMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {createAssignmentMutation.isPending ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Return Confirmation Modal ============ */}
      {returnConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Return Item</h2>
            <p className="text-gray-600 mb-4">
              Mark <strong>{returnConfirm.item_name || returnConfirm.item?.name}</strong> as returned from{' '}
              <strong>{returnConfirm.assigned_to_name || returnConfirm.assigned_to?.username}</strong>?
            </p>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Quantity:</span>
                <span className="font-medium text-gray-900">{returnConfirm.quantity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Assigned:</span>
                <span className="font-medium text-gray-900">{formatDate(returnConfirm.assigned_date)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Condition on Return *</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
                {CONDITION_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            {returnItemMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(returnItemMutation.error)}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setReturnConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleReturn} disabled={returnItemMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {returnItemMutation.isPending ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
