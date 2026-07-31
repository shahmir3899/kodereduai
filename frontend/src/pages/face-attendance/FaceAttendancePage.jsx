import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { useFaceAttendanceStatus } from '../../hooks/useFaceAttendanceStatus'
import { getClassSelectorScope, getResolvedMasterClassId, resolveSessionClassId } from '../../utils/classScope'
import FaceLiveCapturePage from './FaceLiveCapturePage'

const TIER_B_STATUS_BADGE = {
  active: { label: 'Fixed Camera: Active', className: 'bg-green-100 text-green-700' },
  inactive: { label: 'Fixed Camera: Offline', className: 'bg-gray-100 text-gray-600' },
}

// Tabs are two capture modes ("Group Photo" — Tier C, "Mobile Capture" —
// Tier A) plus the existing session history. Consolidated 2026-07: Mobile
// Capture used to live at its own /face-attendance/live-capture route,
// disconnected from this page — that route now redirects here with
// ?tab=mobile so old links/bookmarks keep working.
const TABS = [
  { id: 'group-photo', label: 'Group Photo' },
  { id: 'mobile-capture', label: 'Mobile Capture' },
  { id: 'sessions', label: 'Sessions' },
]

export default function FaceAttendancePage() {
  const { activeSchool, isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const [searchParams] = useSearchParams()

  const [tab, setTab] = useState(searchParams.get('tab') === 'mobile' ? 'mobile-capture' : 'group-photo')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [uploadStep, setUploadStep] = useState(null) // null | 'uploading' | 'creating'
  const [previewUrl, setPreviewUrl] = useState(null)
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const resolvedSelectedSessionClass = resolveSessionClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: true,
    queryKey: 'teacherFaceAttendanceClasses',
  })

  // Load face recognition status (also carries the Tier B device status badge below)
  const { status: faceStatus, tierBStatus } = useFaceAttendanceStatus()

  // Load recent sessions
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['faceSessions', activeSchool?.id],
    queryFn: () => faceAttendanceApi.getSessions({ page_size: 20 }),
    enabled: !!activeSchool,
  })
  const sessions = sessionsData?.data?.results || sessionsData?.data || []

  // Load pending reviews
  const { data: pendingData } = useQuery({
    queryKey: ['pendingFaceReviews', activeSchool?.id],
    queryFn: () => faceAttendanceApi.getPendingReview(),
    enabled: !!activeSchool,
  })
  const pendingReviews = pendingData?.data?.results || pendingData?.data || []

  // Upload and create session mutation
  const createSessionMutation = useMutation({
    mutationFn: async (file) => {
      // Step 1: Upload image
      setUploadStep('uploading')
      const uploadRes = await faceAttendanceApi.uploadImage(
        file, activeSchool?.id, resolvedSelectedClass
      )
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url

      // Step 2: Create session
      setUploadStep('creating')
      const sessionRes = await faceAttendanceApi.createSession({
        class_obj: parseInt(resolvedSelectedClass),
        date: selectedDate,
        image_url: imageUrl,
      }, {
        ...(resolvedSelectedSessionClass && { session_class_id: resolvedSelectedSessionClass }),
        ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      })
      return sessionRes.data
    },
    onSuccess: (data) => {
      setUploadStep(null)
      setPreviewUrl(null)
      showSuccess('Session created! Processing faces...')
      queryClient.invalidateQueries({ queryKey: ['faceSessions'] })
      queryClient.invalidateQueries({ queryKey: ['pendingFaceReviews'] })
      // Navigate to review page
      navigate(`/face-attendance/review/${data.id}`)
    },
    onError: (err) => {
      setUploadStep(null)
      showError(err.response?.data?.error || err.response?.data?.detail || 'Failed to create session')
    },
  })

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!selectedClass) {
      showError('Please select a class first.')
      return
    }

    // Preview
    const reader = new FileReader()
    reader.onload = (ev) => setPreviewUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleCapture = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      showError('Please select an image first.')
      return
    }
    createSessionMutation.mutate(file)
  }

  const getStatusBadge = (status) => {
    const map = {
      UPLOADING: 'bg-gray-100 text-gray-700',
      PROCESSING: 'bg-blue-100 text-blue-700',
      NEEDS_REVIEW: 'bg-yellow-100 text-yellow-700',
      CONFIRMED: 'bg-green-100 text-green-700',
      FAILED: 'bg-red-100 text-red-700',
    }
    return map[status] || 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Face Attendance</h1>
            {TIER_B_STATUS_BADGE[tierBStatus] && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TIER_B_STATUS_BADGE[tierBStatus].className}`}>
                {TIER_B_STATUS_BADGE[tierBStatus].label}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">Camera-based multi-student attendance</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/face-attendance/bulk-enrollment')}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Bulk Enrollment
          </button>
          <button
            onClick={() => navigate('/face-attendance/devices')}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Capture Devices
          </button>
          <button
            onClick={() => navigate('/face-attendance/enrollment')}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage Enrollments
          </button>
        </div>
      </div>

      {/* Status banner */}
      {faceStatus && !faceStatus.face_recognition_available && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Face recognition library is not installed. Please install the <code>face_recognition</code> package.
        </div>
      )}

      {faceStatus && faceStatus.enrolled_faces === 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
          No students have been enrolled for face recognition yet.{' '}
          <button onClick={() => navigate('/face-attendance/enrollment')} className="underline font-medium">
            Enroll student faces
          </button>{' '}
          to get started.
        </div>
      )}

      {/* Pending reviews banner */}
      {pendingReviews.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center justify-between">
          <span>{pendingReviews.length} session(s) ready for review</span>
          <button
            onClick={() => navigate(`/face-attendance/review/${pendingReviews[0].id}`)}
            className="text-blue-700 font-medium underline"
          >
            Review Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'mobile-capture' && <FaceLiveCapturePage />}

      {tab === 'group-photo' && (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Capture Group Photo</h2>

          {/* Class and date selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                scope={classSelectorScope}
                academicYearId={activeAcademicYear?.id}
                showAllOption={showAllOption}
                classes={teacherClassOptions || undefined}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Image upload area */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            {previewUrl ? (
              <div>
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-64 mx-auto rounded-lg mb-4"
                />
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => { setPreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleCapture}
                    disabled={!!uploadStep}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploadStep === 'uploading' ? 'Uploading...' :
                     uploadStep === 'creating' ? 'Creating session...' :
                     'Process Attendance'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="mt-2 text-sm text-gray-500">
                  Take a photo of the class or upload an image
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedClass}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {selectedClass ? 'Select or Capture Photo' : 'Select a class first'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Recent Sessions</h2>
          </div>
          {sessionsLoading ? (
            <div className="p-8"><LoadingSpinner /></div>
          ) : sessions.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No face attendance sessions yet.</div>
          ) : (
            <div className="divide-y">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="p-4 hover:bg-gray-50 cursor-pointer flex items-center justify-between"
                  onClick={() => {
                    if (session.status === 'NEEDS_REVIEW' || session.status === 'CONFIRMED') {
                      navigate(`/face-attendance/review/${session.id}`)
                    }
                  }}
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {session.class_obj?.name || 'Class'} - {session.date}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {session.total_faces_detected} faces detected, {session.faces_matched} matched
                    </div>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(session.status)}`}>
                    {session.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
