import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'

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

function StatusDot({ status }) {
  const map = {
    PRESENT: 'bg-green-500',
    ABSENT: 'bg-red-500',
    LATE: 'bg-yellow-500',
    HOLIDAY: 'bg-gray-300',
    WEEKEND: 'bg-gray-200',
  }
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${map[status] || 'bg-gray-200'}`} />
  )
}

export default function ChildAttendance() {
  const { studentId } = useParams()
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  const { data: attendanceData, isLoading } = useQuery({
    queryKey: ['childAttendance', studentId, selectedMonth, selectedYear],
    queryFn: () => parentsApi.getChildAttendance(studentId, { month: selectedMonth, year: selectedYear }),
    enabled: !!studentId,
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

  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12)
      setSelectedYear(selectedYear - 1)
    } else {
      setSelectedMonth(selectedMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1)
      setSelectedYear(selectedYear + 1)
    } else {
      setSelectedMonth(selectedMonth + 1)
    }
  }

  const isWeekend = (day) => {
    if (!day) return false
    const date = new Date(selectedYear, selectedMonth - 1, day)
    const dow = date.getDay()
    return dow === 0 // Sunday
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

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Overview
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Attendance Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">Monthly attendance view</p>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
        <button
          onClick={goToPrevMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold text-gray-900">
          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
        </h2>
        <button
          onClick={goToNextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
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
                      <span className="mt-0.5 hidden sm:block">
                        <StatusDot status={dayStatusMap[day]} />
                      </span>
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
              <span className="text-xs text-gray-600">Weekend / Holiday</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
