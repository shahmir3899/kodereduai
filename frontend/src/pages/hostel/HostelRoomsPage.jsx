import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi, hrApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const HOSTEL_TYPES = [
  { value: 'BOYS', label: 'Boys' },
  { value: 'GIRLS', label: 'Girls' },
  { value: 'MIXED', label: 'Mixed' },
]

// Must match hostel.models.Room.ROOM_TYPES: anything else is a 400.
const ROOM_TYPES = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'DOUBLE', label: 'Double' },
  { value: 'DORMITORY', label: 'Dormitory' },
]

const hostelTypeLabel = (value) => HOSTEL_TYPES.find((t) => t.value === value)?.label || value
const roomTypeLabel = (value) => ROOM_TYPES.find((t) => t.value === value)?.label || value

const HOSTEL_TYPE_COLORS = {
  BOYS: TONE.sky,
  GIRLS: TONE.pink,
  MIXED: TONE.accent,
}

const emptyHostelForm = {
  name: '',
  hostel_type: 'BOYS',
  capacity: '',
  address: '',
  contact_number: '',
  warden: '',
  is_active: true,
}

const emptyRoomForm = {
  hostel: '',
  room_number: '',
  floor: '',
  room_type: 'DOUBLE',
  capacity: '',
  is_available: true,
}

// A full room is a normal state; "unavailable" is the admin taking the room out of use.
function roomStatus(room) {
  if (!room.is_available) return { label: 'Unavailable', colors: TONE.neutral }
  if (room.is_full) return { label: 'Full', colors: TONE.warning }
  return { label: 'Available', colors: TONE.success }
}

export default function HostelRoomsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [activeTab, setActiveTab] = useState('hostels')
  const [hostelsView, setHostelsView] = useViewPreference('hostels')
  const [roomsView, setRoomsView] = useViewPreference('hostel-rooms')
  const [selectedHostel, setSelectedHostel] = useState('')

  const [showHostelModal, setShowHostelModal] = useState(false)
  const [editingHostel, setEditingHostel] = useState(null)
  const [hostelForm, setHostelForm] = useState(emptyHostelForm)

  const [showRoomModal, setShowRoomModal] = useState(false)
  const [editingRoom, setEditingRoom] = useState(null)
  const [roomForm, setRoomForm] = useState(emptyRoomForm)

  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleteType, setDeleteType] = useState(null)

  const { data: hostelsData, isLoading: hostelsLoading, error: hostelsError } = useQuery({
    queryKey: ['hostels'],
    queryFn: () => hostelApi.getHostels({ page_size: 9999 }),
  })

  const { data: roomsData, isLoading: roomsLoading, error: roomsError } = useQuery({
    queryKey: ['hostelRooms', selectedHostel],
    queryFn: () => hostelApi.getRooms({ hostel_id: selectedHostel, page_size: 9999 }),
    enabled: !!selectedHostel,
  })

  // Wardens are picked from active staff; only needed while the hostel form is open.
  const { data: staffData } = useQuery({
    queryKey: ['hostel-wardens'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
    enabled: showHostelModal,
  })

  const hostels = hostelsData?.data?.results || hostelsData?.data || []
  const rooms = roomsData?.data?.results || roomsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['hostels'] })
    queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
    queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
  }

  const createHostelMutation = useMutation({
    mutationFn: (data) => hostelApi.createHostel(data),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Hostel added')
      closeHostelModal()
    },
  })

  const updateHostelMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.updateHostel(id, data),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Hostel updated')
      closeHostelModal()
    },
  })

  const deleteHostelMutation = useMutation({
    mutationFn: (id) => hostelApi.deleteHostel(id),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Hostel deleted')
      if (selectedHostel === String(deleteConfirm?.id)) setSelectedHostel('')
      closeDeleteConfirm()
    },
  })

  const createRoomMutation = useMutation({
    mutationFn: (data) => hostelApi.createRoom(data),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Room added')
      closeRoomModal()
    },
  })

  const updateRoomMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.updateRoom(id, data),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Room updated')
      closeRoomModal()
    },
  })

  const deleteRoomMutation = useMutation({
    mutationFn: (id) => hostelApi.deleteRoom(id),
    onSuccess: () => {
      refreshAll()
      toast.showSuccess('Room deleted')
      closeDeleteConfirm()
    },
  })

  const openAddHostel = () => {
    setEditingHostel(null)
    setHostelForm(emptyHostelForm)
    setShowHostelModal(true)
  }

  const openEditHostel = (hostel) => {
    setEditingHostel(hostel)
    setHostelForm({
      name: hostel.name || '',
      hostel_type: hostel.hostel_type || 'BOYS',
      capacity: hostel.capacity?.toString() || '',
      address: hostel.address || '',
      contact_number: hostel.contact_number || '',
      warden: hostel.warden?.toString() || '',
      is_active: hostel.is_active !== false,
    })
    setShowHostelModal(true)
  }

  const closeHostelModal = () => {
    setShowHostelModal(false)
    setEditingHostel(null)
    setHostelForm(emptyHostelForm)
    createHostelMutation.reset()
    updateHostelMutation.reset()
  }

  const openAddRoom = () => {
    setEditingRoom(null)
    setRoomForm({ ...emptyRoomForm, hostel: selectedHostel || '' })
    setShowRoomModal(true)
  }

  const openEditRoom = (room) => {
    setEditingRoom(room)
    setRoomForm({
      hostel: room.hostel?.toString() || selectedHostel || '',
      room_number: room.room_number || '',
      floor: room.floor?.toString() ?? '',
      room_type: room.room_type || 'DOUBLE',
      capacity: room.capacity?.toString() || '',
      is_available: room.is_available !== false,
    })
    setShowRoomModal(true)
  }

  const closeRoomModal = () => {
    setShowRoomModal(false)
    setEditingRoom(null)
    setRoomForm(emptyRoomForm)
    createRoomMutation.reset()
    updateRoomMutation.reset()
  }

  const openDeleteConfirm = (item, type) => {
    setDeleteConfirm(item)
    setDeleteType(type)
  }

  const closeDeleteConfirm = () => {
    setDeleteConfirm(null)
    setDeleteType(null)
    deleteHostelMutation.reset()
    deleteRoomMutation.reset()
  }

  useEscapeKey(closeHostelModal, showHostelModal)
  useEscapeKey(closeRoomModal, showRoomModal)
  useEscapeKey(closeDeleteConfirm, !!deleteConfirm)

  const handleHostelSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...hostelForm,
      capacity: parseInt(hostelForm.capacity) || 0,
      warden: hostelForm.warden ? parseInt(hostelForm.warden) : null,
    }
    if (editingHostel) {
      updateHostelMutation.mutate({ id: editingHostel.id, data: payload })
    } else {
      createHostelMutation.mutate(payload)
    }
  }

  const handleRoomSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...roomForm,
      hostel: parseInt(roomForm.hostel),
      floor: parseInt(roomForm.floor) || 0,
      capacity: parseInt(roomForm.capacity) || 1,
    }
    if (editingRoom) {
      updateRoomMutation.mutate({ id: editingRoom.id, data: payload })
    } else {
      createRoomMutation.mutate(payload)
    }
  }

  const handleDelete = () => {
    if (!deleteConfirm) return
    if (deleteType === 'hostel') {
      deleteHostelMutation.mutate(deleteConfirm.id)
    } else {
      deleteRoomMutation.mutate(deleteConfirm.id)
    }
  }

  const hostelMutationError = createHostelMutation.error || updateHostelMutation.error
  const hostelMutationPending = createHostelMutation.isPending || updateHostelMutation.isPending
  const roomMutationError = createRoomMutation.error || updateRoomMutation.error
  const roomMutationPending = createRoomMutation.isPending || updateRoomMutation.isPending
  const deletePending = deleteHostelMutation.isPending || deleteRoomMutation.isPending
  const deleteError = deleteHostelMutation.error || deleteRoomMutation.error

  const tabs = [
    { key: 'hostels', label: 'Hostels' },
    { key: 'rooms', label: 'Rooms' },
  ]

  const showRooms = (hostel) => {
    setSelectedHostel(String(hostel.id))
    setActiveTab('rooms')
  }

  const errorBlock = (err, fallback) => (
    <div className="card text-center py-12">
      <h3 className="text-lg font-medium text-gray-900 mb-2">{fallback}</h3>
      <p className="text-gray-500">{getErrorMessage(err, 'Something went wrong.')}</p>
    </div>
  )

  return (
    <div>
      <PageHeader title="Hostels & Rooms" subtitle="Manage hostels and room inventory" className="mb-6" actions={<>
        {activeTab === 'hostels' && (
          <button onClick={openAddHostel} className="btn btn-primary">Add Hostel</button>
        )}
        {activeTab === 'rooms' && selectedHostel && (
          <button onClick={openAddRoom} className="btn btn-primary">Add Room</button>
        )}
      </>} />

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ============ HOSTELS TAB ============ */}
      {activeTab === 'hostels' && (hostelsError ? errorBlock(hostelsError, 'Failed to load hostels') : (
        <div className="card">
          {hostelsLoading ? (
            <div className="text-center py-8">
              <LoadingState label="Loading hostels..." compact />
            </div>
          ) : hostels.length === 0 ? (
            <EmptyState title="No hostels found" description="Add your first hostel to get started." />
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <ViewToggle view={hostelsView} onChange={setHostelsView} />
              </div>

              {hostelsView === 'cards' ? (
                <CardGrid>
                  {hostels.map((hostel) => (
                    <RecordCard
                      key={hostel.id}
                      title={hostel.name}
                      meta={<Badge colors={HOSTEL_TYPE_COLORS[hostel.hostel_type] || TONE.neutral}>{hostelTypeLabel(hostel.hostel_type)}</Badge>}
                      status={<Badge tone={hostel.is_active ? 'success' : 'danger'}>{hostel.is_active ? 'Active' : 'Inactive'}</Badge>}
                      fields={[
                        { label: 'Capacity', value: hostel.capacity || 0 },
                        { label: 'Occupancy', value: hostel.current_occupancy ?? 0 },
                        { label: 'Rooms', value: hostel.rooms_count ?? 0 },
                        ...(hostel.warden_name ? [{ label: 'Warden', value: hostel.warden_name }] : []),
                      ]}
                      actions={[
                        { label: 'View Rooms', tone: 'success', onClick: () => showRooms(hostel) },
                        { label: 'Edit', tone: 'info', onClick: () => openEditHostel(hostel) },
                        { label: 'Delete', tone: 'danger', onClick: () => openDeleteConfirm(hostel, 'hostel') },
                      ]}
                    />
                  ))}
                </CardGrid>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Occupancy</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Rooms</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Warden</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {hostels.map((hostel) => (
                        <tr key={hostel.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{hostel.name}</td>
                          <td className="px-4 py-3">
                            <Badge colors={HOSTEL_TYPE_COLORS[hostel.hostel_type] || TONE.neutral}>{hostelTypeLabel(hostel.hostel_type)}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{hostel.current_occupancy ?? 0} / {hostel.capacity || 0}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{hostel.rooms_count ?? 0}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{hostel.warden_name || '--'}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge tone={hostel.is_active ? 'success' : 'danger'}>{hostel.is_active ? 'Active' : 'Inactive'}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button onClick={() => showRooms(hostel)} className="text-sm text-green-600 hover:text-green-800 font-medium mr-3">Rooms</button>
                            <button onClick={() => openEditHostel(hostel)} className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3">Edit</button>
                            <button onClick={() => openDeleteConfirm(hostel, 'hostel')} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
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
      ))}

      {/* ============ ROOMS TAB ============ */}
      {activeTab === 'rooms' && (
        <div className="space-y-4">
          <div className="card">
            <Field label="Select Hostel" className="sm:w-64">
              <select
                className="input"
                value={selectedHostel}
                onChange={(e) => setSelectedHostel(e.target.value)}
              >
                <option value="">-- Select Hostel --</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {!selectedHostel ? (
            <div className="card">
              <EmptyState title="Select a hostel to view rooms" description="Choose a hostel from the dropdown above." />
            </div>
          ) : roomsError ? errorBlock(roomsError, 'Failed to load rooms') : (
            <div className="card">
              {roomsLoading ? (
                <div className="text-center py-8">
                  <LoadingState label="Loading rooms..." compact />
                </div>
              ) : rooms.length === 0 ? (
                <EmptyState title="No rooms found" description="Add rooms to this hostel to get started." />
              ) : (
                <>
                  <div className="flex justify-end mb-3">
                    <ViewToggle view={roomsView} onChange={setRoomsView} />
                  </div>

                  {roomsView === 'cards' ? (
                    <CardGrid>
                      {rooms.map((room) => {
                        const state = roomStatus(room)
                        return (
                          <RecordCard
                            key={room.id}
                            title={`Room ${room.room_number}`}
                            meta={`Floor ${room.floor} · ${roomTypeLabel(room.room_type)}`}
                            status={<Badge colors={state.colors}>{state.label}</Badge>}
                            fields={[
                              { label: 'Capacity', value: room.capacity },
                              { label: 'Occupancy', value: room.current_occupancy ?? 0 },
                            ]}
                            actions={[
                              { label: 'Edit', tone: 'info', onClick: () => openEditRoom(room) },
                              { label: 'Delete', tone: 'danger', onClick: () => openDeleteConfirm(room, 'room') },
                            ]}
                          />
                        )
                      })}
                    </CardGrid>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room Number</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Floor</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Capacity</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Occupancy</th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Availability</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {rooms.map((room) => {
                            const state = roomStatus(room)
                            return (
                              <tr key={room.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">{room.room_number}</td>
                                <td className="px-4 py-3 text-sm text-center text-gray-700">{room.floor}</td>
                                <td className="px-4 py-3"><Badge tone="neutral">{roomTypeLabel(room.room_type)}</Badge></td>
                                <td className="px-4 py-3 text-sm text-center text-gray-700">{room.capacity}</td>
                                <td className="px-4 py-3 text-sm text-center text-gray-700">{room.current_occupancy ?? 0}</td>
                                <td className="px-4 py-3 text-center"><Badge colors={state.colors}>{state.label}</Badge></td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                  <button onClick={() => openEditRoom(room)} className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3">Edit</button>
                                  <button onClick={() => openDeleteConfirm(room, 'room')} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ Add/Edit Hostel Modal ============ */}
      {showHostelModal && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            {editingHostel ? 'Edit Hostel' : 'Add Hostel'}
          </h2>

          <form onSubmit={handleHostelSubmit} className="space-y-4">
            <Field label="Hostel Name" required>
              <input
                type="text"
                required
                className="input"
                placeholder="e.g. Al-Falah Boys Hostel"
                value={hostelForm.name}
                onChange={(e) => setHostelForm({ ...hostelForm, name: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Hostel Type" required>
                <select
                  required
                  className="input"
                  value={hostelForm.hostel_type}
                  onChange={(e) => setHostelForm({ ...hostelForm, hostel_type: e.target.value })}
                >
                  {HOSTEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Capacity" required>
                <input
                  type="number"
                  min="1"
                  required
                  className="input"
                  placeholder="e.g. 40"
                  value={hostelForm.capacity}
                  onChange={(e) => setHostelForm({ ...hostelForm, capacity: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Address">
              <textarea
                rows={2}
                className="input"
                value={hostelForm.address}
                onChange={(e) => setHostelForm({ ...hostelForm, address: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact Number">
                <input
                  type="text"
                  className="input"
                  placeholder="0300-1234567"
                  value={hostelForm.contact_number}
                  onChange={(e) => setHostelForm({ ...hostelForm, contact_number: e.target.value })}
                />
              </Field>
              <Field label="Warden">
                <select
                  className="input"
                  value={hostelForm.warden}
                  onChange={(e) => setHostelForm({ ...hostelForm, warden: e.target.value })}
                >
                  <option value="">-- No Warden --</option>
                  {staff.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hostel_active"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={hostelForm.is_active}
                onChange={(e) => setHostelForm({ ...hostelForm, is_active: e.target.checked })}
              />
              <label htmlFor="hostel_active" className="text-sm text-gray-700">Active</label>
            </div>

            {hostelMutationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {getErrorMessage(hostelMutationError, 'Failed to save hostel. Please try again.')}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={closeHostelModal} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={hostelMutationPending} className="btn btn-primary">
                {hostelMutationPending ? 'Saving...' : (editingHostel ? 'Save Changes' : 'Add Hostel')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ============ Add/Edit Room Modal ============ */}
      {showRoomModal && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            {editingRoom ? 'Edit Room' : 'Add Room'}
          </h2>

          <form onSubmit={handleRoomSubmit} className="space-y-4">
            <Field label="Hostel" required>
              <select
                required
                className="input"
                value={roomForm.hostel}
                onChange={(e) => setRoomForm({ ...roomForm, hostel: e.target.value })}
              >
                <option value="">-- Select Hostel --</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Room Number" required>
                <input
                  type="text"
                  required
                  className="input"
                  placeholder="e.g. 101"
                  value={roomForm.room_number}
                  onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                />
              </Field>
              <Field label="Floor" required>
                <input
                  type="number"
                  min="0"
                  required
                  className="input"
                  placeholder="e.g. 1"
                  value={roomForm.floor}
                  onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Room Type" required>
                <select
                  required
                  className="input"
                  value={roomForm.room_type}
                  onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}
                >
                  {ROOM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Capacity" required>
                <input
                  type="number"
                  min="1"
                  required
                  className="input"
                  placeholder="e.g. 2"
                  value={roomForm.capacity}
                  onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="room_available"
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={roomForm.is_available}
                onChange={(e) => setRoomForm({ ...roomForm, is_available: e.target.checked })}
              />
              <label htmlFor="room_available" className="text-sm text-gray-700">Available for allocation</label>
            </div>

            {roomMutationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {getErrorMessage(roomMutationError, 'Failed to save room. Please try again.')}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={closeRoomModal} className="btn btn-secondary">Cancel</button>
              <button type="submit" disabled={roomMutationPending} className="btn btn-primary">
                {roomMutationPending ? 'Saving...' : (editingRoom ? 'Save Changes' : 'Add Room')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ============ Delete Confirmation Modal ============ */}
      {deleteConfirm && (
        <Modal open size="sm" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Delete {deleteType === 'hostel' ? 'Hostel' : 'Room'}
          </h2>
          <p className="text-gray-600 mb-2">
            Are you sure you want to delete{' '}
            <strong>{deleteType === 'hostel' ? deleteConfirm.name : `Room ${deleteConfirm.room_number}`}</strong>?
            This action cannot be undone.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            {deleteType === 'hostel'
              ? 'A hostel with student records cannot be deleted; mark it Inactive instead.'
              : 'A room with student records cannot be deleted; mark it unavailable instead.'}
          </p>

          {deleteError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {getErrorMessage(deleteError, 'Failed to delete.')}
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button onClick={closeDeleteConfirm} className="btn btn-secondary">Cancel</button>
            <button onClick={handleDelete} disabled={deletePending} className="btn btn-danger">
              {deletePending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
