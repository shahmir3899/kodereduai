import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const daysInMonth = lastDay.getDate()

  // getDay() returns 0=Sun ... 6=Sat; we want Mon=0 ... Sun=6
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const days = []

  // Padding for days before the 1st
  for (let i = 0; i < startDow; i++) {
    days.push(null)
  }

  for (let d = 1; d <= daysInMonth; d++) {
    days.push(d)
  }

  return days
}

export default function StudentAttendance() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  const { data: attendanceData, isLoading, error } = useQuery({
    queryKey: ['studentAttendance', selectedMonth, selectedYear],
    queryFn: () => studentPortalApi.getAttendance({ month: selectedMonth, year: selectedYear }),
  })

  const attendance = attendanceData?.data
  const records = attendance?.records || attendance?.days || []
  const summary = attendance?.summary || attendance || {}

  // Build a map of day -> status
  const dayStatusMap = {}
  if (Array.isArray(records)) {
    records.forEach((r) => {
      const day = r.day || (r.date ? new Date(r.date).getDate() : null)
      if (day) {
        dayStatusMap[day] = r.status || r.attendance_status || 'PRESENT'
      }
    })
  }

  const calendarDays = getCalendarDays(selectedYear, selectedMonth)

  const presentCount = summary.present_count ?? summary.present ?? Object.values(dayStatusMap).filter(s => s === 'PRESENT').length
  const absentCount = summary.absent_count ?? summary.absent ?? Object.values(dayStatusMap).filter(s => s === 'ABSENT').length
  const lateCount = summary.late_count ?? summary.late ?? Object.values(dayStatusMap).filter(s => s === 'LATE').length
  const totalDays = summary.total_days ?? ((presentCount + absentCount + lateCount) || 0)
  const attendanceRate = totalDays > 0 ? Math.round(((presentCount + lateCount) / totalDays) * 100) : 0

  // Year options
  const currentYear = now.getFullYear()
  const yearOptions = []
  for (let y = currentYear; y >= currentYear - 3; y--) {
    yearOptions.push(y)
  }

  const isWeekend = (day) => {
    if (!day) return false
    const date = new Date(selectedYear, selectedMonth - 1, day)
    return date.getDay() === 0 // Sunday
  }

  const getDayColor = (day) => {
    if (!day) return ''
    const status = dayStatusMap[day]
    if (status === 'PRESENT') return 'bg-green-100 text-green-800 border-green-200'
    if (status === 'ABSENT') return 'bg-red-100 text-red-800 border-red-200'
    if (status === 'LATE') return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    if (status === 'HOLIDAY') return 'bg-gray-100 text-gray-500 border-gray-200'
    if (isWeekend(day)) return 'bg-gray-50 text-gray-400 border-gray-100'
    return 'bg-white text-gray-700 border-gray-200'
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load attendance</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Attendance</h1>
          <p className="text-sm text-gray-500 mt-1">Monthly attendance calendar view</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={idx} value={idx + 1}>{name}</option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
          <p className="text-xs text-green-600 font-medium">Present</p>
          <p className="text-xl font-bold text-green-700 mt-1">{presentCount}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 font-medium">Absent</p>
          <p className="text-xl font-bold text-red-700 mt-1">{absentCount}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
          <p className="text-xs text-yellow-600 font-medium">Late</p>
          <p className="text-xl font-bold text-yellow-700 mt-1">{lateCount}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
          <p className="text-xs text-blue-600 font-medium">Attendance Rate</p>
          <p className={`text-xl font-bold mt-1 ${
            attendanceRate >= 75 ? 'text-green-700' :
            attendanceRate >= 60 ? 'text-yellow-700' : 'text-red-700'
          }`}>
            {attendanceRate}%
          </p>
        </div>
      </div>

      {/* Calendar */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          {/* Month Title */}
          <h2 className="text-center text-lg font-semibold text-gray-900 mb-4">
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </h2>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
            {DAY_LABELS.map((label) => (
              <div key={label} className="text-center text-xs font-medium text-gray-500 py-2">
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{label.charAt(0)}</span>
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {calendarDays.map((day, idx) => (
              <div
                key={idx}
                className={`aspect-square flex flex-col items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                  day ? getDayColor(day) : 'border-transparent'
                }`}
              >
                {day && (
                  <>
                    <span className="text-sm sm:text-base">{day}</span>
                    {dayStatusMap[day] && (
                      <span className={`mt-0.5 hidden sm:block w-2 h-2 rounded-full ${
                        dayStatusMap[day] === 'PRESENT' ? 'bg-green-500' :
                        dayStatusMap[day] === 'ABSENT' ? 'bg-red-500' :
                        dayStatusMap[day] === 'LATE' ? 'bg-yellow-500' :
                        'bg-gray-300'
                      }`} />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-500" />
              <span className="text-xs text-gray-600">Present</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-500" />
              <span className="text-xs text-gray-600">Absent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-yellow-500" />
              <span className="text-xs text-gray-600">Late</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-gray-300" />
              <span className="text-xs text-gray-600">No Record</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
