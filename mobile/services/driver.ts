// Pure logic for the Driver screens (vehicle, route, journey history, boarding). No React imports.

export interface DriverVehicle {
  id: number;
  vehicle_number: string;
  vehicle_type: string;
  capacity: number;
  assigned_route: number | null;
  assigned_route_name?: string;
  driver_name?: string;
}

export interface DriverRoute {
  id: number;
  name: string;
  start_location?: string;
  end_location?: string;
  distance_km?: string | null;
  estimated_duration_minutes?: number | null;
}

export interface DriverStop {
  id: number;
  name: string;
  address?: string;
  stop_order: number;
  pickup_time: string | null;
  drop_time: string | null;
}

export type JourneyType = 'TO_SCHOOL' | 'FROM_SCHOOL';
export const JOURNEY_LABELS: Record<JourneyType, string> = { TO_SCHOOL: 'To school', FROM_SCHOOL: 'From school' };

export const sortStops = (stops: DriverStop[]) => [...stops].sort((a, b) => (a.stop_order || 0) - (b.stop_order || 0));

// ── Journey history ───────────────────────────────────────────────────────────

export interface JourneyRow {
  id: number;
  status: string;
  status_display?: string;
  journey_type: string;
  journey_type_display?: string;
  started_at: string;
  ended_at?: string | null;
  route?: number;
}

export type ServerJourneyState = 'ACTIVE' | 'ENDED' | 'UNKNOWN';

// What the server says about a journey the phone remembers. History only lists the last 20, so
// a journey that is not in it is UNKNOWN and keeps being tracked rather than being dropped.
export function journeyStateFromHistory(history: JourneyRow[] | undefined, id: number): ServerJourneyState {
  const row = (history ?? []).find((j) => j.id === id);
  if (!row) return 'UNKNOWN';
  return row.status === 'ACTIVE' ? 'ACTIVE' : 'ENDED';
}

export const activeJourneyOf = (history: JourneyRow[] | undefined, routeId: number | null | undefined) =>
  (history ?? []).find((j) => j.status === 'ACTIVE' && (!routeId || j.route === routeId)) ?? null;

export function isToday(iso: string, now: Date = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function durationLabel(start: string, end?: string | null): string {
  if (!end) return '';
  const mins = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return '';
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// ── Boarding ──────────────────────────────────────────────────────────────────

export type Boarding = 'BOARDED' | 'NOT_BOARDED' | 'ABSENT';
export interface BoardingStudent {
  student_id: number;
  name: string;
  class_name?: string | null;
  roll_number?: string | number | null;
  stop_name: string | null;
  stop_order: number | null;
  boarding_status: Boarding | null;
}
export interface BoardingRoster {
  route: { id: number; name: string };
  date: string;
  students: BoardingStudent[];
}

// Tap order: unmarked -> boarded -> did not board -> absent -> unmarked.
const CYCLE: Array<Boarding | null> = [null, 'BOARDED', 'NOT_BOARDED', 'ABSENT'];
export function nextBoarding(current: Boarding | null | undefined): Boarding | null {
  return CYCLE[(CYCLE.indexOf(current ?? null) + 1) % CYCLE.length];
}

export const BOARDING_LABEL: Record<Boarding, string> = { BOARDED: 'Boarded', NOT_BOARDED: 'Not boarded', ABSENT: 'Absent' };
export const BOARDING_TONE: Record<Boarding, 'success' | 'warning' | 'error'> = { BOARDED: 'success', NOT_BOARDED: 'warning', ABSENT: 'error' };

export type Draft = Record<number, Boarding | null>;

export const statusOf = (s: BoardingStudent, draft: Draft): Boarding | null =>
  s.student_id in draft ? draft[s.student_id] : s.boarding_status;

// Only what changed from the saved state is sent. A student returned to "unmarked" has nothing to
// send (the API has no way to un-mark), so it is left out.
export function changedRecords(students: BoardingStudent[], draft: Draft) {
  return students
    .filter((s) => s.student_id in draft && draft[s.student_id] !== s.boarding_status && draft[s.student_id] !== null)
    .map((s) => ({ student_id: s.student_id, boarding_status: draft[s.student_id] as Boarding }));
}

export function boardingCounts(students: BoardingStudent[], draft: Draft) {
  const c = { BOARDED: 0, NOT_BOARDED: 0, ABSENT: 0, unmarked: 0 };
  for (const s of students) {
    const st = statusOf(s, draft);
    if (st) c[st]++;
    else c.unmarked++;
  }
  return c;
}

export interface StopGroup { key: string; title: string; students: BoardingStudent[] }

// Students grouped by stop, in stop order (unassigned stops last).
export function groupByStop(students: BoardingStudent[]): StopGroup[] {
  const groups = new Map<string, StopGroup & { order: number }>();
  for (const s of students) {
    const key = s.stop_name ?? '—';
    const g = groups.get(key) ?? { key, title: s.stop_name ?? 'No stop', students: [], order: s.stop_order ?? 9999 };
    g.students.push(s);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ key, title, students: list }) => ({ key, title, students: list }));
}

export function markAll(students: BoardingStudent[], status: Boarding, draft: Draft): Draft {
  const next = { ...draft };
  for (const s of students) if (statusOf(s, draft) === null) next[s.student_id] = status;
  return next;
}
