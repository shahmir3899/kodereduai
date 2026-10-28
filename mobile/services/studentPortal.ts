import type { TimetableEntry, DayCode } from './teacher';
import type { FeePayment } from './feeCollect';

// Pure logic for the Student screens. DTOs follow backend/students/views.py (Student*View) and
// students/test_portal_contract.py, which pin the real payloads. No React imports.

export interface PortalStudent {
  id: number;
  name: string;
  class_name?: string;
  roll_number?: string | number | null;
  admission_number?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  blood_group?: string | null;
  address?: string | null;
  photo_url?: string | null;
  school_name?: string;
  status?: string;
  guardian_name?: string | null;
  guardian_relation?: string | null;
  guardian_phone?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  emergency_contact?: string | null;
}

export interface PortalDashboard {
  student: PortalStudent;
  attendance: { total_days: number; present: number; absent: number; leave: number; rate: number };
  fees: { total_due: string; total_paid: string; outstanding: string };
  upcoming_assignments: Array<{ id: number; title: string; subject: string; due_date: string; type: string }>;
  today_timetable: Array<{ slot: string; start_time: string; end_time: string; subject: string | null; teacher: string | null; room?: string | null }>;
}

// ── Attendance ────────────────────────────────────────────────────────────────

export type AttendanceCode = 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
export interface PortalAttendance {
  records: Array<{ id: number; date: string; status: AttendanceCode; branch?: string | null }>;
  summary: { total_days: number; present: number; absent: number; late: number; leave: number; rate: number };
}

export function rateTone(rate: number): 'success' | 'warning' | 'error' {
  return rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'error';
}

export interface CalendarCell { day: number | null; status: AttendanceCode | null }

// Month grid (Monday first) with the day's status from the records; null cells pad the week.
export function attendanceCells(year: number, month: number, records: PortalAttendance['records']): CalendarCell[] {
  const byDay = new Map<number, AttendanceCode>();
  for (const r of records) {
    const [y, m, d] = r.date.split('-').map(Number);
    if (y === year && m === month) byDay.set(d, r.status);
  }
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const cells: CalendarCell[] = Array.from({ length: lead }, () => ({ day: null, status: null }));
  for (let d = 1; d <= days; d++) cells.push({ day: d, status: byDay.get(d) ?? null });
  while (cells.length % 7) cells.push({ day: null, status: null });
  return cells;
}

// ── Timetable ─────────────────────────────────────────────────────────────────

export interface PortalTimetable {
  slots: Array<{ id: number; name: string; start_time: string; end_time: string; slot_type?: string; order: number }>;
  entries: Array<{ day: string; slot_id: number; subject: string | null; teacher: string | null; room?: string | null }>;
}

export type PortalPeriod = TimetableEntry & { teacher_name?: string | null; room?: string | null };

// Join entries to their slots so the Teacher day-tab helpers (entriesForDay, formatSlotTime) work.
export function portalPeriods(data: PortalTimetable | null | undefined): PortalPeriod[] {
  const slots = new Map((data?.slots ?? []).map((s) => [s.id, s]));
  const out: PortalPeriod[] = [];
  (data?.entries ?? []).forEach((e, i) => {
    const slot = slots.get(e.slot_id);
    if (!slot) return;
    out.push({
      id: i + 1,
      day: e.day as DayCode,
      slot_name: slot.name,
      slot_order: slot.order,
      slot_type: slot.slot_type,
      slot_start_time: slot.start_time,
      slot_end_time: slot.end_time,
      subject_name: e.subject,
      teacher_name: e.teacher,
      room: e.room,
    });
  });
  return out;
}

// ── Exam schedule ─────────────────────────────────────────────────────────────

export interface ExamScheduleExam {
  exam_id: number;
  exam_name: string;
  exam_type?: string | null;
  exam_group_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  subjects: Array<{ subject_name: string; subject_code?: string | null; exam_date?: string | null; start_time?: string | null; end_time?: string | null }>;
}

export function dateRange(start?: string | null, end?: string | null): string {
  if (!start) return '';
  return end && end !== start ? `${start} to ${end}` : start;
}

// Sheet rows soonest first; undated subjects last.
export function sortSheet(subjects: ExamScheduleExam['subjects']): ExamScheduleExam['subjects'] {
  return [...subjects].sort((a, b) => (a.exam_date ?? '9999').localeCompare(b.exam_date ?? '9999')
    || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
}

// ── Assignments ───────────────────────────────────────────────────────────────

export interface PortalAssignment {
  id: number;
  title: string;
  description?: string;
  subject: string;
  teacher?: string | null;
  assignment_type: string;
  requires_submission: boolean;
  due_date: string | null;
  total_marks: number | null;
  status: string;
  submission?: {
    id: number; status: string; submitted_at: string; marks_obtained: number | null; feedback?: string;
  } | null;
}

export type TaskState = 'graded' | 'submitted' | 'overdue' | 'open' | 'info';
export type TaskTab = 'ALL' | 'TODO' | 'DONE';

// "info" = something to read, with nothing to hand in (diary entries, notes).
export function taskState(a: PortalAssignment, now: number = Date.now()): TaskState {
  if (a.submission) return a.submission.status === 'GRADED' || a.submission.status === 'RETURNED' ? 'graded' : 'submitted';
  if (!a.requires_submission) return 'info';
  return a.due_date && Date.parse(a.due_date) < now ? 'overdue' : 'open';
}

export function filterTasks(list: PortalAssignment[], tab: TaskTab, now: number = Date.now()): PortalAssignment[] {
  return list.filter((a) => {
    const s = taskState(a, now);
    if (tab === 'TODO') return s === 'open' || s === 'overdue';
    if (tab === 'DONE') return s === 'submitted' || s === 'graded';
    return true;
  });
}

// Open work first by due date, then everything else newest due first.
export function sortTasks(list: PortalAssignment[], now: number = Date.now()): PortalAssignment[] {
  const rank = (a: PortalAssignment) => {
    const s = taskState(a, now);
    return s === 'overdue' ? 0 : s === 'open' ? 1 : 2;
  };
  const due = (a: PortalAssignment) => Date.parse(a.due_date || '') || 0;
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? due(a) - due(b) : due(b) - due(a)));
}

// Whole calendar days (device time) from today to the due date, so "due in 2 hours" is today.
export function dueLabel(due: string | null | undefined, now: number = Date.now()): string {
  const t = Date.parse(due || '');
  if (!t) return 'No due date';
  const startOfDay = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((startOfDay(t) - startOfDay(now)) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

export function canSubmit(a: PortalAssignment): boolean {
  return a.status === 'PUBLISHED' && a.requires_submission && !a.submission;
}

// The backend takes text and/or a link (no file upload endpoint); returns an error message or null.
export function validateSubmission(text: string, link: string): string | null {
  if (!text.trim() && !link.trim()) return 'Write your answer or add a link.';
  if (link.trim() && !/^https?:\/\/\S+$/i.test(link.trim())) return 'The link must start with http:// or https://.';
  return null;
}

export function submissionBody(text: string, link: string) {
  const url = link.trim();
  return {
    submission_text: text.trim(),
    ...(url ? { file_url: url, file_name: url.split('/').filter(Boolean).pop()?.slice(0, 190) || 'Link' } : {}),
  };
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface PortalResultExam {
  exam_id: number;
  exam_name: string;
  exam_type?: string | null;
  exam_date?: string | null;
  grade?: string | null;
  branch?: string | null;
  subjects: Array<{ subject: string; marks_obtained: number | null; total_marks: number | null; is_absent: boolean; remarks?: string }>;
}

// Overall percentage of the marked subjects (absent or unmarked ones don't count), as the grade does.
export function examPercentage(exam: PortalResultExam): number | null {
  let got = 0;
  let total = 0;
  for (const s of exam.subjects) {
    if (s.is_absent || s.marks_obtained == null || !s.total_marks) continue;
    got += s.marks_obtained;
    total += s.total_marks;
  }
  return total > 0 ? Math.round((got / total) * 1000) / 10 : null;
}

export function subjectMarks(s: PortalResultExam['subjects'][number]): string {
  if (s.is_absent) return 'Absent';
  if (s.marks_obtained == null) return '–';
  return s.total_marks ? `${s.marks_obtained} / ${s.total_marks}` : String(s.marks_obtained);
}

// ── Fees ──────────────────────────────────────────────────────────────────────

export type PortalFee = FeePayment & { handed_over?: boolean; carried?: boolean; branch?: string | null; read_only?: boolean };

// Newest month first; a handed-over row's balance moved to the new branch, so it isn't owed twice.
export function feeTotals(rows: PortalFee[]) {
  let due = 0;
  let paid = 0;
  for (const r of rows) {
    if (r.handed_over) continue;
    due += Number(r.amount_due) || 0;
    paid += Number(r.amount_paid) || 0;
  }
  return { due, paid, pending: Math.max(0, due - paid) };
}

export function sortFees(rows: PortalFee[]): PortalFee[] {
  return [...rows].sort((a, b) => b.year - a.year || b.month - a.month);
}

// ── Library and transport ─────────────────────────────────────────────────────

export interface LibraryIssue {
  id: number; book_title: string; book_author?: string | null; issue_date: string; due_date: string;
  return_date?: string | null; status: string; fine_amount: string; is_overdue: boolean;
}

export function splitIssues(list: LibraryIssue[]) {
  const current = list.filter((i) => i.status === 'ISSUED' || i.status === 'OVERDUE');
  const ids = new Set(current.map((i) => i.id));
  return { current, past: list.filter((i) => !ids.has(i.id)) };
}

export function totalFines(list: LibraryIssue[]): number {
  return list.reduce((sum, i) => sum + (Number(i.fine_amount) || 0), 0);
}

export interface PortalTransport {
  transport_type?: string;
  route: { name: string; start_location?: string; end_location?: string; distance_km?: string | null; estimated_duration_minutes?: number | null };
  stop: { name: string; address?: string; stop_order?: number; pickup_time?: string; drop_time?: string };
  vehicle: { vehicle_number?: string; vehicle_type?: string; driver_name?: string; driver_phone?: string };
}
