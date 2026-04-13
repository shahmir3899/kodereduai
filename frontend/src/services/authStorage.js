const AUTH_PERSISTENCE_KEY = 'auth_persistence'
const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const ACTIVE_SCHOOL_KEY = 'active_school_id'

const MODE_LOCAL = 'local'
const MODE_SESSION = 'session'

function storageForMode(mode) {
  return mode === MODE_SESSION ? window.sessionStorage : window.localStorage
}

function otherStorageForMode(mode) {
  return mode === MODE_SESSION ? window.localStorage : window.sessionStorage
}

export function getAuthPersistenceMode() {
  const mode = window.localStorage.getItem(AUTH_PERSISTENCE_KEY)
  if (mode === MODE_LOCAL || mode === MODE_SESSION) {
    return mode
  }

  // Backward compatibility: existing users with localStorage tokens stay remembered.
  if (window.localStorage.getItem(ACCESS_TOKEN_KEY) || window.localStorage.getItem(REFRESH_TOKEN_KEY)) {
    window.localStorage.setItem(AUTH_PERSISTENCE_KEY, MODE_LOCAL)
    return MODE_LOCAL
  }

  return MODE_SESSION
}

export function setAuthPersistenceMode(rememberMe) {
  const mode = rememberMe ? MODE_LOCAL : MODE_SESSION
  window.localStorage.setItem(AUTH_PERSISTENCE_KEY, mode)
  return mode
}

export function getAuthValue(key) {
  const mode = getAuthPersistenceMode()
  const primary = storageForMode(mode).getItem(key)
  if (primary) return primary

  // Fallback helps during migration between old/new storage behavior.
  return otherStorageForMode(mode).getItem(key)
}

export function setAuthTokens(accessToken, refreshToken, rememberMe = false) {
  const mode = setAuthPersistenceMode(rememberMe)
  const primary = storageForMode(mode)
  const secondary = otherStorageForMode(mode)

  primary.setItem(ACCESS_TOKEN_KEY, accessToken)
  primary.setItem(REFRESH_TOKEN_KEY, refreshToken)

  secondary.removeItem(ACCESS_TOKEN_KEY)
  secondary.removeItem(REFRESH_TOKEN_KEY)
}

export function setAccessToken(accessToken) {
  const mode = getAuthPersistenceMode()
  storageForMode(mode).setItem(ACCESS_TOKEN_KEY, accessToken)
  otherStorageForMode(mode).removeItem(ACCESS_TOKEN_KEY)
}

export function setActiveSchoolId(schoolId) {
  const mode = getAuthPersistenceMode()
  storageForMode(mode).setItem(ACTIVE_SCHOOL_KEY, schoolId)
  otherStorageForMode(mode).removeItem(ACTIVE_SCHOOL_KEY)
}

export function getAccessToken() {
  return getAuthValue(ACCESS_TOKEN_KEY)
}

export function getRefreshToken() {
  return getAuthValue(REFRESH_TOKEN_KEY)
}

export function getActiveSchoolId() {
  return getAuthValue(ACTIVE_SCHOOL_KEY)
}

export function clearAuthState() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  window.localStorage.removeItem(ACTIVE_SCHOOL_KEY)
  window.localStorage.removeItem(AUTH_PERSISTENCE_KEY)

  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  window.sessionStorage.removeItem(ACTIVE_SCHOOL_KEY)
}
