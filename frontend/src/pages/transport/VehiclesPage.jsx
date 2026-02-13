import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transportApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

const VEHICLE_TYPES = [
  { value: 'BUS', label: 'Bus' },
  { value: 'VAN', label: 'Van' },
  { value: 'CAR', label: 'Car' },
]

const VEHICLE_TYPE_BADGES = {
  BUS: 'bg-blue-100 text-blue-800',
  VAN: 'bg-green-100 text-green-800',
  CAR: 'bg-purple-100 text-purple-800',
}

const emptyForm = {
  vehicle_number: '',
  vehicle_type: 'BUS',
  capacity: '',
  make_model: '',
  driver_name: '',
  driver_phone: '',
  driver_license: '',
  assigned_route: '',
}

export default function VehiclesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [vehicleForm, setVehicleForm] = useState(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Fetch vehicles
  const { data: vehiclesData, isLoading, error } = useQuery({
    queryKey: ['transport-vehicles'],
    queryFn: () => transportApi.getVehicles(),
  })

  // Fetch routes for dropdown
  const { data: routesData } = useQuery({
    queryKey: ['transport-routes'],
    queryFn: () => transportApi.getRoutes(),
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => transportApi.createVehicle(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => transportApi.updateVehicle(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => transportApi.deleteVehicle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      setDeleteConfirm(null)
    },
  })

  const vehicles = vehiclesData?.data?.results || vehiclesData?.data || []
  const routes = routesData?.data?.results || routesData?.data || []

  const openAddModal = () => {
    setEditingVehicle(null)
    setVehicleForm(emptyForm)
    setShowModal(true)
  }

  const openEditModal = (vehicle) => {
    setEditingVehicle(vehicle)
    setVehicleForm({
      vehicle_number: vehicle.vehicle_number || '',
      vehicle_type: vehicle.vehicle_type || 'BUS',
      capacity: vehicle.capacity?.toString() || '',
      make_model: vehicle.make_model || '',
      driver_name: vehicle.driver_name || '',
      driver_phone: vehicle.driver_phone || '',
      driver_license: vehicle.driver_license || '',
      assigned_route: vehicle.assigned_route?.toString() || '',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingVehicle(null)
    setVehicleForm(emptyForm)
  }

  const handleSubmit = () => {
    if (!vehicleForm.vehicle_number.trim()) return

    const payload = {
      ...vehicleForm,
      capacity: vehicleForm.capacity ? parseInt(vehicleForm.capacity) : null,
      assigned_route: vehicleForm.assigned_route ? parseInt(vehicleForm.assigned_route) : null,
    }

    if (editingVehicle) {
      updateMutation.mutate({ id: editingVehicle.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const getRouteName = (routeId) => {
    if (!routeId) return '--'
    const route = routes.find((r) => r.id === routeId)
    return route?.name || '--'
  }

  if (error) {
    return (
      <div className="card text-center py-12">
        <svg className="w-12 h-12 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load vehicles</h3>
        <p className="text-gray-500">{error.response?.data?.detail || error.message || 'Something went wrong.'}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Vehicles</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage vehicles and driver information</p>
        </div>
        <button onClick={openAddModal} className="btn btn-primary">
          Add Vehicle
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading vehicles...</p>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <p className="text-gray-500 mb-2">No vehicles found</p>
            <p className="text-sm text-gray-400">Add your first vehicle to get started.</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-3">
              {vehicles.map((vehicle) => (
                <div key={vehicle.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900">{vehicle.vehicle_number}</p>
                      <p className="text-xs text-gray-500">{vehicle.make_model || 'No make/model'}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ml-2 ${VEHICLE_TYPE_BADGES[vehicle.vehicle_type] || 'bg-gray-100 text-gray-800'}`}>
                      {vehicle.vehicle_type}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-y-1">
                    <p>Capacity: {vehicle.capacity || '--'}</p>
                    {vehicle.driver_name && <p>Driver: {vehicle.driver_name} ({vehicle.driver_phone || '--'})</p>}
                    <p>Route: {getRouteName(vehicle.assigned_route)}</p>
                  </div>
                  <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                    <button onClick={() => openEditModal(vehicle)} className="text-xs text-blue-600 font-medium">Edit</button>
                    <button onClick={() => setDeleteConfirm(vehicle)} className="text-xs text-red-600 font-medium">Delete</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle Number</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Capacity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Make/Model</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Driver Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Driver Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned Route</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {vehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{vehicle.vehicle_number}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${VEHICLE_TYPE_BADGES[vehicle.vehicle_type] || 'bg-gray-100 text-gray-800'}`}>
                          {vehicle.vehicle_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{vehicle.capacity || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{vehicle.make_model || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{vehicle.driver_name || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{vehicle.driver_phone || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{getRouteName(vehicle.assigned_route)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(vehicle)}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(vehicle)}
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingVehicle ? 'Edit Vehicle' : 'Add Vehicle'}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Vehicle Number *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. ABC-1234"
                    value={vehicleForm.vehicle_number}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Vehicle Type</label>
                  <select
                    className="input"
                    value={vehicleForm.vehicle_type}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value })}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Capacity</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="e.g. 40"
                    value={vehicleForm.capacity}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Make / Model</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Toyota Coaster"
                    value={vehicleForm.make_model}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, make_model: e.target.value })}
                  />
                </div>
              </div>

              <hr className="border-gray-200" />
              <p className="text-sm font-medium text-gray-700">Driver Information</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Full name"
                    value={vehicleForm.driver_name}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driver_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Driver Phone</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="0300-1234567"
                    value={vehicleForm.driver_phone}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driver_phone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Driver License Number</label>
                <input
                  type="text"
                  className="input"
                  placeholder="License number"
                  value={vehicleForm.driver_license}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, driver_license: e.target.value })}
                />
              </div>

              <hr className="border-gray-200" />

              <div>
                <label className="label">Assigned Route</label>
                <select
                  className="input"
                  value={vehicleForm.assigned_route}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, assigned_route: e.target.value })}
                >
                  <option value="">-- No Route --</option>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>{route.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {(createMutation.isError || updateMutation.isError) && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createMutation.error?.response?.data?.detail ||
                  createMutation.error?.response?.data?.vehicle_number?.[0] ||
                  updateMutation.error?.response?.data?.detail ||
                  updateMutation.error?.response?.data?.vehicle_number?.[0] ||
                  'Failed to save vehicle. Please try again.'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending || !vehicleForm.vehicle_number.trim()}
                className="btn btn-primary"
              >
                {(createMutation.isPending || updateMutation.isPending)
                  ? 'Saving...'
                  : editingVehicle ? 'Save Changes' : 'Add Vehicle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Vehicle</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete vehicle <strong>{deleteConfirm.vehicle_number}</strong>?
              This action cannot be undone.
            </p>

            {deleteMutation.isError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {deleteMutation.error?.response?.data?.detail || 'Failed to delete vehicle.'}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
