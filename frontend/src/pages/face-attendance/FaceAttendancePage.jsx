import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'

export default function FaceAttendancePage() {
  const { activeSchool } = useAuth()
  const { showError, showSuccess } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [tab, setTab] = useState('capture') // capture | sessions
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [uploadStep, setUploadStep] = useState(null) // null | 'uploading' | 'creating'
  const [previewUrl, setPreviewUrl] = useState(null)

  // Load face recognition status
  const { data: statusData } = useQuery({
    queryKey: ['faceStatus'],
    queryFn: () => faceAttendanceApi.getStatus(),
  })
  const faceStatus = statusData?.data

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
        file, activeSchool?.id, selectedClass
      )
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url

      // Step 2: Create session
      setUploadStep('creating')
      const sessionRes = await faceAttendanceApi.createSession({
        class_obj: parseInt(selectedClass),
        date: selectedDate,
        image_url: imageUrl,
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
          <h1 className="text-2xl font-bold text-gray-900">Face Attendance</h1>
          <p className="text-sm text-gray-500 mt-1">Camera-based multi-student attendance</p>
        </div>
        <button
          onClick={() => navigate('/face-attendance/enrollment')}
          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Manage Enrollments
        </button>
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
        {['capture', 'sessions'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'capture' ? 'Capture' : 'Sessions'}
          </button>
        ))}
      </div>

      {tab === 'capture' && (
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
