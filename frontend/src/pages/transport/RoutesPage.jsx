import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transportApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

const emptyRouteForm = {
  name: '',
  description: '',
  start_location: '',
  end_location: '',
  distance_km: '',
  estimated_duration_minutes: '',
}

const emptyStopForm = {
  name: '',
  address: '',
  order: '',
  pickup_time: '',
  drop_time: '',
}

export default function RoutesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [editingRoute, setEditingRoute] = useState(null)
  const [routeForm, setRouteForm] = useState(emptyRouteForm)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [expandedRoute, setExpandedRoute] = useState(null)
  const [showStopModal, setShowStopModal] = useState(false)
  const [editingStop, setEditingStop] = useState(null)
  const [stopForm, setStopForm] = useState(emptyStopForm)
  const [stopRouteId, setStopRouteId] = useState(null)

  // Fetch routes
  const { data: routesData, isLoading, error } = useQuery({
    queryKey: ['transport-routes'],
    queryFn: () => transportApi.getRoutes(),
  })

  // Fetch stops for expanded route
  const { data: stopsData, isLoading: stopsLoading } = useQuery({
    queryKey: ['transport-stops', expandedRoute],
    queryFn: () => transportApi.getStops({ route: expandedRoute }),
    enabled: !!expandedRoute,
  })

  // Route mutations
  const createRouteMutation = useMutation({
    mutationFn: (data) => transportApi.createRoute(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-routes'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      closeRouteModal()
    },
  })

  const updateRouteMutation = useMutation({
    mutationFn: ({ id, data }) => transportApi.updateRoute(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-routes'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      closeRouteModal()
    },
  })

  const deleteRouteMutation = useMutation({
    mutationFn: (id) => transportApi.deleteRoute(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-routes'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      setDeleteConfirm(null)
    },
  })

  // Stop mutations
  const createStopMutation = useMutation({
    mutationFn: (data) => transportApi.createStop(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-stops', expandedRoute] })
      closeStopModal()
    },
  })

  const updateStopMutation = useMutation({
    mutationFn: ({ id, data }) => transportApi.updateStop(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-stops', expandedRoute] })
      closeStopModal()
    },
  })

  const deleteStopMutation = useMutation({
    mutationFn: (id) => transportApi.deleteStop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-stops', expandedRoute] })
    },
  })

  const routes = routesData?.data?.results || routesData?.data || []
  const stops = stopsData?.data?.results || stopsData?.data || []

  // Route modal handlers
  const openAddRouteModal = () => {
    setEditingRoute(null)
    setRouteForm(emptyRouteForm)
    setShowModal(true)
  }

  const openEditRouteModal = (route) => {
    setEditingRoute(route)
    setRouteForm({
      name: route.name || '',
      description: route.description || '',
      start_location: route.start_location || '',
      end_location: route.end_location || '',
      distance_km: route.distance_km || '',
      estimated_duration_minutes: route.estimated_duration_minutes || '',
    })
    setShowModal(true)
  }

  const closeRouteModal = () => {
    setShowModal(false)
    setEditingRoute(null)
    setRouteForm(emptyRouteForm)
  }

  const handleRouteSubmit = () => {
    if (!routeForm.name.trim()) return

    const payload = {
      ...routeForm,
      distance_km: routeForm.distance_km ? parseFloat(routeForm.distance_km) : null,
      estimated_duration_minutes: routeForm.estimated_duration_minutes ? parseInt(routeForm.estimated_duration_minutes) : null,
    }

    if (editingRoute) {
      updateRouteMutation.mutate({ id: editingRoute.id, data: payload })
    } else {
      createRouteMutation.mutate(payload)
    }
  }

  // Stop modal handlers
  const openAddStopModal = (routeId) => {
    setEditingStop(null)
    setStopRouteId(routeId)
    setStopForm({
      ...emptyStopForm,
      order: (stops.length + 1).toString(),
    })
    setShowStopModal(true)
  }

  const openEditStopModal = (stop) => {
    setEditingStop(stop)
    setStopRouteId(stop.route)
    setStopForm({
      name: stop.name || '',
      address: stop.address || '',
      order: stop.order?.toString() || '',
      pickup_time: stop.pickup_time || '',
      drop_time: stop.drop_time || '',
    })
    setShowStopModal(true)
  }

  const closeStopModal = () => {
    setShowStopModal(false)
    setEditingStop(null)
    setStopForm(emptyStopForm)
    setStopRouteId(null)
  }

  const handleStopSubmit = () => {
    if (!stopForm.name.trim()) return

    const payload = {
      ...stopForm,
      route: stopRouteId,
      order: stopForm.order ? parseInt(stopForm.order) : 1,
    }

    if (editingStop) {
      updateStopMutation.mutate({ id: editingStop.id, data: payload })
    } else {
      createStopMutation.mutate(payload)
    }
  }

  const toggleExpand = (routeId) => {
    setExpandedRoute(expandedRoute === routeId ? null : routeId)
  }

  if (error) {
    return (
      <div className="card text-center py-12">
        <svg className="w-12 h-12 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load routes</h3>
        <p className="text-gray-500">{error.response?.data?.detail || error.message || 'Something went wrong.'}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Transport Routes</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage routes and their stops</p>
        </div>
        <button onClick={openAddRouteModal} className="btn btn-primary">
          Add Route
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading routes...</p>
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <p className="text-gray-500 mb-2">No routes found</p>
            <p className="text-sm text-gray-400">Create your first transport route to get started.</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-3">
              {routes.map((route) => (
                <div key={route.id} className="border border-gray-200 rounded-lg">
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm text-gray-900">{route.name}</p>
                      <button
                        onClick={() => toggleExpand(route.id)}
                        className="text-xs text-primary-600 font-medium"
                      >
                        {expandedRoute === route.id ? 'Hide Stops' : 'Show Stops'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {route.start_location || 'Start'} → {route.end_location || 'End'}
                    </p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      {route.distance_km && <span>{route.distance_km} km</span>}
                      {route.estimated_duration_minutes && <span>{route.estimated_duration_minutes} min</span>}
                      <span>{route.vehicles_count || 0} vehicles</span>
                      <span>{route.students_count || 0} students</span>
                    </div>
                    <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                      <button onClick={() => openEditRouteModal(route)} className="text-xs text-blue-600 font-medium">Edit</button>
                      <button onClick={() => setDeleteConfirm(route)} className="text-xs text-red-600 font-medium">Delete</button>
                    </div>
                  </div>

                  {/* Expanded stops (mobile) */}
                  {expandedRoute === route.id && (
                    <div className="border-t border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-gray-700 uppercase">Stops</p>
                        <button onClick={() => openAddStopModal(route.id)} className="text-xs text-primary-600 font-medium">
                          + Add Stop
                        </button>
                      </div>
                      {stopsLoading ? (
                        <p className="text-xs text-gray-400 py-2">Loading stops...</p>
                      ) : stops.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No stops added yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {stops.sort((a, b) => (a.order || 0) - (b.order || 0)).map((stop) => (
                            <div key={stop.id} className="flex items-center justify-between bg-white p-2 rounded border border-gray-100">
                              <div>
                                <p className="text-xs font-medium text-gray-900">#{stop.order} {stop.name}</p>
                                <p className="text-xs text-gray-500">{stop.address || '--'}</p>
                                <p className="text-xs text-gray-400">
                                  Pickup: {stop.pickup_time || '--'} | Drop: {stop.drop_time || '--'}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => openEditStopModal(stop)} className="text-xs text-blue-600">Edit</button>
                                <button onClick={() => deleteStopMutation.mutate(stop.id)} className="text-xs text-red-600">Del</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">End Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Distance</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicles</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Students</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {routes.map((route) => (
                    <>
                      <tr key={route.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{route.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.start_location || '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.end_location || '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.distance_km ? `${route.distance_km} km` : '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.estimated_duration_minutes ? `${route.estimated_duration_minutes} min` : '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.vehicles_count || 0}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{route.students_count || 0}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleExpand(route.id)}
                            className="text-sm text-primary-600 hover:text-primary-800 font-medium mr-3"
                          >
                            {expandedRoute === route.id ? 'Hide Stops' : 'Stops'}
                          </button>
                          <button
                            onClick={() => openEditRouteModal(route)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(route)}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>

                      {/* Expanded stops row */}
                      {expandedRoute === route.id && (
                        <tr key={`stops-${route.id}`}>
                          <td colSpan={8} className="px-4 py-0">
                            <div className="bg-gray-50 rounded-lg p-4 my-2 border border-gray-200">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-gray-700">Stops for {route.name}</h4>
                                <button
                                  onClick={() => openAddStopModal(route.id)}
                                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                                >
                                  + Add Stop
                                </button>
                              </div>

                              {stopsLoading ? (
                                <div className="text-center py-4">
                                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                                  <p className="text-gray-500 mt-1 text-xs">Loading stops...</p>
                                </div>
                              ) : stops.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">No stops added to this route yet.</p>
                              ) : (
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-white">
                                    <tr>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stop Name</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pickup Time</th>
                                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Drop Time</th>
                                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {stops.sort((a, b) => (a.order || 0) - (b.order || 0)).map((stop) => (
                                      <tr key={stop.id} className="hover:bg-white">
                                        <td className="px-3 py-2 text-sm text-gray-500">{stop.order || '--'}</td>
                                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{stop.name}</td>
                                        <td className="px-3 py-2 text-sm text-gray-500">{stop.address || '--'}</td>
                                        <td className="px-3 py-2 text-sm text-gray-500">{stop.pickup_time || '--'}</td>
                                        <td className="px-3 py-2 text-sm text-gray-500">{stop.drop_time || '--'}</td>
                                        <td className="px-3 py-2 text-right">
                                          <button
                                            onClick={() => openEditStopModal(stop)}
                                            className="text-xs text-blue-600 hover:text-blue-800 font-medium mr-2"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => deleteStopMutation.mutate(stop.id)}
                                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                                          >
                                            Delete
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Route Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingRoute ? 'Edit Route' : 'Create Route'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Route Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Route A - North Sector"
                  value={routeForm.name}
                  onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Optional description"
                  value={routeForm.description}
                  onChange={(e) => setRouteForm({ ...routeForm, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Start Location</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Main Campus"
                    value={routeForm.start_location}
                    onChange={(e) => setRouteForm({ ...routeForm, start_location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">End Location</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. DHA Phase 6"
                    value={routeForm.end_location}
                    onChange={(e) => setRouteForm({ ...routeForm, end_location: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Distance (km)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    placeholder="e.g. 15.5"
                    value={routeForm.distance_km}
                    onChange={(e) => setRouteForm({ ...routeForm, distance_km: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Estimated Duration (minutes)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="e.g. 45"
                    value={routeForm.estimated_duration_minutes}
                    onChange={(e) => setRouteForm({ ...routeForm, estimated_duration_minutes: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {(createRouteMutation.isError || updateRouteMutation.isError) && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createRouteMutation.error?.response?.data?.detail ||
                  updateRouteMutation.error?.response?.data?.detail ||
                  'Failed to save route. Please try again.'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeRouteModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleRouteSubmit}
                disabled={createRouteMutation.isPending || updateRouteMutation.isPending || !routeForm.name.trim()}
                className="btn btn-primary"
              >
                {(createRouteMutation.isPending || updateRouteMutation.isPending)
                  ? 'Saving...'
                  : editingRoute ? 'Save Changes' : 'Create Route'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stop Create/Edit Modal */}
      {showStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingStop ? 'Edit Stop' : 'Add Stop'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Stop Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Main Gate, Sector F"
                  value={stopForm.name}
                  onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Address</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Full address"
                  value={stopForm.address}
                  onChange={(e) => setStopForm({ ...stopForm, address: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Order</label>
                <input
                  type="number"
                  className="input"
                  placeholder="Stop order (1, 2, 3...)"
                  value={stopForm.order}
                  onChange={(e) => setStopForm({ ...stopForm, order: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Pickup Time</label>
                  <input
                    type="time"
                    className="input"
                    value={stopForm.pickup_time}
                    onChange={(e) => setStopForm({ ...stopForm, pickup_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Drop Time</label>
                  <input
                    type="time"
                    className="input"
                    value={stopForm.drop_time}
                    onChange={(e) => setStopForm({ ...stopForm, drop_time: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {(createStopMutation.isError || updateStopMutation.isError) && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createStopMutation.error?.response?.data?.detail ||
                  updateStopMutation.error?.response?.data?.detail ||
                  'Failed to save stop. Please try again.'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeStopModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleStopSubmit}
                disabled={createStopMutation.isPending || updateStopMutation.isPending || !stopForm.name.trim()}
                className="btn btn-primary"
              >
                {(createStopMutation.isPending || updateStopMutation.isPending)
                  ? 'Saving...'
                  : editingStop ? 'Save Changes' : 'Add Stop'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Route</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete route <strong>{deleteConfirm.name}</strong>?
              This will also remove all associated stops, vehicle assignments, and student assignments.
            </p>

            {deleteRouteMutation.isError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {deleteRouteMutation.error?.response?.data?.detail || 'Failed to delete route.'}
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteRouteMutation.mutate(deleteConfirm.id)}
                disabled={deleteRouteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteRouteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
