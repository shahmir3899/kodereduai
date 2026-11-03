// Re-numbering a section's students 1..n: port of RenumberSectionModal.jsx and the rules in
// backend/academic_sessions/renumber_service.py. Never automatic: roll numbers are on registers,
// report cards and fee slips, so the phone shows a preview and applies only on a confirmed tap.

export type RenumberOrder = 'alphabetical' | 'roll' | 'admission' | 'manual';

export const RENUMBER_ORDERS: Array<{ value: RenumberOrder; label: string }> = [
  { value: 'alphabetical', label: 'Alphabetical (A to Z)' },
  { value: 'roll', label: 'Current roll order (closes gaps)' },
  { value: 'admission', label: 'Admission date (oldest first)' },
  { value: 'manual', label: 'Manual: I will set the order' },
];

export interface RenumberRow { enrollment_id: number; student_id: number; name: string; old_roll: string | null; new_roll: string }

export interface RenumberPreview {
  section?: string;
  changes: RenumberRow[];
  unchanged?: number;
  attendance_records?: number;
}

// Manual order starts from the current roll order, which the server previews for us.
export const previewOrderFor = (order: RenumberOrder): Exclude<RenumberOrder, 'manual'> => (order === 'manual' ? 'roll' : order);

export const studentIdsOf = (rows: RenumberRow[]): number[] => rows.map((r) => r.student_id);

// Move one student up (-1) or down (+1); out of range changes nothing.
export function moveId(ids: number[], index: number, delta: -1 | 1): number[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// In manual mode the numbers follow the list: first is 1, second is 2, and so on.
export function manualRows(base: RenumberRow[], ids: number[]): RenumberRow[] {
  const byStudent = new Map(base.map((r) => [r.student_id, r]));
  return ids.filter((id) => byStudent.has(id)).map((id, i) => ({ ...(byStudent.get(id) as RenumberRow), new_roll: String(i + 1) }));
}

// Only the rows whose number would actually change.
export const changedRows = (rows: RenumberRow[]): RenumberRow[] => rows.filter((r) => (r.old_roll ?? '') !== r.new_roll);

export function applyPayload(order: RenumberOrder, manualIds: number[] | null) {
  return { action: 'apply', order, ...(order === 'manual' ? { student_ids: manualIds ?? [] } : {}) };
}

export const previewPayload = (order: RenumberOrder) => ({ action: 'preview', order: previewOrderFor(order) });

const students = (n: number) => `${n} student${n === 1 ? '' : 's'}`;

export const renumberConfirmText = (section: string, count: number) =>
  `${students(count)} in ${section} will get a new roll number. Students who have left keep their old number. This changes the numbers printed on registers, report cards and fee slips.`;

export const renumberResultText = (data: { changed?: number } | null | undefined) => `Re-numbered ${students(data?.changed ?? 0)}.`;

export const attendanceNote = (records: number | undefined) =>
  records && records > 0
    ? `This year already has ${records} attendance record${records === 1 ? '' : 's'} for these students. They stay with the student; only the number printed beside the name changes.`
    : '';

export function renumberErrorText(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: string } } })?.response?.data;
  return d?.detail || 'Could not re-number the section.';
}
