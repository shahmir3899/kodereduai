import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi, sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import ClassSelector from '../ClassSelector'

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}
function formatMonth(year, month) {
  return new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })
}
function pad(n) { return n < 10 ? '0' + n : '' + n }
function getDayName(year, month, day) {
  return new Date(year, month, day).toLocaleString('default', { weekday: 'short' })
}

export default function RegisterTab() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [classId, setClassId] = useState('')
  const [mobileView, setMobileView] = useState('cards')
  const [activeWeek, setActiveWeek] = useState(0)

  const daysInMonth = getDaysInMonth(year, month)
  const dateFrom = `${year}-${pad(month + 1)}-01`
  const dateTo = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  const { activeAcademicYear } = useAcademicYear()

  const { data: sessionClassesRes } = useQuery({
    queryKey: ['registerSessionClasses', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getSessionClasses({
      academic_year: activeAcademicYear?.id,
      page_size: 9999,
      is_active: true,
    }),
    enabled: !!activeAcademicYear?.id,
  })
  const sessionClasses = sessionClassesRes?.data?.results || sessionClassesRes?.data || []

  const { data: enrollmentData } = useQuery({
    queryKey: ['enrollments-by-class', classId, activeAcademicYear?.id],
    queryFn: () => sessionsApi.getEnrollments({
      ...(activeAcademicYear?.id ? { session_class_id: classId } : { class_id: classId }),
      ...(activeAcademicYear?.id ? { academic_year: activeAcademicYear.id } : {}),
      page_size: 9999,
    }),
    enabled: !!classId && !!activeAcademicYear?.id,
  })
  const enrolledStudents = (enrollmentData?.data?.results || enrollmentData?.data || []).map(e => ({
    id: e.student,
    name: e.student_name,
    roll_number: e.roll_number,
  }))

  const selectedMasterClassId = useMemo(() => {
    if (!classId) return ''
    if (!activeAcademicYear?.id) return classId
    const selectedSessionClass = sessionClasses.find(sc => String(sc.id) === String(classId))
    return selectedSessionClass?.class_obj || ''
  }, [classId, activeAcademicYear?.id, sessionClasses])

  const { data: dayStatusRes } = useQuery({
    queryKey: ['registerDayStatus', year, month, selectedMasterClassId, activeAcademicYear?.id],
    queryFn: () => sessionsApi.getCalendarDayStatus({
      date_from: dateFrom,
      date_to: dateTo,
      class_id: selectedMasterClassId || undefined,
      academic_year: activeAcademicYear?.id || undefined,
    }),
    enabled: !!classId,
  })

  const { data: recordsData, isLoading, error } = useQuery({
    queryKey: ['attendanceRecords', dateFrom, dateTo, classId, activeAcademicYear?.id],
    queryFn: () => attendanceApi.getRegisterData({
      ...(activeAcademicYear?.id ? { session_class_id: classId, academic_year: activeAcademicYear.id } : { class_id: classId }),
      date_from: dateFrom,
      date_to: dateTo,
    }),
    enabled: !!classId,
  })
  const records = recordsData?.data || []

  const { students, datesWithData, summary } = useMemo(() => {
    const attendanceMap = {}
    const datesSet = new Set()
    let totalPresent = 0, totalAbsent = 0
    for (const r of records) {
      const sid = r.student_id || r.student
      if (!attendanceMap[sid]) attendanceMap[sid] = {}
      const dayNum = parseInt(r.date.split('-')[2], 10)
      attendanceMap[sid][dayNum] = r.status
      datesSet.add(dayNum)
      if (r.status === 'PRESENT') totalPresent++
      if (r.status === 'ABSENT') totalAbsent++
    }
    const studentRows = enrolledStudents
      .map(s => ({ id: s.id, name: s.name, roll: s.roll_number, dates: attendanceMap[s.id] || {} }))
      .sort((a, b) => (parseInt(a.roll) || 0) - (parseInt(b.roll) || 0))
    return {
      students: studentRows,
      datesWithData: [...datesSet].sort((a, b) => a - b),
      summary: { totalStudents: studentRows.length, totalPresent, totalAbsent },
    }
  }, [records, enrolledStudents])

  const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const dayStatusMap = dayStatusRes?.data?.days || {}
  const offDayByDay = useMemo(() => {
    const map = {}
    Object.entries(dayStatusMap).forEach(([dateKey, value]) => {
      const day = parseInt(dateKey.split('-')[2], 10)
      map[day] = !!value?.is_off_day
    })
    return map
  }, [dayStatusMap])
  const offDayCount = useMemo(() => Object.values(offDayByDay).filter(Boolean).length, [offDayByDay])

  const weeks = useMemo(() => {
    const w = []
    for (let i = 0; i < allDays.length; i += 7) {
      w.push(allDays.slice(i, i + 7))
    }
    return w
  }, [allDays])

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-600">Failed to load attendance records</p>
        <p className="text-sm text-gray-500 mt-2">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <ClassSelector
              value={classId}
              onChange={e => setClassId(e.target.value)}
              className="input w-full"
              scope={activeAcademicYear?.id ? 'session' : 'master'}
              academicYearId={activeAcademicYear?.id}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="btn btn-secondary px-2 py-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-medium text-gray-900 min-w-[140px] text-center">{formatMonth(year, month)}</span>
            <button onClick={nextMonth} className="btn btn-secondary px-2 py-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
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
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card"><p className="text-xs text-gray-500">Students</p><p className="text-xl sm:text-2xl font-bold text-gray-900">{summary.totalStudents}</p></div>
            <div className="card"><p className="text-xs text-gray-500">Days Recorded</p><p className="text-xl sm:text-2xl font-bold text-gray-900">{datesWithData.length}</p></div>
            <div className="card bg-green-50"><p className="text-xs text-gray-500">Present</p><p className="text-xl sm:text-2xl font-bold text-green-600">{summary.totalPresent}</p></div>
            <div className="card bg-red-50"><p className="text-xs text-gray-500">Absent</p><p className="text-xl sm:text-2xl font-bold text-red-600">{summary.totalAbsent}</p></div>
            <div className="card bg-gray-50 col-span-2 sm:col-span-1"><p className="text-xs text-gray-500">OFF Days</p><p className="text-xl sm:text-2xl font-bold text-gray-700">{offDayCount}</p></div>
          </div>

          {/* Mobile View Toggle */}
          <div className="md:hidden flex items-center justify-end gap-2">
            <span className="text-xs text-gray-500">View:</span>
            <button onClick={() => setMobileView('cards')} className={`px-3 py-1.5 text-xs rounded-lg font-medium ${mobileView === 'cards' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Cards</button>
            <button onClick={() => setMobileView('grid')} className={`px-3 py-1.5 text-xs rounded-lg font-medium ${mobileView === 'grid' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Grid</button>
          </div>

          {/* ── Desktop: Full month table ── */}
          <div className="hidden md:block card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[40px]">Roll</th>
                    <th className="sticky left-[52px] z-10 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase border-b border-r border-gray-200 min-w-[140px]">Name</th>
                    {allDays.map(day => (
                      <th key={day} className={`px-0 py-2 text-center text-xs font-medium border-b border-gray-200 min-w-[32px] ${datesWithData.includes(day) ? 'text-gray-700' : 'text-gray-300'}`}>
                        <div className="flex flex-col items-center leading-none gap-0.5">
                          <span>{day}</span>
                          {offDayByDay[day] && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-gray-200 text-gray-700">OFF</span>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase border-b border-l border-gray-200 min-w-[32px]">P</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase border-b border-gray-200 min-w-[32px]">A</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => {
                    const pCount = Object.values(student.dates).filter(s => s === 'PRESENT').length
                    const aCount = Object.values(student.dates).filter(s => s === 'ABSENT').length
                    return (
                      <tr key={student.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="sticky left-0 z-10 px-3 py-1.5 text-xs text-gray-600 border-r border-gray-200 font-medium" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }}>{student.roll}</td>
                        <td className="sticky left-[52px] z-10 px-3 py-1.5 text-xs text-gray-900 border-r border-gray-200 font-medium truncate max-w-[160px]" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }} title={student.name}>{student.name}</td>
                        {allDays.map(day => {
                          const s = student.dates[day]
                          return (
                            <td key={day} className="px-0 py-1.5 text-center text-xs">
                              {s === 'PRESENT' ? <span className="text-green-600 font-semibold">P</span> : s === 'ABSENT' ? <span className="text-red-600 font-semibold">A</span> : <span className="text-gray-200">-</span>}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-center text-xs font-bold text-green-700 border-l border-gray-200">{pCount}</td>
                        <td className="px-2 py-1.5 text-center text-xs font-bold text-red-700">{aCount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Mobile: Card View ── */}
          {mobileView === 'cards' && (
            <div className="md:hidden space-y-3">
              {students.map(student => {
                const pCount = Object.values(student.dates).filter(s => s === 'PRESENT').length
                const aCount = Object.values(student.dates).filter(s => s === 'ABSENT').length
                return (
                  <div key={student.id} className="card py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{student.name}</p>
                        <p className="text-xs text-gray-500">Roll #{student.roll}</p>
                      </div>
                      <div className="flex gap-3 text-sm">
                        <span className="text-green-600 font-semibold">{pCount}P</span>
                        <span className="text-red-600 font-semibold">{aCount}A</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {['M','T','W','T','F','S','S'].map((d, i) => (
                        <div key={i} className="text-center text-[9px] text-gray-400 font-medium">{d}</div>
                      ))}
                      {(() => {
                        const firstDow = new Date(year, month, 1).getDay()
                        const offset = firstDow === 0 ? 6 : firstDow - 1
                        return Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} />)
                      })()}
                      {allDays.map(day => {
                        const s = student.dates[day]
                        const bg = s === 'PRESENT' ? 'bg-green-500' : s === 'ABSENT' ? 'bg-red-500' : 'bg-gray-200'
                        return (
                          <div key={day} className="flex flex-col items-center" title={`${day}: ${s || 'No data'}`}>
                            <div className={`w-5 h-5 rounded-full ${bg} flex items-center justify-center`}>
                              <span className={`text-[8px] font-medium ${s ? 'text-white' : 'text-gray-400'}`}>{day}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Mobile: Week Grid View ── */}
          {mobileView === 'grid' && (
            <div className="md:hidden">
              <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                {weeks.map((week, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveWeek(i)}
                    className={`flex-shrink-0 px-3 py-1.5 text-xs rounded-lg font-medium ${activeWeek === i ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                    {week[0]}-{week[week.length - 1]}
                  </button>
                ))}
              </div>
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-medium text-gray-500 border-b border-r border-gray-200 min-w-[100px]">Name</th>
                        {(weeks[activeWeek] || []).map(day => (
                          <th key={day} className={`px-1 py-2 text-center font-medium border-b border-gray-200 min-w-[36px] ${datesWithData.includes(day) ? 'text-gray-700' : 'text-gray-300'}`}>
                            <div>{getDayName(year, month, day)}</div>
                            <div className="text-[10px]">{day}</div>
                            {offDayByDay[day] && <div className="text-[9px] mt-0.5 px-1 py-0.5 rounded bg-gray-200 text-gray-700 inline-block">OFF</div>}
                          </th>
                        ))}
                        <th className="px-2 py-2 text-center font-medium text-gray-500 border-b border-l border-gray-200">P</th>
                        <th className="px-2 py-2 text-center font-medium text-gray-500 border-b border-gray-200">A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((student, idx) => {
                        const weekDays = weeks[activeWeek] || []
                        const pCount = weekDays.filter(d => student.dates[d] === 'PRESENT').length
                        const aCount = weekDays.filter(d => student.dates[d] === 'ABSENT').length
                        return (
                          <tr key={student.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="sticky left-0 z-10 px-2 py-1.5 text-gray-900 font-medium border-r border-gray-200 truncate max-w-[120px]" style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb' }} title={student.name}>
                              <span className="text-gray-400 mr-1">{student.roll}</span>{student.name}
                            </td>
                            {weekDays.map(day => {
                              const s = student.dates[day]
                              return (
                                <td key={day} className="px-1 py-1.5 text-center">
                                  {s === 'PRESENT' ? <span className="text-green-600 font-bold">P</span> : s === 'ABSENT' ? <span className="text-red-600 font-bold">A</span> : <span className="text-gray-200">-</span>}
                                </td>
                              )
                            })}
                            <td className="px-2 py-1.5 text-center font-bold text-green-700 border-l border-gray-200">{pCount}</td>
                            <td className="px-2 py-1.5 text-center font-bold text-red-700">{aCount}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
