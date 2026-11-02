import { leaveDays, type LeaveApplication, type LeaveStatus } from './myHr';

// Pure logic for the admin's staff leave screen: list filters, the decision and apply payloads, and
// the card text. The server decides who may approve (admin and principal), so nothing here gates access.

export interface StaffLeaveApplication extends LeaveApplication {
  staff_member_name?: string;
  staff_employee_id?: string | null;
  approved_by_name?: string | null;
}

export type LeaveFilter = LeaveStatus | 'ALL';

export const LEAVE_FILTERS: Array<{ value: LeaveFilter; label: string }> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
];

// Query params for the applications list. "All" sends no status.
export function leaveListParams(filter: LeaveFilter, term: string): Record<string, unknown> {
  return {
    page_size: 9999,
    ...(filter !== 'ALL' ? { status: filter } : {}),
    ...(term.trim() ? { search: term.trim() } : {}),
  };
}

// Only a pending application can be approved or rejected; the server answers 400 for any other.
export const canDecide = (a: Pick<LeaveApplication, 'status'>) => a.status === 'PENDING';

export function decisionPayload(remarks: string): { admin_remarks: string } {
  return { admin_remarks: remarks.trim() };
}

// "12 Nov to 14 Nov, 3 days" (or one date when the leave is a single day).
export function leaveDatesLine(a: Pick<LeaveApplication, 'start_date' | 'end_date' | 'total_days'>): string {
  const days = a.total_days ?? leaveDays(a.start_date, a.end_date);
  const when = a.start_date === a.end_date ? a.start_date : `${a.start_date} to ${a.end_date}`;
  return days != null ? `${when}  ·  ${days} day${days === 1 ? '' : 's'}` : when;
}

export function staffLabel(a: Pick<StaffLeaveApplication, 'staff_member_name' | 'staff_employee_id'>): string {
  return a.staff_member_name || 'Staff member';
}

// Applying for someone else (admin): who, which policy, dates, a reason.
export interface ApplyForm { staff: number | null; policy: number | null; start: string; end: string; reason: string }
export const emptyApplyForm = (): ApplyForm => ({ staff: null, policy: null, start: '', end: '', reason: '' });

export function validateApply(f: ApplyForm): string | null {
  if (f.staff == null) return 'Choose the staff member.';
  if (f.policy == null) return 'Choose the type of leave.';
  if (!f.start || !f.end) return 'Choose the start and end dates.';
  if (f.start > f.end) return 'The end date cannot be before the start date.';
  if (!f.reason.trim()) return 'Write a short reason.';
  return null;
}

export function buildApplyPayload(f: ApplyForm) {
  return { staff_member: f.staff, leave_policy: f.policy, start_date: f.start, end_date: f.end, reason: f.reason.trim() };
}

// The server's refusal (a past-dated or overlapping application, a status that cannot change) comes
// as { detail } or as field messages; show the first thing it says.
export function staffLeaveErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim() && data.length < 200) return data;
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const text = Array.isArray(value) ? value.map(String).join(' ') : typeof value === 'string' ? value : '';
      if (text) return text;
    }
  }
  return fallback;
}
