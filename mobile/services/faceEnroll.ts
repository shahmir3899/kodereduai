// Face enrolment from a photo taken with the phone: what the server answers, how to read the background
// task that does the work, the duplicate-person override, and the per-class coverage list. Port of the
// rules in backend/face_attendance (views.py enroll and coverage, tasks.py, matcher.py DuplicateFaceError).
// The server stays the authority on quality, duplicates and the sample cap.

export type CoverageState = 'not_enrolled' | 'needs_more' | 'refresh_due' | 'ok';

export interface CoverageStudent {
  student_id: number; name: string; roll_number?: string | number | null; class_id?: number | null; class_name?: string | null;
  samples: number; last_enrolled_at?: string | null; status: CoverageState;
}
export interface Coverage {
  recommended_samples: number;
  summary: { total: number } & Record<CoverageState, number>;
  students: CoverageStudent[];
}

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  not_enrolled: 'Not enrolled', needs_more: 'Needs more photos', refresh_due: 'Refresh due', ok: 'Enrolled',
};
export const COVERAGE_TONE: Record<CoverageState, 'error' | 'warning' | 'info' | 'success'> = {
  not_enrolled: 'error', needs_more: 'warning', refresh_due: 'info', ok: 'success',
};
export const COVERAGE_FILTERS: Array<{ value: '' | CoverageState; label: string }> = [
  { value: '', label: 'All' }, { value: 'not_enrolled', label: 'Not enrolled' }, { value: 'needs_more', label: 'Needs more' }, { value: 'refresh_due', label: 'Refresh' }, { value: 'ok', label: 'Enrolled' },
];

export const filterCoverage = (rows: CoverageStudent[], filter: '' | CoverageState) => (filter ? rows.filter((r) => r.status === filter) : rows);

export function coverageSummaryLine(c: Pick<Coverage, 'summary'> | undefined): string {
  const s = c?.summary;
  if (!s) return '';
  return `${s.ok} of ${s.total} fully enrolled  ·  ${s.not_enrolled} not enrolled  ·  ${s.needs_more} need more photos${s.refresh_due ? `  ·  ${s.refresh_due} due a refresh` : ''}`;
}

export const coverageLine = (s: CoverageStudent, recommended: number) =>
  [s.roll_number ? `Roll ${s.roll_number}` : '', s.samples > 0 ? `${s.samples} of ${recommended} photos` : 'No photo yet'].filter(Boolean).join('  ·  ');

// How many more photos would reach the recommended number.
export const photosToAdd = (samples: number, recommended: number) => Math.max(0, recommended - samples);

// ── The request and the background task ───────────────────────────────────────────────────────

export const buildEnrollPayload = (studentId: number, imageUrl: string, overrideDuplicate = false) => ({
  student_id: studentId, image_url: imageUrl, ...(overrideDuplicate ? { override_duplicate: true } : {}),
});

export interface EnrollTask { status: string; error_message?: string | null; result_data?: Record<string, unknown> | null }

export type EnrollOutcome =
  | { state: 'running' }
  | { state: 'done'; message: string }
  | { state: 'duplicate'; message: string }
  | { state: 'failed'; message: string };

// The photo is processed in the background: PENDING/STARTED/PROGRESS while it works, SUCCESS or FAILED after.
export function enrollOutcome(t: EnrollTask | undefined | null): EnrollOutcome {
  if (!t) return { state: 'running' };
  const status = String(t.status).toUpperCase();
  if (status === 'SUCCESS') return { state: 'done', message: 'Face enrolled.' };
  if (status === 'FAILED' || status === 'FAILURE' || status === 'CANCELLED') {
    const message = (t.error_message ?? '').trim() || 'The photo could not be used. Try a clearer, front-facing photo.';
    return isDuplicateMessage(message) ? { state: 'duplicate', message } : { state: 'failed', message };
  }
  return { state: 'running' };
}

// The server's own words for "this face is already enrolled for someone else".
export const isDuplicateMessage = (message: string) => /duplicate face detected/i.test(message);

// "Duplicate face detected — this looks like Sara Khan (already enrolled, 92% confidence)." -> the name part.
export function duplicateOf(message: string): string | null {
  const m = /looks like (.+?) \(already enrolled/i.exec(message);
  return m ? m[1] : null;
}

export const overrideText = (name: string, other: string | null) =>
  `${other ? `This face looks like ${other}, who is already enrolled.` : 'This face looks like another enrolled student.'} Only continue if ${name} and ${other ?? 'that student'} are different people (for example twins or siblings).`;

export const POLL_MS = 2000;
export const POLL_LIMIT = 45; // about 90 seconds

export const enrollTimeoutText = 'The photo is still being processed. Check the list in a minute and add it again if it is missing.';

export const enrollErrorText = (e: unknown, fallback = 'Enrolment failed.'): string => {
  const data = (e as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
  if (data?.error || data?.detail) return String(data.error ?? data.detail);
  return (e as { response?: unknown })?.response ? fallback : 'No connection. Check your internet and try again.';
};

// ── The photo itself ──────────────────────────────────────────────────────────────────────────

// A portrait photo for enrolment: square, front-facing, one face.
export const PORTRAIT_TIPS = [
  'One face only, looking at the camera.',
  'Good light on the face, no strong shadow.',
  'No hat, mask or sunglasses.',
  'Take a second and third photo from a slightly different angle.',
];

// What to do before taking a class group photo.
export const GROUP_TIPS = [
  'Hold the phone sideways so everyone fits.',
  'Every face should be visible and facing the camera.',
  'Stand a few steps back, in good light.',
];

export const photoMime = (uri: string): string => (/\.png$/i.test(uri) ? 'image/png' : 'image/jpeg');
export const photoName = (uri: string, fallback: string): string => uri.split('/').pop()?.split('?')[0] || fallback;
