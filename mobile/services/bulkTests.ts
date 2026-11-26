// "Create tests": one standalone test per chosen subject of one class (port of the web BulkTestModal).
// Details -> schedule -> server preview -> create. The server re-checks everything on apply and
// refuses when the preview has conflicts, so the phone only creates when the preview says it can.

export interface ClassSubjectLite { subject: number; subject_name: string; subject_code?: string | null }

// Class-subject rows repeat a subject (one per section or teacher): one entry per subject, A to Z.
export function uniqueSubjects(rows: ClassSubjectLite[]): ClassSubjectLite[] {
  const seen = new Map<number, ClassSubjectLite>();
  rows.forEach((r) => { if (!seen.has(r.subject)) seen.set(r.subject, r); });
  return [...seen.values()].sort((a, b) => a.subject_name.localeCompare(b.subject_name));
}

const shortYear = (name?: string | null) => (name || '').replace(/^academic\s+year\s*/i, '').trim();

// Same rule as the web and the server: "Test - <subject>", the term if not already in it, the short year.
export function buildTestName(subjectName: string, termName?: string | null, yearName?: string | null): string {
  let name = `Test - ${subjectName}`;
  if (termName && !name.toLowerCase().includes(termName.toLowerCase())) name += ` - ${termName}`;
  const y = shortYear(yearName);
  if (y) name += ` ${y}`;
  return name;
}

export interface TestRow {
  subjectId: number; subjectName: string; name: string; manualName: boolean;
  date: string; totalMarks: string; start: string; end: string;
}

// Rebuild the schedule rows for the chosen subjects, keeping what was already typed for a subject.
export function syncRows(previous: TestRow[], subjectIds: number[], subjects: ClassSubjectLite[], termName?: string | null, yearName?: string | null): TestRow[] {
  const prev = new Map(previous.map((r) => [r.subjectId, r]));
  return subjectIds.map((id) => {
    const s = subjects.find((x) => x.subject === id);
    const old = prev.get(id);
    const subjectName = s?.subject_name || old?.subjectName || 'Subject';
    return {
      subjectId: id, subjectName,
      name: old?.manualName ? old.name : buildTestName(subjectName, termName, yearName),
      manualName: old?.manualName ?? false,
      date: old?.date ?? '', totalMarks: old?.totalMarks ?? '100', start: old?.start ?? '', end: old?.end ?? '',
    };
  });
}

export interface Details { yearId: number | null; termId: number | null; examTypeId: number | null; classObj: number | null; subjectIds: number[] }

export function validateDetails(d: Details): string | null {
  if (!d.yearId) return 'Choose the academic year.';
  if (!d.examTypeId) return 'Choose the test type.';
  if (!d.classObj) return 'Choose the class.';
  if (d.subjectIds.length === 0) return 'Choose at least one subject.';
  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule(rows: TestRow[]): string | null {
  for (const r of rows) {
    if (!r.date) return `${r.subjectName}: choose the date.`;
    const marks = Number(r.totalMarks);
    if (!r.totalMarks.trim() || !Number.isFinite(marks) || marks <= 0) return `${r.subjectName}: total marks must be more than 0.`;
    if (r.start && !TIME.test(r.start)) return `${r.subjectName}: start time as HH:MM (24-hour).`;
    if (r.end && !TIME.test(r.end)) return `${r.subjectName}: end time as HH:MM (24-hour).`;
    if (r.start && r.end && r.start > r.end) return `${r.subjectName}: end time must be on or after the start time.`;
  }
  return null;
}

export function bulkTestPayload(d: Details, rows: TestRow[]) {
  return {
    academic_year: d.yearId, term: d.termId, exam_type: d.examTypeId, class_obj: d.classObj,
    tests: rows.map((r) => ({
      subject_id: r.subjectId, name: r.name.trim(), exam_date: r.date, total_marks: Number(r.totalMarks),
      start_time: r.start || null, end_time: r.end || null,
    })),
  };
}

export interface PreviewRow { subject_id: number; subject_name?: string; subject_code?: string; name: string; exam_date: string; total_marks?: number | string; status: 'create' | 'conflict' | 'forbidden' | 'invalid'; reason?: string }
export interface Preview { can_apply: boolean; counts: { requested: number; create: number; conflict: number; forbidden: number; invalid: number }; tests: PreviewRow[] }

export const previewTone = (s: PreviewRow['status']): 'success' | 'warning' | 'error' => (s === 'create' ? 'success' : s === 'conflict' ? 'warning' : 'error');
export const previewLabel = (s: PreviewRow['status']) => ({ create: 'Will be created', conflict: 'Already exists', forbidden: 'Not allowed', invalid: 'Invalid' }[s]);

export function previewSummary(p: Preview): string {
  const blocked = p.counts.forbidden + p.counts.invalid;
  return `${p.counts.create} to create  ·  ${p.counts.conflict} already exist${blocked ? `  ·  ${blocked} cannot be made` : ''}`;
}

// The server answers field errors per name (academic_year, tests, ...) or a detail.
export function bulkTestError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (!(e as { response?: unknown })?.response) return 'No connection. Connect to the internet and try again.';
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === 'string') return obj.detail;
    for (const v of Object.values(obj)) {
      const first = Array.isArray(v) ? v[0] : v;
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object') {
        const inner = Object.values(first as Record<string, unknown>)[0];
        const msg = Array.isArray(inner) ? inner[0] : inner;
        if (typeof msg === 'string') return msg;
      }
    }
  }
  return 'Could not create the tests. Try again.';
}
