// Pure logic for the AI report-card comments; port of the comment tools in
// frontend/src/pages/examinations/ResultsPage.jsx. The server runs the generation in the
// background (comment_jobs.py); the phone starts it and follows its progress.

export type CommentSource = 'AI' | 'FALLBACK' | 'EDITED' | null | undefined;
export type JobStatus = 'NONE' | 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | string;

export interface JobResult {
  generated?: number; overall_generated?: number; fallback_used?: number; overall_fallback?: number;
  skipped?: number; incomplete?: number; cancelled?: boolean;
}
export interface CommentJob {
  task_id?: string; status: JobStatus; current?: number; total?: number; elapsed_seconds?: number;
  cancel_requested?: boolean; result?: JobResult | null; error?: string | null;
}

export const MAX_COMMENT_CHARS = 800;

export function isJobActive(status: JobStatus | undefined): boolean {
  return status === 'PENDING' || status === 'IN_PROGRESS';
}

// 0..100, or null while the total is not known yet.
export function jobPercent(job: CommentJob | null | undefined): number | null {
  if (!job || !job.total) return null;
  return Math.max(0, Math.min(100, Math.round(((job.current ?? 0) / job.total) * 100)));
}

export function jobProgressLabel(job: CommentJob | null | undefined): string {
  if (!job) return '';
  if (job.cancel_requested) return 'Stopping after the students already in progress...';
  if (!job.total) return 'Starting...';
  return `Writing comments: ${job.current ?? 0} of ${job.total} students`;
}

// What to tell the user once a run ends.
export function jobSummary(job: CommentJob): string {
  if (job.status === 'FAILED') return job.error || 'Comment generation failed.';
  const d = job.result ?? {};
  const written = (d.generated ?? 0) + (d.overall_generated ?? 0);
  const templated = (d.fallback_used ?? 0) + (d.overall_fallback ?? 0);
  const parts: string[] = [];
  if (written === 0 && (d.skipped ?? 0) > 0 && !d.cancelled) {
    parts.push(`Nothing new to write: all ${d.skipped} subject comments already exist. Use Regenerate all to rewrite them`);
  } else {
    parts.push(`${d.cancelled ? 'Stopped. Saved' : 'Wrote'} ${d.generated ?? 0} subject comments and ${d.overall_generated ?? 0} overall comments`);
    if (templated > 0) parts.push(`${templated} of them used the standard template because the AI reply failed or was rejected`);
    if ((d.skipped ?? 0) > 0) parts.push(`${d.skipped} subject comments already existed and were kept`);
  }
  if ((d.incomplete ?? 0) > 0) parts.push(`${d.incomplete} students skipped: marks incomplete`);
  return `${parts.join('. ')}.`;
}

// True when a run that was active has now ended, so the results are worth refetching once.
export function justFinished(prev: { id?: string; active: boolean }, job: CommentJob | undefined): boolean {
  return !!job && prev.id === job.task_id && prev.active && !isJobActive(job.status);
}

export type SourceTone = 'info' | 'neutral' | 'success' | 'warning';
// A comment with text but no source was written before sources were tracked.
export function sourceBadge(source: CommentSource, hasText: boolean): { label: string; tone: SourceTone } | null {
  if (source === 'AI') return { label: 'AI', tone: 'info' };
  if (source === 'FALLBACK') return { label: 'Template', tone: 'neutral' };
  if (source === 'EDITED') return { label: 'Edited', tone: 'success' };
  return hasText ? { label: 'Older', tone: 'warning' } : null;
}

export interface CommentRowData {
  key: string;
  label: string;
  subjectId: number | null; // null = the student's overall comment
  text: string;
  source: CommentSource;
}

interface StudentComments {
  overall_comment?: string | null;
  overall_comment_source?: CommentSource;
  marks?: Array<{
    subject_id?: number; subject_name: string; marks_obtained: number | null; is_absent?: boolean;
    ai_comment?: string | null; comment_source?: CommentSource;
  }>;
}

// Overall first, then every subject that has marks (the server writes no comment for the rest).
export function commentRows(student: StudentComments): CommentRowData[] {
  const rows: CommentRowData[] = [{
    key: 'overall', label: 'Overall', subjectId: null, text: student.overall_comment ?? '', source: student.overall_comment_source,
  }];
  for (const m of student.marks ?? []) {
    if (m.subject_id == null || m.marks_obtained == null || m.is_absent) continue;
    rows.push({ key: `s${m.subject_id}`, label: m.subject_name, subjectId: m.subject_id, text: m.ai_comment ?? '', source: m.comment_source });
  }
  return rows;
}

export function commentProblem(text: string): string | null {
  return text.trim().length > MAX_COMMENT_CHARS ? `The comment is too long. The limit is ${MAX_COMMENT_CHARS} characters.` : null;
}

// The 403 the server sends says who may do it ("Only admins or the class teacher ..."), so show it.
export function commentErrorMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { status?: number; data?: { detail?: string; error?: string } } };
  const detail = e?.response?.data?.detail ?? e?.response?.data?.error;
  if (typeof detail === 'string' && detail) return detail;
  if (e?.response?.status === 403) return 'You can only change comments for your own class and subject.';
  return fallback;
}
