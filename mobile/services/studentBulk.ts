import { safeName, type BulkResult } from './bulkReportCards';
import { PASSWORD_MIN_LENGTH } from './studentAccount';

// Pure logic for acting on several students at once (admin and principal): ticking them in the
// list, creating logins with one shared starting password, and one ZIP of student reports. Port of
// SelectionBar.jsx and BulkConvertModal.jsx; the server stays the authority.

export interface PickableStudent { id: number; has_user_account?: boolean }

// A student already known to have a login is left out of "Create logins" (the server would skip them).
// A list that does not say is treated as eligible, and the server decides.
export const accountableIds = (rows: PickableStudent[], selected: number[]): number[] =>
  rows.filter((r) => selected.includes(r.id) && r.has_user_account !== true).map((r) => r.id);

export function bulkPasswordProblem(password: string): string | null {
  if (!password) return 'A starting password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  return null;
}

export function buildBulkAccountsPayload(ids: number[], password: string) {
  return { student_ids: ids, default_password: password };
}

const logins = (n: number) => `${n} login${n === 1 ? '' : 's'}`;

export const bulkAccountsConfirmText = (count: number, skipped: number) =>
  `${logins(count)} will be created, each with the same starting password. Usernames are made from the students' names.${skipped > 0 ? ` ${skipped} already have one and are left out.` : ''}`;

export interface BulkAccountsResult {
  created_count?: number;
  skipped_count?: number;
  error_count?: number;
  created?: Array<{ student_id?: number; student_name: string; username: string }>;
  skipped?: Array<{ name: string; reason?: string }>;
  errors?: Array<{ name: string; error: string }>;
}

// "Created 5 logins. 2 already had one. 1 failed."
export function bulkAccountsResultText(r: BulkAccountsResult | null | undefined): string {
  const created = r?.created_count ?? 0;
  const skipped = r?.skipped_count ?? 0;
  const failed = r?.error_count ?? 0;
  return [
    `Created ${logins(created)}.`,
    skipped > 0 ? `${skipped} already had one.` : '',
    failed > 0 ? `${failed} failed.` : '',
  ].filter(Boolean).join(' ');
}

export function accountsErrorText(e: unknown): string {
  const d = (e as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
  return d?.error || d?.detail || 'Could not create the logins.';
}

// ── Reports as one ZIP ────────────────────────────────────────────────────────

export const studentReportsZipName = (label: string) => `Student_Reports_${safeName(label, 'Students')}.zip`;
export const studentReportsProgress = (done: number, total: number) => `Making student reports: ${done} of ${total}`;

export function studentReportsResultText(r: BulkResult): string {
  if (r.cancelled) return 'Cancelled. Nothing was shared.';
  if (r.generated === 0) return 'No student reports could be made.';
  const base = `Made ${r.generated} student report${r.generated === 1 ? '' : 's'}`;
  return r.skipped.length ? `${base}, ${r.skipped.length} skipped.` : `${base}.`;
}
