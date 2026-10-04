export function getApiErrorMessage(error, fallback) {
  const data = error?.response?.data
  if (!data) return error?.message || fallback
  if (typeof data === 'string') return data
  if (typeof data.detail === 'string') return data.detail

  const firstKey = Object.keys(data)[0]
  if (!firstKey) return fallback
  const firstValue = data[firstKey]

  if (Array.isArray(firstValue) && firstValue.length > 0) {
    return `${firstKey}: ${firstValue[0]}`
  }
  if (typeof firstValue === 'string') {
    return `${firstKey}: ${firstValue}`
  }
  return fallback
}

export function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}
