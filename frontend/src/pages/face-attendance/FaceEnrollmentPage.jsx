import { useMemo, useState, useRef, useEffect } from 'react'
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
import {
  loadFaceApiModels, detectSingleFace, detectAllFacesQuick, detectAllFacesWithDescriptors,
  estimateQualityScore, getFramingHint, MIN_ENROLL_QUALITY_SCORE, LIVE_MOBILE_EMBEDDING_VERSION,
} from '../../utils/faceApiLoader'
import useCameraStream, { cameraButtonLabel } from '../../hooks/useCameraStream'
import CameraPermissionNotice from '../../components/CameraPermissionNotice'

// How often the continuous lock-on/multi-face check runs while the preview
// is live — faster than FaceLiveCapturePage's match-posting loop since this
// is a cheap box-only detection with nothing to POST, just UI feedback.
const LIVE_DETECTION_INTERVAL_MS = 500

// Consecutive "good" ticks required before auto-capture fires — a couple of
// ticks (~1s) of stable framing rather than 1, so a single lucky frame while
// the operator is still settling into position doesn't fire a premature
// capture.
const AUTO_CAPTURE_GOOD_STREAK = 2

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

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
  // Phase 3a duplicate-enrollment check: off by default, only meaningful
  // after a "duplicate_face" rejection — see the checkbox next to the
  // enroll buttons below and DuplicateFaceError's docstring for why the
  // async (photo) path surfaces this via a plain error toast rather than a
  // structured dialog.
  const [overrideDuplicate, setOverrideDuplicate] = useState(false)
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
        override_duplicate: overrideDuplicate,
      })
    },
    onSuccess: (data) => {
      setUploading(false)
      setPreviewUrl(null)
      setSelectedStudent('')
      setOverrideDuplicate(false)
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
      override_duplicate: overrideDuplicate,
    }),
    onSuccess: () => {
      showSuccess('Face enrolled (faceapi_v1).')
      setSelectedStudent('')
      setOverrideDuplicate(false)
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      const data = err.response?.data
      if (data?.error === 'duplicate_face') {
        showError(`${data.message} Tick "Override duplicate check" below and retry if these are different people.`)
      } else {
        showError(data?.error || data?.detail || 'Enrollment failed')
      }
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
                onChange={(e) => { setSelectedStudent(e.target.value); setOverrideDuplicate(false) }}
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

            <label className="flex items-start gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={overrideDuplicate}
                onChange={(e) => setOverrideDuplicate(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Override duplicate check — only tick this after enrollment was blocked for matching
                another student, and you&apos;ve confirmed these are different people.
              </span>
            </label>

            {enrollMode === 'live' ? (
              <LiveEnrollCapture
                selectedStudent={selectedStudent}
                studentPhotoUrl={sortedStudents.find((s) => String(s.id) === String(selectedStudent))?.photo_url}
                studentName={sortedStudents.find((s) => String(s.id) === String(selectedStudent))?.name}
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
export function LiveEnrollCapture({ selectedStudent, studentPhotoUrl, studentName, onSubmit, submitting }) {
  const [modelStatus, setModelStatus] = useState('loading') // loading | ready | error
  const { videoRef, cameraStatus, requestCamera } = useCameraStream({ facingMode: 'user' })
  const [captured, setCaptured] = useState(null) // { descriptor, qualityScore } | error
  const [liveFaceCount, setLiveFaceCount] = useState(0)
  const [liveFramingStatus, setLiveFramingStatus] = useState('none') // none | too-small | off-center | good | multi
  const [liveFaceBoxes, setLiveFaceBoxes] = useState([]) // raw detection boxes, video-pixel space — only populated while multi
  const [selectedFaceBox, setSelectedFaceBox] = useState(null) // tapped box, video-pixel space

  // Read by handleCapture for a synchronous, up-to-the-moment reject check —
  // the disabled= state on the Capture button already reflects this, but a
  // ref guards against the frame having changed between the last tick and
  // the click (see FaceLiveCapturePage's lastFeedbackRef for the same idea).
  const liveFaceCountRef = useRef(0)
  const submittingRef = useRef(submitting)
  submittingRef.current = submitting
  // handleCapture is called both from the button (always the latest render's
  // closure) and from inside the tick effect below, whose closure is only
  // rebuilt when cameraStatus/hasCapturedDescriptor change — modelStatus can
  // flip to 'ready' well after that, so handleCapture reads this ref instead
  // of the modelStatus state directly to avoid gating auto-capture on a
  // frozen, stale value.
  const modelStatusRef = useRef(modelStatus)
  modelStatusRef.current = modelStatus
  // Same staleness concern as modelStatusRef — the camera can be granted
  // (which is what (re)arms the tick effect below) before a student is even
  // selected, especially now that the camera auto-requests on mount (#6).
  // Without this ref, auto-capture's call into handleCapture would forever
  // see the empty selectedStudent from that first render and bail out.
  const selectedStudentRef = useRef(selectedStudent)
  selectedStudentRef.current = selectedStudent

  useEffect(() => {
    let cancelled = false
    loadFaceApiModels()
      .then(() => { if (!cancelled) setModelStatus('ready') })
      .catch(() => { if (!cancelled) setModelStatus('error') })
    return () => { cancelled = true }
  }, [])

  const hasCapturedDescriptor = Boolean(captured?.descriptor)

  // Auto-request the camera as soon as this widget mounts, instead of
  // waiting for a click — browsers only prompt when permission hasn't
  // already been granted for this origin, so on every mount after the very
  // first one this silently re-acquires the stream (e.g. each "Run Another
  // Class" cycle in the bulk queue, which fully unmounts/remounts this
  // component). The manual button below still covers denied/error recovery.
  useEffect(() => {
    if (cameraStatus === 'idle') requestCamera()
  }, [cameraStatus, requestCamera])

  // Continuous lock-on/multi-face check while the preview is live. Runs as
  // its own effect (rather than a setInterval captured once like
  // FaceLiveCapturePage's scan loop) because start/stop here is driven by
  // camera + capture state, not a manual button — letting the effect's own
  // dependency array restart the loop on Retake keeps that in sync for free.
  useEffect(() => {
    if (cameraStatus !== 'granted' || hasCapturedDescriptor) {
      liveFaceCountRef.current = 0
      setLiveFaceCount(0)
      setLiveFramingStatus('none')
      setLiveFaceBoxes([])
      setSelectedFaceBox(null)
      return
    }
    let cancelled = false
    let goodStreak = 0
    const tick = async () => {
      if (!videoRef.current) return
      const detections = await detectAllFacesQuick(videoRef.current)
      if (cancelled) return
      liveFaceCountRef.current = detections.length
      setLiveFaceCount(detections.length)
      if (detections.length === 0) {
        setLiveFramingStatus('none')
        setLiveFaceBoxes([])
        goodStreak = 0
      } else if (detections.length > 1) {
        setLiveFramingStatus('multi')
        setLiveFaceBoxes(detections.map((d) => d.box))
        goodStreak = 0
      } else {
        setLiveFaceBoxes([])
        const status = getFramingHint(detections[0].box, videoRef.current).status
        setLiveFramingStatus(status)
        if (status === 'good') {
          goodStreak += 1
          if (goodStreak >= AUTO_CAPTURE_GOOD_STREAK && !submittingRef.current) {
            goodStreak = 0
            handleCapture()
          }
        } else {
          goodStreak = 0
        }
      }
    }
    tick()
    const id = setInterval(tick, LIVE_DETECTION_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCapture is stable enough here; including it would re-arm the loop on every render
  }, [cameraStatus, hasCapturedDescriptor])

  const handleCapture = async () => {
    if (!videoRef.current || modelStatusRef.current !== 'ready' || !selectedStudentRef.current) return

    if (liveFaceCountRef.current > 1) {
      if (!selectedFaceBox) {
        setCaptured({ error: 'Tap the correct face above, then capture.' })
        return
      }
      const detections = await detectAllFacesWithDescriptors(videoRef.current)
      if (detections.length === 0) {
        setCaptured({ error: 'Lost track of that face — retry.' })
        return
      }
      const targetCenter = {
        x: selectedFaceBox.x + selectedFaceBox.width / 2,
        y: selectedFaceBox.y + selectedFaceBox.height / 2,
      }
      const nearest = detections.reduce((best, d) => {
        const c = { x: d.detection.box.x + d.detection.box.width / 2, y: d.detection.box.y + d.detection.box.height / 2 }
        const dist = Math.hypot(c.x - targetCenter.x, c.y - targetCenter.y)
        return !best || dist < best.dist ? { detection: d, dist } : best
      }, null)
      setCaptured({
        descriptor: nearest.detection.descriptor,
        qualityScore: estimateQualityScore(nearest.detection, videoRef.current),
      })
      setSelectedFaceBox(null)
      return
    }

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
    if (!captured?.descriptor || submittingRef.current) return
    onSubmit(Array.from(captured.descriptor), captured.qualityScore)
    setCaptured(null)
  }

  // Space capture-or-confirms, "r" retakes — lets an operator run through a
  // long bulk queue without reaching for the mouse between students.
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        if (hasCapturedDescriptor) handleConfirm()
        else if (cameraStatus === 'granted') handleCapture()
      } else if (e.key === 'r' || e.key === 'R') {
        if (hasCapturedDescriptor) setCaptured(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleCapture/handleConfirm close over state already covered by these deps
  }, [hasCapturedDescriptor, cameraStatus, selectedFaceBox])

  // Converts a face-api.js box (video's intrinsic pixel space) to the CSS
  // box needed to overlay it on the displayed <video>, accounting for
  // object-cover's crop-to-fill scaling (the larger of the two axis ratios,
  // centered) — a plain width-ratio scale would misplace boxes whenever the
  // video's aspect ratio doesn't match the aspect-video container.
  const boxToOverlayStyle = (box) => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.clientWidth) return null
    const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight)
    const offsetX = (video.clientWidth - video.videoWidth * scale) / 2
    const offsetY = (video.clientHeight - video.videoHeight * scale) / 2
    return {
      left: box.x * scale + offsetX,
      top: box.y * scale + offsetY,
      width: box.width * scale,
      height: box.height * scale,
    }
  }

  const isBoxSelected = (box) => selectedFaceBox
    && Math.abs(box.x - selectedFaceBox.x) < 1 && Math.abs(box.y - selectedFaceBox.y) < 1

  const displayName = studentName || null

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

      {selectedStudent && (
        <div className="flex items-center gap-2">
          {studentPhotoUrl ? (
            <img src={studentPhotoUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[11px] font-semibold">
              {initials(displayName)}
            </div>
          )}
          <span className="text-xs text-gray-500">Capturing for the selected student — confirm it&apos;s them before capturing.</span>
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
        {cameraStatus === 'granted' && !hasCapturedDescriptor && liveFramingStatus !== 'multi' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div
              className={`rounded-[50%] w-[46%] h-[80%] transition-colors ${
                {
                  none: 'border-2 border-dashed border-white/70',
                  'too-small': 'border-2 border-dashed border-amber-400',
                  'off-center': 'border-2 border-dashed border-amber-400',
                  good: 'border-[3px] border-solid border-green-400',
                }[liveFramingStatus]
              }`}
            />
            <span className="absolute bottom-2 text-[11px] text-white/90 bg-black/50 px-2 py-1 rounded">
              {{
                none: 'Fill the oval with your face, then capture',
                'too-small': 'Move closer',
                'off-center': 'Center your face',
                good: 'Hold still — capturing…',
              }[liveFramingStatus]}
            </span>
          </div>
        )}
        {cameraStatus === 'granted' && !hasCapturedDescriptor && liveFramingStatus === 'multi' && (
          <>
            {liveFaceBoxes.map((box, i) => {
              const style = boxToOverlayStyle(box)
              if (!style) return null
              const selected = isBoxSelected(box)
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedFaceBox(box)}
                  className={`absolute rounded border-2 transition-colors ${
                    selected ? 'border-green-400 bg-green-400/10' : 'border-amber-400 bg-amber-400/10 hover:border-white'
                  }`}
                  style={style}
                  aria-label="Select this face to enroll"
                />
              )
            })}
            <span className="absolute bottom-2 text-[11px] text-white/90 bg-black/50 px-2 py-1 rounded pointer-events-none">
              {selectedFaceBox ? 'Face selected — capture to continue' : 'Tap the correct face above'}
            </span>
          </>
        )}
        <CameraPermissionNotice status={cameraStatus} size="sm" />
      </div>

      {captured?.error && (
        <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
          {captured.error}
        </div>
      )}
      {captured?.descriptor && (
        captured.qualityScore < MIN_ENROLL_QUALITY_SCORE ? (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            Quality is low ({(captured.qualityScore * 100).toFixed(0)}%) — retake recommended, or confirm anyway.
          </div>
        ) : (
          <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800">
            Face captured — quality {(captured.qualityScore * 100).toFixed(0)}%. Confirm to save, or retake.
          </div>
        )
      )}

      <div className="flex gap-2">
        {cameraStatus !== 'granted' ? (
          <button
            onClick={requestCamera}
            disabled={cameraStatus === 'requesting'}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {cameraButtonLabel(cameraStatus)}
          </button>
        ) : captured?.descriptor ? (
          <>
            <button
              onClick={() => setCaptured(null)}
              title="Shortcut: R"
              className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              title="Shortcut: Space"
              className={`px-3 py-2 text-white rounded-lg text-xs font-medium disabled:opacity-50 ${
                captured.qualityScore < MIN_ENROLL_QUALITY_SCORE ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {submitting ? 'Saving...' : 'Confirm & Enroll'}
            </button>
          </>
        ) : (
          <button
            onClick={handleCapture}
            disabled={modelStatus !== 'ready' || !selectedStudent || (liveFaceCount > 1 && !selectedFaceBox)}
            title="Shortcut: Space"
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {liveFaceCount > 1 ? 'Capture Selected Face' : 'Capture Face'}
          </button>
        )}
      </div>
      {!selectedStudent && (
        <p className="text-xs text-gray-500">Select a student above before capturing.</p>
      )}
    </div>
  )
}
