import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi, sessionsApi, studentsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import ClassSelector from '../components/ClassSelector'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import useTeacherScopedClasses from '../hooks/useTeacherScopedClasses'
import Spinner from '../components/ui/Spinner'
import { awayDaysInMonth } from '../utils/awayPeriods'

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function formatMonth(year, month) {
  return new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function formatShortDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Day-of-month on which a student's "left" band starts in this month:
// 1 when they had left before the month began, null when they hadn't left
// by its end (or never).
// (A re-admitted student's closed away periods are shaded separately, day by day.)
function leftFromDay(leftDate, year, month, daysInMonth) {
  if (!leftDate) return null
  const [ly, lm, ld] = leftDate.split('-').map(Number)
  const monthIndex = year * 12 + month
  const leftIndex = ly * 12 + (lm - 1)
  if (leftIndex < monthIndex) return 1
  if (leftIndex > monthIndex) return null
  return ld <= daysInMonth ? ld : null
}

export default function AttendanceRecordsPage() {
  const { activeAcademicYear } = useAcademicYear()
  const { isPrincipal, isManager, isTeacher, isSchoolAdmin } = useAuth()
  const { showSuccess, showError } = useToast()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [classId, setClassId] = useState('')
  const [downloading, setDownloading] = useState(false)

  const daysInMonth = getDaysInMonth(year, month)
  const dateFrom = `${year}-${pad(month + 1)}-01`
  const dateTo = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: classId,
    setSelectedClass: setClassId,
    autoSelectFirst: true,
    queryKey: 'teacherAttendanceRegisterClasses',
  })

  // Fetch all enrolled students for the selected class (from DB).
  // as_of_year/as_of_month: month-precision opt-in, so a withdrawn/transferred
  // student still shows for their departure month and earlier, not just past
  // students dropped whole-year the moment they leave.
  const { data: studentsData } = useQuery({
    queryKey: ['students', classId, activeAcademicYear?.id, year, month],
    queryFn: () => studentsApi.getStudents({
      ...(activeAcademicYear?.id ? { session_class_id: classId, academic_year: activeAcademicYear.id } : { class_id: classId }),
      as_of_year: year,
      as_of_month: month + 1,
      page_size: 500,
    }),
    enabled: !!classId,
  })
  const enrolledStudents = studentsData?.data?.results || studentsData?.data || []
  const masterClassId = enrolledStudents[0]?.class_obj

  // Sundays and holidays for the month (class-specific off days included),
  // so the register can shade them instead of showing "-" like a missed day.
  const { data: calendarData } = useQuery({
    queryKey: ['registerCalendar', year, month, masterClassId, activeAcademicYear?.id],
    queryFn: () => sessionsApi.getCalendarMonthView({
      year,
      month: month + 1,
      class_id: masterClassId || undefined,
      academic_year: activeAcademicYear?.id || undefined,
    }),
    enabled: !!classId,
    staleTime: 5 * 60_000,
  })
  const offDays = useMemo(() => {
    const map = {}
    for (const d of calendarData?.data?.days || []) {
      const studentOff = (d.entries || []).filter(
        (e) => e.entry_kind === 'OFF_DAY' && e.affects_students !== false,
      )
      if (d.is_sunday || studentOff.length) {
        map[d.day] = studentOff.map((e) => e.name).join(', ') || 'Sunday'
      }
    }
    return map
  }, [calendarData])

  // Named holiday runs of 3+ consecutive days (e.g. Summer Vacation) get a single
  // spanning, labeled header cell instead of a wall of identical gray columns that
  // reads as "no data" rather than "school was closed" - a lone Sunday stays as
  // the quiet per-day tint below.
  const offBands = useMemo(() => {
    const days = calendarData?.data?.days || []
    const bands = []
    let run = null
    for (const d of days) {
      const named = (d.entries || []).filter(
        (e) => e.entry_kind === 'OFF_DAY' && e.affects_students !== false,
      )
      const label = named.map((e) => e.name).join(', ')
      if (label && run && run.label === label) {
        run.endDay = d.day
      } else {
        if (run) bands.push(run)
        run = label ? { startDay: d.day, endDay: d.day, label } : null
      }
    }
    if (run) bands.push(run)
    return bands.filter((b) => b.endDay - b.startDay + 1 >= 3)
  }, [calendarData])
  const bandByStartDay = useMemo(
    () => Object.fromEntries(offBands.map((b) => [b.startDay, b])),
    [offBands],
  )
  const bandDaySet = useMemo(() => {
    const set = new Set()
    for (const b of offBands) {
      for (let d = b.startDay; d <= b.endDay; d++) set.add(d)
    }
    return set
  }, [offBands])

  // Fetch attendance records for the month + class (page_size large enough for full month)
  const { data: recordsData, isLoading, error } = useQuery({
    queryKey: ['attendanceRecords', dateFrom, dateTo, classId, activeAcademicYear?.id],
    queryFn: () => {
      const params = { date_from: dateFrom, date_to: dateTo, page_size: 2000 }
      if (classId) {
        if (activeAcademicYear?.id) {
          params.session_class_id = classId
          params.academic_year = activeAcademicYear.id
        } else {
          params.class_id = classId
        }
      }
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
    let totalLeave = 0

    for (const r of records) {
      const sid = r.student || r.student_id
      if (!attendanceMap[sid]) attendanceMap[sid] = {}
      const dayNum = parseInt(r.date.split('-')[2], 10)
      attendanceMap[sid][dayNum] = r.status
      datesSet.add(dayNum)
      if (r.status === 'PRESENT') totalPresent++
      if (r.status === 'ABSENT') totalAbsent++
      if (r.status === 'LEAVE') totalLeave++
    }

    // Build student rows from enrolled students (DB source of truth)
    const studentRows = enrolledStudents
      .map((s) => ({
        id: s.id,
        name: s.name,
        roll: s.roll_number,
        dates: attendanceMap[s.id] || {},
        leftDate: s.left_date || null,
        leftStatus: s.status,
        leftFrom: leftFromDay(s.left_date, year, month, daysInMonth),
        awayDays: awayDaysInMonth(s.away_periods, year, month, daysInMonth),
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
        leftStudents: studentRows.filter((r) => r.leftFrom !== null).length,
        totalPresent,
        totalAbsent,
        totalLeave,
        totalRecords: totalPresent + totalAbsent + totalLeave,
      },
    }
  }, [records, enrolledStudents, year, month, daysInMonth])

  // Generate all day numbers for the month
  const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const weekdayOf = (day) => new Date(year, month, day).getDay()
  const todayDay = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : null
  const isPastOrToday = (day) =>
    year < today.getFullYear()
    || (year === today.getFullYear() && (month < today.getMonth() || (month === today.getMonth() && day <= today.getDate())))

  // Month navigation
  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1) }
    else setMonth(month - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1) }
    else setMonth(month + 1)
  }

  // Download register as PDF
  const handleDownloadRegister = async () => {
    try {
      setDownloading(true)
      const params = {
        month: month + 1, // Convert to 1-indexed
        year,
        ...(activeAcademicYear?.id
          ? { session_class_id: classId, academic_year: activeAcademicYear.id }
          : { class_id: classId }
        ),
      }
      const response = await attendanceApi.downloadRegisterPdf(params)

      // Create blob and trigger download
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const monthName = new Date(year, month).toLocaleString('default', { month: 'short' })
      link.setAttribute('download', `attendance_register_${monthName}_${year}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.parentNode.removeChild(link)
      window.URL.revokeObjectURL(url)
      showSuccess('Register downloaded successfully')
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to download register')
    } finally {
      setDownloading(false)
    }
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
            <ClassSelector
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="input w-full"
              scope={activeAcademicYear?.id ? 'session' : 'master'}
              academicYearId={activeAcademicYear?.id}
              showAllOption={showAllOption}
              classes={teacherClassOptions || undefined}
            />
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
        <div className="card p-4 sm:p-6">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Step 1: Class */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">1</span>
              Select Class
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 2: Month */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">2</span>
              Browse Month
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 3: View */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
              View Register
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            Select a class above to view the monthly attendance register.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
            <p className="text-xs text-blue-700">
              <span className="font-semibold">Tip:</span> Use the arrow buttons to navigate between months once a class is selected.
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="card text-center py-12">
          <Spinner size="h-10 w-10" className="mx-auto" />
          <p className="mt-4 text-gray-500">Loading register...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="card">
              <p className="text-xs text-gray-500">Students</p>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">
                {summary.totalStudents - summary.leftStudents}
                {summary.leftStudents > 0 && (
                  <span className="ml-1 text-sm font-medium text-gray-400">+ {summary.leftStudents} left</span>
                )}
              </p>
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
            <div className="card bg-purple-50">
              <p className="text-xs text-gray-500">Leave</p>
              <p className="text-xl sm:text-2xl font-bold text-purple-600">{summary.totalLeave}</p>
            </div>
          </div>

          {/* Action Toolbar */}
          {classId && (
            <div className="flex justify-end">
              {(isSchoolAdmin || isPrincipal || isManager || isTeacher) && (
                <button
                  onClick={handleDownloadRegister}
                  disabled={downloading}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {downloading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2v20m10-10H2" />
                      </svg>
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4m0 0V8m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Download Register PDF
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Register Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th rowSpan={2} className="sticky left-0 z-10 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[48px] w-[48px]">
                      Roll
                    </th>
                    <th rowSpan={2} className="sticky left-[48px] z-10 bg-gray-50 px-2 py-1 text-left text-[10px] font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[140px]">
                      Name
                    </th>
                    <th colSpan={daysInMonth} className="px-2 pt-1.5 pb-0.5 text-left text-[11px] font-semibold text-gray-700 tracking-wide uppercase">
                      {formatMonth(year, month)}
                    </th>
                    <th colSpan={3} rowSpan={2} className="px-1 py-1 text-center text-[10px] font-medium text-gray-500 uppercase border-b border-l border-gray-200">
                      <div className="grid grid-cols-3 gap-1 min-w-[72px]">
                        <span className="text-green-700">P</span>
                        <span className="text-red-700">A</span>
                        <span className="text-purple-700">L</span>
                      </div>
                    </th>
                  </tr>
                  <tr className="bg-gray-50">
                    {(() => {
                      const cells = []
                      let day = 1
                      while (day <= daysInMonth) {
                        const band = bandByStartDay[day]
                        if (band) {
                          const span = band.endDay - band.startDay + 1
                          cells.push(
                            <th
                              key={day}
                              colSpan={span}
                              title={band.label}
                              className="px-1 pb-1 pt-0.5 text-center border-b border-l border-gray-200 bg-indigo-50 align-middle"
                            >
                              <span className="block text-[9px] font-semibold text-indigo-700 whitespace-nowrap overflow-hidden text-ellipsis">
                                {band.label}
                              </span>
                            </th>,
                          )
                          day += span
                          continue
                        }
                        const wd = weekdayOf(day)
                        const off = offDays[day]
                        const isToday = day === todayDay
                        cells.push(
                          <th
                            key={day}
                            title={off || undefined}
                            className={`px-0 pb-1 pt-0.5 text-center border-b border-gray-200 min-w-[26px] w-[26px] leading-tight ${
                              wd === 1 ? 'border-l border-l-gray-200' : ''
                            } ${off ? 'bg-gray-100' : ''} ${isToday ? 'ring-1 ring-inset ring-blue-400 rounded-sm' : ''}`}
                          >
                            <span className={`block text-[9px] font-medium ${off ? 'text-gray-400' : 'text-gray-400'}`}>
                              {WEEKDAY_LETTERS[wd]}
                            </span>
                            <span className={`block text-[11px] font-semibold ${
                              isToday ? 'text-blue-600' : !isPastOrToday(day) ? 'text-gray-300' : off ? 'text-gray-400' : 'text-gray-700'
                            }`}>
                              {day}
                            </span>
                          </th>,
                        )
                        day += 1
                      }
                      return cells
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => {
                    const pCount = Object.values(student.dates).filter((s) => s === 'PRESENT').length
                    const aCount = Object.values(student.dates).filter((s) => s === 'ABSENT').length
                    const lCount = Object.values(student.dates).filter((s) => s === 'LEAVE').length

                    const leftFrom = student.leftFrom
                    // Merge the days from leaving into one band, unless records
                    // somehow exist there (then show them rather than hide them).
                    const bandFrom = leftFrom !== null
                      && !Object.keys(student.dates).some((d) => Number(d) >= leftFrom)
                      ? leftFrom : null
                    const leftLabel = student.leftDate
                      ? `${student.leftStatus === 'TRANSFERRED' ? 'Transferred' : 'Left'} ${formatShortDate(student.leftDate)}`
                      : null
                    const rowBg = idx % 2 === 0 ? 'white' : '#f9fafb'

                    return (
                      <tr
                        key={student.id}
                        className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${leftFrom !== null ? 'opacity-80' : ''}`}
                      >
                        <td className="sticky left-0 z-10 px-2 py-1 text-xs text-gray-600 border-r border-gray-200 font-medium min-w-[48px] w-[48px]"
                            style={{ backgroundColor: rowBg }}>
                          {student.roll}
                        </td>
                        <td className="sticky left-[48px] z-10 px-2 py-1 text-xs text-gray-900 border-r border-gray-200 font-medium max-w-[160px]"
                            style={{ backgroundColor: rowBg }}
                            title={leftLabel ? `${student.name} (${leftLabel})` : student.name}>
                          <span className="block truncate">{student.name}</span>
                          {leftFrom !== null && leftLabel && (
                            <span className="inline-block mt-0.5 px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-600">
                              {leftLabel}
                            </span>
                          )}
                        </td>
                        {allDays.map((day) => {
                          if (bandFrom !== null && day > bandFrom) return null
                          if (bandFrom !== null && day === bandFrom) {
                            return (
                              <td
                                key={day}
                                colSpan={daysInMonth - bandFrom + 1}
                                className="px-2 py-1 text-[10px] font-medium text-gray-500 bg-gray-100 border-l-2 border-l-gray-300"
                                title={leftLabel || 'Left'}
                              >
                                <span className="whitespace-nowrap">{leftLabel || 'Left'}</span>
                              </td>
                            )
                          }
                          const s = student.dates[day]
                          const off = offDays[day]
                          const awayThatDay = student.awayDays?.has(day)
                          const enrolledThatDay = (leftFrom === null || day < leftFrom) && !awayThatDay
                          const unmarked = !s && !off && enrolledThatDay && isPastOrToday(day) && datesWithData.includes(day)
                          return (
                            <td
                              key={day}
                              title={awayThatDay ? 'Away from school' : unmarked ? 'Not marked' : off && !s ? off : undefined}
                              className={`px-0 py-1 text-center text-xs border-gray-100 ${
                                weekdayOf(day) === 1 ? 'border-l border-l-gray-200' : ''
                              } ${awayThatDay ? 'bg-gray-200/80' : bandDaySet.has(day) ? 'bg-indigo-50/70' : off ? 'bg-gray-100/80' : ''} ${day === todayDay ? 'bg-blue-50/60' : ''}`}
                            >
                              {s === 'PRESENT' ? (
                                <span className="text-green-600 font-semibold">P</span>
                              ) : s === 'ABSENT' ? (
                                <span className="text-red-600 font-semibold">A</span>
                              ) : s === 'LEAVE' ? (
                                <span className="text-purple-600 font-semibold">L</span>
                              ) : unmarked ? (
                                <span className="text-amber-500 font-bold">·</span>
                              ) : null}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1 text-center text-xs font-bold text-green-700 border-l border-gray-200">
                          {pCount}
                        </td>
                        <td className="px-2 py-1 text-center text-xs font-bold text-red-700">
                          {aCount}
                        </td>
                        <td className="px-2 py-1 text-center text-xs font-bold text-purple-700">
                          {lCount}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500">
              <span><span className="font-semibold text-green-600">P</span> Present</span>
              <span><span className="font-semibold text-red-600">A</span> Absent</span>
              <span><span className="font-semibold text-purple-600">L</span> Leave</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" /> Sunday / short holiday</span>
              <span className="flex items-center gap-1"><span className="inline-block w-5 h-3 rounded-sm bg-indigo-50 border border-indigo-100" /> Multi-day holiday (named above)</span>
              <span><span className="font-bold text-amber-500">·</span> Not marked</span>
              <span className="flex items-center gap-1"><span className="inline-block w-5 h-3 rounded-sm bg-gray-100 border-l-2 border-gray-300" /> Left the school</span>
              <span className="flex items-center gap-1"><span className="inline-block w-5 h-3 rounded-sm bg-gray-200" /> Away (not enrolled)</span>
            </div>
          </div>

          {/* Mobile fallback: student summary cards */}
          <div className="sm:hidden space-y-3">
            <p className="text-xs text-gray-400 text-center">Scroll the table above horizontally, or view student summaries below</p>
            {students.map((student) => {
              const pCount = Object.values(student.dates).filter((s) => s === 'PRESENT').length
              const aCount = Object.values(student.dates).filter((s) => s === 'ABSENT').length
              const lCount = Object.values(student.dates).filter((s) => s === 'LEAVE').length
              return (
                <div key={student.id} className="card py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{student.name}</p>
                      <p className="text-xs text-gray-500">
                        Roll #{student.roll}
                        {student.leftFrom !== null && student.leftDate && (
                          <span className="ml-2 px-1.5 py-px rounded text-[10px] font-semibold uppercase bg-gray-200 text-gray-600">
                            {student.leftStatus === 'TRANSFERRED' ? 'Transferred' : 'Left'} {formatShortDate(student.leftDate)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-3 text-sm">
                      <span className="text-green-600 font-semibold">{pCount}P</span>
                      <span className="text-red-600 font-semibold">{aCount}A</span>
                      <span className="text-purple-600 font-semibold">{lCount}L</span>
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
