import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { academicsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' }
const DAY_LABELS_FULL = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' }

const isSlotApplicable = (slot, day) => {
  if (!slot?.applicable_days?.length) return true
  return slot.applicable_days.includes(day)
}

export default function TeacherTimetablePage() {
  const { activeAcademicYear } = useAcademicYear()
  const [expandedDay, setExpandedDay] = useState('MON')

  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ['teacherTimetableSlots'],
    queryFn: () => academicsApi.getTimetableSlots({ page_size: 9999 }),
  })

  const { data: timetableRes, isLoading: timetableLoading } = useQuery({
    queryKey: ['teacherWeeklyTimetable', activeAcademicYear?.id],
    queryFn: () => academicsApi.getMyTimetable({
      ...(activeAcademicYear?.id ? { academic_year: activeAcademicYear.id } : {}),
    }),
  })

  const slots = slotsData?.data?.results || slotsData?.data || []
  const entries = timetableRes?.data || []
  const isLoading = slotsLoading || timetableLoading

  const grid = useMemo(() => {
    const mapped = {}
    entries.forEach((entry) => {
      const key = `${entry.day}-${entry.slot}`
      mapped[key] = entry
    })
    return mapped
  }, [entries])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Timetable</h1>
        <p className="text-sm text-gray-600">Your weekly timetable by class and subject</p>
      </div>

      {!activeAcademicYear?.id && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          Select an academic year from the top switcher to scope your timetable.
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : slots.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No timetable slots configured yet.
        </div>
      ) : (
        <>
          {/* Desktop Grid */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full border-collapse bg-white rounded-xl shadow-sm">
              <thead>
                <tr>
                  <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-36">
                    Time
                  </th>
                  {DAYS.map(day => (
                    <th key={day} className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                      {DAY_LABELS[day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr key={slot.id}>
                    <td className="border border-gray-200 px-3 py-2 bg-gray-50">
                      <div className="text-sm font-medium text-gray-700">{slot.name}</div>
                      <div className="text-xs text-gray-400">
                        {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                      </div>
                    </td>
                    {DAYS.map(day => {
                      const key = `${day}-${slot.id}`
                      const entry = grid[key]
                      const notApplicable = !isSlotApplicable(slot, day)
                      const isBreak = slot.slot_type !== 'PERIOD'
                      return (
                        <td
                          key={key}
                          className={`border border-gray-200 px-2 py-2 text-center ${
                            notApplicable ? 'bg-gray-50' : isBreak ? 'bg-gray-100 text-gray-400' : ''
                          }`}
                        >
                          {notApplicable ? (
                            <span className="text-gray-200 text-xs">&mdash;</span>
                          ) : isBreak ? (
                            <span className="text-xs italic">{slot.name}</span>
                          ) : entry ? (
                            <div>
                              <div className="text-xs font-semibold text-gray-800">{entry.class_name}</div>
                              <div className="text-xs text-gray-600">{entry.subject_code || entry.subject_name}</div>
                              {entry.room && <div className="text-xs text-gray-400">{entry.room}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">Free</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Day Accordion */}
          <div className="lg:hidden space-y-3">
            {DAYS.map(day => (
              <div key={day} className="card">
                <button
                  onClick={() => setExpandedDay(expandedDay === day ? '' : day)}
                  className="w-full flex items-center justify-between"
                >
                  <span className="font-semibold text-gray-900 text-sm">{DAY_LABELS_FULL[day]}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedDay === day ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {expandedDay === day && (
                  <div className="mt-3 space-y-2">
                    {slots.map(slot => {
                      const key = `${day}-${slot.id}`
                      const entry = grid[key]
                      const notApplicable = !isSlotApplicable(slot, day)
                      const isBreak = slot.slot_type !== 'PERIOD'
                      return (
                        <div
                          key={slot.id}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            notApplicable ? 'bg-gray-50 opacity-40' : isBreak ? 'bg-gray-100' : 'bg-gray-50'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-medium text-gray-700">{slot.name}</div>
                            <div className="text-xs text-gray-400">{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</div>
                          </div>
                          {notApplicable ? (
                            <span className="text-xs text-gray-300 italic">N/A</span>
                          ) : isBreak ? (
                            <span className="text-xs text-gray-400 italic">{slot.slot_type_display}</span>
                          ) : entry ? (
                            <div className="text-right">
                              <div className="text-xs font-semibold text-gray-800">{entry.class_name}</div>
                              <div className="text-xs text-gray-600">{entry.subject_code || entry.subject_name}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">Free</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
