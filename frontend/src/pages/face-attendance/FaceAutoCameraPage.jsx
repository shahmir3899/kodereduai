import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { faceAttendanceApi, faceDeviceApi } from '../../services/api'
import { loadFaceApiModels, detectSingleFace, LIVE_MOBILE_EMBEDDING_VERSION } from '../../utils/faceApiLoader'
import { getDeviceKey } from '../../utils/deviceKeyStore'
import useCameraStream, { cameraButtonLabel } from '../../hooks/useCameraStream'
import CameraPermissionNotice from '../../components/CameraPermissionNotice'
import LoadingState from '../../components/ui/LoadingState'

// One match attempt at most this often while a face is in view.
const POST_COOLDOWN_MS = 3000
// Don't flash/count the same student again for this long — they're usually still standing there.
const SAME_STUDENT_COOLDOWN_MS = 60000
const FLASH_MS = 3500
const IDLE_POLL_MS = 1500
const FACE_POLL_MS = 1000
const RETRY_POLL_MS = 5000

/**
 * Unattended automatic camera: this browser (e.g. a tablet at the gate) runs as a
 * registered capture device. It watches the camera, matches faces and marks
 * attendance on its own — no prompts, no login needed on this screen.
 *
 * It signs its requests with the device's key (kept on this browser only), not a
 * user login. Only confident matches mark anyone; uncertain ones are ignored,
 * because nobody is standing there to answer "is this <name>?".
 */
export default function FaceAutoCameraPage() {
  const { deviceId } = useParams()
  const navigate = useNavigate()
  const { videoRef, cameraStatus, requestCamera, stopCamera } = useCameraStream({ facingMode: 'user' })

  const [modelReady, setModelReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState(null) // { name, marked } for a moment after a match
  const [problem, setProblem] = useState(null) // 'rejected' | 'network' | null
  const [markedCount, setMarkedCount] = useState(0)
  const seenRef = useRef(new Map()) // studentId -> last time we showed/counted them
  const flashTimerRef = useRef(null)

  const { data, isLoading } = useQuery({
    queryKey: ['faceCaptureDevices'],
    queryFn: () => faceAttendanceApi.getDevices(),
  })
  const devices = data?.data?.results || data?.data || []
  const device = devices.find((d) => String(d.id) === String(deviceId))
  const deviceKey = getDeviceKey(deviceId)
  const isBrowserDevice = device?.embedding_version === LIVE_MOBILE_EMBEDDING_VERSION

  useEffect(() => {
    let cancelled = false
    loadFaceApiModels()
      .then(() => { if (!cancelled) setModelReady(true) })
      .catch(() => { if (!cancelled) setProblem('network') })
    return () => { cancelled = true }
  }, [])

  // Keep the screen awake while running — an unattended tablet shouldn't go to sleep mid-morning.
  useEffect(() => {
    if (!running || !navigator.wakeLock) return undefined
    let sentinel = null
    navigator.wakeLock.request('screen').then((s) => { sentinel = s }).catch(() => { /* best effort */ })
    return () => { sentinel?.release?.().catch?.(() => {}) }
  }, [running])

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  // The scan loop.
  useEffect(() => {
    if (!running || cameraStatus !== 'granted' || !modelReady || !deviceKey) return undefined
    let cancelled = false
    let timer = null
    let lastPostAt = 0

    const showFlash = (name, marked) => {
      setFlash({ name, marked })
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS)
    }

    const tick = async () => {
      if (cancelled) return
      let delay = IDLE_POLL_MS
      try {
        const detection = videoRef.current ? await detectSingleFace(videoRef.current) : null
        if (cancelled) return
        if (detection) {
          delay = FACE_POLL_MS
          const now = Date.now()
          if (now - lastPostAt >= POST_COOLDOWN_MS) {
            lastPostAt = now
            const res = await faceDeviceApi.liveMatch(deviceKey, {
              embedding: Array.from(detection.descriptor),
              embedding_version: LIVE_MOBILE_EMBEDDING_VERSION,
              timestamp: new Date().toISOString(),
            })
            if (cancelled) return
            setProblem(null)
            const match = res.data
            if (match.match_status === 'AUTO_MATCHED' && match.student) {
              const lastSeen = seenRef.current.get(match.student.id)
              if (!lastSeen || now - lastSeen > SAME_STUDENT_COOLDOWN_MS) {
                showFlash(match.student.name, match.attendance_marked)
                if (match.attendance_marked) setMarkedCount((c) => c + 1)
              }
              seenRef.current.set(match.student.id, now)
            }
          }
        }
      } catch (err) {
        if (cancelled) return
        if (err?.response?.status === 401) {
          // The key was reset or the device switched off: retrying can't help.
          setProblem('rejected')
          setRunning(false)
          return
        }
        setProblem('network')
        delay = RETRY_POLL_MS
      }
      timer = setTimeout(tick, delay)
    }

    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [running, cameraStatus, modelReady, deviceKey, videoRef])

  const start = () => {
    setProblem(null)
    setRunning(true)
    if (cameraStatus !== 'granted') requestCamera()
  }

  const stop = () => {
    setRunning(false)
    setFlash(null)
    stopCamera()
  }

  const back = () => navigate('/face-attendance/devices')

  if (isLoading) return <LoadingState />

  const blocker = !device
    ? 'This device was not found. It may have been removed.'
    : !isBrowserDevice
      ? 'This device runs on its own mini PC, not in a browser. Add a browser device to use this screen as a camera.'
      : !device.is_active
        ? 'This device is switched off. Turn it on from the Capture Devices page.'
        : !deviceKey
          ? "This browser doesn't have the device's key. On the Capture Devices page, choose Start auto camera to set it up here."
          : null

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={back} className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1">
        <span>&larr;</span> Capture Devices
      </button>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{device?.name || 'Auto camera'}</h1>
      <p className="text-sm text-gray-500 mt-1">
        {device
          ? `${device.scope_type === 'CLASS' ? (device.class_obj_detail?.name || 'One class') : 'Whole school'} · marks attendance automatically`
          : 'Automatic attendance camera'}
      </p>

      {blocker ? (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800" data-testid="auto-camera-blocker">
          {blocker}{' '}
          <Link to="/face-attendance/devices" className="underline font-medium">Open Capture Devices</Link>
        </div>
      ) : (
        <div className="mt-4 bg-white rounded-lg border p-4 space-y-3">
          {problem === 'rejected' && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
              The device key was rejected, so scanning stopped. The key may have been reset or the device switched off —
              set this screen up again from the Capture Devices page.
            </div>
          )}
          {problem === 'network' && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800" role="status">
              Can&apos;t reach the server — still trying.
            </div>
          )}

          <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ transform: 'scaleX(-1)' }}
              className={`w-full h-full object-cover ${cameraStatus === 'granted' ? '' : 'hidden'}`}
            />
            {flash && (
              <div
                className="absolute inset-x-0 bottom-0 p-4 text-center bg-green-600/90 text-white"
                data-testid="match-flash"
              >
                <div className="text-lg font-semibold">{flash.name}</div>
                <div className="text-sm">{flash.marked ? '✓ Marked present' : '✓ Already marked today'}</div>
              </div>
            )}
            {cameraStatus === 'granted' && running && !flash && (
              <span className="absolute top-2 left-2 text-xs text-white bg-black/60 px-2 py-1 rounded">
                {modelReady ? 'Looking for faces…' : 'Loading face recognition…'}
              </span>
            )}
            <CameraPermissionNotice status={cameraStatus} size="md" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-gray-600" data-testid="marked-count">
              Marked in this session: <span className="font-semibold text-gray-900">{markedCount}</span>
            </div>
            {running ? (
              <button onClick={stop} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium">
                Stop
              </button>
            ) : (
              <button
                onClick={start}
                disabled={cameraStatus === 'requesting' || !modelReady}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {cameraStatus === 'granted' || cameraStatus === 'idle' ? 'Start' : cameraButtonLabel(cameraStatus)}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Only clear matches are marked. If someone isn&apos;t recognised they are simply skipped — use Mobile Capture when you
            want to confirm uncertain matches by hand.
          </p>
        </div>
      )}
    </div>
  )
}
