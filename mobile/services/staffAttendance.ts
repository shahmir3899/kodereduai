import { isFutureDate } from './attendanceEntry';
import type { StaffAttendanceStatus } from './myHr';

// Pure logic for the admin's staff attendance screen: one day, every active staff member, a status
// each, saved in one call. The server turns an OFF day into On leave by itself.

export interface StaffForAttendance {
  id: number;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  employee_id?: string | null;
  department_name?: string | null;
}

export interface ExistingStaffAttendance {
  staff_member: number;
  status: StaffAttendanceStatus;
  check_in?: string | null;
  check_out?: string | null;
  notes?: string | null;
}

export interface StaffAttendanceRow {
  staffId: number;
  name: string;
  employeeId: string;
  department: string;
  status: StaffAttendanceStatus | '';
  checkIn: string;
  checkOut: string;
  notes: string;
}

export const STATUS_OPTIONS: Array<{ value: StaffAttendanceStatus; label: string; letter: string }> = [
  { value: 'PRESENT', label: 'Present', letter: 'P' },
  { value: 'ABSENT', label: 'Absent', letter: 'A' },
  { value: 'LATE', label: 'Late', letter: 'L' },
  { value: 'HALF_DAY', label: 'Half day', letter: 'H' },
  { value: 'ON_LEAVE', label: 'On leave', letter: 'V' },
];

const trimTime = (t?: string | null) => (t ? t.slice(0, 5) : '');

export function staffName(s: StaffForAttendance): string {
  return s.full_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || `Staff ${s.id}`;
}

// One row per staff member, pre-filled from what is already saved for the day.
export function buildRows(staff: StaffForAttendance[], existing: ExistingStaffAttendance[]): StaffAttendanceRow[] {
  const byStaff = new Map(existing.map((r) => [r.staff_member, r]));
  return staff
    .map((s) => {
      const e = byStaff.get(s.id);
      return {
        staffId: s.id,
        name: staffName(s),
        employeeId: s.employee_id ?? '',
        department: s.department_name ?? '',
        status: (e?.status ?? '') as StaffAttendanceRow['status'],
        checkIn: trimTime(e?.check_in),
        checkOut: trimTime(e?.check_out),
        notes: e?.notes ?? '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countStatuses(rows: StaffAttendanceRow[]): Record<StaffAttendanceStatus | 'UNMARKED', number> {
  const out = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0, UNMARKED: 0 };
  for (const r of rows) out[r.status || 'UNMARKED'] += 1;
  return out;
}

// Fills only the rows nobody has marked yet, so a saved Absent or Late is never overwritten.
export function markUnmarkedPresent(rows: StaffAttendanceRow[]): StaffAttendanceRow[] {
  return rows.map((r) => (r.status ? r : { ...r, status: 'PRESENT' }));
}

export const isDirty = (rows: StaffAttendanceRow[], base: StaffAttendanceRow[]) =>
  JSON.stringify(rows) !== JSON.stringify(base);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Times are optional, 24-hour HH:MM, and the check-out cannot be before the check-in.
export function validateTimes(row: Pick<StaffAttendanceRow, 'checkIn' | 'checkOut' | 'name'>): string | null {
  const { checkIn, checkOut, name } = row;
  if (checkIn && !TIME.test(checkIn)) return `${name}: check-in must be a time like 08:30.`;
  if (checkOut && !TIME.test(checkOut)) return `${name}: check-out must be a time like 15:00.`;
  if (checkIn && checkOut && checkOut < checkIn) return `${name}: check-out is before check-in.`;
  return null;
}

export function validateDay(date: string, rows: StaffAttendanceRow[]): string | null {
  if (isFutureDate(date)) return 'Attendance cannot be marked for a future date.';
  if (!rows.some((r) => r.status)) return 'Mark at least one staff member.';
  for (const r of rows) {
    if (!r.status) continue;
    const bad = validateTimes(r);
    if (bad) return bad;
  }
  return null;
}

// Only marked rows are sent; unmarked ones are left as they are on the server.
export function buildSavePayload(date: string, rows: StaffAttendanceRow[]) {
  return {
    date,
    records: rows
      .filter((r) => r.status)
      .map((r) => ({
        staff_member: r.staffId,
        date,
        status: r.status,
        check_in: r.checkIn || null,
        check_out: r.checkOut || null,
        notes: r.notes.trim(),
      })),
  };
}
