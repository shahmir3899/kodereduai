import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

const emptyAllocationForm = {
  student: '',
  room: '',
  academic_year: '',
}

export default function HostelAllocationsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Filters
  const [hostelFilter, setHostelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [allocationForm, setAllocationForm] = useState(emptyAllocationForm)

  // Vacate confirmation
  const [vacateConfirm, setVacateConfirm] = useState(null)

  // ---- Queries ----

  const { data: allocationsData, isLoading } = useQuery({
    queryKey: ['hostelAllocations', hostelFilter, statusFilter],
    queryFn: () => hostelApi.getAllocations({
      hostel_id: hostelFilter || undefined,
      status: statusFilter || undefined,
    }),
  })

  const { data: hostelsData } = useQuery({
    queryKey: ['hostels'],
    queryFn: () => hostelApi.getHostels(),
  })

  const { data: roomsData } = useQuery({
    queryKey: ['hostelRooms', allocationForm.hostel_for_room || ''],
    queryFn: () => hostelApi.getRooms({ hostel_id: allocationForm.hostel_for_room || undefined }),
    enabled: showModal,
  })

  const allocations = allocationsData?.data?.results || allocationsData?.data || []
  const hostels = hostelsData?.data?.results || hostelsData?.data || []
  const rooms = roomsData?.data?.results || roomsData?.data || []

  // ---- Mutations ----

  const createAllocationMutation = useMutation({
    mutationFn: (data) => hostelApi.createAllocation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelAllocations'] })
      queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeModal()
    },
  })

  const vacateAllocationMutation = useMutation({
    mutationFn: (id) => hostelApi.vacateAllocation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelAllocations'] })
      queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      setVacateConfirm(null)
    },
  })

  // ---- Modal Handlers ----

  const openModal = () => {
    setAllocationForm({ ...emptyAllocationForm, hostel_for_room: '' })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setAllocationForm(emptyAllocationForm)
  }

  // ---- Submit Handler ----

  const handleSubmit = (e) => {
    e.preventDefault()
    createAllocationMutation.mutate({
      student: parseInt(allocationForm.student),
      room: parseInt(allocationForm.room),
      academic_year: allocationForm.academic_year,
    })
  }

  const statusColors = {
    active: 'bg-green-100 text-green-700',
    ACTIVE: 'bg-green-100 text-green-700',
    vacated: 'bg-gray-100 text-gray-700',
    VACATED: 'bg-gray-100 text-gray-700',
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Room Allocations</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage student-to-room allocations</p>
        </div>
        <button
          onClick={openModal}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Allocate Student
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Hostel</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={hostelFilter}
              onChange={(e) => setHostelFilter(e.target.value)}
            >
              <option value="">All Hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Status</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="vacated">Vacated</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3">Loading allocations...</p>
          </div>
        ) : allocations.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 font-medium">No allocations found</p>
            <p className="text-gray-400 text-sm mt-1">
              {hostelFilter || statusFilter ? 'Try adjusting your filters.' : 'Allocate your first student to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {allocations.map((alloc) => (
                <div key={alloc.id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">
                        {alloc.student_name || alloc.student?.name || '-'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {alloc.class_name || alloc.student?.class_name || '-'}
                      </p>
                    </div>
                    <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[alloc.status] || 'bg-gray-100 text-gray-700'
                    }`}>
                      {alloc.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>Hostel: {alloc.hostel_name || alloc.room?.hostel_name || '-'}</p>
                    <p>Room: {alloc.room_number || alloc.room?.room_number || '-'}</p>
                    <p>Year: {alloc.academic_year || '-'}</p>
                    <p>Allocated: {formatDate(alloc.allocated_date || alloc.created_at)}</p>
                  </div>
                  {(alloc.status === 'active' || alloc.status === 'ACTIVE') && (
                    <div className="mt-3 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => setVacateConfirm(alloc)}
                        className="text-xs text-red-600 font-medium"
                      >
                        Vacate
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hostel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Allocated Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {allocations.map((alloc) => (
                    <tr key={alloc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {alloc.student_name || alloc.student?.name || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {alloc.class_name || alloc.student?.class_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {alloc.hostel_name || alloc.room?.hostel_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {alloc.room_number || alloc.room?.room_number || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {alloc.academic_year || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          statusColors[alloc.status] || 'bg-gray-100 text-gray-700'
                        }`}>
                          {alloc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(alloc.allocated_date || alloc.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(alloc.status === 'active' || alloc.status === 'ACTIVE') && (
                          <button
                            onClick={() => setVacateConfirm(alloc)}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                          >
                            Vacate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Allocate Student Modal ============ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Allocate Student</h2>

            {createAllocationMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createAllocationMutation.error.response?.data?.detail ||
                 createAllocationMutation.error.response?.data?.non_field_errors?.[0] ||
                 createAllocationMutation.error.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Student ID *</label>
                <input
                  type="number"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter student ID"
                  value={allocationForm.student}
                  onChange={(e) => setAllocationForm({ ...allocationForm, student: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Hostel *</label>
                <select
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={allocationForm.hostel_for_room || ''}
                  onChange={(e) => setAllocationForm({ ...allocationForm, hostel_for_room: e.target.value, room: '' })}
                >
                  <option value="">-- Select Hostel --</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Room *</label>
                <select
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={allocationForm.room}
                  onChange={(e) => setAllocationForm({ ...allocationForm, room: e.target.value })}
                  disabled={!allocationForm.hostel_for_room}
                >
                  <option value="">-- Select Room --</option>
                  {rooms
                    .filter((r) => r.is_available !== false)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        Room {r.room_number} (Floor {r.floor} | Cap: {r.capacity} | Occ: {r.current_occupancy ?? r.occupancy ?? 0})
                      </option>
                    ))}
                </select>
                {!allocationForm.hostel_for_room && (
                  <p className="text-xs text-gray-400 mt-1">Select a hostel first to see available rooms.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Academic Year *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. 2025-2026"
                  value={allocationForm.academic_year}
                  onChange={(e) => setAllocationForm({ ...allocationForm, academic_year: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createAllocationMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createAllocationMutation.isPending ? 'Allocating...' : 'Allocate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Vacate Confirmation Modal ============ */}
      {vacateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Vacate Student</h2>
            <p className="text-gray-600 mb-4">
              Are you sure you want to vacate{' '}
              <strong>{vacateConfirm.student_name || vacateConfirm.student?.name || 'this student'}</strong>{' '}
              from Room <strong>{vacateConfirm.room_number || vacateConfirm.room?.room_number || '-'}</strong>?
            </p>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Hostel:</span>
                <span className="font-medium text-gray-900">{vacateConfirm.hostel_name || vacateConfirm.room?.hostel_name || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Allocated:</span>
                <span className="font-medium text-gray-900">{formatDate(vacateConfirm.allocated_date || vacateConfirm.created_at)}</span>
              </div>
            </div>

            {vacateAllocationMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {vacateAllocationMutation.error.response?.data?.detail || vacateAllocationMutation.error.message || 'Failed to vacate.'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setVacateConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => vacateAllocationMutation.mutate(vacateConfirm.id)}
                disabled={vacateAllocationMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {vacateAllocationMutation.isPending ? 'Processing...' : 'Vacate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
