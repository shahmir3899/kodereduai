// No real network: expo/fetch and the axios instance are mocked, so no model quota is used.
const mockFetch = jest.fn();
const mockGet = jest.fn();
jest.mock('expo/fetch', () => ({ fetch: (...a: any[]) => mockFetch(...a) }));
jest.mock('../services/api', () => ({ __esModule: true, default: { defaults: { baseURL: 'https://api.test/' }, get: (...a: any[]) => mockGet(...a) } }));
jest.mock('../services/auth', () => ({ getAccessToken: async () => 'tok', getActiveSchoolId: async () => '37' }));
jest.mock('../services/formFile', () => ({ appendFile: jest.fn() }));

import { eventsFromReply, errorFromBody, streamMessage, StreamUnavailable } from '../services/assistantApi';

const enc = new TextEncoder();
function streamOf(chunks: string[]) {
  let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }) }) };
}

beforeEach(() => { mockFetch.mockReset(); mockGet.mockReset(); });

describe('streamMessage', () => {
  it('sends the token and school and reads events split across chunks', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: streamOf(['data: {"type":"sta', 'rt"}\n\ndata: {"type":"final","content":"x"}\n\n']) });
    const got: any[] = [];
    await streamMessage(7, 'hi', (e) => got.push(e));
    expect(got.map((e) => e.type)).toEqual(['start', 'final']);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test/api/assistant/conversations/7/stream/');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['X-School-ID']).toBe('37');
  });

  it('refreshes through a normal call and retries once after a 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, status: 200, body: streamOf(['data: {"type":"final"}\n\n']) });
    mockGet.mockResolvedValue({});
    const got: any[] = [];
    await streamMessage(1, 'hi', (e) => got.push(e));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(got).toHaveLength(1);
  });

  it('uses the error text the server wrote for people', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Daily limit reached' }) });
    await expect(streamMessage(1, 'hi', () => {})).rejects.toThrow('Daily limit reached');
  });

  it('asks for the plain endpoint when the stream cannot open or has no body', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    await expect(streamMessage(1, 'hi', () => {})).rejects.toBeInstanceOf(StreamUnavailable);
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null });
    await expect(streamMessage(1, 'hi', () => {})).rejects.toBeInstanceOf(StreamUnavailable);
  });

  it('lets an abort through unchanged', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abort);
    await expect(streamMessage(1, 'hi', () => {})).rejects.toBe(abort);
  });
});

describe('helpers', () => {
  it('turns the plain reply into a final event', () => {
    const [e] = eventsFromReply({ response: 'hi', message: { id: 3, role: 'assistant', content: 'hi', actions: [] }, memory: { used: 1, limit: 10 } });
    expect(e).toMatchObject({ type: 'final', content: 'hi', memory: { used: 1, limit: 10 } });
  });

  it('adds the HTTP status to framework messages only', () => {
    expect(errorFromBody({ error: 'Mine' }, 400)).toBe('Mine');
    expect(errorFromBody({ detail: 'Not found.' }, 404)).toBe('Not found. (HTTP 404)');
    expect(errorFromBody(null, 500)).toMatch(/HTTP 500/);
  });
});
