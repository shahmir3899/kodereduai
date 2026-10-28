// Pure logic for the self-service HR screens (My Leave, My Attendance); port of the self-service
// paths in frontend/src/pages/hr/LeaveManagementPage.jsx and StaffAttendancePage.jsx.

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveApplication {
  id: number;
  staff_member: number;
  leave_policy: number;
  leave_policy_name?: string;
  leave_type_display?: string;
  start_date: string;
  end_date: string;
  total_days?: number | null;
  reason?: string;
  status: LeaveStatus;
  admin_remarks?: string | null;
}

export interface LeavePolicy { id: number; name: string; leave_type?: string; days_allowed?: number }
export interface LeaveBalance { policy_id: number; policy_name: string; days_allowed: number; days_used: number; days_remaining: number }

export const LEAVE_STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export function leaveTone(s: LeaveStatus): 'warning' | 'success' | 'error' | 'neutral' {
  return s === 'PENDING' ? 'warning' : s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'error' : 'neutral';
}

// Pending and approved leave can be called off; the server refuses the rest.
export const canCancelLeave = (a: Pick<LeaveApplication, 'status'>) => a.status === 'PENDING' || a.status === 'APPROVED';

export function filterLeave(list: LeaveApplication[], status: string): LeaveApplication[] {
  return status ? list.filter((a) => a.status === status) : list;
}

// Newest start date first.
export function sortLeave(list: LeaveApplication[]): LeaveApplication[] {
  return [...list].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
}

export interface LeaveForm { policy: number | null; start: string; end: string; reason: string }
export const emptyLeaveForm = (): LeaveForm => ({ policy: null, start: '', end: '', reason: '' });

// Days from start to end, both included; null while either date is missing or the range is backwards.
export function leaveDays(start: string, end: string): number | null {
  if (!start || !end || end < start) return null;
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

// null when fine. The server enforces the real rules (overlaps, balances); this catches mistakes early.
export function validateLeave(f: LeaveForm): string | null {
  if (!f.policy) return 'Please choose the type of leave';
  if (!f.start) return 'Please pick the first day';
  if (!f.end) return 'Please pick the last day';
  if (f.end < f.start) return 'The last day cannot be before the first day';
  if (!f.reason.trim()) return 'Please give a reason';
  return null;
}

// staff_member is left out on purpose: the server forces it to the signed-in person's own record.
export function buildLeavePayload(f: LeaveForm) {
  return { leave_policy: f.policy, start_date: f.start, end_date: f.end, reason: f.reason.trim() };
}

export function leaveErrorMessage(data: unknown): string {
  const d = (data ?? {}) as { end_date?: string[]; detail?: string; non_field_errors?: string[] };
  return d.end_date?.[0] || d.detail || d.non_field_errors?.[0] || 'Failed to submit leave application';
}

// The signed-in person's own staff record: the one on their leave applications, else the staff
// list entry linked to their user, else (teachers) the teacher on their timetable.
export function resolveMyStaffId(input: {
  applications: Array<{ staff_member: number }>;
  staff: Array<{ id: number; user?: number | null }>;
  userId: number | undefined;
  timetableTeacherId?: number | null;
}): number | null {
  const fromApps = input.applications[0]?.staff_member;
  if (fromApps) return fromApps;
  const mine = input.userId != null ? input.staff.find((s) => s.user === input.userId) : undefined;
  return mine?.id ?? input.timetableTeacherId ?? null;
}

// Share of the allowance already used, 0..100 (a policy with no allowance counts as unused).
export function usedPercent(b: Pick<LeaveBalance, 'days_allowed' | 'days_used'>): number {
  if (!(b.days_allowed > 0)) return 0;
  return Math.min(100, Math.round((b.days_used / b.days_allowed) * 100));
}

export type StaffAttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE';
export interface StaffAttendanceRecord {
  id: number;
  date: string;
  status: StaffAttendanceStatus;
  status_display?: string;
  check_in?: string | null;
  check_out?: string | null;
  notes?: string | null;
}
export interface AttendanceSummary {
  PRESENT?: number; ABSENT?: number; LATE?: number; HALF_DAY?: number; ON_LEAVE?: number; attendance_rate?: number | null;
}

export const ATTENDANCE_LABELS: Record<StaffAttendanceStatus, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', HALF_DAY: 'Half day', ON_LEAVE: 'On leave',
};

export function attendanceTone(s: StaffAttendanceStatus): 'success' | 'error' | 'warning' | 'info' {
  return s === 'PRESENT' ? 'success' : s === 'ABSENT' ? 'error' : s === 'ON_LEAVE' ? 'info' : 'warning';
}

// First and last day of a month, stopping at today for the current month (no future days).
export function monthRange(year: number, month0: number, today: string): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(year, month0 + 1, 0).getDate();
  const end = `${year}-${pad(month0 + 1)}-${pad(last)}`;
  return { start: `${year}-${pad(month0 + 1)}-01`, end: end > today ? today : end };
}

export function sortAttendance(list: StaffAttendanceRecord[]): StaffAttendanceRecord[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date));
}

// 'HH:MM:SS' -> 'HH:MM'.
export const shortTime = (t?: string | null) => (t ? t.slice(0, 5) : '—');
