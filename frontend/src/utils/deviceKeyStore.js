// A capture device's raw key is shown once, when it is created or reset. To let
// this browser run as that automatic camera later, it is kept here — on this
// browser only, per device — and used solely for that device's live-match calls.
// Storage can be unavailable (private window, blocked site data), so every access
// is guarded and a missing key simply means "ask the admin to reset it".
const keyFor = (deviceId) => `faceAutoCamera:${deviceId}`

export function getDeviceKey(deviceId) {
  try {
    return window.localStorage.getItem(keyFor(deviceId)) || null
  } catch {
    return null
  }
}

export function saveDeviceKey(deviceId, rawKey) {
  try {
    window.localStorage.setItem(keyFor(deviceId), rawKey)
    return true
  } catch {
    return false
  }
}

export function clearDeviceKey(deviceId) {
  try {
    window.localStorage.removeItem(keyFor(deviceId))
  } catch {
    /* nothing to clear */
  }
}
