import { useEffect, useRef, useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { faceAttendanceApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import { loadFaceApiModels, detectSingleFace, TIER_A_EMBEDDING_VERSION } from '../../utils/faceApiLoader'

// Only POST a match attempt for a given detection at most this often — a
// lingering face would otherwise fire on every detection tick. Mirrors the
// same principle as Tier B's on-prem sampling (design doc §4), applied
// client-side here since there's no device-level rate limiting for Tier A.
const POST_COOLDOWN_MS = 4000
const DETECTION_INTERVAL_MS = 1000
const FEEDBACK_DISPLAY_MS = 4000

// Mobile Capture tab content on the main face-attendance page (consolidated
// 2026-07 — this used to be a fully separate /face-attendance/live-capture
// page; that route now redirects here). Kept as its own component/file
// rather than inlined so the camera/model logic isn't duplicated or
// rewritten — see FaceAttendancePage's "mobile" tab.
export default function FaceLiveCapturePage() {
  const { isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()

  const [modelStatus, setModelStatus] = useState('loading') // loading | ready | error
  const [cameraStatus, setCameraStatus] = useState('idle') // idle | requesting | granted | denied | unavailable
  const [scanning, setScanning] = useState(false)
  const [lastFeedback, setLastFeedback] = useState(null) // { studentName, matchStatus, attendanceMarked } | null
  const [selectedClass, setSelectedClass] = useState('')

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const intervalRef = useRef(null)
  const lastPostAtRef = useRef(0)
  const feedbackTimeoutRef = useRef(null)

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, undefined)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const {
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: true,
    queryKey: 'teacherFaceLiveCaptureClasses',
  })

  const matchMutation = useMutation({
    mutationFn: (payload) => faceAttendanceApi.liveMatch(payload),
  })

  const feedbackMutation = useMutation({
    mutationFn: ({ eventId, isCorrect }) => faceAttendanceApi.submitLiveMatchFeedback(eventId, isCorrect),
  })

  // Load the face-api.js models once on mount.
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

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unavailable')
      return
    }
    setCameraStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraStatus('granted')
    } catch (err) {
      setCameraStatus(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }, [])

  useEffect(() => () => {
    stopCamera()
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
  }, [stopCamera])

  const canStartScanning = modelStatus === 'ready' && cameraStatus === 'granted'
    && (!isTeacher || !!resolvedSelectedClass)

  const handleDetectionTick = useCallback(async () => {
    if (!videoRef.current || matchMutation.isPending) return
    const now = Date.now()
    if (now - lastPostAtRef.current < POST_COOLDOWN_MS) return

    const detection = await detectSingleFace(videoRef.current)
    if (!detection) return

    lastPostAtRef.current = now
    const embedding = Array.from(detection.descriptor)

    try {
      const res = await matchMutation.mutateAsync({
        embedding,
        embedding_version: TIER_A_EMBEDDING_VERSION,
        timestamp: new Date().toISOString(),
        ...(resolvedSelectedClass && { class_id: parseInt(resolvedSelectedClass, 10) }),
      })
      const data = res.data
      setLastFeedback({
        matchStatus: data.match_status,
        studentName: data.student?.name || null,
        attendanceMarked: data.attendance_marked,
        eventId: data.event_id,
      })
    } catch {
      // A single failed ping shouldn't interrupt the scanning loop — the
      // next tick will simply try again.
      setLastFeedback({ matchStatus: 'ERROR', studentName: null, attendanceMarked: false, eventId: null })
    }
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    feedbackTimeoutRef.current = setTimeout(() => setLastFeedback(null), FEEDBACK_DISPLAY_MS)
  }, [matchMutation, resolvedSelectedClass])

  const startScanning = () => {
    setScanning(true)
    intervalRef.current = setInterval(handleDetectionTick, DETECTION_INTERVAL_MS)
  }

  const stopScanning = () => {
    setScanning(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const handleFeedback = (isCorrect) => {
    if (!lastFeedback?.eventId) return
    feedbackMutation.mutate({ eventId: lastFeedback.eventId, isCorrect })
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    setLastFeedback(null)
  }

  const feedbackConfirmButtons = () => {
    if (!lastFeedback?.eventId) return null
    return (
      <div className="flex gap-2 mt-2">
        <span className="text-xs text-gray-500 self-center">Was this correct?</span>
        <button
          onClick={() => handleFeedback(true)}
          className="px-2 py-1 text-xs font-medium rounded border border-green-300 text-green-700 hover:bg-green-100"
        >
          ✓ Correct
        </button>
        <button
          onClick={() => handleFeedback(false)}
          className="px-2 py-1 text-xs font-medium rounded border border-red-300 text-red-700 hover:bg-red-100"
        >
          ✗ Wrong
        </button>
      </div>
    )
  }

  const feedbackBanner = () => {
    if (!lastFeedback) return null
    if (lastFeedback.matchStatus === 'ERROR') {
      return (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Couldn&apos;t reach the server for the last detection — still scanning.
        </div>
      )
    }
    if (lastFeedback.matchStatus === 'AUTO_MATCHED' && lastFeedback.studentName) {
      return (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 font-medium">
          {lastFeedback.studentName} — {lastFeedback.attendanceMarked ? 'marked present' : 'already marked today'}
          {feedbackConfirmButtons()}
        </div>
      )
    }
    if (lastFeedback.matchStatus === 'FLAGGED') {
      return (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          Possible match ({lastFeedback.studentName || 'uncertain'}) — confidence too low to auto-mark.
          {lastFeedback.studentName && feedbackConfirmButtons()}
        </div>
      )
    }
    return (
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
        Face detected — no enrolled match found.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-lg border p-6 space-y-4">
        {modelStatus === 'loading' && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Loading face recognition model&hellip; this only happens once per session.
          </div>
        )}
        {modelStatus === 'error' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
            <span>Failed to load the face recognition model. Check your connection and retry.</span>
            <button
              onClick={() => { setModelStatus('loading'); loadFaceApiModels().then(() => setModelStatus('ready')).catch(() => setModelStatus('error')) }}
              className="ml-3 underline font-medium"
            >
              Retry
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Class {isTeacher ? '' : '(optional — leave blank to scan the whole school)'}
          </label>
          <ClassSelector
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            scope={classSelectorScope}
            academicYearId={activeAcademicYear?.id}
            showAllOption={!isTeacher}
            allOptionLabel="Whole School"
            classes={teacherClassOptions || undefined}
            disabled={scanning}
          />
        </div>

        <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraStatus === 'granted' ? '' : 'hidden'}`}
          />
          {cameraStatus !== 'granted' && (
            <div className="text-center text-gray-300 text-sm p-6">
              {cameraStatus === 'idle' && 'Camera access is required for live capture.'}
              {cameraStatus === 'requesting' && 'Requesting camera access…'}
              {cameraStatus === 'denied' && (
                <span className="text-red-300">
                  Camera access was denied. Enable it in your browser&apos;s site settings and retry.
                </span>
              )}
              {cameraStatus === 'unavailable' && (
                <span className="text-red-300">No camera is available on this device.</span>
              )}
            </div>
          )}
        </div>

        {feedbackBanner()}

        <div className="flex gap-3">
          {cameraStatus !== 'granted' ? (
            <button
              onClick={requestCamera}
              disabled={cameraStatus === 'requesting'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {cameraStatus === 'denied' || cameraStatus === 'unavailable' ? 'Retry Camera Access' : 'Enable Camera'}
            </button>
          ) : scanning ? (
            <button
              onClick={stopScanning}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Stop Scanning
            </button>
          ) : (
            <button
              onClick={startScanning}
              disabled={!canStartScanning}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Scanning
            </button>
          )}
        </div>
        {isTeacher && !resolvedSelectedClass && (
          <p className="text-xs text-gray-500">Select your class to start scanning.</p>
        )}
      </div>
    </div>
  )
}
