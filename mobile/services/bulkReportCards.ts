import { zipSync } from 'fflate';
import { exportErrorMessage, looksLikePdf } from './reports';

// Pure logic for "download all report cards of a class as one ZIP", as the web does (Students,
// Download Reports). The server makes one PDF per student; the phone asks for them a few at a time,
// packs them into a ZIP and shares that single file (the share sheet takes one file at a time).

// A class this big asks first: every PDF is held in memory until the ZIP is built.
export const BULK_CONFIRM_ABOVE = 60;
export const BULK_CONCURRENCY = 3;

export interface BulkStudent {
  studentId: number;
  enrollmentId: number | null;
  name: string;
  roll?: string | number | null;
}

export const needsConfirm = (count: number) => count > BULK_CONFIRM_ABOVE;

// File-system safe: letters, digits, dot, dash and underscore.
export function safeName(text: unknown, fallback: string): string {
  return String(text ?? '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

// "<roll>_<name>.pdf", as the web names them. A repeat gets a number so no file overwrites another.
export function bulkFileNames(students: BulkStudent[]): string[] {
  const used = new Map<string, number>();
  return students.map((s, i) => {
    const base = `${safeName(s.roll, String(i + 1))}_${safeName(s.name, 'Student')}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${n > 1 ? `${base}_${n}` : base}.pdf`;
  });
}

export const zipFileName = (className: string) => `Report_Cards_${safeName(className, 'Class')}.zip`;

export interface BulkResult {
  generated: number;
  skipped: Array<{ name: string; reason: string }>;
  cancelled: boolean;
}

// Runs the work over the list with at most `limit` in flight, starting nothing new after a stop.
async function runLimited<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>, stopped: () => boolean) {
  let next = 0;
  const lane = async () => {
    while (next < items.length && !stopped()) {
      const i = next++;
      await work(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

export interface BuildArgs {
  students: BulkStudent[];
  fetchPdf: (student: BulkStudent) => Promise<{ data: ArrayBuffer }>;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
  concurrency?: number;
}

// The ZIP bytes (null when nothing was made or the run was cancelled) and what happened to each student.
export async function buildBulkZip(args: BuildArgs): Promise<{ zip: Uint8Array | null; result: BulkResult }> {
  const { students, fetchPdf, onProgress, shouldCancel = () => false, concurrency = BULK_CONCURRENCY } = args;
  const names = bulkFileNames(students);
  const files: Record<string, Uint8Array> = {};
  const skipped: BulkResult['skipped'] = [];
  let done = 0;

  await runLimited(students, concurrency, async (student, i) => {
    try {
      const { data } = await fetchPdf(student);
      if (!looksLikePdf(data)) throw new Error('The report card could not be made.');
      files[names[i]] = new Uint8Array(data);
    } catch (e) {
      const own = (e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error)?.message;
      skipped.push({ name: student.name, reason: own || 'Could not make this report card' });
    }
    done += 1;
    onProgress?.(done, students.length);
  }, shouldCancel);

  const cancelled = shouldCancel();
  const generated = Object.keys(files).length;
  // PDFs are already compressed, so the ZIP stores them as they are.
  const zip = !cancelled && generated > 0 ? zipSync(files, { level: 0 }) : null;
  return { zip, result: { generated, skipped, cancelled } };
}

export function progressText(done: number, total: number): string {
  return `Making report cards: ${done} of ${total}`;
}

export function resultText(r: BulkResult): string {
  if (r.cancelled) return 'Cancelled. Nothing was shared.';
  if (r.generated === 0) return 'No report cards could be made.';
  const base = `Made ${r.generated} report card${r.generated === 1 ? '' : 's'}`;
  return r.skipped.length ? `${base}, ${r.skipped.length} skipped.` : `${base}.`;
}
