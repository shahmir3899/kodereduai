import { CAMERA_STATUS_MESSAGES } from '../hooks/useCameraStream'

// Renders inside the same dark video-placeholder box on every camera
// screen — red text for the three states that need the operator to act
// outside the app (browser settings, hardware, another app/tab), neutral
// text for idle/requesting. Nothing rendered once the camera is granted.
export default function CameraPermissionNotice({ status, size = 'sm' }) {
  const message = CAMERA_STATUS_MESSAGES[status]
  if (!message) return null
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'
  const isActionable = status === 'denied' || status === 'not-found' || status === 'in-use' || status === 'error'
  return (
    <div className={`text-center p-4 ${textSize} ${isActionable ? 'text-red-300' : 'text-gray-300'}`}>
      {message}
    </div>
  )
}
