import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transportApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

const BOARDING_STATUSES = [
  { value: 'BOARDED', label: 'Boarded', color: 'bg-green-100 text-green-800 border-green-300', activeColor: 'bg-green-500 text-white' },
  { value: 'NOT_BOARDED', label: 'Not Boarded', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', activeColor: 'bg-yellow-500 text-white' },
  { value: 'ABSENT', label: 'Absent', color: 'bg-red-100 text-red-800 border-red-300', activeColor: 'bg-red-500 text-white' },
]

export default function TransportAttendancePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedRoute, setSelectedRoute] = useState('')
  const [attendanceMap, setAttendanceMap] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Fetch routes
  const { data: routesData } = useQuery({
    queryKey: ['transport-routes'],
    queryFn: () => transportApi.getRoutes(),
  })

  // Fetch assignments for selected route
  const { data: assignmentsData, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['transport-assignments', selectedRoute],
    queryFn: () => transportApi.getAssignments({ route: selectedRoute }),
    enabled: !!selectedRoute,
  })

  // Fetch existing attendance for selected date + route
  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ['transport-attendance', selectedRoute, selectedDate],
    queryFn: () => transportApi.getAttendance({ route: selectedRoute, date: selectedDate }),
    enabled: !!selectedRoute && !!selectedDate,
    onSuccess: (data) => {
      // Pre-populate attendanceMap from existing records
      const records = data?.data?.results || data?.data || []
      const map = {}
      records.forEach((record) => {
        map[record.student] = record.status || record.boarding_status || 'BOARDED'
      })
      setAttendanceMap(map)
    },
  })

  // Bulk mark mutation
  const bulkMarkMutation = useMutation({
    mutationFn: (data) => transportApi.bulkMarkAttendance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-attendance', selectedRoute, selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['transport-dashboard'] })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
  })

  const routes = routesData?.data?.results || routesData?.data || []
  const assignments = assignmentsData?.data?.results || assignmentsData?.data || []
  const existingAttendance = attendanceData?.data?.results || attendanceData?.data || []

  // Build the merged attendance map on data load
  useMemo(() => {
    if (existingAttendance.length > 0) {
      const map = {}
      existingAttendance.forEach((record) => {
        map[record.student] = record.status || record.boarding_status || 'BOARDED'
      })
      setAttendanceMap(map)
    } else if (selectedRoute) {
      // Reset when no existing records
      setAttendanceMap({})
    }
  }, [existingAttendance, selectedRoute, selectedDate])

  const isLoading = assignmentsLoading || attendanceLoading

  const handleStatusChange = (studentId, status) => {
    setAttendanceMap((prev) => ({
      ...prev,
      [studentId]: status,
    }))
    setSaveSuccess(false)
  }

  const handleSaveAll = async () => {
    if (assignments.length === 0 || !selectedRoute || !selectedDate) return

    setIsSaving(true)
    setSaveSuccess(false)

    const records = assignments.map((assignment) => ({
      student: assignment.student,
      route: parseInt(selectedRoute),
      date: selectedDate,
      status: attendanceMap[assignment.student] || 'BOARDED',
    }))

    try {
      await bulkMarkMutation.mutateAsync({
        date: selectedDate,
        route: parseInt(selectedRoute),
        records,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRouteChange = (routeId) => {
    setSelectedRoute(routeId)
    setAttendanceMap({})
    setSaveSuccess(false)
  }

  const handleDateChange = (date) => {
    setSelectedDate(date)
    setAttendanceMap({})
    setSaveSuccess(false)
  }

  // Summary stats
  const summaryStats = useMemo(() => {
    const total = assignments.length
    let boarded = 0
    let notBoarded = 0
    let absent = 0

    assignments.forEach((assignment) => {
      const status = attendanceMap[assignment.student]
      if (status === 'BOARDED') boarded++
      else if (status === 'NOT_BOARDED') notBoarded++
      else if (status === 'ABSENT') absent++
    })

    // Count unmarked as separate
    const unmarked = total - boarded - notBoarded - absent

    return { total, boarded, notBoarded, absent, unmarked }
  }, [assignments, attendanceMap])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Transport Attendance</h1>
        <p className="text-sm sm:text-base text-gray-600">Mark daily transport boarding attendance</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Route</label>
            <select
              className="input"
              value={selectedRoute}
              onChange={(e) => handleRouteChange(e.target.value)}
            >
              <option value="">-- Select Route --</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>{route.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!selectedRoute ? (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="text-gray-500">Select a date and route to mark transport attendance.</p>
        </div>
      ) : isLoading ? (
        <div className="card text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading students...</p>
        </div>
      ) : assignments.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <p className="text-gray-500 mb-2">No students assigned to this route</p>
          <p className="text-sm text-gray-400">Assign students to this route first from the Assignments page.</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="card !p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Total Students</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{summaryStats.total}</p>
            </div>
            <div className="card !p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Boarded</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{summaryStats.boarded}</p>
            </div>
            <div className="card !p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Not Boarded</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{summaryStats.notBoarded}</p>
            </div>
            <div className="card !p-4">
              <p className="text-xs font-medium text-gray-500 uppercase">Absent</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{summaryStats.absent}</p>
            </div>
          </div>

          {/* Attendance List */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Mark Attendance
                {summaryStats.unmarked > 0 && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    ({summaryStats.unmarked} unmarked)
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3">
                {saveSuccess && (
                  <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Saved!
                  </span>
                )}
                <button
                  onClick={handleSaveAll}
                  disabled={isSaving || bulkMarkMutation.isPending}
                  className="btn btn-primary"
                >
                  {isSaving || bulkMarkMutation.isPending ? 'Saving...' : 'Save All'}
                </button>
              </div>
            </div>

            {bulkMarkMutation.isError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {bulkMarkMutation.error?.response?.data?.detail || 'Failed to save attendance. Please try again.'}
              </div>
            )}

            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {assignments.map((assignment) => {
                const currentStatus = attendanceMap[assignment.student]
                return (
                  <div key={assignment.id} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{assignment.student_name}</p>
                        <p className="text-xs text-gray-500">
                          {assignment.class_name || '--'} | Stop: {assignment.stop_name || '--'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {BOARDING_STATUSES.map((status) => (
                        <button
                          key={status.value}
                          onClick={() => handleStatusChange(assignment.student, status.value)}
                          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-colors ${
                            currentStatus === status.value
                              ? status.activeColor
                              : status.color
                          }`}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stop</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Boarding Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {assignments.map((assignment) => {
                    const currentStatus = attendanceMap[assignment.student]
                    return (
                      <tr key={assignment.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{assignment.student_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{assignment.class_name || '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{assignment.stop_name || '--'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{assignment.vehicle_number || '--'}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-2">
                            {BOARDING_STATUSES.map((status) => (
                              <button
                                key={status.value}
                                onClick={() => handleStatusChange(assignment.student, status.value)}
                                className={`py-1 px-3 rounded-lg text-xs font-medium border transition-colors ${
                                  currentStatus === status.value
                                    ? status.activeColor
                                    : status.color
                                }`}
                              >
                                {status.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Save button for long lists */}
            {assignments.length > 10 && (
              <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-3">
                  {saveSuccess && (
                    <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved!
                    </span>
                  )}
                  <button
                    onClick={handleSaveAll}
                    disabled={isSaving || bulkMarkMutation.isPending}
                    className="btn btn-primary"
                  >
                    {isSaving || bulkMarkMutation.isPending ? 'Saving...' : 'Save All'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
