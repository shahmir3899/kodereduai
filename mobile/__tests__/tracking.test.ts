import {
  canTrackInBackground, classifySendError, enqueue, existingJourneyId, flushNewest, formatElapsed, isStale,
  MAX_BUFFER, newest, permissionState, type Ping,
} from '../services/tracking';

const ping = (at: number): Ping => ({ latitude: 31.5, longitude: 74.3, accuracy: 5, speed: null, at });

describe('buffer', () => {
  it('keeps fixes in time order and caps the length, dropping the oldest', () => {
    let b: Ping[] = [];
    for (let i = 0; i < MAX_BUFFER + 5; i++) b = enqueue(b, ping(i));
    expect(b).toHaveLength(MAX_BUFFER);
    expect(b[0].at).toBe(5);
    expect(newest(b)?.at).toBe(MAX_BUFFER + 4);
  });
  it('orders a late arrival correctly', () => {
    expect(enqueue([ping(10), ping(30)], ping(20)).map((p) => p.at)).toEqual([10, 20, 30]);
  });
  it('has no newest fix when empty', () => expect(newest([])).toBeNull());
});

describe('classifySendError', () => {
  const err = (status?: number) => (status ? { response: { status } } : new Error('Network Error'));
  it.each([
    [undefined, 'retry'], [500, 'retry'], [503, 'retry'], [429, 'retry'], [401, 'retry'],
    [404, 'gone'], [400, 'drop'], [403, 'drop'], [422, 'drop'],
  ])('status %s is %s', (status, expected) => expect(classifySendError(err(status as number | undefined))).toBe(expected));
});

describe('flushNewest', () => {
  const buf = [ping(1), ping(2), ping(3)];
  it('sends only the newest and clears the rest, since the server stamps arrival time', async () => {
    const sent: number[] = [];
    const r = await flushNewest(buf, async (p) => { sent.push(p.at); return 'ok'; });
    expect(sent).toEqual([3]);
    expect(r).toEqual({ remaining: [], sent: true, gone: false });
  });
  it('keeps everything for the next try when there is no signal', async () => {
    const r = await flushNewest(buf, async () => 'retry');
    expect(r.remaining).toHaveLength(3);
    expect(r.sent).toBe(false);
  });
  it('discards only the refused fix', async () => {
    const r = await flushNewest(buf, async () => 'drop');
    expect(r.remaining.map((p) => p.at)).toEqual([1, 2]);
  });
  it('clears the buffer and reports when the journey is over', async () => {
    const r = await flushNewest(buf, async () => 'gone');
    expect(r).toEqual({ remaining: [], sent: false, gone: true });
  });
  it('does nothing for an empty buffer', async () => {
    const send = jest.fn();
    expect(await flushNewest([], send)).toEqual({ remaining: [], sent: false, gone: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('staleness and time', () => {
  it('warns after two minutes without a report, or when nothing was ever sent', () => {
    expect(isStale(null, 1000)).toBe(true);
    expect(isStale(0, 119_000)).toBe(false);
    expect(isStale(0, 121_000)).toBe(true);
  });
  it('formats elapsed time', () => {
    const start = '2026-10-28T10:00:00Z';
    expect(formatElapsed(start, Date.parse('2026-10-28T10:05:09Z'))).toBe('5m 9s');
    expect(formatElapsed(start, Date.parse('2026-10-28T11:02:03Z'))).toBe('1h 2m 3s');
    expect(formatElapsed('junk')).toBe('');
  });
});

describe('permissions', () => {
  it('needs both foreground and "all the time" access to track in the background', () => {
    expect(permissionState('denied', 'granted')).toBe('denied');
    expect(permissionState('granted', 'denied')).toBe('foreground-only');
    expect(permissionState('granted', 'granted')).toBe('granted');
    expect(canTrackInBackground('foreground-only')).toBe(false);
    expect(canTrackInBackground('granted')).toBe(true);
  });
});

describe('existingJourneyId', () => {
  it('reads the journey the server says is already active', () => {
    expect(existingJourneyId({ response: { status: 400, data: { error: 'An active journey already exists for this route.', journey_id: 42 } } })).toBe(42);
  });
  it('ignores other errors', () => {
    expect(existingJourneyId({ response: { status: 400, data: { error: 'No vehicle' } } })).toBeNull();
    expect(existingJourneyId({ response: { status: 500, data: { journey_id: 3 } } })).toBeNull();
    expect(existingJourneyId(new Error('x'))).toBeNull();
  });
});
