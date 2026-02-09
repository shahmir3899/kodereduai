import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi, classesApi, studentsApi } from '../services/api'

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function formatMonth(year, month) {
  return new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

export default function AttendanceRecordsPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [classId, setClassId] = useState('')

  const daysInMonth = getDaysInMonth(year, month)
  const dateFrom = `${year}-${pad(month + 1)}-01`
  const dateTo = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  // Fetch classes
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
  })
  const classes = classesData?.data?.results || classesData?.data || []

  // Fetch all enrolled students for the selected class (from DB)
  const { data: studentsData } = useQuery({
    queryKey: ['students', classId],
    queryFn: () => studentsApi.getStudents({ class_id: classId, page_size: 500 }),
    enabled: !!classId,
  })
  const enrolledStudents = studentsData?.data?.results || studentsData?.data || []

  // Fetch attendance records for the month + class (page_size large enough for full month)
  const { data: recordsData, isLoading, error } = useQuery({
    queryKey: ['attendanceRecords', dateFrom, dateTo, classId],
    queryFn: () => {
      const params = { date_from: dateFrom, date_to: dateTo, page_size: 2000 }
      if (classId) params.class_id = classId
      return attendanceApi.getRecords(params)
    },
    enabled: !!classId,
  })

  const records = recordsData?.data?.results || recordsData?.data || []

  // Build register: start from enrolled students, overlay attendance records
  const { students, datesWithData, summary } = useMemo(() => {
    // Build attendance lookup: { studentId: { dayNum: status } }
    const attendanceMap = {}
    const datesSet = new Set()
    let totalPresent = 0
    let totalAbsent = 0

    for (const r of records) {
      const sid = r.student || r.student_id
      if (!attendanceMap[sid]) attendanceMap[sid] = {}
      const dayNum = parseInt(r.date.split('-')[2], 10)
      attendanceMap[sid][dayNum] = r.status
      datesSet.add(dayNum)
      if (r.status === 'PRESENT') totalPresent++
      if (r.status === 'ABSENT') totalAbsent++
    }

    // Build student rows from enrolled students (DB source of truth)
    const studentRows = enrolledStudents
      .map((s) => ({
        id: s.id,
        name: s.name,
        roll: s.roll_number,
        dates: attendanceMap[s.id] || {},
      }))
      .sort((a, b) => {
        const ra = parseInt(a.roll) || 0
        const rb = parseInt(b.roll) || 0
        return ra - rb
      })

    return {
      students: studentRows,
      datesWithData: [...datesSet].sort((a, b) => a - b),
      summary: {
        totalStudents: studentRows.length,
        totalPresent,
        totalAbsent,
        totalRecords: totalPresent + totalAbsent,
      },
    }
  }, [records, enrolledStudents])

  // Generate all day numbers for the month
  const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // Month navigation
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1) }
    else setMonth(month - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1) }
    else setMonth(month + 1)
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-600">Failed to load attendance records</p>
        <p className="text-sm text-gray-500 mt-2">{error.message}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Attendance Register</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Monthly attendance view — select a class to see the register
        </p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
          {/* Class (required) */}
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="input w-full"
            >
              <option value="">Select Class</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="btn btn-secondary px-2 py-2" title="Previous month">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-900 min-w-[140px] text-center">
              {formatMonth(year, month)}
            </span>
            <button onClick={nextMonth} className="btn btn-secondary px-2 py-2" title="Next month">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {!classId ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">Select a class to view the register</p>
        </div>
      ) : isLoading ? (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading register...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card">
              <p className="text-xs text-gray-500">Students</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{summary.totalStudents}</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Days Recorded</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{datesWithData.length}</p>
            </div>
            <div className="card bg-green-50">
              <p className="text-xs text-gray-500">Present</p>
              <p className="text-xl sm:text-2xl font-bold text-green-600">{summary.totalPresent}</p>
            </div>
            <div className="card bg-red-50">
              <p className="text-xs text-gray-500">Absent</p>
              <p className="text-xl sm:text-2xl font-bold text-red-600">{summary.totalAbsent}</p>
            </div>
          </div>

          {/* Register Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[40px]">
                      Roll
                    </th>
                    <th className="sticky left-[52px] z-10 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[140px]">
                      Name
                    </th>
                    {allDays.map((day) => (
                      <th
                        key={day}
                        className={`px-0 py-2 text-center text-xs font-medium border-b border-gray-200 min-w-[32px] ${
                          datesWithData.includes(day) ? 'text-gray-700' : 'text-gray-300'
                        }`}
                      >
                        {day}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase border-b border-l border-gray-200 min-w-[32px]">
                      P
                    </th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase border-b border-gray-200 min-w-[32px]">
                      A
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => {
                    const pCount = Object.values(student.dates).filter((s) => s === 'PRESENT').length
                    const aCount = Object.values(student.dates).filter((s) => s === 'ABSENT').length

                    return (
                      <tr
                        key={student.id}
                        className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                      >
                        <td className="sticky left-0 z-10 px-3 py-1.5 text-xs text-gray-600 border-r border-gray-200 font-medium"
                            style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>
                          {student.roll}
                        </td>
                        <td className="sticky left-[52px] z-10 px-3 py-1.5 text-xs text-gray-900 border-r border-gray-200 font-medium truncate max-w-[160px]"
                            style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}
                            title={student.name}>
                          {student.name}
                        </td>
                        {allDays.map((day) => {
                          const s = student.dates[day]
                          return (
                            <td key={day} className="px-0 py-1.5 text-center text-xs border-gray-100">
                              {s === 'PRESENT' ? (
                                <span className="text-green-600 font-semibold">P</span>
                              ) : s === 'ABSENT' ? (
                                <span className="text-red-600 font-semibold">A</span>
                              ) : (
                                <span className="text-gray-200">-</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-center text-xs font-bold text-green-700 border-l border-gray-200">
                          {pCount}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs font-bold text-red-700">
                          {aCount}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile fallback: student summary cards */}
          <div className="sm:hidden space-y-3">
            <p className="text-xs text-gray-400 text-center">Scroll the table above horizontally, or view student summaries below</p>
            {students.map((student) => {
              const pCount = Object.values(student.dates).filter((s) => s === 'PRESENT').length
              const aCount = Object.values(student.dates).filter((s) => s === 'ABSENT').length
              return (
                <div key={student.id} className="card py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{student.name}</p>
                      <p className="text-xs text-gray-500">Roll #{student.roll}</p>
                    </div>
                    <div className="flex gap-3 text-sm">
                      <span className="text-green-600 font-semibold">{pCount}P</span>
                      <span className="text-red-600 font-semibold">{aCount}A</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
