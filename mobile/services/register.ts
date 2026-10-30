// Pure logic for the monthly attendance register; port of the helpers in
// frontend/src/pages/AttendanceRecordsPage.jsx and utils/awayPeriods.js.

export type RegStatus = 'PRESENT' | 'ABSENT' | 'LEAVE';
// What one cell of a student's month shows.
export type DayCell = RegStatus | 'NONE' | 'OFF' | 'NOT_ENROLLED';

export interface AwayPeriod { start: string; end?: string | null; reason?: string }
export interface RegisterStudent {
  id: number;
  name: string;
  roll_number?: string | null;
  left_date?: string | null;
  status?: string;
  admission_date?: string | null;
  away_periods?: AwayPeriod[] | null;
}
export interface RegisterRecord { student_id: number; date: string; status: string }
export interface CalendarDay {
  day: number;
  is_sunday?: boolean;
  entries?: Array<{ entry_kind?: string; affects_students?: boolean; name?: string }>;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (year: number, month0: number, day: number) => `${year}-${pad(month0 + 1)}-${pad(day)}`;
export const daysInMonth = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

// A day is "away" when start <= day < end (end is the first day back; null while still away).
function isAwayOn(periods: AwayPeriod[] | null | undefined, iso: string): boolean {
  return (periods || []).some((p) => p.start <= iso && (!p.end || iso < p.end));
}

// First day of this month on which a student counts as having left: 1 if they left earlier,
// null if they hadn't left by the month's end (or never).
export function leftFromDay(leftDate: string | null | undefined, year: number, month0: number, days: number): number | null {
  if (!leftDate) return null;
  const [ly, lm, ld] = leftDate.split('-').map(Number);
  const monthIndex = year * 12 + month0;
  const leftIndex = ly * 12 + (lm - 1);
  if (leftIndex < monthIndex) return 1;
  if (leftIndex > monthIndex) return null;
  return ld <= days ? ld : null;
}

// Days of this month before the admission date: 0 when admitted by the 1st, the whole month
// when admitted later.
export function joinedBeforeDay(admissionDate: string | null | undefined, year: number, month0: number, days: number): number {
  if (!admissionDate) return 0;
  const [ay, am, ad] = admissionDate.split('-').map(Number);
  const monthIndex = year * 12 + month0;
  const admitIndex = ay * 12 + (am - 1);
  if (admitIndex < monthIndex) return 0;
  if (admitIndex > monthIndex) return days;
  return Math.min(ad - 1, days);
}

// Student-facing off days: Sundays and holidays that affect students.
export function offDayMap(days: CalendarDay[]): Record<number, string> {
  const map: Record<number, string> = {};
  for (const d of days) {
    const names = (d.entries || [])
      .filter((e) => e.entry_kind === 'OFF_DAY' && e.affects_students !== false)
      .map((e) => e.name)
      .filter(Boolean)
      .join(', ');
    const hasOff = (d.entries || []).some((e) => e.entry_kind === 'OFF_DAY' && e.affects_students !== false);
    if (d.is_sunday || hasOff) map[d.day] = names || 'Sunday';
  }
  return map;
}

export interface RegisterRow {
  id: number;
  name: string;
  roll: string;
  cells: DayCell[]; // index 0 = day 1
  present: number;
  absent: number;
  leave: number;
  // Present out of days actually marked; null when nothing is marked yet.
  percent: number | null;
  hasLeft: boolean;
}

export interface Register {
  rows: RegisterRow[];
  totals: { present: number; absent: number; leave: number; percent: number | null };
}

const isRegStatus = (s: string): s is RegStatus => s === 'PRESENT' || s === 'ABSENT' || s === 'LEAVE';

export function buildRegister(input: {
  students: RegisterStudent[];
  records: RegisterRecord[];
  offDays: Record<number, string>;
  year: number;
  month0: number;
}): Register {
  const { students, records, offDays, year, month0 } = input;
  const days = daysInMonth(year, month0);

  const byStudent = new Map<number, Map<number, RegStatus>>();
  for (const r of records) {
    if (!isRegStatus(r.status)) continue;
    const day = parseInt(r.date.split('-')[2], 10);
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, new Map());
    byStudent.get(r.student_id)!.set(day, r.status);
  }

  const rows: RegisterRow[] = students
    .map((s) => {
      const marked = byStudent.get(s.id) ?? new Map<number, RegStatus>();
      const leftFrom = leftFromDay(s.left_date, year, month0, days);
      const joined = joinedBeforeDay(s.admission_date, year, month0, days);
      const away = new Set<number>();
      for (let d = 1; d <= days; d++) if (isAwayOn(s.away_periods, isoDay(year, month0, d))) away.add(d);

      let present = 0;
      let absent = 0;
      let leave = 0;
      const cells: DayCell[] = [];
      for (let d = 1; d <= days; d++) {
        const status = marked.get(d);
        // A saved mark always shows, even on a day the calendar now calls off.
        if (status) {
          cells.push(status);
          if (status === 'PRESENT') present++;
          else if (status === 'ABSENT') absent++;
          else leave++;
        } else if (d <= joined || (leftFrom != null && d >= leftFrom) || away.has(d)) {
          cells.push('NOT_ENROLLED');
        } else if (offDays[d]) {
          cells.push('OFF');
        } else {
          cells.push('NONE');
        }
      }
      const total = present + absent + leave;
      return {
        id: s.id,
        name: s.name,
        roll: s.roll_number ? String(s.roll_number) : '',
        cells,
        present,
        absent,
        leave,
        percent: total > 0 ? Math.round((present / total) * 100) : null,
        hasLeft: leftFrom != null,
      };
    })
    .sort((a, b) => (parseInt(a.roll, 10) || 0) - (parseInt(b.roll, 10) || 0));

  const present = rows.reduce((n, r) => n + r.present, 0);
  const absent = rows.reduce((n, r) => n + r.absent, 0);
  const leave = rows.reduce((n, r) => n + r.leave, 0);
  const total = present + absent + leave;
  return { rows, totals: { present, absent, leave, percent: total > 0 ? Math.round((present / total) * 100) : null } };
}

export function monthLabel(year: number, month0: number): string {
  return new Date(year, month0).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

// Month stepping with the year rolling over; the register never goes past the current month.
export function stepMonth(
  year: number, month0: number, delta: number, current: { year: number; month0: number },
): { year: number; month0: number } {
  const index = year * 12 + month0 + delta;
  const next = { year: Math.floor(index / 12), month0: ((index % 12) + 12) % 12 };
  const limit = current.year * 12 + current.month0;
  return next.year * 12 + next.month0 > limit ? { year: current.year, month0: current.month0 } : next;
}
