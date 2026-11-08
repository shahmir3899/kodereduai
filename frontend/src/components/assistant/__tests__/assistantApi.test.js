import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  API_BASE_URL: '',
}))
vi.mock('../../../services/authStorage', () => ({ getAccessToken: () => 'tok', getActiveSchoolId: () => '42' }))

import api from '../../../services/api'
import { createSseParser, streamMessage } from '../../../services/assistantApi'

const enc = new TextEncoder()
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`

function streamOf(chunks) {
  let i = 0
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }) }) },
  }
}

describe('createSseParser', () => {
  it('reads several events from one chunk', () => {
    const got = []
    createSseParser((e) => got.push(e))(sse({ type: 'start' }) + sse({ type: 'route', agents: ['finance'] }))
    expect(got.map((e) => e.type)).toEqual(['start', 'route'])
  })

  it('reassembles an event split across chunks', () => {
    const got = []
    const feed = createSseParser((e) => got.push(e))
    const whole = sse({ type: 'final', content: 'سلام hello' })
    feed(whole.slice(0, 12))
    expect(got).toHaveLength(0)
    feed(whole.slice(12))
    expect(got[0].content).toBe('سلام hello')
  })

  it('skips malformed events without stopping', () => {
    const got = []
    createSseParser((e) => got.push(e))('data: {oops\n\n' + sse({ type: 'start' }))
    expect(got).toEqual([{ type: 'start' }])
  })

  it('ignores comments and empty blocks', () => {
    const got = []
    createSseParser((e) => got.push(e))(': keep-alive\n\n\n\n' + sse({ type: 'start' }))
    expect(got).toHaveLength(1)
  })
})

describe('streamMessage', () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.clearAllMocks() })

  it('posts with auth and school headers and emits every event', async () => {
    fetch.mockResolvedValue(streamOf([sse({ type: 'start' }), sse({ type: 'final', content: 'ok' })]))
    const got = []
    await streamMessage(3, 'hello', (e) => got.push(e.type))
    expect(got).toEqual(['start', 'final'])
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toBe('/api/assistant/conversations/3/stream/')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(opts.headers['X-School-ID']).toBe('42')
    expect(JSON.parse(opts.body)).toEqual({ message: 'hello' })
  })

  it('turns a refusal (400) into an error with the server message', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Daily message limit reached.' }) })
    await expect(streamMessage(3, 'x', () => {})).rejects.toThrow('Daily message limit reached.')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html') } })
    await expect(streamMessage(3, 'x', () => {})).rejects.toThrow(/could not answer/i)
  })

  it('refreshes the session once on 401 and retries', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce(streamOf([sse({ type: 'final', content: 'ok' })]))
    const got = []
    await streamMessage(3, 'x', (e) => got.push(e.type))
    expect(api.get).toHaveBeenCalledWith('/api/assistant/capabilities/')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(got).toEqual(['final'])
  })
})
