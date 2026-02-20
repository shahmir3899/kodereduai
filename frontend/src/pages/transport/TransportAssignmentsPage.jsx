import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transportApi, studentsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

const TRANSPORT_TYPES = [
  { value: 'PICKUP', label: 'Pickup Only' },
  { value: 'DROP', label: 'Drop Only' },
  { value: 'BOTH', label: 'Both (Pickup & Drop)' },
]

export default function TransportAssignmentsPage() {
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()

  const [filterRoute, setFilterRoute] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterTransportType, setFilterTransportType] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [selectedStudents, setSelectedStudents] = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [modalClassFilter, setModalClassFilter] = useState('')
  const [modalSelectedStudents, setModalSelectedStudents] = useState([])

  const [assignForm, setAssignForm] = useState({
    route: '',
    stop: '',
    vehicle: '',
    transport_type: 'BOTH',
  })

  const [bulkForm, setBulkForm] = useState({
    route: '',
    stop: '',
    vehicle: '',
    transport_type: 'BOTH',
  })

  // Fetch assignments
  const { data: assignmentsData, isLoading, error } = useQuery({
    queryKey: ['transport-assignments', filterRoute, filterClass, filterTransportType],
    queryFn: () => transportApi.getAssignments({
      ...(filterRoute && { route: filterRoute }),
      ...(filterClass && { class_id: filterClass }),
      ...(filterTransportType && { transport_type: filterTransportType }),
      page_size: 9999,
    }),
  })

  // Fetch routes
  const { data: routesData } = useQuery({
    queryKey: ['transport-routes'],
    queryFn: () => transportApi.getRoutes({ page_size: 9999 }),
  })

  // Fetch students for assignment (session-aware)
  const { data: studentsData } = useQuery({
    queryKey: ['students', activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeSchool?.id,
  })

  // Fetch stops filtered by selected route
  const selectedRouteForForm = showModal ? assignForm.route : bulkForm.route
  const { data: stopsData } = useQuery({
    queryKey: ['transport-stops', selectedRouteForForm],
    queryFn: () => transportApi.getStops({ route: selectedRouteForForm, page_size: 9999 }),
    enabled: !!selectedRouteForForm,
  })

  // Fetch vehicles filtered by selected route
  const { data: vehiclesData } = useQuery({
    queryKey: ['transport-vehicles-route', selectedRouteForForm],
    queryFn: () => transportApi.getVehicles({ assigned_route: selectedRouteForForm, page_size: 9999 }),
    enabled: !!selectedRouteForForm,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => transportApi.createAssignment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => transportApi.deleteAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      setDeleteConfirm(null)
    },
  })

  const bulkAssignMutation = useMutation({
    mutationFn: (data) => transportApi.bulkAssign(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      if (showBulkModal) closeBulkModal()
      if (showModal) closeModal()
    },
  })

  const assignments = assignmentsData?.data?.results || assignmentsData?.data || []
  const routes = routesData?.data?.results || routesData?.data || []
  const allStudents = studentsData?.data?.results || studentsData?.data || []
  const stops = stopsData?.data?.results || stopsData?.data || []
  const vehicles = vehiclesData?.data?.results || vehiclesData?.data || []

  // Filter students for search + class filter in modal
  const filteredStudents = useMemo(() => {
    let result = allStudents
    // Filter by class
    if (modalClassFilter) {
      result = result.filter((s) => String(s.class_obj) === String(modalClassFilter))
    }
    // Filter by search
    if (studentSearch.trim()) {
      const searchLower = studentSearch.toLowerCase()
      result = result.filter((s) =>
        s.name?.toLowerCase().includes(searchLower) ||
        s.roll_number?.toLowerCase().includes(searchLower) ||
        s.class_name?.toLowerCase().includes(searchLower)
      )
    }
    // Exclude already-selected students from list
    const selectedIds = new Set(modalSelectedStudents.map((s) => s.id))
    result = result.filter((s) => !selectedIds.has(s.id))
    return result.slice(0, 30)
  }, [allStudents, studentSearch, modalClassFilter, modalSelectedStudents])

  // Modal handlers
  const openAddModal = () => {
    setAssignForm({
      route: '',
      stop: '',
      vehicle: '',
      transport_type: 'BOTH',
    })
    setStudentSearch('')
    setModalClassFilter('')
    setModalSelectedStudents([])
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setAssignForm({
      route: '',
      stop: '',
      vehicle: '',
      transport_type: 'BOTH',
    })
    setStudentSearch('')
    setModalClassFilter('')
    setModalSelectedStudents([])
  }

  const handleSubmit = () => {
    if (modalSelectedStudents.length === 0 || !assignForm.route) return

    if (modalSelectedStudents.length === 1) {
      createMutation.mutate({
        student: modalSelectedStudents[0].id,
        route: parseInt(assignForm.route),
        stop: assignForm.stop ? parseInt(assignForm.stop) : null,
        vehicle: assignForm.vehicle ? parseInt(assignForm.vehicle) : null,
        transport_type: assignForm.transport_type,
      })
    } else {
      bulkAssignMutation.mutate({
        student_ids: modalSelectedStudents.map((s) => s.id),
        route: parseInt(assignForm.route),
        stop: assignForm.stop ? parseInt(assignForm.stop) : null,
        vehicle: assignForm.vehicle ? parseInt(assignForm.vehicle) : null,
        transport_type: assignForm.transport_type,
      })
    }
  }

  const addStudentToSelection = (student) => {
    setModalSelectedStudents((prev) => [...prev, student])
    setStudentSearch('')
  }

  const removeStudentFromSelection = (studentId) => {
    setModalSelectedStudents((prev) => prev.filter((s) => s.id !== studentId))
  }

  const addAllFilteredStudents = () => {
    setModalSelectedStudents((prev) => {
      const existingIds = new Set(prev.map((s) => s.id))
      const newStudents = filteredStudents.filter((s) => !existingIds.has(s.id))
      return [...prev, ...newStudents]
    })
  }

  // Bulk assign handlers
  const openBulkModal = () => {
    if (selectedStudents.length === 0) return
    setBulkForm({
      route: '',
      stop: '',
      vehicle: '',
      transport_type: 'BOTH',
    })
    setShowBulkModal(true)
  }

  const closeBulkModal = () => {
    setShowBulkModal(false)
    setSelectedStudents([])
    setBulkForm({
      route: '',
      stop: '',
      vehicle: '',
      transport_type: 'BOTH',
    })
  }

  const handleBulkSubmit = () => {
    if (!bulkForm.route || selectedStudents.length === 0) return

    const payload = {
      student_ids: selectedStudents,
      route: parseInt(bulkForm.route),
      stop: bulkForm.stop ? parseInt(bulkForm.stop) : null,
      vehicle: bulkForm.vehicle ? parseInt(bulkForm.vehicle) : null,
      transport_type: bulkForm.transport_type,
    }

    bulkAssignMutation.mutate(payload)
  }

  const toggleStudentSelection = (studentId) => {
    setSelectedStudents((prev) =>
      prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId]
    )
  }

  const toggleSelectAll = () => {
    if (selectedStudents.length === assignments.length) {
      setSelectedStudents([])
    } else {
      setSelectedStudents(assignments.map((a) => a.student))
    }
  }

  const getTransportTypeBadge = (type) => {
    switch (type) {
      case 'PICKUP':
        return 'bg-blue-100 text-blue-800'
      case 'DROP':
        return 'bg-orange-100 text-orange-800'
      case 'BOTH':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (error) {
    return (
      <div className="card text-center py-12">
        <svg className="w-12 h-12 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load assignments</h3>
        <p className="text-gray-500">{error.response?.data?.detail || error.message || 'Something went wrong.'}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Transport Assignments</h1>
          <p className="text-sm sm:text-base text-gray-600">Assign students to routes and stops</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedStudents.length > 0 && (
            <button onClick={openBulkModal} className="btn btn-secondary">
              Bulk Assign ({selectedStudents.length})
            </button>
          )}
          <button onClick={openAddModal} className="btn btn-primary">
            New Assignment
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Filter by Route</label>
            <select
              className="input"
              value={filterRoute}
              onChange={(e) => setFilterRoute(e.target.value)}
            >
              <option value="">All Routes</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>{route.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Filter by Class</label>
            <ClassSelector
              className="input"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              showAllOption
            />
          </div>
          <div>
            <label className="label">Filter by Transport Type</label>
            <select
              className="input"
              value={filterTransportType}
              onChange={(e) => setFilterTransportType(e.target.value)}
            >
              <option value="">All Types</option>
              {TRANSPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Assignments Table */}
      <div className="card">
        {!isLoading && assignments.length > 0 && (
          <div className="mb-4 text-sm text-gray-500">
            Showing {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading assignments...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 mb-2">No assignments found</p>
            <p className="text-sm text-gray-400">
              {filterRoute || filterClass
                ? 'Try adjusting the filters above.'
                : 'Assign students to transport routes to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedStudents.includes(assignment.student)}
                      onChange={() => toggleStudentSelection(assignment.student)}
                      className="rounded border-gray-300"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900">{assignment.student_name}</p>
                      <p className="text-xs text-gray-500">{assignment.class_name || '--'}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${getTransportTypeBadge(assignment.transport_type)}`}>
                      {assignment.transport_type}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 space-y-0.5 ml-7">
                    <p>Route: {assignment.route_name || '--'}</p>
                    <p>Stop: {assignment.stop_name || '--'}</p>
                    <p>Pickup: {assignment.stop_pickup_time || '--'} | Drop: {assignment.stop_drop_time || '--'}</p>
                    <p>Vehicle: {assignment.vehicle_number || '--'}</p>
                  </div>
                  <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100 ml-7">
                    <button onClick={() => setDeleteConfirm(assignment)} className="text-xs text-red-600 font-medium">Remove</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedStudents.length === assignments.length && assignments.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stop</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pickup</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Drop</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedStudents.includes(assignment.student)}
                          onChange={() => toggleStudentSelection(assignment.student)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{assignment.student_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.class_name || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.route_name || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.stop_name || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.stop_pickup_time || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.stop_drop_time || '--'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{assignment.vehicle_number || '--'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTransportTypeBadge(assignment.transport_type)}`}>
                          {assignment.transport_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setDeleteConfirm(assignment)}
                          className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                          Remove
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

      {/* New Assignment Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">New Transport Assignment</h2>

            <div className="space-y-4">
              {/* Student Selection */}
              <div>
                <label className="label">Students *</label>

                {/* Selected students chips */}
                {modalSelectedStudents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {modalSelectedStudents.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 border border-primary-200 rounded-full text-xs font-medium text-primary-800"
                      >
                        {s.name}
                        <button
                          onClick={() => removeStudentFromSelection(s.id)}
                          className="text-primary-500 hover:text-primary-700"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setModalSelectedStudents([])}
                      className="text-xs text-gray-500 hover:text-red-600 px-1"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Class filter + search */}
                <div className="flex gap-2 mb-2">
                  <ClassSelector
                    className="input w-1/3 text-sm"
                    value={modalClassFilter}
                    onChange={(e) => setModalClassFilter(e.target.value)}
                    showAllOption
                    allOptionLabel="All Classes"
                  />
                  <input
                    type="text"
                    className="input flex-1 text-sm"
                    placeholder="Search by name or roll no..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />
                </div>

                {/* Student list */}
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                  {filteredStudents.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-3">
                      {allStudents.length === 0 ? 'No students in current session' : 'No matching students'}
                    </p>
                  ) : (
                    <>
                      {(modalClassFilter || studentSearch.trim()) && filteredStudents.length > 1 && (
                        <button
                          onClick={addAllFilteredStudents}
                          className="w-full text-left px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 text-xs font-medium text-primary-600"
                        >
                          + Add all {filteredStudents.length} shown
                        </button>
                      )}
                      {filteredStudents.map((student) => (
                        <button
                          key={student.id}
                          onClick={() => addStudentToSelection(student)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                        >
                          <span className="text-sm font-medium text-gray-900">{student.name}</span>
                          <span className="text-xs text-gray-500 ml-2">Roll #{student.roll_number} | {student.class_name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {modalSelectedStudents.length} student{modalSelectedStudents.length !== 1 ? 's' : ''} selected
                  {activeAcademicYear && <span> | Session: {activeAcademicYear.name}</span>}
                </p>
              </div>

              {/* Route */}
              <div>
                <label className="label">Route *</label>
                <select
                  className="input"
                  value={assignForm.route}
                  onChange={(e) => setAssignForm({ ...assignForm, route: e.target.value, stop: '', vehicle: '' })}
                >
                  <option value="">-- Select Route --</option>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>{route.name}</option>
                  ))}
                </select>
              </div>

              {/* Stop (filtered by route) */}
              <div>
                <label className="label">Stop</label>
                <select
                  className="input"
                  value={assignForm.stop}
                  onChange={(e) => setAssignForm({ ...assignForm, stop: e.target.value })}
                  disabled={!assignForm.route}
                >
                  <option value="">-- Select Stop --</option>
                  {stops.sort((a, b) => (a.order || 0) - (b.order || 0)).map((stop) => (
                    <option key={stop.id} value={stop.id}>#{stop.order} {stop.name}</option>
                  ))}
                </select>
                {!assignForm.route && <p className="text-xs text-gray-400 mt-1">Select a route first</p>}
              </div>

              {/* Vehicle (filtered by route) */}
              <div>
                <label className="label">Vehicle</label>
                <select
                  className="input"
                  value={assignForm.vehicle}
                  onChange={(e) => setAssignForm({ ...assignForm, vehicle: e.target.value })}
                  disabled={!assignForm.route}
                >
                  <option value="">-- Select Vehicle --</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.vehicle_number} ({vehicle.vehicle_type})
                    </option>
                  ))}
                </select>
                {!assignForm.route && <p className="text-xs text-gray-400 mt-1">Select a route first</p>}
              </div>

              {/* Transport Type */}
              <div>
                <label className="label">Transport Type</label>
                <select
                  className="input"
                  value={assignForm.transport_type}
                  onChange={(e) => setAssignForm({ ...assignForm, transport_type: e.target.value })}
                >
                  {TRANSPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {(createMutation.isError || bulkAssignMutation.isError) && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createMutation.error?.response?.data?.detail ||
                  createMutation.error?.response?.data?.non_field_errors?.[0] ||
                  bulkAssignMutation.error?.response?.data?.detail ||
                  'Failed to create assignment. Please try again.'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || bulkAssignMutation.isPending || modalSelectedStudents.length === 0 || !assignForm.route}
                className="btn btn-primary"
              >
                {(createMutation.isPending || bulkAssignMutation.isPending)
                  ? 'Saving...'
                  : `Assign ${modalSelectedStudents.length || ''} Student${modalSelectedStudents.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Bulk Assign Students</h2>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800">
                Assigning <strong>{selectedStudents.length}</strong> student{selectedStudents.length !== 1 ? 's' : ''} to the same route and stop.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Route *</label>
                <select
                  className="input"
                  value={bulkForm.route}
                  onChange={(e) => setBulkForm({ ...bulkForm, route: e.target.value, stop: '', vehicle: '' })}
                >
                  <option value="">-- Select Route --</option>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>{route.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Stop</label>
                <select
                  className="input"
                  value={bulkForm.stop}
                  onChange={(e) => setBulkForm({ ...bulkForm, stop: e.target.value })}
                  disabled={!bulkForm.route}
                >
                  <option value="">-- Select Stop --</option>
                  {stops.sort((a, b) => (a.order || 0) - (b.order || 0)).map((stop) => (
                    <option key={stop.id} value={stop.id}>#{stop.order} {stop.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Vehicle</label>
                <select
                  className="input"
                  value={bulkForm.vehicle}
                  onChange={(e) => setBulkForm({ ...bulkForm, vehicle: e.target.value })}
                  disabled={!bulkForm.route}
                >
                  <option value="">-- Select Vehicle --</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.vehicle_number} ({vehicle.vehicle_type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Transport Type</label>
                <select
                  className="input"
                  value={bulkForm.transport_type}
                  onChange={(e) => setBulkForm({ ...bulkForm, transport_type: e.target.value })}
                >
                  {TRANSPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {bulkAssignMutation.isError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {bulkAssignMutation.error?.response?.data?.detail || 'Failed to bulk assign. Please try again.'}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeBulkModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleBulkSubmit}
                disabled={bulkAssignMutation.isPending || !bulkForm.route}
                className="btn btn-primary"
              >
                {bulkAssignMutation.isPending ? 'Assigning...' : `Assign ${selectedStudents.length} Students`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Remove Assignment</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove the transport assignment for <strong>{deleteConfirm.student_name}</strong>?
            </p>

            {deleteMutation.isError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {deleteMutation.error?.response?.data?.detail || 'Failed to remove assignment.'}
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
                {deleteMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
