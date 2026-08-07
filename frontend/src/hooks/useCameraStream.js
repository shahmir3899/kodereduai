import { useCallback, useEffect, useRef, useState } from 'react'

// Shared getUserMedia lifecycle for the two screens that actually stream a
// live camera feed (FaceLiveCapturePage, LiveEnrollCapture) — Group Photo
// capture uses a native <input type="file" capture> instead, which has no
// JS-visible permission/device state to unify here.
//
// Distinct statuses (not a single generic "error") so each screen can give
// the operator a next step instead of a dead end:
//   idle        — camera not yet requested
//   requesting  — getUserMedia() in flight
//   granted     — stream attached to videoRef.current
//   denied      — user (or a site-permission policy) refused access
//   not-found   — no camera device exists on this hardware
//   in-use      — a device exists but is held by another app/tab
//   error       — anything else (unsupported browser, transient failure)
export const CAMERA_STATUS_MESSAGES = {
  idle: 'Camera access is required.',
  requesting: 'Requesting camera access…',
  denied: "Camera access was denied. Enable it in your browser's site settings and retry.",
  'not-found': "No camera was found on this device. Check it's connected and try again.",
  'in-use': 'The camera is already in use by another app or tab. Close it there and retry.',
  error: 'Could not start the camera. Check your device and retry.',
  granted: null,
}

export function cameraButtonLabel(status) {
  if (status === 'requesting') return 'Requesting…'
  if (status === 'granted') return 'Camera Enabled'
  if (status === 'idle') return 'Enable Camera'
  return 'Retry Camera Access'
}

export default function useCameraStream({ facingMode = 'user' } = {}) {
  const [cameraStatus, setCameraStatus] = useState('idle')
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      return
    }
    setCameraStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraStatus('granted')
    } catch (err) {
      switch (err?.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
        case 'SecurityError':
          setCameraStatus('denied')
          break
        case 'NotFoundError':
        case 'DevicesNotFoundError':
        case 'OverconstrainedError':
          setCameraStatus('not-found')
          break
        case 'NotReadableError':
        case 'TrackStartError':
          setCameraStatus('in-use')
          break
        default:
          setCameraStatus('error')
      }
    }
  }, [facingMode])

  useEffect(() => () => stopCamera(), [stopCamera])

  return { videoRef, cameraStatus, requestCamera, stopCamera }
}
