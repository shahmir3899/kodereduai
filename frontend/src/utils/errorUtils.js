/**
 * Extract a human-readable error message from an Axios error or DRF response.
 */
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

  // Field-level errors: { field_name: ["error1", "error2"] }
  const firstField = Object.keys(data).find(k => Array.isArray(data[k]))
  if (firstField) return `${firstField}: ${data[firstField].join(', ')}`

  return fallback
}
