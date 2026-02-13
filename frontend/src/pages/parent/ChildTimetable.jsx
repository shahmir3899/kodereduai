import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SUBJECT_COLORS = [
  'bg-blue-50 border-blue-200 text-blue-800',
  'bg-green-50 border-green-200 text-green-800',
  'bg-purple-50 border-purple-200 text-purple-800',
  'bg-amber-50 border-amber-200 text-amber-800',
  'bg-rose-50 border-rose-200 text-rose-800',
  'bg-cyan-50 border-cyan-200 text-cyan-800',
  'bg-indigo-50 border-indigo-200 text-indigo-800',
  'bg-teal-50 border-teal-200 text-teal-800',
  'bg-orange-50 border-orange-200 text-orange-800',
  'bg-pink-50 border-pink-200 text-pink-800',
  'bg-lime-50 border-lime-200 text-lime-800',
  'bg-sky-50 border-sky-200 text-sky-800',
]

function getSubjectColor(subjectName, subjectColorMap) {
  if (!subjectName) return 'bg-gray-50 border-gray-200 text-gray-600'
  if (!subjectColorMap[subjectName]) {
    const idx = Object.keys(subjectColorMap).length % SUBJECT_COLORS.length
    subjectColorMap[subjectName] = SUBJECT_COLORS[idx]
  }
  return subjectColorMap[subjectName]
}

export default function ChildTimetable() {
  const { studentId } = useParams()
  const [mobileDay, setMobileDay] = useState(
    Math.min(new Date().getDay() - 1, 5)  // Default to today (capped at Sat)
  )

  const { data: timetableData, isLoading } = useQuery({
    queryKey: ['childTimetable', studentId],
    queryFn: () => parentsApi.getChildTimetable(studentId),
    enabled: !!studentId,
  })

  const timetable = timetableData?.data
  const entries = timetable?.entries || timetable?.slots || (Array.isArray(timetable) ? timetable : [])

  // Build structured data: { slot_time: { day: entry } }
  const subjectColorMap = {}
  const slotsByTime = {}
  const allSlotTimes = new Set()

  entries.forEach((entry) => {
    const day = entry.day || entry.day_of_week || ''
    const startTime = entry.start_time || entry.slot_start || ''
    const endTime = entry.end_time || entry.slot_end || ''
    const timeKey = `${startTime}-${endTime}`

    allSlotTimes.add(timeKey)

    if (!slotsByTime[timeKey]) {
      slotsByTime[timeKey] = { start: startTime, end: endTime, days: {} }
    }
    slotsByTime[timeKey].days[day] = {
      subject: entry.subject_name || entry.subject || '',
      teacher: entry.teacher_name || entry.teacher || '',
    }

    // Pre-build color map
    if (entry.subject_name || entry.subject) {
      getSubjectColor(entry.subject_name || entry.subject, subjectColorMap)
    }
  })

  // Sort slots by start time
  const sortedSlots = Object.values(slotsByTime).sort((a, b) => {
    return a.start.localeCompare(b.start)
  })

  // For mobile: organize by day
  const entriesByDay = {}
  DAYS.forEach((day) => {
    entriesByDay[day] = sortedSlots
      .filter((slot) => slot.days[day])
      .map((slot) => ({
        start: slot.start,
        end: slot.end,
        ...slot.days[day],
      }))
  })

  const formatTime = (time) => {
    if (!time) return ''
    const parts = time.split(':')
    if (parts.length < 2) return time
    const h = parseInt(parts[0])
    const m = parts[1]
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m} ${ampm}`
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Overview
        </Link>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    )
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
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Class Timetable</h1>
        <p className="text-sm text-gray-500 mt-1">Weekly class schedule</p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No timetable available</h3>
          <p className="text-sm text-gray-500">The timetable has not been set up for this class yet.</p>
        </div>
      ) : (
        <>
          {/* Desktop Grid View */}
          <div className="hidden lg:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Time</th>
                    {DAYS.map((day) => (
                      <th key={day} className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedSlots.map((slot, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap align-top">
                        <div>{formatTime(slot.start)}</div>
                        <div className="text-gray-400">{formatTime(slot.end)}</div>
                      </td>
                      {DAYS.map((day) => {
                        const entry = slot.days[day]
                        if (!entry) {
                          return (
                            <td key={day} className="px-2 py-2">
                              <div className="h-14 rounded-lg bg-gray-50 border border-gray-100" />
                            </td>
                          )
                        }
                        return (
                          <td key={day} className="px-2 py-2">
                            <div className={`h-14 rounded-lg border px-2 py-1.5 flex flex-col justify-center ${getSubjectColor(entry.subject, subjectColorMap)}`}>
                              <p className="text-xs font-semibold truncate">{entry.subject}</p>
                              {entry.teacher && (
                                <p className="text-[10px] opacity-75 truncate mt-0.5">{entry.teacher}</p>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-4">
            {/* Day Selector */}
            <div className="flex gap-1 overflow-x-auto pb-1">
              {DAYS.map((day, idx) => (
                <button
                  key={day}
                  onClick={() => setMobileDay(idx)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    mobileDay === idx
                      ? 'bg-primary-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {DAYS_SHORT[idx]}
                </button>
              ))}
            </div>

            {/* Day Schedule */}
            <div className="space-y-2">
              {entriesByDay[DAYS[mobileDay < 0 ? 0 : mobileDay]]?.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-500">No classes scheduled for {DAYS[mobileDay < 0 ? 0 : mobileDay]}</p>
                </div>
              ) : (
                entriesByDay[DAYS[mobileDay < 0 ? 0 : mobileDay]]?.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-4 ${getSubjectColor(entry.subject, subjectColorMap)}`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{entry.subject}</h3>
                      <span className="text-xs opacity-75">
                        {formatTime(entry.start)} - {formatTime(entry.end)}
                      </span>
                    </div>
                    {entry.teacher && (
                      <p className="text-xs opacity-75 mt-1">
                        <svg className="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {entry.teacher}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Subject Legend */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Subject Legend</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(subjectColorMap).map(([subject, colorClass]) => (
                <span key={subject} className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${colorClass}`}>
                  {subject}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
