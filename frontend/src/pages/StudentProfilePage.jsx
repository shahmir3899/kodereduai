import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, reportsApi } from '../services/api'
import { useToast } from '../components/Toast'
import { useBackgroundTask } from '../hooks/useBackgroundTask'
import WhatsAppTick from '../components/WhatsAppTick'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { useAuth } from '../contexts/AuthContext'
import { useSessionClasses } from '../hooks/useSessionClasses'
import { getNextAvailableRoll } from '../utils/rollSuggestion'

const TABS = ['Overview', 'Attendance', 'Fees', 'Academics', 'History', 'Documents']

const riskColors = {
  HIGH: 'bg-red-100 text-red-800 border-red-200',
  MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  LOW: 'bg-green-100 text-green-800 border-green-200',
}

function getApiErrorMessage(error, fallback) {
  const data = error?.response?.data
  if (!data) return error?.message || fallback
  if (typeof data === 'string') return data
  if (typeof data.detail === 'string') return data.detail

  const firstKey = Object.keys(data)[0]
  if (!firstKey) return fallback
  const firstValue = data[firstKey]

  if (Array.isArray(firstValue) && firstValue.length > 0) {
    return `${firstKey}: ${firstValue[0]}`
  }
  if (typeof firstValue === 'string') {
    return `${firstKey}: ${firstValue}`
  }
  return fallback
}

function normalizeGender(gender) {
  if (!gender) return ''
  const value = String(gender).trim().toUpperCase()
  if (value === 'MALE') return 'M'
  if (value === 'FEMALE') return 'F'
  if (value === 'OTHER') return 'O'
  if (value === 'M' || value === 'F' || value === 'O') return value
  return ''
}

export default function StudentProfilePage() {
  const { id } = useParams()
  const [tab, setTab] = useState('Overview')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    roll_number: '',
    admission_number: '',
    admission_date: '',
    date_of_birth: '',
    gender: '',
    blood_group: '',
    address: '',
    previous_school: '',
    parent_phone: '',
    parent_name: '',
    guardian_name: '',
    guardian_relation: '',
    guardian_phone: '',
    guardian_email: '',
    guardian_occupation: '',
    guardian_address: '',
    emergency_contact: '',
  })
  const [editRollManuallyEdited, setEditRollManuallyEdited] = useState(false)
  const [recommendedEditRoll, setRecommendedEditRoll] = useState('')
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [statusForm, setStatusForm] = useState({ status: '', status_date: '', status_reason: '' })
  const [showReclassifyModal, setShowReclassifyModal] = useState(false)
  const [reclassifyForm, setReclassifyForm] = useState({
    target_session_class_id: '',
    new_roll_number: '',
    reason: '',
  })
  const [reclassifyRollManuallyEdited, setReclassifyRollManuallyEdited] = useState(false)
  const [recommendedReclassifyRoll, setRecommendedReclassifyRoll] = useState('')
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const {
    sessionClasses: correctionSessionClasses,
    isLoading: correctionClassesLoading,
  } = useSessionClasses(activeAcademicYear?.id)

  // Report download (background task)
  const reportTask = useBackgroundTask({
    mutationFn: (data) => reportsApi.generate(data),
    taskType: 'REPORT_GENERATION',
    title: 'Generating Student Report',
    onSuccess: (resultData) => {
      if (resultData?.download_url) {
        const baseUrl = import.meta.env.VITE_API_URL || ''
        window.open(`${baseUrl}${resultData.download_url}`, '_blank')
      }
    },
  })

  // Core data
  const { data: studentData, isLoading, isError: studentIsError, error: studentError } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.getStudent(id),
  })

  const { data: summaryData, isLoading: summaryLoading, isError: summaryIsError, error: summaryError } = useQuery({
    queryKey: ['studentProfileSummary', id],
    queryFn: () => studentsApi.getProfileSummary(id),
  })

  // AI Profile
  const { data: aiData, isLoading: aiLoading, isError: aiIsError, error: aiError } = useQuery({
    queryKey: ['studentAIProfile', id],
    queryFn: () => studentsApi.getAIProfile(id),
  })

  // Tab-specific data — staleTime keeps cached results across tab switches;
  // gcTime holds data in memory for 10 min so re-visits within the session are instant.
  const { data: attendanceData, isLoading: attendanceLoading, isError: attendanceIsError, error: attendanceError } = useQuery({
    queryKey: ['studentAttendance', id],
    queryFn: () => studentsApi.getAttendanceHistory(id),
    enabled: tab === 'Attendance',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: feeData, isLoading: feeLoading, isError: feeIsError, error: feeError } = useQuery({
    queryKey: ['studentFees', id],
    queryFn: () => studentsApi.getFeeLedger(id),
    enabled: tab === 'Fees',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: examData, isLoading: examLoading, isError: examIsError, error: examError } = useQuery({
    queryKey: ['studentExams', id],
    queryFn: () => studentsApi.getExamResults(id),
    enabled: tab === 'Academics',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: historyData, isLoading: historyLoading, isError: historyIsError, error: historyError } = useQuery({
    queryKey: ['studentHistory', id],
    queryFn: () => studentsApi.getEnrollmentHistory(id),
    enabled: tab === 'History',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: docsData, isLoading: docsLoading, isError: docsIsError, error: docsError, refetch: refetchDocs } = useQuery({
    queryKey: ['studentDocuments', id],
    queryFn: () => studentsApi.getDocuments(id),
    enabled: tab === 'Documents',
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: reclassifyStudentsData } = useQuery({
    queryKey: ['studentReclassifyStudents', activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      school_id: activeSchool?.id,
      academic_year: activeAcademicYear?.id,
      page_size: 9999,
    }),
    enabled: showReclassifyModal && !!activeAcademicYear?.id,
    staleTime: 60_000,
  })

  const { data: editStudentsData } = useQuery({
    queryKey: ['studentEditRollStudents', activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      school_id: activeSchool?.id,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      page_size: 9999,
    }),
    enabled: showEditModal && !!activeSchool?.id,
    staleTime: 60_000,
  })

  const updateStudentMutation = useMutation({
    mutationFn: (payload) => studentsApi.updateStudent(id, payload),
    onSuccess: () => {
      showSuccess('Student profile updated successfully')
      setShowEditModal(false)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['studentProfileSummary', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (error) => {
      const message = getApiErrorMessage(error, 'Failed to update student profile')
      showError(message)
    },
  })

  const reclassifyMutation = useMutation({
    mutationFn: (payload) => studentsApi.reclassifyStudent(id, payload),
    onSuccess: () => {
      showSuccess('Student reclassified successfully')
      setShowReclassifyModal(false)
      setReclassifyForm({ target_session_class_id: '', new_roll_number: '', reason: '' })
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['studentHistory', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['promotion-history'] })
    },
    onError: (error) => {
      const message = error?.response?.data?.detail || error?.message || 'Failed to reclassify student'
      showError(message)
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: (payload) => studentsApi.updateStudent(id, payload),
    onSuccess: () => {
      showSuccess('Student status updated successfully')
      setShowStatusModal(false)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (error) => {
      showError(getApiErrorMessage(error, 'Failed to update student status'))
    },
  })

  const student = studentData?.data
  const summary = summaryData?.data
  const ai = aiData?.data
  const reclassifyStudents = reclassifyStudentsData?.data?.results || reclassifyStudentsData?.data || []
  const editStudents = editStudentsData?.data?.results || editStudentsData?.data || []

  const occupiedRollsForEditClass = useMemo(() => {
    if (!student?.class_obj) return []

    return editStudents
      .filter((s) => {
        if (String(s.id) === String(id)) return false
        return String(s.class_obj || '') === String(student.class_obj)
      })
      .map((s) => s.roll_number)
  }, [editStudents, student?.class_obj, id])

  useEffect(() => {
    if (!showEditModal || !student?.class_obj) {
      setRecommendedEditRoll('')
      return
    }

    const nextRoll = getNextAvailableRoll(occupiedRollsForEditClass)
    setRecommendedEditRoll(nextRoll)

    if (!editRollManuallyEdited && !editForm.roll_number?.trim()) {
      setEditForm((prev) => ({ ...prev, roll_number: nextRoll }))
    }
  }, [
    showEditModal,
    student?.class_obj,
    occupiedRollsForEditClass,
    editRollManuallyEdited,
    editForm.roll_number,
  ])

  const occupiedRollsForReclassifyClass = useMemo(() => {
    if (!reclassifyForm.target_session_class_id) return []

    return reclassifyStudents
      .filter((s) => {
        if (String(s.id) === String(id)) return false
        if (String(s.session_class_obj || '') === String(reclassifyForm.target_session_class_id)) return true

        // Fallback for payloads without session_class_obj annotation
        const selectedSessionClass = correctionSessionClasses.find(
          (sc) => String(sc.id) === String(reclassifyForm.target_session_class_id),
        )
        if (!selectedSessionClass?.class_obj) return false
        return String(s.class_obj || '') === String(selectedSessionClass.class_obj)
      })
      .map((s) => s.roll_number)
  }, [reclassifyStudents, correctionSessionClasses, reclassifyForm.target_session_class_id, id])

  useEffect(() => {
    if (!showReclassifyModal || !reclassifyForm.target_session_class_id) {
      setRecommendedReclassifyRoll('')
      return
    }

    const nextRoll = getNextAvailableRoll(occupiedRollsForReclassifyClass)
    setRecommendedReclassifyRoll(nextRoll)

    if (!reclassifyRollManuallyEdited && !reclassifyForm.new_roll_number?.trim()) {
      setReclassifyForm((prev) => ({ ...prev, new_roll_number: nextRoll }))
    }
  }, [
    showReclassifyModal,
    reclassifyForm.target_session_class_id,
    occupiedRollsForReclassifyClass,
    reclassifyRollManuallyEdited,
    reclassifyForm.new_roll_number,
  ])

  const handleOpenEditModal = () => {
    setEditForm({
      name: student?.name || '',
      roll_number: student?.roll_number || '',
      admission_number: student?.admission_number || '',
      admission_date: student?.admission_date || '',
      date_of_birth: student?.date_of_birth || '',
      gender: normalizeGender(student?.gender),
      blood_group: student?.blood_group || '',
      address: student?.address || '',
      previous_school: student?.previous_school || '',
      parent_phone: student?.parent_phone || '',
      parent_name: student?.parent_name || '',
      guardian_name: student?.guardian_name || '',
      guardian_relation: student?.guardian_relation || '',
      guardian_phone: student?.guardian_phone || '',
      guardian_email: student?.guardian_email || '',
      guardian_occupation: student?.guardian_occupation || '',
      guardian_address: student?.guardian_address || '',
      emergency_contact: student?.emergency_contact || '',
    })
    setEditRollManuallyEdited(false)
    setRecommendedEditRoll('')
    setShowEditModal(true)
  }

  const applyRecommendedEditRoll = () => {
    if (!recommendedEditRoll) return
    setEditForm((prev) => ({ ...prev, roll_number: recommendedEditRoll }))
    setEditRollManuallyEdited(true)
  }

  const handleSubmitEdit = () => {
    if (!editForm.name?.trim() || !editForm.roll_number?.trim()) {
      showError('Name and roll number are required')
      return
    }

    const payload = {
      ...editForm,
      name: editForm.name.trim(),
      roll_number: editForm.roll_number.trim(),
      gender: normalizeGender(editForm.gender),
      admission_date: editForm.admission_date || null,
      date_of_birth: editForm.date_of_birth || null,
    }

    updateStudentMutation.mutate({
      ...payload,
    })
  }

  const handleOpenStatusModal = () => {
    setStatusForm({
      status: student?.status || 'ACTIVE',
      status_date: student?.status_date || '',
      status_reason: student?.status_reason || '',
    })
    setShowStatusModal(true)
  }

  const handleSubmitStatus = () => {
    if (!statusForm.status) {
      showError('Status is required')
      return
    }
    updateStatusMutation.mutate({
      status: statusForm.status,
      status_date: statusForm.status_date || null,
      status_reason: statusForm.status_reason,
    })
  }

  const handleOpenReclassifyModal = () => {
    if (!activeAcademicYear?.id) {
      showError('Select an academic year from the top switcher first')
      return
    }
    setReclassifyForm({
      target_session_class_id: '',
      new_roll_number: student?.roll_number || '',
      reason: '',
    })
    setReclassifyRollManuallyEdited(false)
    setRecommendedReclassifyRoll('')
    setShowReclassifyModal(true)
  }

  const handleReclassifyClassChange = (value) => {
    if (!reclassifyForm.new_roll_number?.trim()) {
      setReclassifyRollManuallyEdited(false)
    }
    setReclassifyForm((prev) => ({
      ...prev,
      target_session_class_id: value,
      new_roll_number: reclassifyRollManuallyEdited ? prev.new_roll_number : '',
    }))
  }

  const applyRecommendedReclassifyRoll = () => {
    if (!recommendedReclassifyRoll) return
    setReclassifyForm((prev) => ({ ...prev, new_roll_number: recommendedReclassifyRoll }))
    setReclassifyRollManuallyEdited(true)
  }

  const handleSubmitReclassify = () => {
    if (!activeAcademicYear?.id || !reclassifyForm.target_session_class_id) {
      showError('Selected academic year and target class are required')
      return
    }
    if (!reclassifyForm.reason.trim()) {
      showError('Reason is required')
      return
    }

    const selectedSessionClass = correctionSessionClasses.find(
      (sc) => String(sc.id) === String(reclassifyForm.target_session_class_id),
    )

    reclassifyMutation.mutate({
      academic_year_id: Number(activeAcademicYear.id),
      target_session_class_id: Number(reclassifyForm.target_session_class_id),
      ...(selectedSessionClass?.class_obj && { target_class_id: Number(selectedSessionClass.class_obj) }),
      ...(reclassifyForm.new_roll_number.trim() && { new_roll_number: reclassifyForm.new_roll_number.trim() }),
      reason: reclassifyForm.reason.trim(),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (studentIsError) {
    return (
      <div className="text-center py-20 text-red-600">
        Failed to load student profile: {studentError?.message || 'Unknown error'}
      </div>
    )
  }

  if (!student) {
    return <div className="text-center py-20 text-gray-500">Student not found</div>
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/students" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Students
      </Link>

      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-primary-700">
              {student.name?.charAt(0)?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
              {ai?.overall_risk && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${riskColors[ai.overall_risk]}`}>
                  {ai.overall_risk} Risk
                </span>
              )}
              {student.status && student.status !== 'ACTIVE' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {student.status}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              <span>Roll #{student.roll_number}</span>
              <span>{student.class_name}</span>
              {student.admission_number && <span>Adm #{student.admission_number}</span>}
              {student.gender && <span>{student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : 'Other'}</span>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              {student.parent_phone && <span>Parent: {student.parent_phone}<WhatsAppTick phone={student.parent_phone} /></span>}
              {student.guardian_phone && <span>Guardian: {student.guardian_phone}<WhatsAppTick phone={student.guardian_phone} /></span>}
              {student.parent_name && <span>{student.parent_name}</span>}
            </div>
            {/* Quick-action chips */}
            <div className="flex flex-wrap gap-2 mt-2">
              {student.emergency_contact && (
                <a
                  href={`tel:${student.emergency_contact}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  Emergency: {student.emergency_contact}
                </a>
              )}
              {student.has_user_account ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  Portal: {student.user_username}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  No portal account
                </span>
              )}
              {student.status && student.status !== 'ACTIVE' && student.status_reason && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title={student.status_reason}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {student.status_reason.length > 40 ? student.status_reason.slice(0, 40) + '…' : student.status_reason}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            <button
              onClick={handleOpenEditModal}
              className="px-4 py-2 bg-gray-100 text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-200 text-sm"
            >
              Edit Profile
            </button>
            <button
              onClick={handleOpenStatusModal}
              className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-200 text-sm"
            >
              Update Status
            </button>
            <button
              onClick={handleOpenReclassifyModal}
              className="px-4 py-2 bg-blue-100 text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-200 text-sm"
            >
              Reclassify
            </button>
            <button
              onClick={() => reportTask.trigger({
                report_type: 'STUDENT_COMPREHENSIVE',
                format: 'PDF',
                parameters: { student_id: parseInt(id) },
              })}
              disabled={reportTask.isSubmitting}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              {reportTask.isSubmitting ? 'Starting...' : 'Download Report'}
            </button>
          </div>
        </div>
      </div>

      <ProfileDetailsSection student={student} />

      {/* AI Summary */}
      {aiLoading && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
          Loading AI assessment...
        </div>
      )}
      {aiIsError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          AI assessment unavailable: {aiError?.message || 'Unable to fetch profile insights'}
        </div>
      )}
      {ai?.ai_summary && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-indigo-900">AI Assessment</p>
              <p className="text-sm text-indigo-800 mt-0.5">{ai.ai_summary}</p>
              {ai.recommendations?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {ai.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-indigo-700 flex items-start gap-1">
                      <span className="mt-0.5">-</span> {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {tab === 'Overview' && <OverviewTab summary={summary} ai={ai} isLoading={summaryLoading} error={summaryIsError ? summaryError : null} />}
      {tab === 'Attendance' && <AttendanceTab data={attendanceData?.data} isLoading={attendanceLoading} error={attendanceIsError ? attendanceError : null} />}
      {tab === 'Fees' && <FeesTab data={feeData?.data} isLoading={feeLoading} error={feeIsError ? feeError : null} />}
      {tab === 'Academics' && <AcademicsTab data={examData?.data} isLoading={examLoading} error={examIsError ? examError : null} />}
      {tab === 'History' && <HistoryTab data={historyData?.data} isLoading={historyLoading} error={historyIsError ? historyError : null} />}
      {tab === 'Documents' && <DocumentsTab studentId={id} data={docsData?.data} refetch={refetchDocs} isLoading={docsLoading} error={docsIsError ? docsError : null} />}

      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Edit Student Profile</h2>
              <p className="text-sm text-gray-500 mt-1">Quick edits stay on Students list. Use this form for full profile fields.</p>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Roll Number</label>
                    {recommendedEditRoll && (
                      <button
                        type="button"
                        className="text-xs font-medium text-primary-600 hover:text-primary-700"
                        onClick={applyRecommendedEditRoll}
                      >
                        Suggest {recommendedEditRoll}
                      </button>
                    )}
                  </div>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    value={editForm.roll_number}
                    onChange={(e) => {
                      setEditRollManuallyEdited(true)
                      setEditForm((p) => ({ ...p, roll_number: e.target.value }))
                    }}
                  />
                  {recommendedEditRoll && (
                    <p className="text-xs text-gray-500 mt-1">Next available roll in this class: {recommendedEditRoll}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Admission Number</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.admission_number} onChange={(e) => setEditForm((p) => ({ ...p, admission_number: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Admission Date</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.admission_date || ''} onChange={(e) => setEditForm((p) => ({ ...p, admission_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                  <input type="date" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.date_of_birth || ''} onChange={(e) => setEditForm((p) => ({ ...p, date_of_birth: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.gender} onChange={(e) => setEditForm((p) => ({ ...p, gender: e.target.value }))}>
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="O">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.blood_group} onChange={(e) => setEditForm((p) => ({ ...p, blood_group: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parent Phone</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.parent_phone} onChange={(e) => setEditForm((p) => ({ ...p, parent_phone: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parent Name</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.parent_name} onChange={(e) => setEditForm((p) => ({ ...p, parent_name: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Name</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_name} onChange={(e) => setEditForm((p) => ({ ...p, guardian_name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Relation</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_relation} onChange={(e) => setEditForm((p) => ({ ...p, guardian_relation: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Phone</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_phone} onChange={(e) => setEditForm((p) => ({ ...p, guardian_phone: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Email</label>
                  <input type="email" className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_email} onChange={(e) => setEditForm((p) => ({ ...p, guardian_email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Occupation</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_occupation} onChange={(e) => setEditForm((p) => ({ ...p, guardian_occupation: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact</label>
                  <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.emergency_contact} onChange={(e) => setEditForm((p) => ({ ...p, emergency_contact: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Previous School</label>
                <input className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.previous_school} onChange={(e) => setEditForm((p) => ({ ...p, previous_school: e.target.value }))} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Address</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={editForm.guardian_address} onChange={(e) => setEditForm((p) => ({ ...p, guardian_address: e.target.value }))} />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSubmitEdit} disabled={updateStudentMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {updateStudentMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Update Student Status</h2>
              <p className="text-sm text-gray-500 mt-1">Use this for mid-session status changes (e.g. student left, transferred, suspended).</p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={statusForm.status}
                  onChange={(e) => setStatusForm((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="WITHDRAWN">Withdrawn (Left school)</option>
                  <option value="TRANSFERRED">Transferred (Moved to another school)</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="GRADUATED">Graduated</option>
                  <option value="REPEAT">Repeat</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={statusForm.status_date}
                  onChange={(e) => setStatusForm((p) => ({ ...p, status_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={statusForm.status_reason}
                  onChange={(e) => setStatusForm((p) => ({ ...p, status_reason: e.target.value }))}
                  placeholder="Brief reason for status change"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowStatusModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSubmitStatus} disabled={updateStatusMutation.isPending} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {updateStatusMutation.isPending ? 'Saving...' : 'Save Status'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReclassifyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Reclassify Student</h2>
              <p className="text-sm text-gray-500 mt-1">Use this for single-student correction. For year-end transitions, use Promotion page.</p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year</label>
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700">
                  {activeAcademicYear?.name || 'No academic year selected'}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Class</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={reclassifyForm.target_session_class_id}
                  onChange={(e) => handleReclassifyClassChange(e.target.value)}
                  disabled={!activeAcademicYear?.id || correctionClassesLoading}
                >
                  <option value="">Select class</option>
                  {correctionSessionClasses.map((sc) => {
                    const label = sc.label || (sc.section ? `${sc.display_name || sc.name} - ${sc.section}` : (sc.display_name || sc.name))
                    return (
                      <option key={sc.id} value={sc.id}>{label}</option>
                    )
                  })}
                </select>
                {!activeAcademicYear?.id && (
                  <p className="text-xs text-amber-600 mt-1">Pick an academic year from the top switcher to load session classes.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Roll Number (optional)</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  value={reclassifyForm.new_roll_number}
                  onChange={(e) => {
                    setReclassifyRollManuallyEdited(true)
                    setReclassifyForm((p) => ({ ...p, new_roll_number: e.target.value }))
                  }}
                />
                {recommendedReclassifyRoll && reclassifyForm.target_session_class_id && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span>Suggested next roll: {recommendedReclassifyRoll}</span>
                    {String(reclassifyForm.new_roll_number || '').trim() !== String(recommendedReclassifyRoll) && (
                      <button
                        type="button"
                        className="text-primary-600 hover:text-primary-700 font-medium"
                        onClick={applyRecommendedReclassifyRoll}
                      >
                        Use suggested
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <textarea rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg" value={reclassifyForm.reason} onChange={(e) => setReclassifyForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Why this correction is required" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowReclassifyModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={handleSubmitReclassify} disabled={reclassifyMutation.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {reclassifyMutation.isPending ? 'Applying...' : 'Apply Reclassification'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

function DetailGroup({ title, rows, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const visibleRows = rows.filter((row) => row.value)
  if (visibleRows.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <dl className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-3">
          {visibleRows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs uppercase tracking-wide text-gray-500">{row.label}</dt>
              <dd className="text-sm text-gray-900 mt-0.5 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function ProfileDetailsSection({ student }) {
  // Determine which groups have any data so empty sections stay hidden entirely
  const hasPersonal = !!(student.date_of_birth || student.blood_group || student.emergency_contact || student.address)
  const hasAdmission = !!(student.admission_date || student.previous_school)
  const hasGuardian = !!(student.guardian_name || student.guardian_relation || student.guardian_email || student.guardian_occupation || student.guardian_address)
  const hasSystem = !!(student.user_username || student.status_date || student.status_reason)

  if (!hasPersonal && !hasAdmission && !hasGuardian && !hasSystem) return null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      {hasPersonal && (
        <DetailGroup
          title="Personal"
          rows={[
            { label: 'Date of Birth', value: formatDate(student.date_of_birth) },
            { label: 'Blood Group', value: student.blood_group },
            { label: 'Emergency Contact', value: student.emergency_contact },
            { label: 'Address', value: student.address },
          ]}
        />
      )}
      {hasAdmission && (
        <DetailGroup
          title="Admission"
          rows={[
            { label: 'Admission Date', value: formatDate(student.admission_date) },
            { label: 'Previous School', value: student.previous_school },
            { label: 'School', value: student.school_name },
            { label: 'Class', value: student.class_name },
          ]}
        />
      )}
      {hasGuardian && (
        <DetailGroup
          title="Guardian"
          rows={[
            { label: 'Guardian Name', value: student.guardian_name },
            { label: 'Relation', value: student.guardian_relation },
            { label: 'Guardian Email', value: student.guardian_email },
            { label: 'Occupation', value: student.guardian_occupation },
            { label: 'Guardian Address', value: student.guardian_address },
          ]}
        />
      )}
      {hasSystem && (
        <DetailGroup
          title="System"
          defaultOpen={false}
          rows={[
            { label: 'Portal Account', value: student.has_user_account ? 'Enabled' : null },
            { label: 'Username', value: student.user_username },
            { label: 'Status Date', value: formatDate(student.status_date) },
            { label: 'Status Reason', value: student.status_reason },
          ]}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    yellow: 'bg-yellow-50 text-yellow-700',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[color]?.split(' ')[1] || 'text-gray-900'}`}>{value ?? '-'}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function OverviewTab({ summary, ai, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading summary...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load summary</div>
  if (!summary) return <div className="text-center py-10 text-gray-500">No summary available</div>

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Attendance"
        value={summary.attendance_rate != null ? `${summary.attendance_rate}%` : 'N/A'}
        sub={`${summary.present_days || 0} / ${summary.total_days || 0} days`}
        color={summary.attendance_rate >= 75 ? 'green' : summary.attendance_rate >= 60 ? 'yellow' : 'red'}
      />
      <StatCard
        label="Fee Paid"
        value={summary.total_due ? `${Math.round((summary.total_paid || 0) / summary.total_due * 100)}%` : 'N/A'}
        sub={`PKR ${(summary.total_paid || 0).toLocaleString()} / ${(summary.total_due || 0).toLocaleString()}`}
        color={summary.total_paid >= summary.total_due ? 'green' : 'yellow'}
      />
      <StatCard
        label="Outstanding"
        value={`PKR ${(summary.outstanding || 0).toLocaleString()}`}
        color={summary.outstanding > 0 ? 'red' : 'green'}
      />
      <StatCard
        label="Exam Average"
        value={summary.exam_average != null ? `${summary.exam_average}` : 'N/A'}
        color={summary.exam_average >= 60 ? 'green' : summary.exam_average >= 40 ? 'yellow' : 'red'}
      />
      {ai?.attendance && (
        <>
          <StatCard label="Attendance Risk" value={ai.attendance.risk} color={ai.attendance.risk === 'LOW' ? 'green' : ai.attendance.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={`Trend: ${ai.attendance.trend}`} />
          <StatCard label="Academic Risk" value={ai.academic?.risk || 'N/A'} color={ai.academic?.risk === 'LOW' ? 'green' : ai.academic?.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={ai.academic?.weakest ? `Weakest: ${ai.academic.weakest}` : null} />
          <StatCard label="Financial Risk" value={ai.financial?.risk || 'N/A'} color={ai.financial?.risk === 'LOW' ? 'green' : ai.financial?.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={`${ai.financial?.months_overdue || 0} months overdue`} />
          <StatCard label="Overall Risk Score" value={ai.risk_score != null ? `${ai.risk_score}%` : 'N/A'} color={ai.overall_risk === 'LOW' ? 'green' : ai.overall_risk === 'MEDIUM' ? 'yellow' : 'red'} />
        </>
      )}
    </div>
  )
}

function AttendanceTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading attendance...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load attendance</div>
  const months = data?.months || []
  if (months.length === 0) return <div className="text-center py-10 text-gray-500">No attendance records found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Present</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Absent</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Late</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {months.map((m, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.month}</td>
              <td className="px-4 py-3 text-sm text-green-600">{m.present}</td>
              <td className="px-4 py-3 text-sm text-red-600">{m.absent}</td>
              <td className="px-4 py-3 text-sm text-yellow-600">{m.late || 0}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{m.total}</td>
              <td className="px-4 py-3 text-sm">
                <span className={`font-medium ${m.rate >= 75 ? 'text-green-600' : m.rate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {m.rate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeesTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading fee records...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load fee records</div>
  const payments = data?.payments || data || []
  if (payments.length === 0) return <div className="text-center py-10 text-gray-500">No fee records found</div>

  const statusColors = {
    PAID: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-yellow-100 text-yellow-800',
    PENDING: 'bg-red-100 text-red-800',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fee Type</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Due</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {payments.map((p, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900">
                {p.month_name || `${p.month}/${p.year}`}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{p.fee_type_name || p.fee_type || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">PKR {parseFloat(p.amount_due || 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">PKR {parseFloat(p.amount_paid || 0).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[p.status] || 'bg-gray-100 text-gray-800'}`}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AcademicsTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading exam results...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load exam results</div>
  const exams = data?.exams || data || []
  if (exams.length === 0) return <div className="text-center py-10 text-gray-500">No exam results found</div>

  return (
    <div className="space-y-4">
      {(Array.isArray(exams) ? exams : Object.entries(exams).map(([name, marks]) => ({ exam_name: name, marks }))).map((exam, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">{exam.exam_name || exam.name || `Exam ${i + 1}`}</h3>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Subject</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Obtained</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">%</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(exam.marks || exam.subjects || []).map((m, j) => {
                const pct = m.total_marks ? Math.round(m.marks_obtained / m.total_marks * 100) : 0
                return (
                  <tr key={j}>
                    <td className="px-4 py-2 text-sm text-gray-900">{m.subject_name || m.subject}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 text-right">{m.marks_obtained}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 text-right">{m.total_marks}</td>
                    <td className="px-4 py-2 text-sm text-right">
                      <span className={pct >= 60 ? 'text-green-600' : pct >= 40 ? 'text-yellow-600' : 'text-red-600'}>
                        {pct}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{m.grade || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function HistoryTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading enrollment history...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load enrollment history</div>
  const history = data?.enrollments || data || []
  if (history.length === 0) return <div className="text-center py-10 text-gray-500">No enrollment history found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Section</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roll #</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {history.map((e, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900">{e.academic_year_name || e.academic_year}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.class_name}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.section || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.roll_number || '-'}</td>
              <td className="px-4 py-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  e.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                  e.status === 'PROMOTED' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {e.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DocumentsTab({ studentId, data, refetch, isLoading, error }) {
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const { showError, showSuccess } = useToast()
  const docs = data?.documents || data || []

  const typeLabels = {
    PHOTO: 'Photo',
    BIRTH_CERT: 'Birth Certificate',
    PREV_REPORT: 'Previous Report',
    TC: 'Transfer Certificate',
    MEDICAL: 'Medical Record',
    OTHER: 'Other',
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await studentsApi.uploadDocument(studentId, {
        title: file.name,
        document_type: 'OTHER',
        file_url: `uploads/${file.name}`, // Placeholder - real upload would use Supabase
      })
      showSuccess('Document record created')
      refetch()
    } catch {
      showError('Failed to upload document')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId) => {
    setDeletingId(docId)
    try {
      await studentsApi.deleteDocument(studentId, docId)
      showSuccess('Document deleted')
      refetch()
    } catch {
      showError('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading documents...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load documents</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload Document'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No documents uploaded</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-500">
                  {typeLabels[doc.document_type] || doc.document_type} - {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:text-primary-800">
                    View
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {deletingId === doc.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
