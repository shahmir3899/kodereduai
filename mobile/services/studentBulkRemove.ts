// Removing several students at once (web BulkDeleteStudentsModal): the same soft delete as removing
// one, so they show up in Recently deleted and can be restored. The count is typed back, the
// many-student version of typing a name.

// The server takes at most 100 ids per call (StudentViewSet.BULK_DELETE_MAX).
export const BULK_REMOVE_BATCH = 100;
export const SKIPPED_PREVIEW = 10;

export interface SkippedStudent { id: number; name?: string | null; code?: string; detail?: string }
export interface BulkRemoveResult { deleted: number[]; skipped: SkippedStudent[] }

export function batchesOf<T>(items: T[], size = BULK_REMOVE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function validateBulkRemove(typed: string, count: number, reason: string): string | null {
  if (typed.trim() !== String(count)) return `Type ${count} to confirm.`;
  if (!reason.trim()) return 'A reason is required.';
  return null;
}

// Sends the batches one after another. A later batch failing leaves the earlier ones removed, so
// the error says how many already went instead of implying nothing happened.
export async function removeInBatches(
  ids: number[], reason: string,
  send: (body: { student_ids: number[]; reason: string }) => Promise<{ data?: Partial<BulkRemoveResult> }>,
): Promise<BulkRemoveResult & { error?: unknown }> {
  const deleted: number[] = [];
  const skipped: SkippedStudent[] = [];
  try {
    for (const batch of batchesOf(ids)) {
      const res = await send({ student_ids: batch, reason: reason.trim() });
      deleted.push(...(res.data?.deleted ?? []));
      skipped.push(...(res.data?.skipped ?? []));
    }
  } catch (error) {
    return { deleted, skipped, error };
  }
  return { deleted, skipped };
}

export function bulkRemoveError(error: unknown, alreadyRemoved: number): string {
  const d = (error as { response?: { data?: { detail?: string; error?: string } } })?.response?.data;
  const text = d?.detail || d?.error || ((error as { response?: unknown })?.response ? 'Could not remove the students.' : 'No connection. Check your internet and try again.');
  return alreadyRemoved ? `${text} (${alreadyRemoved} were already removed.)` : text;
}

export function skippedLines(skipped: SkippedStudent[]): string[] {
  const lines = skipped.slice(0, SKIPPED_PREVIEW).map((s) => `${s.name || `Student ${s.id}`}: ${s.detail || 'could not be removed'}`);
  if (skipped.length > SKIPPED_PREVIEW) lines.push(`...and ${skipped.length - SKIPPED_PREVIEW} more`);
  return lines;
}

export function namesPreview(names: string[], max = SKIPPED_PREVIEW): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}
