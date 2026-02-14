import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hostelApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

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
  room_type: 'SHARED',
  capacity: '',
  is_available: true,
}

export default function HostelRoomsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('hostels')
  const [selectedHostel, setSelectedHostel] = useState('')

  // Hostel modal
  const [showHostelModal, setShowHostelModal] = useState(false)
  const [editingHostel, setEditingHostel] = useState(null)
  const [hostelForm, setHostelForm] = useState(emptyHostelForm)

  // Room modal
  const [showRoomModal, setShowRoomModal] = useState(false)
  const [editingRoom, setEditingRoom] = useState(null)
  const [roomForm, setRoomForm] = useState(emptyRoomForm)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleteType, setDeleteType] = useState(null)

  // ---- Queries ----

  const { data: hostelsData, isLoading: hostelsLoading } = useQuery({
    queryKey: ['hostels'],
    queryFn: () => hostelApi.getHostels(),
  })

  const { data: roomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['hostelRooms', selectedHostel],
    queryFn: () => hostelApi.getRooms({ hostel_id: selectedHostel }),
    enabled: !!selectedHostel,
  })

  const hostels = hostelsData?.data?.results || hostelsData?.data || []
  const rooms = roomsData?.data?.results || roomsData?.data || []

  // ---- Hostel Mutations ----

  const createHostelMutation = useMutation({
    mutationFn: (data) => hostelApi.createHostel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeHostelModal()
    },
  })

  const updateHostelMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.updateHostel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeHostelModal()
    },
  })

  const deleteHostelMutation = useMutation({
    mutationFn: (id) => hostelApi.deleteHostel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      setDeleteConfirm(null)
      setDeleteType(null)
      if (selectedHostel === String(deleteConfirm?.id)) {
        setSelectedHostel('')
      }
    },
  })

  // ---- Room Mutations ----

  const createRoomMutation = useMutation({
    mutationFn: (data) => hostelApi.createRoom(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeRoomModal()
    },
  })

  const updateRoomMutation = useMutation({
    mutationFn: ({ id, data }) => hostelApi.updateRoom(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      closeRoomModal()
    },
  })

  const deleteRoomMutation = useMutation({
    mutationFn: (id) => hostelApi.deleteRoom(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hostelRooms'] })
      queryClient.invalidateQueries({ queryKey: ['hostels'] })
      queryClient.invalidateQueries({ queryKey: ['hostelDashboard'] })
      setDeleteConfirm(null)
      setDeleteType(null)
    },
  })

  // ---- Modal Handlers ----

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
      capacity: hostel.capacity || '',
      address: hostel.address || '',
      contact_number: hostel.contact_number || '',
      warden: hostel.warden || '',
      is_active: hostel.is_active !== false,
    })
    setShowHostelModal(true)
  }

  const closeHostelModal = () => {
    setShowHostelModal(false)
    setEditingHostel(null)
    setHostelForm(emptyHostelForm)
  }

  const openAddRoom = () => {
    setEditingRoom(null)
    setRoomForm({
      ...emptyRoomForm,
      hostel: selectedHostel || '',
    })
    setShowRoomModal(true)
  }

  const openEditRoom = (room) => {
    setEditingRoom(room)
    setRoomForm({
      hostel: room.hostel?.toString() || room.hostel_id?.toString() || selectedHostel || '',
      room_number: room.room_number || '',
      floor: room.floor ?? '',
      room_type: room.room_type || 'SHARED',
      capacity: room.capacity || '',
      is_available: room.is_available !== false,
    })
    setShowRoomModal(true)
  }

  const closeRoomModal = () => {
    setShowRoomModal(false)
    setEditingRoom(null)
    setRoomForm(emptyRoomForm)
  }

  const openDeleteConfirm = (item, type) => {
    setDeleteConfirm(item)
    setDeleteType(type)
  }

  // ---- Submit Handlers ----

  const handleHostelSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...hostelForm,
      capacity: parseInt(hostelForm.capacity) || 0,
      warden: hostelForm.warden || null,
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

  const hostelTypeColors = {
    BOYS: 'bg-sky-100 text-sky-700',
    GIRLS: 'bg-pink-100 text-pink-700',
    MIXED: 'bg-purple-100 text-purple-700',
  }

  const tabs = [
    { key: 'hostels', label: 'Hostels' },
    { key: 'rooms', label: 'Rooms' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Hostels & Rooms</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage hostels and room inventory</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'hostels' && (
            <button
              onClick={openAddHostel}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Hostel
            </button>
          )}
          {activeTab === 'rooms' && selectedHostel && (
            <button
              onClick={openAddRoom}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Add Room
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ============ HOSTELS TAB ============ */}
      {activeTab === 'hostels' && (
        <div className="bg-white rounded-lg shadow-sm">
          {hostelsLoading ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-3">Loading hostels...</p>
            </div>
          ) : hostels.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <p className="text-gray-500 font-medium">No hostels found</p>
              <p className="text-gray-400 text-sm mt-1">Add your first hostel to get started.</p>
            </div>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="sm:hidden divide-y divide-gray-200">
                {hostels.map((hostel) => (
                  <div key={hostel.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{hostel.name}</p>
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${hostelTypeColors[hostel.hostel_type] || 'bg-gray-100 text-gray-700'}`}>
                          {hostel.hostel_type}
                        </span>
                      </div>
                      <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                        hostel.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {hostel.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>Capacity: {hostel.capacity || 0} | Occupancy: {hostel.current_occupancy ?? hostel.occupancy ?? 0}</p>
                      {hostel.warden_name && <p>Warden: {hostel.warden_name}</p>}
                    </div>
                    <div className="flex gap-3 mt-3 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => { setSelectedHostel(String(hostel.id)); setActiveTab('rooms') }}
                        className="text-xs text-green-600 font-medium"
                      >
                        View Rooms
                      </button>
                      <button onClick={() => openEditHostel(hostel)} className="text-xs text-blue-600 font-medium">Edit</button>
                      <button onClick={() => openDeleteConfirm(hostel, 'hostel')} className="text-xs text-red-600 font-medium">Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Capacity</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Occupancy</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Warden</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {hostels.map((hostel) => (
                      <tr key={hostel.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{hostel.name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${hostelTypeColors[hostel.hostel_type] || 'bg-gray-100 text-gray-700'}`}>
                            {hostel.hostel_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">{hostel.capacity || 0}</td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">{hostel.current_occupancy ?? hostel.occupancy ?? 0}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{hostel.warden_name || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            hostel.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {hostel.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => { setSelectedHostel(String(hostel.id)); setActiveTab('rooms') }}
                            className="text-sm text-green-600 hover:text-green-800 font-medium mr-3"
                          >
                            Rooms
                          </button>
                          <button
                            onClick={() => openEditHostel(hostel)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(hostel, 'hostel')}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============ ROOMS TAB ============ */}
      {activeTab === 'rooms' && (
        <div className="space-y-4">
          {/* Hostel filter */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Select Hostel</label>
            <select
              className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={selectedHostel}
              onChange={(e) => setSelectedHostel(e.target.value)}
            >
              <option value="">-- Select Hostel --</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          {!selectedHostel ? (
            <div className="bg-white rounded-lg shadow-sm text-center py-16">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <p className="text-gray-500 font-medium">Select a hostel to view rooms</p>
              <p className="text-gray-400 text-sm mt-1">Choose a hostel from the dropdown above.</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm">
              {roomsLoading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-500 mt-3">Loading rooms...</p>
                </div>
              ) : rooms.length === 0 ? (
                <div className="text-center py-16">
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <p className="text-gray-500 font-medium">No rooms found</p>
                  <p className="text-gray-400 text-sm mt-1">Add rooms to this hostel to get started.</p>
                </div>
              ) : (
                <>
                  {/* Mobile card view */}
                  <div className="sm:hidden divide-y divide-gray-200">
                    {rooms.map((room) => (
                      <div key={room.id} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm text-gray-900">Room {room.room_number}</p>
                            <p className="text-xs text-gray-500">Floor {room.floor} | {room.room_type}</p>
                          </div>
                          <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                            room.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {room.is_available ? 'Available' : 'Full'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          <p>Capacity: {room.capacity} | Occupancy: {room.current_occupancy ?? room.occupancy ?? 0}</p>
                        </div>
                        <div className="flex gap-3 mt-3 pt-2 border-t border-gray-100">
                          <button onClick={() => openEditRoom(room)} className="text-xs text-blue-600 font-medium">Edit</button>
                          <button onClick={() => openDeleteConfirm(room, 'room')} className="text-xs text-red-600 font-medium">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
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
                      <tbody className="bg-white divide-y divide-gray-200">
                        {rooms.map((room) => (
                          <tr key={room.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{room.room_number}</td>
                            <td className="px-4 py-3 text-sm text-center text-gray-700">{room.floor}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                {room.room_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-center text-gray-700">{room.capacity}</td>
                            <td className="px-4 py-3 text-sm text-center text-gray-700">{room.current_occupancy ?? room.occupancy ?? 0}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                room.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {room.is_available ? 'Available' : 'Full'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button
                                onClick={() => openEditRoom(room)}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => openDeleteConfirm(room, 'room')}
                                className="text-sm text-red-600 hover:text-red-800 font-medium"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ Add/Edit Hostel Modal ============ */}
      {showHostelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingHostel ? 'Edit Hostel' : 'Add Hostel'}
            </h2>

            {hostelMutationError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {hostelMutationError.response?.data?.detail || hostelMutationError.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleHostelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Hostel Name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={hostelForm.name}
                  onChange={(e) => setHostelForm({ ...hostelForm, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Hostel Type *</label>
                  <select
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={hostelForm.hostel_type}
                    onChange={(e) => setHostelForm({ ...hostelForm, hostel_type: e.target.value })}
                  >
                    <option value="BOYS">Boys</option>
                    <option value="GIRLS">Girls</option>
                    <option value="MIXED">Mixed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Capacity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={hostelForm.capacity}
                    onChange={(e) => setHostelForm({ ...hostelForm, capacity: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Address</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={hostelForm.address}
                  onChange={(e) => setHostelForm({ ...hostelForm, address: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Contact Number</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={hostelForm.contact_number}
                    onChange={(e) => setHostelForm({ ...hostelForm, contact_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Warden (Staff ID)</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional"
                    value={hostelForm.warden}
                    onChange={(e) => setHostelForm({ ...hostelForm, warden: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="hostel_active"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={hostelForm.is_active}
                  onChange={(e) => setHostelForm({ ...hostelForm, is_active: e.target.checked })}
                />
                <label htmlFor="hostel_active" className="text-sm text-gray-700">Active</label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeHostelModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={hostelMutationPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {hostelMutationPending ? 'Saving...' : (editingHostel ? 'Save Changes' : 'Add Hostel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Add/Edit Room Modal ============ */}
      {showRoomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingRoom ? 'Edit Room' : 'Add Room'}
            </h2>

            {roomMutationError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {roomMutationError.response?.data?.detail || roomMutationError.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleRoomSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Hostel *</label>
                <select
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={roomForm.hostel}
                  onChange={(e) => setRoomForm({ ...roomForm, hostel: e.target.value })}
                >
                  <option value="">-- Select Hostel --</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Room Number *</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. 101"
                    value={roomForm.room_number}
                    onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Floor *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={roomForm.floor}
                    onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Room Type *</label>
                  <select
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={roomForm.room_type}
                    onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}
                  >
                    <option value="SINGLE">Single</option>
                    <option value="DOUBLE">Double</option>
                    <option value="TRIPLE">Triple</option>
                    <option value="SHARED">Shared</option>
                    <option value="DORMITORY">Dormitory</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Capacity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={roomForm.capacity}
                    onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="room_available"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={roomForm.is_available}
                  onChange={(e) => setRoomForm({ ...roomForm, is_available: e.target.checked })}
                />
                <label htmlFor="room_available" className="text-sm text-gray-700">Available</label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeRoomModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={roomMutationPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {roomMutationPending ? 'Saving...' : (editingRoom ? 'Save Changes' : 'Add Room')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Delete Confirmation Modal ============ */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Delete {deleteType === 'hostel' ? 'Hostel' : 'Room'}
            </h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete{' '}
              <strong>{deleteType === 'hostel' ? deleteConfirm.name : `Room ${deleteConfirm.room_number}`}</strong>?
              This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {deleteError.response?.data?.detail || deleteError.message || 'Failed to delete.'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteType(null) }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deletePending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletePending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
