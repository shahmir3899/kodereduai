import api, { API_BASE_URL } from './api'
import { getAccessToken, getActiveSchoolId } from './authStorage'

const BASE = '/api/assistant'

export const assistantApi = {
  capabilities: () => api.get(`${BASE}/capabilities/`),
  listConversations: () => api.get(`${BASE}/conversations/`),
  createConversation: (data = {}) => api.post(`${BASE}/conversations/`, data),
  updateConversation: (id, data) => api.patch(`${BASE}/conversations/${id}/`, data),
  deleteConversation: (id) => api.delete(`${BASE}/conversations/${id}/`),
  getMessages: (id) => api.get(`${BASE}/conversations/${id}/messages/`),
  getInsights: (params) => api.get(`${BASE}/insights/`, { params }),
  updateInsightGroup: (id, data) => api.patch(`${BASE}/insights/groups/${id}/`, data),
  sendFeedback: (data) => api.post(`${BASE}/feedback/`, data),
  listActions: () => api.get(`${BASE}/actions/`),
  approveAction: (id) => api.post(`${BASE}/actions/${id}/approve/`, {}),
  rejectAction: (id) => api.post(`${BASE}/actions/${id}/reject/`, {}),
  editAction: (id, edits) => api.post(`${BASE}/actions/${id}/edit/`, { edits }),
  // Voice. The recording is sent as multipart; the browser sets the boundary itself.
  transcribe: (blob, language = 'auto') => {
    const form = new FormData()
    form.append('audio', blob, `speech.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
    form.append('language', language)
    return api.post(`${BASE}/voice/transcribe/`, form)
  },
  spokenVersion: (text) => api.post(`${BASE}/voice/spoken/`, { text }),
}

/**
 * Parse a server-sent-events body into JSON events.
 * Chunks can split an event anywhere, so keep the unfinished tail until the next chunk.
 */
export function createSseParser(onEvent) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        onEvent(JSON.parse(data))
      } catch {
        // A half-written or non-JSON event is skipped rather than killing the whole stream.
      }
    }
  }
}

async function openStream(conversationId, message, signal) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const schoolId = getActiveSchoolId()
  if (schoolId) headers['X-School-ID'] = schoolId
  return fetch(`${API_BASE_URL}${BASE}/conversations/${conversationId}/stream/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
    signal,
  })
}

/**
 * Send a message and call onEvent for every server event (start, route, step, card, final, error).
 * Resolves when the stream ends. Rejects with an Error whose message is safe to show.
 */
export async function streamMessage(conversationId, message, onEvent, signal) {
  let response = await openStream(conversationId, message, signal)
  if (response.status === 401) {
    // Streaming bypasses the axios interceptor: make any normal call so it refreshes the token, then retry once.
    await api.get(`${BASE}/capabilities/`)
    response = await openStream(conversationId, message, signal)
  }
  if (!response.ok) {
    let detail = 'The assistant could not answer. Please try again.'
    try {
      const body = await response.json()
      // Our own errors are written for people. A framework message (like a 406) is not, so say which HTTP status it was.
      detail = body.error || (body.detail ? `${body.detail} (HTTP ${response.status})` : detail)
    } catch {
      detail = `${detail} (HTTP ${response.status})`
    }
    const error = new Error(detail)
    error.status = response.status
    throw error
  }
  if (!response.body) throw new Error('Streaming is not supported by this browser.')

  const parse = createSseParser(onEvent)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parse(decoder.decode(value, { stream: true }))
  }
}
