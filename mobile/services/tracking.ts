// Pure rules for the driver's GPS reporting. No React Native imports, so Jest can load it.
//
// The server stamps every position with the time it ARRIVES (RouteLocationUpdate.timestamp is
// auto_now_add and the update endpoint takes no client time). So after a signal gap we send only
// the newest fix: replaying older ones would show them to parents as fresh positions.

export interface ActiveJourney {
  id: number;
  mode: 'route' | 'student';
  routeName?: string;
  journeyType?: string;
  startedAt: string;
}

export interface Ping {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  // Device time of the fix, kept only to pick the newest and to detect staleness.
  at: number;
}

export const MAX_BUFFER = 20;
// No successful report for this long means parents are looking at an old position.
export const STALE_AFTER_MS = 2 * 60_000;

export function enqueue(buffer: Ping[], ping: Ping, cap: number = MAX_BUFFER): Ping[] {
  const next = [...buffer, ping].sort((a, b) => a.at - b.at);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function newest(buffer: Ping[]): Ping | null {
  return buffer.length ? buffer.reduce((a, b) => (b.at >= a.at ? b : a)) : null;
}

export type SendOutcome = 'ok' | 'retry' | 'drop' | 'gone';

// What a failed report means:
//  gone  - the server says the journey is not active: stop tracking and forget it
//  drop  - the server refused this fix itself (bad data): do not resend it
//  retry - no signal, a server error, rate limiting or an expired login: keep it for next time
export function classifySendError(error: unknown): SendOutcome {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (!status) return 'retry';
  if (status === 404) return 'gone';
  if (status === 401 || status === 408 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

export interface FlushResult {
  remaining: Ping[];
  sent: boolean;
  gone: boolean;
}

// Send the newest buffered fix. On success the older ones are dropped with it (see the note above).
export async function flushNewest(buffer: Ping[], send: (ping: Ping) => Promise<SendOutcome>): Promise<FlushResult> {
  const ping = newest(buffer);
  if (!ping) return { remaining: [], sent: false, gone: false };
  const outcome = await send(ping);
  if (outcome === 'gone') return { remaining: [], sent: false, gone: true };
  if (outcome === 'ok') return { remaining: [], sent: true, gone: false };
  if (outcome === 'drop') return { remaining: buffer.filter((p) => p !== ping), sent: false, gone: false };
  return { remaining: buffer, sent: false, gone: false };
}

export function isStale(lastOkAt: number | null, now: number = Date.now(), after: number = STALE_AFTER_MS): boolean {
  return lastOkAt == null || now - lastOkAt > after;
}

export function formatElapsed(startedAt: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(startedAt));
  if (Number.isNaN(diff)) return '';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

export type PermissionState = 'granted' | 'foreground-only' | 'denied';

export function permissionState(foreground: string, background: string): PermissionState {
  if (foreground !== 'granted') return 'denied';
  return background === 'granted' ? 'granted' : 'foreground-only';
}

// A route journey needs "allow all the time": the phone is usually locked in a pocket.
export const canTrackInBackground = (s: PermissionState) => s === 'granted';

// The 400 the server returns when the route already has an active journey names it, so a driver
// whose app was killed can pick it back up.
export function existingJourneyId(error: unknown): number | null {
  const data = (error as { response?: { status?: number; data?: { journey_id?: unknown } } } | null)?.response;
  const id = Number(data?.data?.journey_id);
  return data?.status === 400 && Number.isFinite(id) && id > 0 ? id : null;
}
