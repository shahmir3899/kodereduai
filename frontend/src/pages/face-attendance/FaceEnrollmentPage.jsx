import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import { useBackgroundTasks } from '../../contexts/BackgroundTaskContext'
import { faceAttendanceApi, studentsApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId, resolveSessionClassId } from '../../utils/classScope'
import { loadFaceApiModels, detectSingleFace, estimateQualityScore, LIVE_MOBILE_EMBEDDING_VERSION } from '../../utils/faceApiLoader'

export default function FaceEnrollmentPage() {
  const { activeSchool, isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { addTask } = useBackgroundTasks()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [selectedClass, setSelectedClass] = useState('')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [enrollMode, setEnrollMode] = useState('photo') // 'photo' (dlib_v1, unchanged) | 'live' (faceapi_v1)
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
    queryKey: 'teacherFaceEnrollmentClasses',
  })

  // Load students for selected class
  const { data: studentsData } = useQuery({
    queryKey: ['students', resolvedSelectedClass, resolvedSelectedSessionClass, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      class_id: resolvedSelectedClass,
      ...(resolvedSelectedSessionClass && { session_class_id: resolvedSelectedSessionClass }),
      page_size: 100,
      is_active: true,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!resolvedSelectedClass,
  })
  const students = studentsData?.data?.results || studentsData?.data || []

  // Load enrollments for selected class
  const { data: enrollmentsData, isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['faceEnrollments', activeSchool?.id, resolvedSelectedClass],
    queryFn: () => faceAttendanceApi.getEnrollments(
      resolvedSelectedClass ? { class_obj: resolvedSelectedClass } : {}
    ),
    enabled: !!activeSchool,
  })
  const enrollments = enrollmentsData?.data?.results || enrollmentsData?.data || []

  const parseRollForSort = (rollValue) => {
    const parsed = Number.parseInt(String(rollValue ?? '').trim(), 10)
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
  }

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      const rollCmp = parseRollForSort(a.roll_number) - parseRollForSort(b.roll_number)
      if (rollCmp !== 0) return rollCmp
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [students])

  const sortedEnrollments = useMemo(() => {
    return [...enrollments].sort((a, b) => {
      const rollCmp = parseRollForSort(a.student_roll) - parseRollForSort(b.student_roll)
      if (rollCmp !== 0) return rollCmp
      return String(a.student_name || '').localeCompare(String(b.student_name || ''))
    })
  }, [enrollments])

  // Enroll mutation
  const enrollMutation = useMutation({
    mutationFn: async (file) => {
      setUploading(true)
      // Upload image
      const uploadRes = await faceAttendanceApi.uploadImage(
        file, activeSchool?.id, resolvedSelectedClass || 0
      )
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url

      // Enroll face
      return faceAttendanceApi.enrollFace({
        student_id: parseInt(selectedStudent),
        image_url: imageUrl,
      })
    },
    onSuccess: (data) => {
      setUploading(false)
      setPreviewUrl(null)
      setSelectedStudent('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      
      // Register task with background task context for monitoring
      const taskId = data.data?.task_id || data.task_id
      const studentName = data.data?.student_name || data.student_name || 'Student'
      
      if (taskId) {
        addTask(
          taskId,
          `Enroll face: ${studentName}`,
          'FACE_ATTENDANCE',
          (result) => {
            // Task completed (success or already handled by context)
            queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
          }
        )
      }
      
      showSuccess('Processing enrollment...')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      setUploading(false)
      showError(err.response?.data?.error || err.response?.data?.detail || 'Enrollment failed')
    },
  })

  // Enroll mutation — Live Mobile capture, client-side embedding (design doc §5)
  const enrollEmbeddingMutation = useMutation({
    mutationFn: ({ studentId, embedding, qualityScore }) => faceAttendanceApi.enrollWithEmbedding({
      student_id: studentId,
      embedding,
      embedding_version: LIVE_MOBILE_EMBEDDING_VERSION,
      quality_score: qualityScore,
    }),
    onSuccess: () => {
      showSuccess('Face enrolled (faceapi_v1).')
      setSelectedStudent('')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      showError(err.response?.data?.error || err.response?.data?.detail || 'Enrollment failed')
    },
  })

  // Delete enrollment mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => faceAttendanceApi.deleteEnrollment(id),
    onSuccess: () => {
      showSuccess('Face enrollment removed')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      showError(err.response?.data?.error || 'Failed to remove enrollment')
    },
  })

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPreviewUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleEnroll = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      showError('Please select a photo.')
      return
    }
    if (!selectedStudent) {
      showError('Please select a student.')
      return
    }
    enrollMutation.mutate(file)
  }

  // Build enrollment status for students
  const enrolledStudentIds = new Set(enrollments.map((e) => e.student))
  const enrolledVisibleCount = sortedStudents.filter((s) => enrolledStudentIds.has(s.id)).length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/face-attendance')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
          >
            <span>&larr;</span> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Face Enrollment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enroll student photos for face recognition
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrollment form */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Enroll Student Face</h2>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
              <button
                onClick={() => setEnrollMode('photo')}
                className={`px-3 py-1.5 ${enrollMode === 'photo' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Photo Upload
              </button>
              <button
                onClick={() => setEnrollMode('live')}
                className={`px-3 py-1.5 ${enrollMode === 'live' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Live Capture
              </button>
            </div>
          </div>

          {enrollMode === 'photo' && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-900 mb-3">Photo Requirements</h3>
              <div className="space-y-2 text-sm text-blue-800">
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>Clear portrait crop (head and shoulders)</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>Exactly one face visible</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>Front-facing angle (minimal side angle)</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>Good lighting (no harsh shadows)</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>Sharp focus (no motion blur)</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-green-600 font-semibold">✓</span>
                  <span>JPG or PNG format, high resolution</span>
                </div>
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <div className="flex gap-2">
                    <span className="text-red-600 font-semibold">✗</span>
                    <span>No masks, sunglasses, or heavy accessories</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-red-600 font-semibold">✗</span>
                    <span>Avoid compressed/blurry images</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => { setSelectedClass(e.target.value); setSelectedStudent('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                scope={classSelectorScope}
                academicYearId={activeAcademicYear?.id}
                showAllOption={showAllOption}
                classes={teacherClassOptions || undefined}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student</label>
              <select
                value={selectedStudent}
                onChange={(e) => setSelectedStudent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                disabled={!selectedClass}
              >
                <option value="">Select student...</option>
                {sortedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`${s.roll_number || '-'} - ${s.name}`}
                    {enrolledStudentIds.has(s.id) ? ' [enrolled]' : ''}
                  </option>
                ))}
              </select>
            </div>

            {enrollMode === 'live' ? (
              <LiveEnrollCapture
                selectedStudent={selectedStudent}
                onSubmit={(embedding, qualityScore) => enrollEmbeddingMutation.mutate({
                  studentId: parseInt(selectedStudent, 10), embedding, qualityScore,
                })}
                submitting={enrollEmbeddingMutation.isPending}
              />
            ) : (
              <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student Photo</label>
              <p className="text-xs text-gray-500 mb-2">
                Upload a clear portrait photo with exactly one face visible.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                onChange={handleFileSelect}
                className="w-full text-sm border border-gray-300 rounded-lg p-2"
              />
            </div>

            {previewUrl && (
              <div className="text-center">
                <img src={previewUrl} alt="Preview" className="h-40 mx-auto rounded-lg" />
              </div>
            )}

            <button
              onClick={handleEnroll}
              disabled={uploading || !selectedStudent || !previewUrl}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Enrolling...' : 'Enroll Face'}
            </button>
              </>
            )}
          </div>
        </div>

        {/* Current enrollments */}
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">
              Enrolled Faces
              {selectedClass && ` (${sortedEnrollments.length})`}
            </h2>
          </div>

          {enrollmentsLoading ? (
            <div className="p-8"><LoadingSpinner /></div>
          ) : sortedEnrollments.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              {selectedClass
                ? 'No students enrolled in this class yet.'
                : 'Select a class to see enrolled students.'}
            </div>
          ) : (
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {sortedEnrollments.map((enrollment) => (
                <div key={enrollment.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      {enrollment.student_name}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          enrollment.embedding_version === LIVE_MOBILE_EMBEDDING_VERSION
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {enrollment.embedding_version}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      #{enrollment.student_roll} &middot; {enrollment.class_name} &middot;
                      Quality: {(enrollment.quality_score * 100).toFixed(0)}%
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      const ok = await confirm({ title: 'Remove Enrollment', message: 'Remove this face enrollment?', confirmLabel: 'Remove' })
                      if (ok) deleteMutation.mutate(enrollment.id)
                    }}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Summary for selected class */}
          {selectedClass && sortedStudents.length > 0 && (
            <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
              {enrolledVisibleCount} of {sortedStudents.length} students enrolled
              {sortedStudents.length - enrolledVisibleCount > 0 && (
                <span className="text-orange-600 ml-1">
                  ({sortedStudents.length - enrolledVisibleCount} missing)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmModalRoot />
    </div>
  )
}

/**
 * Guided client-side capture for faceapi_v1 enrollment (design doc §5): same
 * class/student selection as the photo flow above, but the capture step runs
 * face-api.js in the browser instead of uploading a photo for server-side
 * dlib processing. One student at a time, one confirmed capture per submit.
 * Exported for reuse by FaceBulkEnrollmentPage, which drives this same
 * component through a whole class roster instead of one manually-selected
 * student — the capture/quality logic itself isn't duplicated there.
 */
export function LiveEnrollCapture({ selectedStudent, onSubmit, submitting }) {
  const [modelStatus, setModelStatus] = useState('loading') // loading | ready | error
  const [cameraStatus, setCameraStatus] = useState('idle') // idle | requesting | granted | denied | unavailable
  const [captured, setCaptured] = useState(null) // { descriptor, qualityScore } | null

  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadFaceApiModels()
      .then(() => { if (!cancelled) setModelStatus('ready') })
      .catch(() => { if (!cancelled) setModelStatus('error') })
    return () => { cancelled = true }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const requestCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unavailable')
      return
    }
    setCameraStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraStatus('granted')
    } catch (err) {
      setCameraStatus(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }

  const handleCapture = async () => {
    if (!videoRef.current) return
    const detection = await detectSingleFace(videoRef.current)
    if (!detection) {
      setCaptured({ error: 'No single face detected — center one face and retry.' })
      return
    }
    setCaptured({
      descriptor: detection.descriptor,
      qualityScore: estimateQualityScore(detection, videoRef.current),
    })
  }

  const handleConfirm = () => {
    if (!captured?.descriptor) return
    onSubmit(Array.from(captured.descriptor), captured.qualityScore)
    setCaptured(null)
  }

  return (
    <div className="space-y-3">
      {modelStatus === 'loading' && (
        <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
          Loading face recognition model&hellip;
        </div>
      )}
      {modelStatus === 'error' && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          Failed to load the model. Check your connection and reload the page.
        </div>
      )}

      <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${cameraStatus === 'granted' ? '' : 'hidden'}`}
        />
        {cameraStatus !== 'granted' && (
          <div className="text-center text-gray-300 text-xs p-4">
            {cameraStatus === 'idle' && 'Camera access is required to capture a face.'}
            {cameraStatus === 'requesting' && 'Requesting camera access…'}
            {cameraStatus === 'denied' && (
              <span className="text-red-300">Camera access denied — enable it in browser settings.</span>
            )}
            {cameraStatus === 'unavailable' && <span className="text-red-300">No camera available.</span>}
          </div>
        )}
      </div>

      {captured?.error && (
        <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
          {captured.error}
        </div>
      )}
      {captured?.descriptor && (
        <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800">
          Face captured — quality {(captured.qualityScore * 100).toFixed(0)}%. Confirm to save, or retake.
        </div>
      )}

      <div className="flex gap-2">
        {cameraStatus !== 'granted' ? (
          <button
            onClick={requestCamera}
            disabled={cameraStatus === 'requesting'}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Enable Camera
          </button>
        ) : captured?.descriptor ? (
          <>
            <button
              onClick={() => setCaptured(null)}
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Confirm & Enroll'}
            </button>
          </>
        ) : (
          <button
            onClick={handleCapture}
            disabled={modelStatus !== 'ready' || !selectedStudent}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Capture Face
          </button>
        )}
      </div>
      {!selectedStudent && (
        <p className="text-xs text-gray-500">Select a student above before capturing.</p>
      )}
    </div>
  )
}
