import { useState } from 'react'
import Modal from '../../components/ui/Modal'
import Field from '../../components/ui/Field'
import Badge from '../../components/ui/Badge'
import { TONE } from '../../components/ui/statusTones'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transportApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const VEHICLE_TYPES = [
  { value: 'BUS', label: 'Bus' },
  { value: 'VAN', label: 'Van' },
  { value: 'CAR', label: 'Car' },
]

const VEHICLE_TYPE_BADGES = {
  BUS: TONE.info,
  VAN: TONE.success,
  CAR: TONE.accent,
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

  const [view, setView] = useViewPreference('vehicles')
  const [showModal, setShowModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [vehicleForm, setVehicleForm] = useState(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Fetch vehicles
  const { data: vehiclesData, isLoading, error } = useQuery({
    queryKey: ['transport-vehicles'],
    queryFn: () => transportApi.getVehicles({ page_size: 9999 }),
  })

  // Fetch routes for dropdown
  const { data: routesData } = useQuery({
    queryKey: ['transport-routes'],
    queryFn: () => transportApi.getRoutes({ page_size: 9999 }),
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

  useEscapeKey(closeModal, showModal)
  useEscapeKey(() => setDeleteConfirm(null), !!deleteConfirm)

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
      <PageHeader title="Vehicles" subtitle="Manage vehicles and driver information" className="mb-6" actions={<>
<button onClick={openAddModal} className="btn btn-primary">
          Add Vehicle
        </button>
</>} />

      <div className="card">
        {isLoading ? (
          <div className="text-center py-8">
            <LoadingState label="Loading vehicles..." compact />
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
            <div className="flex justify-end mb-3">
              <ViewToggle view={view} onChange={setView} />
            </div>

            {view === 'cards' ? (
            <CardGrid>
              {vehicles.map((vehicle) => (
                <RecordCard
                  key={vehicle.id}
                  title={vehicle.vehicle_number}
                  meta={vehicle.make_model || 'No make/model'}
                  status={
                    <Badge colors={VEHICLE_TYPE_BADGES[vehicle.vehicle_type] || TONE.neutral}>
                      {vehicle.vehicle_type}
                    </Badge>
                  }
                  fields={[
                    { label: 'Capacity', value: vehicle.capacity || '--' },
                    { label: 'Route', value: getRouteName(vehicle.assigned_route) },
                    ...(vehicle.driver_name ? [{ label: 'Driver', value: `${vehicle.driver_name} (${vehicle.driver_phone || '--'})` }] : []),
                  ]}
                  actions={[
                    { label: 'Edit', tone: 'info', onClick: () => openEditModal(vehicle) },
                    { label: 'Delete', tone: 'danger', onClick: () => setDeleteConfirm(vehicle) },
                  ]}
                />
              ))}
            </CardGrid>
            ) : (
            <div className="overflow-x-auto">
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
                <tbody className="divide-y divide-gray-100">
                  {vehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{vehicle.vehicle_number}</td>
                      <td className="px-4 py-3">
                        <Badge colors={VEHICLE_TYPE_BADGES[vehicle.vehicle_type] || TONE.neutral}>
                          {vehicle.vehicle_type}
                        </Badge>
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
            )}
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal open  size="lg" closeOnBackdrop={false}>
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingVehicle ? 'Edit Vehicle' : 'Add Vehicle'}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Vehicle Number" required>
<input
                    type="text"
                    className="input"
                    placeholder="e.g. ABC-1234"
                    value={vehicleForm.vehicle_number}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_number: e.target.value })}
                  />
</Field>
                <Field label="Vehicle Type">
<select
                    className="input"
                    value={vehicleForm.vehicle_type}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value })}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
</Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Capacity">
<input
                    type="number"
                    className="input"
                    placeholder="e.g. 40"
                    value={vehicleForm.capacity}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })}
                  />
</Field>
                <Field label="Make / Model">
<input
                    type="text"
                    className="input"
                    placeholder="e.g. Toyota Coaster"
                    value={vehicleForm.make_model}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, make_model: e.target.value })}
                  />
</Field>
              </div>

              <hr className="border-gray-200" />
              <p className="text-sm font-medium text-gray-700">Driver Information</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Driver Name">
<input
                    type="text"
                    className="input"
                    placeholder="Full name"
                    value={vehicleForm.driver_name}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driver_name: e.target.value })}
                  />
</Field>
                <Field label="Driver Phone">
<input
                    type="text"
                    className="input"
                    placeholder="0300-1234567"
                    value={vehicleForm.driver_phone}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driver_phone: e.target.value })}
                  />
</Field>
              </div>

              <Field label="Driver License Number">
<input
                  type="text"
                  className="input"
                  placeholder="License number"
                  value={vehicleForm.driver_license}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, driver_license: e.target.value })}
                />
</Field>

              <hr className="border-gray-200" />

              <Field label="Assigned Route">
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
</Field>
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
          </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <Modal open  size="sm" closeOnBackdrop={false}>
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
          </Modal>
      )}
    </div>
  )
}
