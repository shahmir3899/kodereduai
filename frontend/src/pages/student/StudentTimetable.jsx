import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SLOT_TYPE_STYLES = {
  PERIOD: 'bg-white',
  BREAK: 'bg-yellow-50',
  LUNCH: 'bg-orange-50',
  ASSEMBLY: 'bg-blue-50',
}

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

function getSubjectColor(subjectName, colorMap) {
  if (!subjectName) return 'bg-gray-50 border-gray-200 text-gray-600'
  if (!colorMap[subjectName]) {
    const idx = Object.keys(colorMap).length % SUBJECT_COLORS.length
    colorMap[subjectName] = SUBJECT_COLORS[idx]
  }
  return colorMap[subjectName]
}

function formatTime(time) {
  if (!time) return ''
  const parts = time.split(':')
  if (parts.length < 2) return time
  const h = parseInt(parts[0])
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m} ${ampm}`
}

export default function StudentTimetable() {
  const [mobileDay, setMobileDay] = useState(
    Math.min(Math.max(new Date().getDay() - 1, 0), 5) // Default to today, capped at Sat
  )

  const { data: timetableData, isLoading, error } = useQuery({
    queryKey: ['studentTimetable'],
    queryFn: () => studentPortalApi.getTimetable(),
  })

  const timetable = timetableData?.data
  const slots = timetable?.slots || []
  const entries = timetable?.entries || timetable?.slots || (Array.isArray(timetable) ? timetable : [])

  // Build structured data: { slot_time: { day: entry } }
  const subjectColorMap = {}
  const slotsByTime = {}

  entries.forEach((entry) => {
    const day = entry.day || entry.day_of_week || ''
    const startTime = entry.start_time || entry.slot_start || ''
    const endTime = entry.end_time || entry.slot_end || ''
    const slotType = entry.slot_type || entry.type || 'PERIOD'
    const timeKey = `${startTime}-${endTime}`

    if (!slotsByTime[timeKey]) {
      slotsByTime[timeKey] = { start: startTime, end: endTime, type: slotType, days: {} }
    }
    slotsByTime[timeKey].days[day] = {
      subject: entry.subject_name || entry.subject || '',
      teacher: entry.teacher_name || entry.teacher || '',
      room: entry.room || entry.room_number || '',
      type: slotType,
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
        type: slot.days[day]?.type || slot.type,
        ...slot.days[day],
      }))
  })

  const getSlotTypeBg = (type) => {
    return SLOT_TYPE_STYLES[type] || SLOT_TYPE_STYLES.PERIOD
  }

  const isSpecialSlot = (type) => {
    return ['BREAK', 'LUNCH', 'ASSEMBLY'].includes(type)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load timetable</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Weekly Timetable</h1>
        <p className="text-sm text-gray-500 mt-1">Your class schedule for the week</p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No timetable available</h3>
          <p className="text-sm text-gray-500">The timetable has not been set up for your class yet.</p>
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
                  {sortedSlots.map((slot, idx) => {
                    const slotType = slot.type || 'PERIOD'
                    const isSpecial = isSpecialSlot(slotType)

                    return (
                      <tr key={idx} className={getSlotTypeBg(slotType)}>
                        <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap align-top">
                          <div>{formatTime(slot.start)}</div>
                          <div className="text-gray-400">{formatTime(slot.end)}</div>
                        </td>
                        {DAYS.map((day) => {
                          const entry = slot.days[day]
                          const cellType = entry?.type || slotType

                          if (isSpecial && !entry) {
                            return (
                              <td key={day} className="px-2 py-2">
                                <div className={`h-14 rounded-lg flex items-center justify-center text-xs font-medium text-gray-500 ${
                                  cellType === 'BREAK' ? 'bg-yellow-100 border border-yellow-200' :
                                  cellType === 'LUNCH' ? 'bg-orange-100 border border-orange-200' :
                                  cellType === 'ASSEMBLY' ? 'bg-blue-100 border border-blue-200' :
                                  'bg-gray-50 border border-gray-100'
                                }`}>
                                  {cellType}
                                </div>
                              </td>
                            )
                          }

                          if (!entry) {
                            return (
                              <td key={day} className="px-2 py-2">
                                <div className="h-14 rounded-lg bg-gray-50 border border-gray-100" />
                              </td>
                            )
                          }

                          if (isSpecialSlot(cellType)) {
                            return (
                              <td key={day} className="px-2 py-2">
                                <div className={`h-14 rounded-lg border px-2 py-1.5 flex flex-col justify-center items-center ${
                                  cellType === 'BREAK' ? 'bg-yellow-100 border-yellow-200 text-yellow-800' :
                                  cellType === 'LUNCH' ? 'bg-orange-100 border-orange-200 text-orange-800' :
                                  cellType === 'ASSEMBLY' ? 'bg-blue-100 border-blue-200 text-blue-800' :
                                  'bg-gray-100 border-gray-200 text-gray-600'
                                }`}>
                                  <p className="text-xs font-semibold">{cellType}</p>
                                </div>
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
                                {entry.room && (
                                  <p className="text-[10px] opacity-60 truncate">{entry.room}</p>
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
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
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {DAYS_SHORT[idx]}
                </button>
              ))}
            </div>

            {/* Day Schedule */}
            <div className="space-y-2">
              {entriesByDay[DAYS[mobileDay]]?.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-500">No classes scheduled for {DAYS[mobileDay]}</p>
                </div>
              ) : (
                entriesByDay[DAYS[mobileDay]]?.map((entry, idx) => {
                  const entryType = entry.type || 'PERIOD'

                  if (isSpecialSlot(entryType)) {
                    return (
                      <div
                        key={idx}
                        className={`rounded-xl border p-4 text-center ${
                          entryType === 'BREAK' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                          entryType === 'LUNCH' ? 'bg-orange-50 border-orange-200 text-orange-800' :
                          entryType === 'ASSEMBLY' ? 'bg-blue-50 border-blue-200 text-blue-800' :
                          'bg-gray-50 border-gray-200 text-gray-600'
                        }`}
                      >
                        <p className="text-sm font-semibold">{entryType}</p>
                        <p className="text-xs opacity-75 mt-1">
                          {formatTime(entry.start)} - {formatTime(entry.end)}
                        </p>
                      </div>
                    )
                  }

                  return (
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
                      <div className="flex items-center gap-3 mt-1">
                        {entry.teacher && (
                          <p className="text-xs opacity-75">
                            <svg className="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            {entry.teacher}
                          </p>
                        )}
                        {entry.room && (
                          <p className="text-xs opacity-75">
                            <svg className="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            {entry.room}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Slot Type Legend */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Legend</h3>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-gray-200 bg-white" />
                <span className="text-xs text-gray-600">Period</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-yellow-200 bg-yellow-50" />
                <span className="text-xs text-gray-600">Break</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-orange-200 bg-orange-50" />
                <span className="text-xs text-gray-600">Lunch</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border border-blue-200 bg-blue-50" />
                <span className="text-xs text-gray-600">Assembly</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
