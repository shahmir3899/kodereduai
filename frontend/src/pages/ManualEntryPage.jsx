import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceApi, sessionsApi } from '../services/api'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import ClassSelector from '../components/ClassSelector'

export default function ManualEntryPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
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

  const { data: sessionClassesRes, isLoading: sessionClassesLoading } = useQuery({
    queryKey: ['manualEntrySessionClasses', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getSessionClasses({
      academic_year: activeAcademicYear?.id,
      page_size: 9999,
      is_active: true,
    }),
    enabled: !!activeAcademicYear?.id,
  })
  const sessionClasses = sessionClassesRes?.data?.results || sessionClassesRes?.data || []

  const allowedMasterClassIds = new Set(classes.map(c => c.id))
  const filteredSessionClasses = sessionClasses.filter(sc => sc.class_obj && allowedMasterClassIds.has(sc.class_obj))
  const useSessionClassFilter = !!activeAcademicYear?.id && filteredSessionClasses.length > 0
  const classOptions = useSessionClassFilter
    ? filteredSessionClasses.map(sc => ({
      id: sc.id,
      name: sc.display_name,
      section: sc.section || '',
      label: sc.label,
    }))
    : classes

  // Fetch enrolled students for selected class + academic year
  const { data: studentsRes, isLoading: studentsLoading } = useQuery({
    queryKey: ['studentsForAttendance', classId, activeAcademicYear?.id, useSessionClassFilter],
    queryFn: () => sessionsApi.getEnrollments({
      ...(useSessionClassFilter ? { session_class_id: classId } : { class_id: classId }),
      academic_year: activeAcademicYear?.id,
      page_size: 500,
    }),
    enabled: !!classId && !!activeAcademicYear?.id,
  })
  const students = (studentsRes?.data?.results || studentsRes?.data || []).map(e => ({
    id: e.student,
    name: e.student_name,
    roll_number: e.roll_number || '',
  }))

  // Fetch existing records for this class+date
  const { data: existingRes, isLoading: existingLoading } = useQuery({
    queryKey: ['existingAttendance', classId, date, activeAcademicYear?.id, useSessionClassFilter],
    queryFn: () => attendanceApi.getRecords({
      ...(useSessionClassFilter ? { session_class_id: classId } : { class_id: classId }),
      date,
      academic_year: activeAcademicYear?.id,
      page_size: 500,
    }),
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
          status: existingMap[s.id] || 'NOT_SET',
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
    setAttendanceData(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const next = item.status === 'NOT_SET' ? 'PRESENT' : item.status === 'PRESENT' ? 'ABSENT' : 'NOT_SET'
      return { ...item, status: next }
    }))
  }

  const markAll = (status) => {
    setAttendanceData(prev => prev.map(item => ({ ...item, status })))
  }

  const handleSave = () => {
    const entries = attendanceData
      .filter(a => a.status !== 'NOT_SET')
      .map(a => ({ student_id: a.student_id, status: a.status }))
    if (entries.length === 0) {
      setSaveMsg('No attendance marked. Set status for at least one student.')
      setTimeout(() => setSaveMsg(''), 4000)
      return
    }
    bulkSaveMut.mutate({
      ...(useSessionClassFilter ? { session_class_id: parseInt(classId) } : { class_id: parseInt(classId) }),
      academic_year: activeAcademicYear?.id,
      date,
      entries,
    })
  }

  const presentCount = attendanceData.filter(a => a.status === 'PRESENT').length
  const absentCount = attendanceData.filter(a => a.status === 'ABSENT').length
  const notSetCount = attendanceData.filter(a => a.status === 'NOT_SET').length
  const hasExisting = existingRecords.length > 0

  const isDataLoading = studentsLoading || existingLoading

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Manual Attendance Entry</h1>

      {/* Selectors */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <ClassSelector
              value={classId}
              onChange={e => { setClassId(e.target.value); setAttendanceData([]); setSaveMsg('') }}
              className="input w-full"
              disabled={classesLoading || sessionClassesLoading}
              classes={classOptions}
              placeholder={classesLoading || sessionClassesLoading ? 'Loading classes...' : 'Select Class'}
            />
            {useSessionClassFilter && (
              <p className="text-[11px] text-blue-600 mt-1">Using session classes for {activeAcademicYear?.name}</p>
            )}
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
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => markAll('PRESENT')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200">Mark All Present</button>
                <button onClick={() => markAll('ABSENT')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200">Mark All Absent</button>
                <button onClick={() => markAll('NOT_SET')} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Reset All</button>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-semibold">{presentCount} Present</span>
                <span className="text-red-600 font-semibold">{absentCount} Absent</span>
                {notSetCount > 0 && <span className="text-gray-400">{notSetCount} Not Set</span>}
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
                            : item.status === 'ABSENT'
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {item.status === 'PRESENT' ? 'Present' : item.status === 'ABSENT' ? 'Absent' : 'Not Set'}
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
                      : item.status === 'ABSENT'
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {item.status === 'PRESENT' ? 'P' : item.status === 'ABSENT' ? 'A' : '—'}
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
              disabled={bulkSaveMut.isPending || (presentCount + absentCount) === 0}
              className="btn btn-primary min-w-[180px]"
            >
              {bulkSaveMut.isPending ? 'Saving...' : `Save Attendance (${presentCount + absentCount})`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
