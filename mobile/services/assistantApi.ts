import { fetch as streamingFetch } from 'expo/fetch';
import api from './api';
import { getAccessToken, getActiveSchoolId } from './auth';
import { appendFile } from './formFile';
import { createSseParser, type AssistantEvent } from './assistantSse';

const BASE = '/api/assistant';

export const assistantApi = {
  capabilities: () => api.get(`${BASE}/capabilities/`),
  listConversations: () => api.get(`${BASE}/conversations/`),
  createConversation: (data: object = {}) => api.post(`${BASE}/conversations/`, data),
  updateConversation: (id: number, data: object) => api.patch(`${BASE}/conversations/${id}/`, data),
  deleteConversation: (id: number) => api.delete(`${BASE}/conversations/${id}/`),
  getMessages: (id: number) => api.get(`${BASE}/conversations/${id}/messages/`),
  // Non-streaming turn: used when the stream cannot be opened.
  sendMessage: (id: number, message: string) => api.post(`${BASE}/conversations/${id}/messages/`, { message }, { timeout: 120000 }),
  sendFeedback: (data: { message_id: number | string; rating: 1 | -1 }) => api.post(`${BASE}/feedback/`, data),
  approveAction: (id: number) => api.post(`${BASE}/actions/${id}/approve/`, {}),
  rejectAction: (id: number) => api.post(`${BASE}/actions/${id}/reject/`, {}),
  editAction: (id: number, edits: object) => api.post(`${BASE}/actions/${id}/edit/`, { edits }),
  spokenVersion: (text: string) => api.post(`${BASE}/voice/spoken/`, { text }),
  // The recording is a file on the phone; React Native reads { uri, name, type } itself.
  transcribe: async (file: { uri: string; name: string; type: string }, language = 'auto') => {
    const form = new FormData();
    await appendFile(form, 'audio', file);
    form.append('language', language);
    return api.post(`${BASE}/voice/transcribe/`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
  },
};

export class StreamUnavailable extends Error {}

async function openStream(conversationId: number, message: string, signal?: AbortSignal) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const schoolId = await getActiveSchoolId();
  if (schoolId) headers['X-School-ID'] = schoolId;
  // The axios instance already knows the server address, so the stream cannot drift from it.
  const base = String(api.defaults.baseURL ?? '').replace(/\/$/, '');
  return streamingFetch(`${base}${BASE}/conversations/${conversationId}/stream/`, {
    method: 'POST', headers, body: JSON.stringify({ message }), signal,
  });
}

/** Errors the server wrote for people say so; a framework message gets its HTTP status added. */
export function errorFromBody(body: any, status: number): string {
  const fallback = 'The assistant could not answer. Please try again.';
  if (!body) return `${fallback} (HTTP ${status})`;
  return body.error || (body.detail ? `${body.detail} (HTTP ${status})` : `${fallback} (HTTP ${status})`);
}

/**
 * Send a message and call onEvent for every server event (start, route, step, card, final, error).
 * Resolves when the stream ends. Throws StreamUnavailable when the stream could not be opened at all
 * (the caller then uses the plain endpoint), or an Error with text that is safe to show.
 */
export async function streamMessage(conversationId: number, message: string, onEvent: (e: AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  let response;
  try {
    response = await openStream(conversationId, message, signal);
    if (response.status === 401) {
      // Streaming bypasses the axios interceptor: any normal call refreshes the token, then retry once.
      await api.get(`${BASE}/capabilities/`);
      response = await openStream(conversationId, message, signal);
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new StreamUnavailable(err?.message || 'stream could not open');
  }
  if (!response.ok) {
    let body: any = null;
    try { body = await response.json(); } catch { /* not JSON */ }
    const error: Error & { status?: number } = new Error(errorFromBody(body, response.status));
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new StreamUnavailable('no response body');

  const parse = createSseParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parse(decoder.decode(value, { stream: true }));
  }
}

/** The plain endpoint's reply, shaped as the events the stream would have sent. */
export function eventsFromReply(data: any): AssistantEvent[] {
  return [{ type: 'final', content: data?.response ?? data?.message?.content ?? '', message: data?.message, memory: data?.memory, sub_agents: data?.sub_agents, tool_calls: data?.tool_calls }];
}
