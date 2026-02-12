import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'

const STATUS_OPTIONS = [
  { value: '', label: '-- Select --' },
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'HALF_DAY', label: 'Half Day' },
  { value: 'ON_LEAVE', label: 'On Leave' },
]

const statusColors = {
  PRESENT: 'bg-green-100 text-green-800',
  ABSENT: 'bg-red-100 text-red-800',
  LATE: 'bg-yellow-100 text-yellow-800',
  HALF_DAY: 'bg-orange-100 text-orange-800',
  ON_LEAVE: 'bg-blue-100 text-blue-800',
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

export default function StaffAttendancePage() {
  const queryClient = useQueryClient()
  const today = formatDate(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const [attendanceData, setAttendanceData] = useState({})
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [viewMode, setViewMode] = useState('mark') // 'mark' | 'summary'
  const [summaryRange, setSummaryRange] = useState(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 30)
    return { start: formatDate(start), end: formatDate(end) }
  })

  // Fetch active staff
  const { data: staffRes, isLoading: staffLoading } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })

  // Fetch attendance for selected date
  const { data: attendanceRes, isLoading: attLoading } = useQuery({
    queryKey: ['hrAttendance', selectedDate],
    queryFn: () => hrApi.getStaffAttendance({ date: selectedDate, page_size: 500 }),
  })

  // Fetch summary
  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['hrAttendanceSummary', summaryRange.start, summaryRange.end],
    queryFn: () => hrApi.getAttendanceSummary({ start_date: summaryRange.start, end_date: summaryRange.end }),
    enabled: viewMode === 'summary',
  })

  const staffList = staffRes?.data?.results || staffRes?.data || []
  const existingAttendance = attendanceRes?.data?.results || attendanceRes?.data || []
  const summaryData = summaryRes?.data || []

  // Build map of existing attendance: staff_member_id -> record
  const existingMap = useMemo(() => {
    const map = {}
    existingAttendance.forEach(rec => {
      map[rec.staff_member] = rec
    })
    return map
  }, [existingAttendance])

  // Initialize local attendance state when data changes
  useMemo(() => {
    const data = {}
    staffList.forEach(staff => {
      const existing = existingMap[staff.id]
      data[staff.id] = {
        status: existing?.status || '',
        check_in: existing?.check_in || '',
        check_out: existing?.check_out || '',
        notes: existing?.notes || '',
      }
    })
    setAttendanceData(data)
    setHasChanges(false)
  }, [staffList, existingMap])

  const updateField = (staffId, field, value) => {
    setAttendanceData(prev => ({
      ...prev,
      [staffId]: { ...prev[staffId], [field]: value },
    }))
    setHasChanges(true)
  }

  // Quick mark all unmarked as present
  const markAllPresent = () => {
    setAttendanceData(prev => {
      const updated = { ...prev }
      Object.keys(updated).forEach(id => {
        if (!updated[id].status) {
          updated[id] = { ...updated[id], status: 'PRESENT' }
        }
      })
      return updated
    })
    setHasChanges(true)
  }

  // Bulk save
  const bulkSave = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const records = []
      Object.entries(attendanceData).forEach(([staffId, data]) => {
        if (data.status) {
          records.push({
            staff_member: parseInt(staffId),
            date: selectedDate,
            status: data.status,
            check_in: data.check_in || null,
            check_out: data.check_out || null,
            notes: data.notes || '',
          })
        }
      })
      if (records.length === 0) {
        setSaveMsg('No attendance marked to save.')
        setSaving(false)
        return
      }
      await hrApi.bulkMarkAttendance({ records })
      queryClient.invalidateQueries({ queryKey: ['hrAttendance', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      setSaveMsg(`Saved attendance for ${records.length} staff member(s).`)
      setHasChanges(false)
    } catch (err) {
      setSaveMsg(err.response?.data?.detail || err.response?.data?.error || 'Failed to save attendance.')
    }
    setSaving(false)
  }

  // Navigate date
  const changeDate = (delta) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(formatDate(d))
  }

  // Summary stats for current date
  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0, unmarked: 0 }
    Object.values(attendanceData).forEach(d => {
      if (d.status && c[d.status] !== undefined) c[d.status]++
      else c.unmarked++
    })
    return c
  }, [attendanceData])

  const isLoading = staffLoading || attLoading

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Staff Attendance</h1>
          <p className="text-sm text-gray-600">Mark daily attendance for staff members</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('mark')}
            className={`px-3 py-1.5 text-sm rounded-lg ${viewMode === 'mark' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Daily Mark
          </button>
          <button
            onClick={() => setViewMode('summary')}
            className={`px-3 py-1.5 text-sm rounded-lg ${viewMode === 'summary' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Summary
          </button>
        </div>
      </div>

      {viewMode === 'mark' ? (
        <>
          {/* Date Navigation */}
          <div className="card mb-4 flex flex-col sm:flex-row items-center gap-3">
            <button onClick={() => changeDate(-1)} className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">
              &larr; Prev
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="input text-center w-44"
            />
            <button onClick={() => changeDate(1)} className="px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">
              Next &rarr;
            </button>
            <span className="text-sm text-gray-500 ml-2">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>

          {/* Summary Bar */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {[
              { label: 'Present', count: counts.PRESENT, cls: 'text-green-700 bg-green-50' },
              { label: 'Absent', count: counts.ABSENT, cls: 'text-red-700 bg-red-50' },
              { label: 'Late', count: counts.LATE, cls: 'text-yellow-700 bg-yellow-50' },
              { label: 'Half Day', count: counts.HALF_DAY, cls: 'text-orange-700 bg-orange-50' },
              { label: 'On Leave', count: counts.ON_LEAVE, cls: 'text-blue-700 bg-blue-50' },
              { label: 'Unmarked', count: counts.unmarked, cls: 'text-gray-700 bg-gray-50' },
            ].map(s => (
              <div key={s.label} className={`rounded-lg p-2 text-center ${s.cls}`}>
                <p className="text-lg font-bold">{s.count}</p>
                <p className="text-xs">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button onClick={markAllPresent} className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200">
              Mark All Present
            </button>
            <button
              onClick={bulkSave}
              disabled={saving || !hasChanges}
              className="px-4 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save All'}
            </button>
            {saveMsg && (
              <span className={`text-sm ${saveMsg.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
                {saveMsg}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : staffList.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No active staff members found.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Staff Member</th>
                      <th className="px-4 py-3 text-left">Employee ID</th>
                      <th className="px-4 py-3 text-left">Department</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-3 py-3 text-left">Check In</th>
                      <th className="px-3 py-3 text-left">Check Out</th>
                      <th className="px-3 py-3 text-left">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {staffList.map(staff => {
                      const data = attendanceData[staff.id] || {}
                      return (
                        <tr key={staff.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-medium text-gray-900">{staff.full_name}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{staff.employee_id}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{staff.department_name || '-'}</td>
                          <td className="px-4 py-2">
                            <select
                              value={data.status || ''}
                              onChange={e => updateField(staff.id, 'status', e.target.value)}
                              className={`input text-sm py-1 ${data.status ? statusColors[data.status] || '' : ''}`}
                            >
                              {STATUS_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              value={data.check_in || ''}
                              onChange={e => updateField(staff.id, 'check_in', e.target.value)}
                              className="input text-sm py-1 w-28"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              value={data.check_out || ''}
                              onChange={e => updateField(staff.id, 'check_out', e.target.value)}
                              className="input text-sm py-1 w-28"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={data.notes || ''}
                              onChange={e => updateField(staff.id, 'notes', e.target.value)}
                              className="input text-sm py-1 w-32"
                              placeholder="Notes..."
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {staffList.map(staff => {
                  const data = attendanceData[staff.id] || {}
                  return (
                    <div key={staff.id} className="card">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{staff.full_name}</p>
                          <p className="text-xs text-gray-500">{staff.employee_id} {staff.department_name ? `| ${staff.department_name}` : ''}</p>
                        </div>
                        {data.status && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[data.status] || 'bg-gray-100 text-gray-800'}`}>
                            {data.status}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Status</label>
                          <select
                            value={data.status || ''}
                            onChange={e => updateField(staff.id, 'status', e.target.value)}
                            className="input text-sm py-1 w-full"
                          >
                            {STATUS_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Notes</label>
                          <input
                            type="text"
                            value={data.notes || ''}
                            onChange={e => updateField(staff.id, 'notes', e.target.value)}
                            className="input text-sm py-1 w-full"
                            placeholder="Notes..."
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Check In</label>
                          <input
                            type="time"
                            value={data.check_in || ''}
                            onChange={e => updateField(staff.id, 'check_in', e.target.value)}
                            className="input text-sm py-1 w-full"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Check Out</label>
                          <input
                            type="time"
                            value={data.check_out || ''}
                            onChange={e => updateField(staff.id, 'check_out', e.target.value)}
                            className="input text-sm py-1 w-full"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      ) : (
        /* Summary View */
        <>
          <div className="card mb-4 flex flex-col sm:flex-row items-center gap-3">
            <label className="text-sm text-gray-600">From:</label>
            <input
              type="date"
              value={summaryRange.start}
              onChange={e => setSummaryRange(p => ({ ...p, start: e.target.value }))}
              className="input w-40"
            />
            <label className="text-sm text-gray-600">To:</label>
            <input
              type="date"
              value={summaryRange.end}
              onChange={e => setSummaryRange(p => ({ ...p, end: e.target.value }))}
              className="input w-40"
            />
          </div>

          {summaryLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : summaryData.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No attendance data for this period.</div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Staff Member</th>
                      <th className="px-4 py-3 text-center">Present</th>
                      <th className="px-4 py-3 text-center">Absent</th>
                      <th className="px-4 py-3 text-center">Late</th>
                      <th className="px-4 py-3 text-center">Half Day</th>
                      <th className="px-4 py-3 text-center">On Leave</th>
                      <th className="px-4 py-3 text-center">Total Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summaryData.map((row, i) => {
                      const total = (row.PRESENT || 0) + (row.ABSENT || 0) + (row.LATE || 0) + (row.HALF_DAY || 0) + (row.ON_LEAVE || 0)
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-medium text-gray-900">{row.staff_member__full_name || row.staff_name}</td>
                          <td className="px-4 py-2 text-sm text-center text-green-700 font-semibold">{row.PRESENT || 0}</td>
                          <td className="px-4 py-2 text-sm text-center text-red-700 font-semibold">{row.ABSENT || 0}</td>
                          <td className="px-4 py-2 text-sm text-center text-yellow-700 font-semibold">{row.LATE || 0}</td>
                          <td className="px-4 py-2 text-sm text-center text-orange-700 font-semibold">{row.HALF_DAY || 0}</td>
                          <td className="px-4 py-2 text-sm text-center text-blue-700 font-semibold">{row.ON_LEAVE || 0}</td>
                          <td className="px-4 py-2 text-sm text-center font-bold text-gray-900">{total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {summaryData.map((row, i) => {
                  const total = (row.PRESENT || 0) + (row.ABSENT || 0) + (row.LATE || 0) + (row.HALF_DAY || 0) + (row.ON_LEAVE || 0)
                  return (
                    <div key={i} className="card">
                      <p className="font-medium text-gray-900 text-sm mb-2">{row.staff_member__full_name || row.staff_name}</p>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-green-50 rounded p-1"><span className="font-bold text-green-700">{row.PRESENT || 0}</span><br />Present</div>
                        <div className="bg-red-50 rounded p-1"><span className="font-bold text-red-700">{row.ABSENT || 0}</span><br />Absent</div>
                        <div className="bg-yellow-50 rounded p-1"><span className="font-bold text-yellow-700">{row.LATE || 0}</span><br />Late</div>
                        <div className="bg-orange-50 rounded p-1"><span className="font-bold text-orange-700">{row.HALF_DAY || 0}</span><br />Half Day</div>
                        <div className="bg-blue-50 rounded p-1"><span className="font-bold text-blue-700">{row.ON_LEAVE || 0}</span><br />On Leave</div>
                        <div className="bg-gray-50 rounded p-1"><span className="font-bold text-gray-900">{total}</span><br />Total</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
