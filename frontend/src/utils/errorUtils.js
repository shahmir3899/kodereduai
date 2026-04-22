/**
 * Extract a human-readable error message from an Axios error or DRF response.
 */
function flattenErrorMessages(value, prefix = '') {
  if (value == null) return []

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [prefix ? `${prefix}: ${String(value)}` : String(value)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, idx) => {
      const nextPrefix = prefix && typeof item === 'object' && item !== null
        ? `${prefix}[${idx + 1}]`
        : prefix
      return flattenErrorMessages(item, nextPrefix)
    })
  }

  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      return flattenErrorMessages(nested, nextPrefix)
    })
  }

  return [prefix ? `${prefix}: ${String(value)}` : String(value)]
}

export function getErrorMessage(error, fallback = 'Something went wrong') {
  // Network error (no response at all)
  if (!error?.response) {
    return error?.message === 'Network Error'
      ? 'Network error — please check your connection.'
      : fallback
  }

  const { status, data } = error.response

  // Server error with HTML body (Django debug page, nginx error, etc.)
  if (typeof data === 'string' && (data.includes('<!DOCTYPE') || data.includes('<html'))) {
    return status >= 500
      ? 'Server error — please try again later.'
      : fallback
  }

  // Standard DRF error shapes
  if (!data) return fallback
  if (typeof data === 'string') return data
  if (data.detail) return data.detail
  if (data.non_field_errors) return data.non_field_errors.join(', ')
  if (Array.isArray(data)) {
    const messages = flattenErrorMessages(data)
    return messages.length ? messages.join(', ') : fallback
  }

  const messages = flattenErrorMessages(data)
  if (messages.length) return messages.join(', ')

  return fallback
}
