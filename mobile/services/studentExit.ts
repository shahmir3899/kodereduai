// Student leaving, transfer and re-admission: port of StudentExitWizard.jsx, ReadmitStudentModal.jsx and
// the rules in backend/student_exits (services.py, views.py, serializers.py). Pure logic, no screens:
// the request builders, what the server's answers mean, and the words. Admin and principal only (the
// server checks). Nothing here is applied automatically: every step is a confirmed tap.

export type ExitType = 'WITHDRAWN' | 'TRANSFERRED';
export type ExitStatus = 'OPEN' | 'FINALIZED' | 'CANCELLED';
export type ItemKind = 'FEES' | 'LIBRARY' | 'GATE_PASS';
export type ItemState = 'CLEAR' | 'OPEN' | 'WAIVED' | 'CARRIED';

export const EXIT_TYPES: Array<{ value: ExitType; label: string; hint: string }> = [
  { value: 'WITHDRAWN', label: 'Withdrawn', hint: 'Left school.' },
  { value: 'TRANSFERRED', label: 'Transferred', hint: 'Moves to another branch of this organization, with a new record there. The record here stays.' },
];

export const WAIVER_REASON_MIN_LENGTH = 10;

// ── What the server sends ─────────────────────────────────────────────────────

export interface FeeDetailRow { label: string; fee_type?: string; month?: number | null; year?: number | null; balance: string | number }
export interface BookDetailRow { id: number; title: string; due_date: string; status?: string }
export interface PassDetailRow { id: number; going_to: string; departure_date: string }

export interface ExitItem {
  id?: number;
  kind: ItemKind;
  kind_label?: string;
  state: ItemState;
  summary?: string | null;
  detail?: { items?: FeeDetailRow[]; books?: BookDetailRow[]; passes?: PassDetailRow[] } | null;
  amount?: string | number | null;
  waiver_reason?: string | null;
  waived_by_name?: string | null;
  waived_at?: string | null;
}

export interface FeeCarryLine { fee_type: string; label: string; balance: string | number; month: number; year: number; category_exists?: boolean }
export interface FeeCarryPlan { destination: string; total: string | number; lines: FeeCarryLine[] }

export interface StudentExitCase {
  id: number;
  student: number;
  student_name?: string;
  exit_type: ExitType;
  exit_type_label?: string;
  status: ExitStatus;
  leaving_date: string;
  reason?: string | null;
  destination_school?: number | null;
  destination_school_name?: string | null;
  destination_session_class?: number | null;
  destination_class_label?: string | null;
  destination_roll_number?: string | null;
  fee_carry_plan?: FeeCarryPlan | null;
  remove_records_after_leaving?: boolean;
  items?: ExitItem[];
  open_item_count?: number;
}

export interface ExitDestination { id: number; name: string }
export interface DestinationClass { id: number; label: string; rolls: string[] }
export interface DestinationClasses { academic_year?: { id: number; name: string }; classes: DestinationClass[] }

// ── The details step ──────────────────────────────────────────────────────────

export interface ExitForm {
  exitType: ExitType;
  leavingDate: string;
  reason: string;
  destinationSchool: number | null;
  destinationClass: number | null;
  destinationRoll: string;
}

export const emptyExitForm = (today: string): ExitForm => ({
  exitType: 'WITHDRAWN', leavingDate: today, reason: '', destinationSchool: null, destinationClass: null, destinationRoll: '',
});

// A form that continues an exit already started.
export const exitToForm = (c: StudentExitCase): ExitForm => ({
  exitType: c.exit_type, leavingDate: c.leaving_date, reason: c.reason ?? '',
  destinationSchool: c.destination_school ?? null, destinationClass: c.destination_session_class ?? null,
  destinationRoll: c.destination_roll_number ?? '',
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isTransfer = (f: Pick<ExitForm, 'exitType'>) => f.exitType === 'TRANSFERRED';

export function validateDetails(f: ExitForm): string | null {
  if (!ISO_DAY.test(f.leavingDate)) return 'Choose the leaving date.';
  if (isTransfer(f)) {
    if (!f.destinationSchool) return 'Choose the branch the student is transferring to.';
    if (!f.destinationClass) return 'Choose the class at the new branch.';
    if (!f.destinationRoll.trim()) return 'Enter the roll number at the new branch.';
  }
  return null;
}

// Placement fields only for a transfer; a withdrawal sends none, as the server refuses them.
function placement(f: ExitForm) {
  return isTransfer(f)
    ? { destination_school: f.destinationSchool, destination_session_class: f.destinationClass, destination_roll_number: f.destinationRoll.trim() }
    : {};
}

export function buildStartPayload(studentId: number, f: ExitForm) {
  return {
    student: studentId,
    exit_type: f.exitType,
    leaving_date: f.leavingDate,
    reason: f.reason.trim(),
    ...placement(f),
    // Removing records after the leaving date is a deletion; the phone never asks for it.
    remove_records_after_leaving: false,
  };
}

export function buildUpdatePayload(f: ExitForm) {
  return { leaving_date: f.leavingDate, reason: f.reason.trim(), ...placement(f), remove_records_after_leaving: false };
}

// "Next free roll in that class": the number after the highest all-digit roll taken, or null when no roll is a number.
export function nextFreeRoll(taken: string[]): string | null {
  const nums = taken.map((r) => String(r).trim()).filter((r) => /^\d+$/.test(r)).map(Number);
  if (nums.length === 0) return null;
  return String(Math.max(...nums) + 1);
}

// ── The clearance step ────────────────────────────────────────────────────────

export const ITEM_STATE_LABELS: Record<ItemState, string> = { CLEAR: 'Clear', OPEN: 'Open', WAIVED: 'Waived', CARRIED: 'Carried to new branch' };
export const ITEM_STATE_TONES: Record<ItemState, 'success' | 'error' | 'warning' | 'info'> = { CLEAR: 'success', OPEN: 'error', WAIVED: 'warning', CARRIED: 'info' };

export const itemsOf = (c: StudentExitCase | null | undefined): ExitItem[] => c?.items ?? [];
export const openItems = (c: StudentExitCase | null | undefined): ExitItem[] => itemsOf(c).filter((i) => i.state === 'OPEN');

// Finalizing needs every item clear, waived or carried.
export const canFinalize = (c: StudentExitCase | null | undefined): boolean => !!c && c.status === 'OPEN' && openItems(c).length === 0;

// The waiver reason, trimmed, must be long enough for the log to mean something.
export function waiverProblem(reason: string): string | null {
  return reason.trim().length < WAIVER_REASON_MIN_LENGTH ? `Give a reason of at least ${WAIVER_REASON_MIN_LENGTH} characters to waive this item.` : null;
}

export const reasonPayload = (reason: string) => ({ reason: reason.trim() });

const money = (v: string | number | null | undefined) => `PKR ${Math.round(Number(v) || 0).toLocaleString()}`;
const when = (month: number | null | undefined, year: number | null | undefined) => (month ? ` (${month}/${year})` : year ? ` (${year})` : '');

// The lines under an item: each unpaid fee with its balance, each book not returned, each pass still out.
export function itemDetailLines(item: ExitItem): string[] {
  const d = item.detail ?? {};
  if (item.kind === 'FEES') return (d.items ?? []).map((r) => `${r.label}${when(r.month, r.year)}: ${money(r.balance)}`);
  if (item.kind === 'LIBRARY') return (d.books ?? []).map((b) => `${b.title}, due ${b.due_date}${b.status === 'OVERDUE' ? ' (overdue)' : ''}`);
  if (item.kind === 'GATE_PASS') return (d.passes ?? []).map((p) => `Out to ${p.going_to} since ${p.departure_date}`);
  return [];
}

// What carrying the pending fees would hand to the new branch.
export function carryLines(plan: FeeCarryPlan | null | undefined): string[] {
  return (plan?.lines ?? []).map((l) => `${l.label}${when(l.month, l.year)}: ${money(l.balance)}${l.category_exists === false ? ' (category will be created)' : ''}`);
}

export const carryText = (plan: FeeCarryPlan) => `${money(plan.total)} of unpaid fees becomes ${plan.destination}'s to collect, created there as unpaid, and is no longer counted here.`;

export const waivedNote = (i: ExitItem) => `Waived by ${i.waived_by_name ?? 'someone'}${i.waived_at ? ` on ${i.waived_at.slice(0, 10)}` : ''}: ${i.waiver_reason ?? ''}`.trim();

// ── The review step ───────────────────────────────────────────────────────────

export function finalizeEffects(c: Pick<StudentExitCase, 'exit_type' | 'destination_school_name' | 'leaving_date'>): string[] {
  const moved = c.exit_type === 'TRANSFERRED';
  return [
    `The student is marked ${moved ? 'Transferred' : 'Withdrawn'} and this year's enrollment is closed.`,
    ...(moved ? [`A new student record is created at ${c.destination_school_name ?? 'the new branch'}, starting ${c.leaving_date}.`] : []),
    'Their hostel room is vacated and transport assignment ended.',
    'Their own login at this school is switched off.',
    'Parents keep read-only access to the history.',
  ];
}

export const openItemsText = (n: number) => `${n} item${n === 1 ? ' is' : 's are'} still open. Clear or waive ${n === 1 ? 'it' : 'them'} first.`;

export const finalizeConfirmText = (c: Pick<StudentExitCase, 'student_name' | 'exit_type' | 'leaving_date'>) =>
  `${c.student_name ?? 'This student'} will be marked ${c.exit_type === 'TRANSFERRED' ? 'Transferred' : 'Withdrawn'} from ${c.leaving_date}. This closes their enrollment and switches off their login. It can only be undone by re-admitting them.`;

export const finalizedText = (c: Pick<StudentExitCase, 'student_name' | 'exit_type'>) =>
  `${c.student_name ?? 'The student'} has been ${c.exit_type === 'TRANSFERRED' ? 'transferred' : 'withdrawn'}.`;

// ── What went wrong ───────────────────────────────────────────────────────────

export interface LeavingConflict {
  detail: string;
  student_name?: string;
  leaving_date?: string;
  last_record_date?: string;
  suggested_leaving_date?: string;
  attendance?: { count: number; first_date?: string | null; last_date?: string | null; present?: number; absent?: number; leave?: number };
  marks?: { count: number; exams?: Array<{ name: string; count: number }> };
}

export type ExitProblem =
  | { kind: 'conflict'; message: string; conflict: LeavingConflict }
  | { kind: 'clearance'; message: string; openKinds: string[] }
  | { kind: 'plain'; message: string };

// The server answers 400 with { detail } for a broken rule, plus structured fields for two of them: a
// leaving date that strands records, and a finalize with open items.
export function exitProblem(e: unknown, fallback = 'Something went wrong. Try again.'): ExitProblem {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data || typeof data !== 'object') return { kind: 'plain', message: (e as Error)?.message && !(e as { response?: unknown }).response ? 'No connection. Check your internet and try again.' : fallback };
  const detail = typeof data.detail === 'string' ? data.detail : '';
  if (typeof data.suggested_leaving_date === 'string') return { kind: 'conflict', message: detail || fallback, conflict: data as unknown as LeavingConflict };
  if (data.code === 'clearance_incomplete') return { kind: 'clearance', message: detail || fallback, openKinds: Array.isArray(data.open_items) ? (data.open_items as string[]) : [] };
  return { kind: 'plain', message: detail || (typeof data.error === 'string' ? data.error : '') || fallback };
}

// "3 attendance records, 2 exam marks": what a leaving date would strand.
export function conflictSummary(c: LeavingConflict): string {
  const a = c.attendance?.count ?? 0;
  const m = c.marks?.count ?? 0;
  return [a > 0 ? `${a} attendance record${a === 1 ? '' : 's'}` : '', m > 0 ? `${m} exam mark${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
}

// ── Re-admission ──────────────────────────────────────────────────────────────

export interface ReadmitForm { returnDate: string; sessionClass: number | null; roll: string; reason: string }

export const emptyReadmitForm = (today: string): ReadmitForm => ({ returnDate: today, sessionClass: null, roll: '', reason: '' });

// The server decides about same-day returns, a taken roll and a missing class; the phone checks only the date.
export function validateReadmit(f: ReadmitForm, leftOn?: string | null): string | null {
  if (!ISO_DAY.test(f.returnDate)) return 'Choose the return date.';
  if (leftOn && f.returnDate <= leftOn) return `The return date must be after the day they left (${leftOn}).`;
  return null;
}

export const buildReadmitPayload = (studentId: number, f: ReadmitForm) => ({
  student: studentId,
  return_date: f.returnDate,
  session_class: f.sessionClass,
  roll_number: f.roll.trim(),
  reason: f.reason.trim(),
});

export const readmitConfirmText = (name: string, f: Pick<ReadmitForm, 'returnDate'>) =>
  `${name} will be re-admitted from ${f.returnDate}. Their earlier records stay and the time away stays empty.`;

export const awaySinceText = (name: string, since: string | null | undefined) => `${name}${since ? ` has been away since ${since}` : ' is away'}.`;
