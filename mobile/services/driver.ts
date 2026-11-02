// Pure logic for the Driver screens (vehicle, route, journey history). No React imports.

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
