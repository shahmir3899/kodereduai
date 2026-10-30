import type { DayCode } from './teacher';
import type { PortalPeriod, AttendanceCode } from './studentPortal';

// Pure logic for the Parent screens. DTOs follow backend/parents/views.py and overview.py; the
// per-child library, transport, exam schedule, results and fees payloads match the student
// portal's, so those types and screens come from services/studentPortal.ts. No React imports.

export interface ChildLink {
  id: number;
  student: number;
  student_name: string;
  student_photo_url?: string | null;
  student_roll_number?: string | number | null;
  class_name?: string | null;
  school: number;
  school_name?: string;
  relation?: string;
  is_primary?: boolean;
}

export interface ExamBlock {
  exam_id: number; exam_name: string; percentage: number; marks_obtained: number; total_marks: number;
  start_date?: string | null; branch?: string | null; read_only?: boolean;
}

export interface ChildOverview {
  student_id: number;
  student_name: string;
  photo_url?: string;
  class_name: string;
  roll_number: string;
  school_name: string;
  attendance_summary: {
    total_days: number; present: number; absent: number; leave: number; attendance_rate: number | null;
    today: AttendanceCode | null; recent: Array<{ date: string; status: AttendanceCode }>;
  };
  fee_summary: { total_due: string | number; total_paid: string | number; outstanding: string | number; overdue_amount: string | number; unpaid_items: number };
  latest_exam: ExamBlock | null;
  previous_exam: ExamBlock | null;
  next_exam: { exam_name: string; subject_name: string; exam_date: string; start_time?: string | null } | null;
  today: { date: string; is_off_day: boolean; off_day_types: string[] };
  pending_leave_count: number;
}

export const childName = (c: Pick<ChildLink, 'student_name' | 'class_name'>) =>
  c.class_name ? `${c.student_name} (${c.class_name})` : c.student_name;

// ── Attendance ────────────────────────────────────────────────────────────────

export interface ChildAttendanceRow { id: number; date: string; status: AttendanceCode; branch?: string | null }

// The parent endpoint returns bare rows with no summary, so a month's figures are counted here.
// "Rate" counts leave as attended, as the student portal's summary does.
export function monthSummary(rows: ChildAttendanceRow[]) {
  const n = { present: 0, absent: 0, late: 0, leave: 0 };
  for (const r of rows) {
    if (r.status === 'PRESENT') n.present++;
    else if (r.status === 'ABSENT') n.absent++;
    else if (r.status === 'LATE') n.late++;
    else if (r.status === 'LEAVE') n.leave++;
  }
  const total = n.present + n.absent + n.late + n.leave;
  return { ...n, total_days: total, rate: total ? Math.round(((n.present + n.leave) / total) * 1000) / 10 : 0 };
}

// ── Timetable ─────────────────────────────────────────────────────────────────

export interface ChildTimetableRow {
  id: number; day: string; slot_name: string; start_time: string; end_time: string;
  subject: string | null; teacher: string | null; room?: string | null;
}

// This endpoint has no slot order, so periods are ordered by start time.
export function childPeriods(rows: ChildTimetableRow[] | null | undefined): PortalPeriod[] {
  return (rows ?? []).map((r) => {
    const [h, m] = (r.start_time || '0:0').split(':').map(Number);
    return {
      id: r.id,
      day: r.day as DayCode,
      slot_name: r.slot_name,
      slot_order: (h || 0) * 60 + (m || 0),
      slot_start_time: r.start_time,
      slot_end_time: r.end_time,
      subject_name: r.subject,
      teacher_name: r.teacher,
      room: r.room,
    };
  });
}

// ── Leave ─────────────────────────────────────────────────────────────────────

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface ChildLeave {
  id: number; student: number; student_name: string; start_date: string; end_date: string; reason: string;
  document_url?: string | null; status: LeaveStatus; reviewed_by_name?: string | null; reviewed_at?: string | null;
  review_note?: string | null; created_at: string;
}

export const LEAVE_TONE: Record<LeaveStatus, 'warning' | 'success' | 'error' | 'neutral'> = {
  PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', CANCELLED: 'neutral',
};

// Only a pending request can be withdrawn (the API refuses the rest).
export const canCancelLeave = (l: Pick<ChildLeave, 'status'>) => l.status === 'PENDING';

export function leaveDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) || b < a ? 0 : Math.round((b - a) / 86_400_000) + 1;
}

export interface LeaveForm { student: number | null; start: string; end: string; reason: string; link: string }

// Returns an error message or null. The API also checks start <= end and the child link.
export function validateLeave(f: LeaveForm): string | null {
  if (!f.student) return 'Choose a child.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start) || !/^\d{4}-\d{2}-\d{2}$/.test(f.end)) return 'Choose the first and last day.';
  if (f.end < f.start) return 'The last day cannot be before the first day.';
  if (!f.reason.trim()) return 'Give a reason.';
  if (f.link.trim() && !/^https?:\/\/\S+$/i.test(f.link.trim())) return 'The link must start with http:// or https://.';
  return null;
}

export function leaveBody(f: LeaveForm) {
  return {
    student: f.student,
    start_date: f.start,
    end_date: f.end,
    reason: f.reason.trim(),
    ...(f.link.trim() ? { document_url: f.link.trim() } : {}),
  };
}

// ── Bus tracking ──────────────────────────────────────────────────────────────

export interface TrackPoint { id: number; latitude: string | number; longitude: string | number; speed?: number | null; timestamp: string }
export interface TrackResponse {
  active: boolean;
  message?: string;
  journey?: { id: number; route_name?: string; vehicle_number?: string | null; driver_name?: string | null; journey_type_display?: string; status_display?: string; started_at?: string };
  locations?: TrackPoint[];
  student_stop?: { id: number; name: string | null };
}

// Newest point first (the API's order is not relied on).
export function latestPoint(points: TrackPoint[] | undefined): TrackPoint | null {
  if (!points || points.length === 0) return null;
  return [...points].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
}

export function mapUrl(p: TrackPoint | null): string | null {
  return p ? `https://www.google.com/maps/search/?api=1&query=${Number(p.latitude)},${Number(p.longitude)}` : null;
}

// ── Registration ──────────────────────────────────────────────────────────────

export interface RegisterForm { username: string; email: string; password: string; confirmPassword: string; phone: string; invite_code: string }

export function registerProblem(f: RegisterForm): string | null {
  if (!f.invite_code.trim()) return 'Enter the invite code from the school.';
  if (!f.username.trim()) return 'Choose a username.';
  if (!f.phone.trim()) return 'Enter your phone number.';
  if (f.password.length < 8) return 'The password must be at least 8 characters.';
  if (f.password !== f.confirmPassword) return 'The passwords do not match.';
  return null;
}

// The API requires confirm_password and phone; leaving them out is a 400.
export function registerBody(f: RegisterForm) {
  return {
    invite_code: f.invite_code.trim(),
    username: f.username.trim(),
    ...(f.email.trim() ? { email: f.email.trim() } : {}),
    password: f.password,
    confirm_password: f.confirmPassword,
    phone: f.phone.trim(),
  };
}

// First readable message from a DRF error body ({field: [msgs]}, {detail}, {error}).
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  if (typeof d.error === 'string') return d.error;
  const first = Object.values(d).flat()[0];
  return typeof first === 'string' ? first : fallback;
}
