import { useEffect, useRef, useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { faceAttendanceApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import { loadFaceApiModels, detectSingleFace, getFramingHint, LIVE_MOBILE_EMBEDDING_VERSION } from '../../utils/faceApiLoader'
import useCameraStream, { cameraButtonLabel } from '../../hooks/useCameraStream'
import CameraPermissionNotice from '../../components/CameraPermissionNotice'

// Only POST a match attempt for a given detection at most this often — a
// lingering face would otherwise fire on every detection tick. Mirrors the
// same principle as Fixed Camera capture's on-prem sampling (design doc §4),
// applied client-side here since there's no device-level rate limiting for
// Live Mobile capture.
const POST_COOLDOWN_MS = 4000
// Poll fast while a face is (or was just) in frame; back off once nobody's
// there for a few ticks in a row so an idle phone isn't running the
// detector every second for no reason. Snaps back to FAST immediately on
// the next detection — only the slow-down is gradual, not the speed-up.
const FAST_DETECTION_INTERVAL_MS = 1000
const SLOW_DETECTION_INTERVAL_MS = 2500
const NO_FACE_TICKS_BEFORE_SLOWDOWN = 3
const FEEDBACK_DISPLAY_MS = 4000
const RECENT_MATCHES_LIMIT = 8

// Mobile Capture tab content on the main face-attendance page (consolidated
// 2026-07 — this used to be a fully separate /face-attendance/live-capture
// page; that route now redirects here). Kept as its own component/file
// rather than inlined so the camera/model logic isn't duplicated or
// rewritten — see FaceAttendancePage's "mobile" tab.
export default function FaceLiveCapturePage() {
  const { isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()

  const [modelStatus, setModelStatus] = useState('loading') // loading | ready | error
  const { videoRef, cameraStatus, requestCamera, stopCamera } = useCameraStream({ facingMode: 'user' })
  const [scanning, setScanning] = useState(false)
  const [lastFeedback, setLastFeedback] = useState(null) // { studentName, matchStatus, attendanceMarked } | null
  const [selectedClass, setSelectedClass] = useState('')
  const [recentMatches, setRecentMatches] = useState([]) // [{ id, name, thumbnail, ts }, ...] most-recent-first, session-scoped

  const canvasRef = useRef(null)
  // Holds the current setTimeout id for the self-rescheduling poll loop (see
  // runTick) — same slot the old setInterval id lived in, just renamed
  // since it's no longer a fixed-rate interval.
  const pollTimeoutRef = useRef(null)
  const lastPostAtRef = useRef(0)
  const feedbackTimeoutRef = useRef(null)
  // Mirrors lastFeedback but read from inside the tick closure, which
  // otherwise only ever sees the lastFeedback value from when scanning
  // started (see startScanning) — refs sidestep that.
  const lastFeedbackRef = useRef(null)
  // Consecutive ticks with no face detected — drives the adaptive poll
  // interval below (runTick). Ref, not state: it changes every tick and
  // has no UI of its own, so it doesn't need to trigger a render.
  const noFaceStreakRef = useRef(0)

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

  const clearOverlay = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // Draws the face-api.js detection box + name/confidence label on the
  // canvas sitting on top of the video. The video is rendered with
  // object-fit: cover, so the detector's box (in the video's intrinsic
  // videoWidth/videoHeight space) has to be re-mapped through the same
  // crop-and-scale math the browser applies, or the box drifts off the
  // actual face as soon as the video's aspect ratio differs from the
  // aspect-video container.
  const drawOverlay = useCallback((detection, feedbackOverride) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const displayWidth = video.clientWidth
    const displayHeight = video.clientHeight
    if (!displayWidth || !displayHeight) return
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth
      canvas.height = displayHeight
    }
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!detection) return

    const { box } = detection.detection
    const vw = video.videoWidth || displayWidth
    const vh = video.videoHeight || displayHeight
    const scale = Math.max(displayWidth / vw, displayHeight / vh)
    const offsetX = (vw * scale - displayWidth) / 2
    const offsetY = (vh * scale - displayHeight) / 2
    const x = box.x * scale - offsetX
    const y = box.y * scale - offsetY
    const w = box.width * scale
    const h = box.height * scale

    const feedback = feedbackOverride !== undefined ? feedbackOverride : lastFeedbackRef.current
    let color = '#60a5fa' // neutral blue — face detected, no match resolved yet
    let label = null
    if (feedback?.matchStatus === 'AUTO_MATCHED' && feedback.studentName) {
      color = '#22c55e'
      label = feedback.studentName
    } else if (feedback?.matchStatus === 'FLAGGED') {
      color = '#eab308'
      label = feedback.studentName ? `${feedback.studentName}?` : 'Uncertain match'
    }

    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, w, h)

    if (label) {
      ctx.font = '600 13px sans-serif'
      const textWidth = ctx.measureText(label).width
      const labelHeight = 20
      const labelY = Math.max(0, y - labelHeight)
      ctx.fillStyle = color
      ctx.fillRect(x, labelY, textWidth + 12, labelHeight)
      ctx.fillStyle = '#0f172a'
      ctx.fillText(label, x + 6, labelY + 14)
    } else {
      // No match label yet (still neutral/uncertain) — show framing
      // guidance below the box instead, so it never overlaps the name
      // badge that appears above the box once a match resolves.
      const hint = getFramingHint(box, video)
      if (hint.message) {
        ctx.font = '600 12px sans-serif'
        const hintWidth = ctx.measureText(hint.message).width
        const hintY = y + h + 4
        ctx.fillStyle = 'rgba(15,23,42,0.75)'
        ctx.fillRect(x, hintY, hintWidth + 10, 18)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(hint.message, x + 5, hintY + 13)
      }
    }
  }, [])

  // Small square JPEG crop of the video frame around the given detection
  // box, for the recent-matches strip. Best-effort — returns null rather
  // than throwing if the video isn't in a readable state, since a missed
  // thumbnail shouldn't interrupt the scanning loop.
  const captureThumbnail = (video, box, size = 64) => {
    try {
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return null
      const pad = box.width * 0.15
      const sx = Math.max(0, box.x - pad)
      const sy = Math.max(0, box.y - pad)
      const sw = Math.min(vw - sx, box.width + pad * 2)
      const sh = Math.min(vh - sy, box.height + pad * 2)
      const off = document.createElement('canvas')
      off.width = size
      off.height = size
      const ctx = off.getContext('2d')
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, size, size)
      return off.toDataURL('image/jpeg', 0.7)
    } catch {
      return null
    }
  }

  useEffect(() => () => {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
  }, [])

  const canStartScanning = modelStatus === 'ready' && cameraStatus === 'granted'
    && (!isTeacher || !!resolvedSelectedClass)

  // Self-rescheduling instead of setInterval: each tick picks its own next
  // delay (FAST while a face is/was around, SLOW after a few empty ticks in
  // a row), which a fixed-rate setInterval can't do without being torn down
  // and recreated every time the rate needs to change.
  const runTick = useCallback(async () => {
    let nextDelay = FAST_DETECTION_INTERVAL_MS
    if (!videoRef.current) {
      pollTimeoutRef.current = setTimeout(runTick, nextDelay)
      return
    }
    const detection = await detectSingleFace(videoRef.current)
    // Draw on every tick regardless of the match-post cooldown below, so the
    // operator gets instant "yes, a face is framed" feedback even on ticks
    // that don't fire a match request.
    drawOverlay(detection)

    if (detection) {
      noFaceStreakRef.current = 0
    } else {
      noFaceStreakRef.current += 1
    }
    nextDelay = noFaceStreakRef.current >= NO_FACE_TICKS_BEFORE_SLOWDOWN
      ? SLOW_DETECTION_INTERVAL_MS
      : FAST_DETECTION_INTERVAL_MS

    if (!detection || matchMutation.isPending) {
      pollTimeoutRef.current = setTimeout(runTick, nextDelay)
      return
    }

    const now = Date.now()
    if (now - lastPostAtRef.current < POST_COOLDOWN_MS) {
      pollTimeoutRef.current = setTimeout(runTick, nextDelay)
      return
    }

    lastPostAtRef.current = now
    const embedding = Array.from(detection.descriptor)

    try {
      const res = await matchMutation.mutateAsync({
        embedding,
        embedding_version: LIVE_MOBILE_EMBEDDING_VERSION,
        timestamp: new Date().toISOString(),
        ...(resolvedSelectedClass && { class_id: parseInt(resolvedSelectedClass, 10) }),
      })
      const data = res.data
      const feedback = {
        matchStatus: data.match_status,
        studentName: data.student?.name || null,
        attendanceMarked: data.attendance_marked,
        eventId: data.event_id,
      }
      lastFeedbackRef.current = feedback
      setLastFeedback(feedback)
      drawOverlay(detection, feedback)
      if (feedback.matchStatus === 'AUTO_MATCHED' && feedback.studentName && data.student?.id) {
        const thumbnail = captureThumbnail(videoRef.current, detection.detection.box)
        setRecentMatches((prev) => [
          { id: data.student.id, name: feedback.studentName, thumbnail, ts: now },
          ...prev,
        ].slice(0, RECENT_MATCHES_LIMIT))
      }
    } catch {
      // A single failed ping shouldn't interrupt the scanning loop — the
      // next tick will simply try again.
      const feedback = { matchStatus: 'ERROR', studentName: null, attendanceMarked: false, eventId: null }
      lastFeedbackRef.current = feedback
      setLastFeedback(feedback)
    }
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    feedbackTimeoutRef.current = setTimeout(() => {
      lastFeedbackRef.current = null
      setLastFeedback(null)
    }, FEEDBACK_DISPLAY_MS)

    pollTimeoutRef.current = setTimeout(runTick, nextDelay)
  }, [matchMutation, resolvedSelectedClass, drawOverlay])

  const startScanning = () => {
    setScanning(true)
    noFaceStreakRef.current = 0
    setRecentMatches([])
    runTick()
  }

  const stopScanning = () => {
    setScanning(false)
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current)
      pollTimeoutRef.current = null
    }
    clearOverlay()
  }

  const handleFeedback = (isCorrect) => {
    if (!lastFeedback?.eventId) return
    feedbackMutation.mutate({ eventId: lastFeedback.eventId, isCorrect })
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    lastFeedbackRef.current = null
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
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 w-full h-full pointer-events-none ${cameraStatus === 'granted' ? '' : 'hidden'}`}
          />
          <CameraPermissionNotice status={cameraStatus} size="md" />
        </div>

        {feedbackBanner()}

        {recentMatches.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Recently marked present</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentMatches.map((m) => (
                <div key={`${m.id}-${m.ts}`} className="flex-shrink-0 w-14 text-center">
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt={m.name} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                      ?
                    </div>
                  )}
                  <div className="text-[10px] text-gray-600 truncate mt-1">{m.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {cameraStatus !== 'granted' ? (
            <button
              onClick={requestCamera}
              disabled={cameraStatus === 'requesting'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {cameraButtonLabel(cameraStatus)}
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
