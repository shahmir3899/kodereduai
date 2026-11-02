// Pure logic for the student profile's heavier admin actions: removing a student (soft delete),
// bringing one back, moving one to another section, and the documents list. The server decides
// what is allowed and returns a preview for the risky ones, so nothing here gates access.

// ── Remove (soft delete) ────────────────────────────────────────────────────

// The name is typed back because a student was once removed from the wrong row; a tap-through
// confirm does not catch that.
export const namesMatch = (typed: string, name: string) => typed.trim().toLowerCase() === (name || '').trim().toLowerCase();

export function validateRemove(typed: string, name: string, reason: string): string | null {
  if (!namesMatch(typed, name)) return `Type "${name}" exactly to confirm.`;
  if (!reason.trim()) return 'A reason is required.';
  return null;
}

export interface RecordCounts { attendance?: number; fees?: number; marks?: number; enrollments?: number; other?: number }

// What stays with the student while they are hidden, from the server's removal preview.
export function keptRecordsLine(counts: RecordCounts | undefined): string {
  const parts = [
    counts?.attendance ? `${counts.attendance} attendance` : null,
    counts?.fees ? `${counts.fees} fee` : null,
    counts?.marks ? `${counts.marks} marks` : null,
    counts?.enrollments ? `${counts.enrollments} enrollment` : null,
    counts?.other ? `${counts.other} other` : null,
  ].filter(Boolean);
  return parts.length ? `Kept with the student: ${parts.join(', ')} records.` : 'The student has no other records.';
}

// ── Recently deleted and restore ────────────────────────────────────────────

export interface DeletedStudent {
  id: number; name: string; roll_number?: string | null; class_name?: string | null; parent_name?: string | null;
  deleted_at?: string | null; deleted_by?: string | null; deleted_reason?: string | null;
}

export const deletedLine = (s: DeletedStudent) =>
  [s.roll_number ? `Roll ${s.roll_number}` : null, s.class_name].filter(Boolean).join('  ·  ');

export const deletedMeta = (s: DeletedStudent) =>
  [s.deleted_at ? `Removed ${s.deleted_at.slice(0, 10)}` : null, s.deleted_by ? `by ${s.deleted_by}` : null].filter(Boolean).join(' ');

// The server answers 409 roll_conflict when the roll number was given to someone else meanwhile.
export function isRollConflict(error: unknown): boolean {
  const r = (error as { response?: { status?: number; data?: { code?: string } } })?.response;
  return r?.status === 409 && r?.data?.code === 'roll_conflict';
}

export const buildRestorePayload = (roll: string) => (roll.trim() ? { roll_number: roll.trim() } : {});

// ── Change class (reclassify) ───────────────────────────────────────────────

export interface MoveForm { sectionId: number | null; effectiveDate: string; roll: string; reason: string; feeOption: 'keep' | 'reprice' }
export const emptyMoveForm = (today: string): MoveForm => ({ sectionId: null, effectiveDate: today, roll: '', reason: '', feeOption: 'keep' });

export interface MovePreview {
  effective_date?: string;
  suggested_roll?: string | number | null;
  warnings?: { attendance_since?: number; fee_rows_since?: number; marks_in_year?: number };
  fees?: {
    applies?: boolean; can_reprice?: boolean; blockers?: string[]; annual_note?: string;
    categories?: Array<{ name: string; old_fee: string | null; new_fee: string | null }>;
  };
}

export function movePreviewParams(yearId: number, f: MoveForm) {
  return { academic_year_id: yearId, target_session_class_id: f.sectionId, effective_date: f.effectiveDate };
}

export function validateMove(f: MoveForm, currentSectionId: number | null): string | null {
  if (f.sectionId == null) return 'Choose the new section.';
  if (f.sectionId === currentSectionId && !f.roll.trim()) return 'The student is already in this section. Choose another.';
  if (!f.effectiveDate) return 'Choose the first day in the new class.';
  if (!f.reason.trim()) return 'A reason is required.';
  return null;
}

export function buildMovePayload(yearId: number, f: MoveForm, feesApply: boolean) {
  return {
    academic_year_id: yearId,
    target_session_class_id: f.sectionId,
    effective_date: f.effectiveDate,
    reason: f.reason.trim(),
    ...(f.roll.trim() ? { new_roll_number: f.roll.trim() } : {}),
    ...(feesApply ? { fee_option: f.feeOption } : {}),
  };
}

// Records dated on or after the move date stay with the old class; the dialog says how many.
export function moveWarningLines(p: MovePreview | null | undefined): string[] {
  const w = p?.warnings ?? {};
  const out: string[] = [];
  if (w.attendance_since) out.push(`${w.attendance_since} attendance record(s) dated on or after this day stay with the old class.`);
  if (w.fee_rows_since) out.push(`${w.fee_rows_since} monthly fee row(s) from that month on are affected.`);
  if (w.marks_in_year) out.push(`${w.marks_in_year} exam mark(s) this year stay with the old class.`);
  return out;
}

export function feeImpactLines(p: MovePreview | null | undefined): string[] {
  const fees = p?.fees;
  if (!fees?.applies) return [];
  const lines = (fees.categories ?? [])
    .filter((c) => c.old_fee !== c.new_fee)
    .map((c) => `${c.name}: PKR ${c.old_fee ?? '—'} to PKR ${c.new_fee ?? '—'} a month`);
  if (fees.annual_note) lines.push(fees.annual_note);
  return lines;
}

// Re-pricing needs a different master class, no payments and no closed months; otherwise keep.
export const canRepriceFees = (p: MovePreview | null | undefined) => !!p?.fees?.applies && !!p.fees.can_reprice;
export const feeBlockers = (p: MovePreview | null | undefined) => p?.fees?.blockers ?? [];

// ── Documents ───────────────────────────────────────────────────────────────

export interface StudentDocumentRow {
  id: number; title: string; document_type: string; file_url?: string | null; created_at?: string; read_only?: boolean; branch?: string | null;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  PHOTO: 'Photo', BIRTH_CERT: 'Birth certificate', PREV_REPORT: 'Previous report', TC: 'Transfer certificate', MEDICAL: 'Medical record', OTHER: 'Other',
};

export const docLine = (d: StudentDocumentRow) =>
  [DOC_TYPE_LABELS[d.document_type] ?? d.document_type, d.created_at ? d.created_at.slice(0, 10) : null].filter(Boolean).join('  ·  ');

// The web app has stored placeholder paths such as "uploads/name.pdf" instead of real links, so a
// document is viewable only when it has a real web address.
export const viewableUrl = (d: Pick<StudentDocumentRow, 'file_url'>): string | null =>
  d.file_url && /^https?:\/\//i.test(d.file_url) ? d.file_url : null;

// Earlier branches' documents are shown but belong to the other branch's record.
export const canDeleteDocument = (d: Pick<StudentDocumentRow, 'read_only'>) => !d.read_only;
