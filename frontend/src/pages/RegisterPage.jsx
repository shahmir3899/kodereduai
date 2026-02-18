import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { attendanceApi, classesApi, studentsApi, schoolsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

// ─── Utility helpers ───
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

// ─── Tab button component ───
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`py-3 px-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
        active
          ? 'border-primary-600 text-primary-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Accuracy helpers ───
function getAccuracyColor(accuracy) {
  if (accuracy === null || accuracy === undefined) return 'text-gray-500'
  if (accuracy >= 0.9) return 'text-green-600'
  if (accuracy >= 0.7) return 'text-yellow-600'
  return 'text-red-600'
}
function getAccuracyBg(accuracy) {
  if (accuracy === null || accuracy === undefined) return 'bg-gray-100'
  if (accuracy >= 0.9) return 'bg-green-100'
  if (accuracy >= 0.7) return 'bg-yellow-100'
  return 'bg-red-100'
}

// ═══════════════════════════════════════════
// REGISTER TAB
// ═══════════════════════════════════════════
function RegisterTab() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [classId, setClassId] = useState('')
  const [mobileView, setMobileView] = useState('cards') // 'cards' | 'grid'
  const [activeWeek, setActiveWeek] = useState(0)

  const daysInMonth = getDaysInMonth(year, month)
  const dateFrom = `${year}-${pad(month + 1)}-01`
  const dateTo = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
  })
  const classes = classesData?.data?.results || classesData?.data || []

  const { data: studentsData } = useQuery({
    queryKey: ['students', classId],
    queryFn: () => studentsApi.getStudents({ class_id: classId, page_size: 500 }),
    enabled: !!classId,
  })
  const enrolledStudents = studentsData?.data?.results || studentsData?.data || []

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

  const { students, datesWithData, summary } = useMemo(() => {
    const attendanceMap = {}
    const datesSet = new Set()
    let totalPresent = 0, totalAbsent = 0
    for (const r of records) {
      const sid = r.student || r.student_id
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

  // Build weeks for mobile week-view
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
            <select value={classId} onChange={e => setClassId(e.target.value)} className="input w-full">
              <option value="">Select Class</option>
              {classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
            </select>
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
          </div>

          {/* Mobile View Toggle */}
          <div className="md:hidden flex items-center justify-end gap-2">
            <span className="text-xs text-gray-500">View:</span>
            <button
              onClick={() => setMobileView('cards')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${mobileView === 'cards' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >Cards</button>
            <button
              onClick={() => setMobileView('grid')}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${mobileView === 'grid' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >Grid</button>
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
                      <th key={day} className={`px-0 py-2 text-center text-xs font-medium border-b border-gray-200 min-w-[32px] ${datesWithData.includes(day) ? 'text-gray-700' : 'text-gray-300'}`}>{day}</th>
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
                    {/* Mini calendar grid */}
                    <div className="grid grid-cols-7 gap-1">
                      {/* Day headers */}
                      {['M','T','W','T','F','S','S'].map((d, i) => (
                        <div key={i} className="text-center text-[9px] text-gray-400 font-medium">{d}</div>
                      ))}
                      {/* Leading blanks for first day alignment */}
                      {(() => {
                        const firstDow = new Date(year, month, 1).getDay()
                        const offset = firstDow === 0 ? 6 : firstDow - 1 // Monday-based
                        return Array.from({ length: offset }, (_, i) => <div key={`blank-${i}`} />)
                      })()}
                      {/* Day dots */}
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
              {/* Week tabs */}
              <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                {weeks.map((week, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveWeek(i)}
                    className={`flex-shrink-0 px-3 py-1.5 text-xs rounded-lg font-medium ${
                      activeWeek === i ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {week[0]}-{week[week.length - 1]}
                  </button>
                ))}
              </div>
              {/* Week table */}
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

// ═══════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════
function AnalyticsTab({ onGoToConfig }) {
  const [days, setDays] = useState(30)

  const { data: statsData, isLoading, error } = useQuery({
    queryKey: ['accuracyStats', days],
    queryFn: () => attendanceApi.getAccuracyStats({ days }),
  })

  const stats = statsData?.data || {}
  const periodStats = stats.period_stats || {}
  const weeklyTrend = stats.weekly_trend || []
  const commonErrors = stats.common_ocr_errors || []
  const hasData = periodStats.total_corrections > 0 || periodStats.total_predictions > 0

  if (error) {
    return <div className="card text-center py-8"><p className="text-red-600">Failed to load accuracy data</p></div>
  }

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Track how well AI predictions match human confirmations
          {stats.school_name && <span className="ml-1">- {stats.school_name}</span>}
        </p>
        <select value={days} onChange={e => setDays(parseInt(e.target.value))} className="input w-auto">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {isLoading ? (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading accuracy data...</p>
        </div>
      ) : !hasData ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">No feedback data yet</p>
          <p className="mt-2 text-sm text-gray-400">Accuracy data is recorded when you confirm attendance on the review page.</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`card ${getAccuracyBg(periodStats.accuracy)}`}>
              <p className="text-sm text-gray-600">Accuracy</p>
              <p className={`text-2xl sm:text-3xl font-bold ${getAccuracyColor(periodStats.accuracy)}`}>{periodStats.accuracy_pct || 'N/A'}</p>
              <p className="text-xs text-gray-500 mt-1">{periodStats.uploads_confirmed || 0} uploads</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Predictions</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{periodStats.total_predictions || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Students processed</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Corrections</p>
              <p className="text-2xl sm:text-3xl font-bold text-orange-600">{periodStats.attendance_corrections || 0}</p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between"><span>False Pos</span><span className="font-medium text-red-600">{periodStats.false_positives || 0}</span></div>
                <div className="flex justify-between"><span>False Neg</span><span className="font-medium text-yellow-600">{periodStats.false_negatives || 0}</span></div>
              </div>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Matching</p>
              <p className="text-2xl sm:text-3xl font-bold text-blue-600">{(periodStats.name_mismatches || 0) + (periodStats.roll_mismatches || 0)}</p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between"><span>Name</span><span className="font-medium text-blue-600">{periodStats.name_mismatches || 0}</span></div>
                <div className="flex justify-between"><span>Roll</span><span className="font-medium text-blue-600">{periodStats.roll_mismatches || 0}</span></div>
              </div>
            </div>
          </div>

          {/* Weekly Trend */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Weekly Accuracy Trend</h3>
            {weeklyTrend.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No trend data available yet</p>
            ) : (
              <>
                <div className="sm:hidden space-y-3">
                  {weeklyTrend.map((week, idx) => (
                    <div key={idx} className="p-3 border border-gray-200 rounded-lg">
                      <p className="text-sm font-medium text-gray-900">{week.week_start} - {week.week_end}</p>
                      <div className="flex justify-between mt-2 text-xs text-gray-600">
                        <span>{week.uploads_processed} uploads</span>
                        <span>{week.total_predictions} predictions</span>
                        <span className={`px-2 py-0.5 rounded-full font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>{week.accuracy_pct}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploads</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Predictions</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Corrections</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {weeklyTrend.map((week, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{week.week_start} - {week.week_end}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.uploads_processed}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.total_predictions}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.corrections}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-1 rounded-full text-sm font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>{week.accuracy_pct}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Common OCR Errors */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Common OCR Errors</h3>
              <button onClick={onGoToConfig} className="text-sm text-primary-600 hover:text-primary-700">Fix in Configuration</button>
            </div>
            {commonErrors.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No OCR errors recorded yet</p>
            ) : (
              <div className="space-y-3">
                {commonErrors.map((err, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <span className="font-mono text-lg bg-white px-3 py-1 rounded border">"{err.raw_mark}"</span>
                      <div>
                        <p className="text-sm text-gray-900">Misread <span className="font-medium">{err.misread_count}</span> times</p>
                        <p className="text-xs text-gray-500">Avg confidence: {Math.round((err.avg_ocr_confidence || 0) * 100)}%</p>
                      </div>
                    </div>
                    {err.suggestion && <p className="text-sm text-blue-600 max-w-xs text-right">{err.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// CONFIGURATION TAB
// ═══════════════════════════════════════════
function ConfigurationTab() {
  const queryClient = useQueryClient()
  const [configTab, setConfigTab] = useState('mappings')

  // Mark Mappings State
  const [mappings, setMappings] = useState({
    PRESENT: ['P', 'p', '✓', '✔', '/', '1'],
    ABSENT: ['A', 'a', '✗', '✘', 'X', 'x', '0', '-'],
    LATE: ['L', 'l'],
    LEAVE: ['Le', 'LE', 'le'],
    default: 'ABSENT',
  })
  const [newSymbol, setNewSymbol] = useState({ status: 'PRESENT', symbol: '' })

  // Register Config State
  const [regConfig, setRegConfig] = useState({
    orientation: 'rows_are_students', date_header_row: 0, student_name_col: 0,
    roll_number_col: 1, data_start_row: 1, data_start_col: 2,
  })

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({ queryKey: ['markMappings'], queryFn: () => schoolsApi.getMarkMappings() })
  const { data: regConfigData, isLoading: regConfigLoading } = useQuery({ queryKey: ['registerConfig'], queryFn: () => schoolsApi.getRegisterConfig() })
  const { data: suggestionsData } = useQuery({ queryKey: ['mappingSuggestions'], queryFn: () => attendanceApi.getMappingSuggestions({}) })

  useEffect(() => { if (mappingsData?.data?.mark_mappings) setMappings(mappingsData.data.mark_mappings) }, [mappingsData])
  useEffect(() => { if (regConfigData?.data?.register_config) setRegConfig(regConfigData.data.register_config) }, [regConfigData])

  const saveMappingsMutation = useMutation({
    mutationFn: data => schoolsApi.updateMarkMappings(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['markMappings'] }); queryClient.invalidateQueries({ queryKey: ['mappingSuggestions'] }) },
  })
  const saveRegConfigMutation = useMutation({
    mutationFn: data => schoolsApi.updateRegisterConfig(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registerConfig'] }),
  })

  const addSymbol = () => {
    if (!newSymbol.symbol.trim()) return
    const { status, symbol: sym } = newSymbol
    const trimmed = sym.trim()
    if (!mappings[status]?.includes(trimmed)) {
      setMappings(prev => ({ ...prev, [status]: [...(prev[status] || []), trimmed] }))
    }
    setNewSymbol({ ...newSymbol, symbol: '' })
  }
  const removeSymbol = (status, symbol) => setMappings(prev => ({ ...prev, [status]: prev[status].filter(s => s !== symbol) }))
  const applySuggestion = (mark, suggestedStatus) => {
    if (!mappings[suggestedStatus]?.includes(mark)) {
      setMappings(prev => ({ ...prev, [suggestedStatus]: [...(prev[suggestedStatus] || []), mark] }))
    }
  }

  const suggestions = suggestionsData?.data?.suggestions || []

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button onClick={() => setConfigTab('mappings')} className={`px-4 py-2 text-sm rounded-lg font-medium ${configTab === 'mappings' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Mark Mappings</button>
        <button onClick={() => setConfigTab('register')} className={`px-4 py-2 text-sm rounded-lg font-medium ${configTab === 'register' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Register Layout</button>
      </div>

      {/* Mark Mappings */}
      {configTab === 'mappings' && (
        <div className="space-y-4">
          {mappingsLoading ? (
            <div className="card text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div></div>
          ) : (
            <>
              {suggestions.length > 0 && (
                <div className="card bg-blue-50 border-blue-200">
                  <h3 className="font-medium text-blue-800 mb-3 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    Suggestions Based on OCR Errors
                  </h3>
                  <div className="space-y-2">
                    {suggestions.slice(0, 5).map((s, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white p-2 rounded-lg">
                        <div>
                          <span className="font-mono bg-gray-100 px-2 py-1 rounded">"{s.mark}"</span>
                          <span className="text-sm text-gray-600 ml-2">misread {s.misread_count} times</span>
                          {s.current_mapping !== 'Not mapped (using default)' && <span className="text-xs text-gray-500 ml-2">(currently: {s.current_mapping})</span>}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => applySuggestion(s.mark, 'PRESENT')} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Add to PRESENT</button>
                          <button onClick={() => applySuggestion(s.mark, 'ABSENT')} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Add to ABSENT</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card">
                <h3 className="font-medium text-gray-900 mb-4">Current Mark Mappings</h3>
                <p className="text-sm text-gray-500 mb-4">Define which symbols map to each attendance status.</p>
                <div className="space-y-4">
                  {['PRESENT', 'ABSENT', 'LATE', 'LEAVE'].map(status => (
                    <div key={status} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className={`font-medium ${status === 'PRESENT' ? 'text-green-700' : status === 'ABSENT' ? 'text-red-700' : status === 'LATE' ? 'text-yellow-700' : 'text-blue-700'}`}>{status}</span>
                        <span className="text-sm text-gray-500">{mappings[status]?.length || 0} symbols</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {mappings[status]?.map((symbol, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm">
                            <span className="font-mono">{symbol}</span>
                            <button onClick={() => removeSymbol(status, symbol)} className="text-gray-400 hover:text-red-500">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </span>
                        ))}
                        {(!mappings[status] || mappings[status].length === 0) && <span className="text-sm text-gray-400 italic">No symbols defined</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Default for blank/unrecognized marks:</label>
                  <select value={mappings.default || 'ABSENT'} onChange={e => setMappings(prev => ({ ...prev, default: e.target.value }))} className="input w-full sm:w-48">
                    <option value="PRESENT">PRESENT</option><option value="ABSENT">ABSENT</option><option value="LATE">LATE</option><option value="LEAVE">LEAVE</option>
                  </select>
                </div>
                <div className="mt-6 p-4 border border-dashed border-gray-300 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Add New Symbol</h4>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <select value={newSymbol.status} onChange={e => setNewSymbol({ ...newSymbol, status: e.target.value })} className="input w-full sm:w-40">
                      <option value="PRESENT">PRESENT</option><option value="ABSENT">ABSENT</option><option value="LATE">LATE</option><option value="LEAVE">LEAVE</option>
                    </select>
                    <input type="text" value={newSymbol.symbol} onChange={e => setNewSymbol({ ...newSymbol, symbol: e.target.value })} placeholder="Symbol (e.g., P, ✓, A)" className="input flex-1" maxLength={5} />
                    <button onClick={addSymbol} className="btn btn-secondary">Add</button>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveMappingsMutation.mutate(mappings)} disabled={saveMappingsMutation.isPending} className="btn btn-primary">{saveMappingsMutation.isPending ? 'Saving...' : 'Save Mark Mappings'}</button>
                </div>
                {saveMappingsMutation.isSuccess && <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">Mark mappings saved successfully!</div>}
                {saveMappingsMutation.isError && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">Failed to save: {saveMappingsMutation.error?.response?.data?.error || 'Unknown error'}</div>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Register Layout */}
      {configTab === 'register' && (
        <div className="card">
          {regConfigLoading ? (
            <div className="text-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div></div>
          ) : (
            <>
              <h3 className="font-medium text-gray-900 mb-4">Register Layout Configuration</h3>
              <p className="text-sm text-gray-500 mb-6">Configure how the AI interprets your attendance register format.</p>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Register Orientation</label>
                  <select value={regConfig.orientation} onChange={e => setRegConfig(prev => ({ ...prev, orientation: e.target.value }))} className="input w-full">
                    <option value="rows_are_students">Rows are students, columns are dates</option>
                    <option value="columns_are_students">Columns are students, rows are dates</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {[
                    { key: 'date_header_row', label: 'Date Header Row', min: 0, help: 'Row containing date numbers (0-indexed)' },
                    { key: 'data_start_row', label: 'Data Start Row', min: 0, help: 'First row with student attendance data' },
                    { key: 'student_name_col', label: 'Student Name Column', min: 0, help: 'Column with student names (0-indexed)' },
                    { key: 'roll_number_col', label: 'Roll Number Column', min: -1, help: 'Column with roll numbers (-1 if none)' },
                    { key: 'data_start_col', label: 'Data Start Column', min: 0, help: 'First column with attendance marks' },
                  ].map(({ key, label, min, help }) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
                      <input type="number" min={min} value={regConfig[key]} onChange={e => setRegConfig(prev => ({ ...prev, [key]: parseInt(e.target.value) || 0 }))} className="input w-full" />
                      <p className="mt-1 text-xs text-gray-500">{help}</p>
                    </div>
                  ))}
                </div>
                {/* Visual Preview */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Preview Layout</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs border border-gray-300">
                      <tbody>
                        {[0, 1, 2, 3].map(row => (
                          <tr key={row}>
                            {[0, 1, 2, 3, 4, 5].map(col => {
                              const isHeader = row === regConfig.date_header_row
                              const isNameCol = col === regConfig.student_name_col
                              const isRollCol = col === regConfig.roll_number_col
                              const isDataArea = row >= regConfig.data_start_row && col >= regConfig.data_start_col
                              let content = '', bgColor = 'bg-white'
                              if (isHeader && col >= regConfig.data_start_col) { content = `Day ${col - regConfig.data_start_col + 1}`; bgColor = 'bg-blue-100' }
                              else if (isNameCol && row >= regConfig.data_start_row) { content = `Name ${row}`; bgColor = 'bg-green-100' }
                              else if (isRollCol && row >= regConfig.data_start_row) { content = `${row}`; bgColor = 'bg-yellow-100' }
                              else if (isDataArea) { content = 'P/A'; bgColor = 'bg-gray-100' }
                              return <td key={col} className={`border border-gray-300 p-2 text-center ${bgColor}`}>{content}</td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 sm:gap-4 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border"></span> Date Header</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 border"></span> Name Column</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-100 border"></span> Roll Column</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-100 border"></span> Attendance Data</span>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <button onClick={() => saveRegConfigMutation.mutate(regConfig)} disabled={saveRegConfigMutation.isPending} className="btn btn-primary">{saveRegConfigMutation.isPending ? 'Saving...' : 'Save Register Configuration'}</button>
                </div>
                {saveRegConfigMutation.isSuccess && <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">Register configuration saved successfully!</div>}
                {saveRegConfigMutation.isError && <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">Failed to save: {saveRegConfigMutation.error?.response?.data?.error || 'Unknown error'}</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// MANUAL ENTRY TAB
// ═══════════════════════════════════════════
function ManualEntryTab() {
  const queryClient = useQueryClient()
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [attendanceData, setAttendanceData] = useState([])
  const [saveMsg, setSaveMsg] = useState('')

  // Fetch classes (role-aware: admin=all, teacher=assigned only)
  const { data: classesRes, isLoading: classesLoading } = useQuery({
    queryKey: ['myAttendanceClasses'],
    queryFn: () => attendanceApi.getMyAttendanceClasses(),
  })
  const classes = classesRes?.data || []

  // Fetch students for selected class
  const { data: studentsRes, isLoading: studentsLoading } = useQuery({
    queryKey: ['studentsForAttendance', classId],
    queryFn: () => studentsApi.getStudents({ class_id: classId, is_active: true, page_size: 500 }),
    enabled: !!classId,
  })
  const students = studentsRes?.data?.results || studentsRes?.data || []

  // Fetch existing records for this class+date
  const { data: existingRes, isLoading: existingLoading } = useQuery({
    queryKey: ['existingAttendance', classId, date],
    queryFn: () => attendanceApi.getRecords({ class_id: classId, date, page_size: 500 }),
    enabled: !!classId && !!date,
  })
  const existingRecords = existingRes?.data?.results || existingRes?.data || []

  // Merge students + existing records into grid
  useEffect(() => {
    if (!classId || !date || studentsLoading || existingLoading) return

    const existingMap = {}
    for (const r of existingRecords) {
      existingMap[r.student || r.student_id] = r.status
    }

    setAttendanceData(
      students
        .slice()
        .sort((a, b) => (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0))
        .map(s => ({
          student_id: s.id,
          student_name: s.name,
          student_roll: s.roll_number || '',
          status: existingMap[s.id] || 'PRESENT',
        }))
    )
  }, [classId, date, students.length, existingRecords.length, studentsLoading, existingLoading])

  // Bulk save mutation
  const bulkSaveMut = useMutation({
    mutationFn: (data) => attendanceApi.bulkEntryAttendance(data),
    onSuccess: (res) => {
      const d = res.data
      setSaveMsg(`Saved! ${d.created} created, ${d.updated} updated.${d.errors?.length ? ` ${d.errors.length} errors.` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['attendanceRecords'] })
      queryClient.invalidateQueries({ queryKey: ['existingAttendance'] })
      setTimeout(() => setSaveMsg(''), 5000)
    },
    onError: (err) => {
      setSaveMsg(`Error: ${err.response?.data?.detail || 'Failed to save attendance.'}`)
    },
  })

  const toggleStatus = (idx) => {
    setAttendanceData(prev => prev.map((item, i) =>
      i === idx ? { ...item, status: item.status === 'PRESENT' ? 'ABSENT' : 'PRESENT' } : item
    ))
  }

  const markAll = (status) => {
    setAttendanceData(prev => prev.map(item => ({ ...item, status })))
  }

  const handleSave = () => {
    bulkSaveMut.mutate({
      class_id: parseInt(classId),
      date,
      entries: attendanceData.map(a => ({ student_id: a.student_id, status: a.status })),
    })
  }

  const presentCount = attendanceData.filter(a => a.status === 'PRESENT').length
  const absentCount = attendanceData.filter(a => a.status === 'ABSENT').length
  const hasExisting = existingRecords.length > 0

  const isDataLoading = studentsLoading || existingLoading

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select
              value={classId}
              onChange={e => { setClassId(e.target.value); setAttendanceData([]); setSaveMsg('') }}
              className="input w-full"
              disabled={classesLoading}
            >
              <option value="">{classesLoading ? 'Loading classes...' : 'Select Class'}</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setAttendanceData([]); setSaveMsg('') }}
              className="input w-full"
            />
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!classId ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">Select a class and date to mark attendance</p>
        </div>
      ) : isDataLoading ? (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading students...</p>
        </div>
      ) : attendanceData.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No active students found in this class.</p>
        </div>
      ) : (
        <>
          {/* Existing records info */}
          {hasExisting && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Attendance records already exist for this date ({existingRecords.length} records). Saving will update them.</span>
            </div>
          )}

          {/* Quick actions + summary */}
          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex gap-2">
                <button onClick={() => markAll('PRESENT')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200">Mark All Present</button>
                <button onClick={() => markAll('ABSENT')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200">Mark All Absent</button>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-semibold">{presentCount} Present</span>
                <span className="text-red-600 font-semibold">{absentCount} Absent</span>
                <span className="text-gray-500">{attendanceData.length} Total</span>
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block card p-0 overflow-hidden">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b w-12">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b w-20">Roll</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase border-b">Student Name</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase border-b w-32">Status</th>
                </tr>
              </thead>
              <tbody>
                {attendanceData.map((item, idx) => (
                  <tr key={item.student_id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-4 py-2.5 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-600 font-medium">{item.student_roll}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900">{item.student_name}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleStatus(idx)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors min-w-[80px] ${
                          item.status === 'PRESENT'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}
                      >
                        {item.status === 'PRESENT' ? 'Present' : 'Absent'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {attendanceData.map((item, idx) => (
              <div key={item.student_id} className="card py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.student_name}</p>
                  <p className="text-xs text-gray-500">Roll #{item.student_roll}</p>
                </div>
                <button
                  onClick={() => toggleStatus(idx)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    item.status === 'PRESENT'
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                  }`}
                >
                  {item.status === 'PRESENT' ? 'P' : 'A'}
                </button>
              </div>
            ))}
          </div>

          {/* Save button + messages */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="text-sm">
              {saveMsg && (
                <p className={saveMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}>{saveMsg}</p>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={bulkSaveMut.isPending || attendanceData.length === 0}
              className="btn btn-primary min-w-[180px]"
            >
              {bulkSaveMut.isPending ? 'Saving...' : `Save Attendance (${attendanceData.length})`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════
export default function RegisterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isSchoolAdmin, isTeacher, isPrincipal } = useAuth()
  const canManualEntry = isSchoolAdmin || isTeacher || isPrincipal
  const initialTab = searchParams.get('tab') || 'register'
  const [activeTab, setActiveTab] = useState(initialTab)

  const switchTab = (tab) => {
    setActiveTab(tab)
    setSearchParams(tab === 'register' ? {} : { tab })
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Register & Analytics</h1>
        <p className="text-sm text-gray-600">Attendance records, AI accuracy, and configuration</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4 overflow-x-auto">
        <nav className="flex space-x-1 sm:space-x-2 min-w-max">
          <TabButton active={activeTab === 'register'} onClick={() => switchTab('register')}>Register</TabButton>
          {canManualEntry && (
            <TabButton active={activeTab === 'manual'} onClick={() => switchTab('manual')}>Manual Entry</TabButton>
          )}
          <TabButton active={activeTab === 'analytics'} onClick={() => switchTab('analytics')}>Analytics</TabButton>
          <TabButton active={activeTab === 'config'} onClick={() => switchTab('config')}>Configuration</TabButton>
        </nav>
      </div>

      {activeTab === 'register' && <RegisterTab />}
      {activeTab === 'manual' && canManualEntry && <ManualEntryTab />}
      {activeTab === 'analytics' && <AnalyticsTab onGoToConfig={() => switchTab('config')} />}
      {activeTab === 'config' && <ConfigurationTab />}
    </div>
  )
}
