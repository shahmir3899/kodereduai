import { useEffect, useRef, useState } from 'react'
import useCameraStream, { cameraButtonLabel } from '../../hooks/useCameraStream'
import CameraPermissionNotice from '../../components/CameraPermissionNotice'
import { loadFaceApiModels, detectAllFacesQuick } from '../../utils/faceApiLoader'

const FACE_COUNT_INTERVAL_MS = 1000
const MAX_PHOTO_WIDTH = 1920

/**
 * Live camera for taking the class group photo inside the app — the
 * alternative to the file picker. Shows a running count of faces in frame
 * (with boxes) so the operator can tell everyone is visible before capturing.
 *
 * Capturing hands back a JPEG File from the RAW camera frame, so it goes
 * through exactly the same upload + processing path as a picked file. The
 * front camera is shown mirrored (selfie view); the rear camera is not.
 *
 * @param onCapture (File) => void
 * @param onCancel  () => void
 */
export default function GroupPhotoCamera({ onCapture, onCancel }) {
  const [facing, setFacing] = useState('environment') // rear camera first: a class photo is of other people
  const { videoRef, cameraStatus, requestCamera, stopCamera } = useCameraStream({ facingMode: facing })
  const [modelReady, setModelReady] = useState(false)
  const [boxes, setBoxes] = useState([]) // raw detection boxes, video-pixel space
  const [capturing, setCapturing] = useState(false)
  const mirrored = facing === 'user'

  useEffect(() => {
    let cancelled = false
    loadFaceApiModels()
      .then(() => { if (!cancelled) setModelReady(true) })
      .catch(() => { /* count is a hint only — capturing still works without it */ })
    return () => { cancelled = true }
  }, [])

  // Open the camera on mount and again whenever the operator flips front/rear
  // (requestCamera changes with facingMode).
  useEffect(() => {
    stopCamera()
    requestCamera()
  }, [requestCamera, stopCamera])

  // Live face count + boxes while the preview runs.
  const busyRef = useRef(false)
  useEffect(() => {
    if (cameraStatus !== 'granted' || !modelReady) {
      setBoxes([])
      return undefined
    }
    let cancelled = false
    const tick = async () => {
      if (busyRef.current || !videoRef.current) return
      busyRef.current = true
      try {
        const found = await detectAllFacesQuick(videoRef.current)
        if (!cancelled) setBoxes(found.map((d) => d.box))
      } catch {
        if (!cancelled) setBoxes([])
      } finally {
        busyRef.current = false
      }
    }
    tick()
    const id = setInterval(tick, FACE_COUNT_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [cameraStatus, modelReady, videoRef])

  const boxStyle = (box) => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.clientWidth) return null
    // object-cover: the larger axis ratio wins and the overflow is cropped evenly.
    const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight)
    const offsetX = (video.clientWidth - video.videoWidth * scale) / 2
    const offsetY = (video.clientHeight - video.videoHeight * scale) / 2
    const left = box.x * scale + offsetX
    return {
      left: mirrored ? video.clientWidth - left - box.width * scale : left,
      top: box.y * scale + offsetY,
      width: box.width * scale,
      height: box.height * scale,
    }
  }

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || capturing) return
    setCapturing(true)
    const scale = Math.min(1, MAX_PHOTO_WIDTH / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) { setCapturing(false); return }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height) // raw frame — never the mirrored view
    canvas.toBlob((blob) => {
      setCapturing(false)
      if (!blob) return
      stopCamera()
      onCapture(new File([blob], `group-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  const handleCancel = () => {
    stopCamera()
    onCancel()
  }

  return (
    <div className="space-y-3" data-testid="group-photo-camera">
      <div className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
          className={`w-full h-full object-cover ${cameraStatus === 'granted' ? '' : 'hidden'}`}
        />
        {cameraStatus === 'granted' && boxes.map((box, i) => {
          const style = boxStyle(box)
          if (!style) return null
          return <div key={i} className="absolute border-2 border-green-400 rounded-sm pointer-events-none" style={style} />
        })}
        {cameraStatus === 'granted' && (
          <span
            className="absolute top-2 left-2 text-xs font-medium text-white bg-black/60 px-2 py-1 rounded"
            data-testid="live-face-count"
          >
            {!modelReady ? 'Loading face detector…' : `${boxes.length} face${boxes.length === 1 ? '' : 's'} in frame`}
          </span>
        )}
        <CameraPermissionNotice status={cameraStatus} size="md" />
      </div>

      <p className="text-xs text-gray-500">
        Hold the phone steady and check every face is clear and inside the frame before capturing.
      </p>

      <div className="flex flex-wrap gap-3 justify-center">
        {cameraStatus !== 'granted' ? (
          <button
            onClick={requestCamera}
            disabled={cameraStatus === 'requesting'}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {cameraButtonLabel(cameraStatus)}
          </button>
        ) : (
          <>
            <button
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm"
            >
              {mirrored ? 'Use rear camera' : 'Use front camera'}
            </button>
            <button
              onClick={handleCapture}
              disabled={capturing}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {capturing ? 'Capturing…' : 'Capture photo'}
            </button>
          </>
        )}
        <button onClick={handleCancel} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}
