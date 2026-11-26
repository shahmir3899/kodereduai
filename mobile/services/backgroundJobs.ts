// The signed-in person's background jobs (web TaskDrawer): GET /api/tasks/tasks/ lists the last 24
// hours; a pending or running one can be cancelled. Progress is tracked by the server in Postgres.
export type JobStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';

export interface BackgroundJob {
  id: number;
  celery_task_id: string;
  task_type: string;
  title: string;
  status: JobStatus;
  progress_current: number;
  progress_total: number;
  // -1 while running with no known total.
  progress_percent: number;
  error_message?: string;
  created_at: string;
  completed_at?: string | null;
}

export const JOB_STATUS: Record<JobStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'error' }> = {
  PENDING: { label: 'Waiting', tone: 'neutral' },
  IN_PROGRESS: { label: 'Running', tone: 'info' },
  SUCCESS: { label: 'Done', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'error' },
};

export const isActiveJob = (j: { status: string }) => j.status === 'PENDING' || j.status === 'IN_PROGRESS';

export function jobsOf(data: unknown): BackgroundJob[] {
  if (Array.isArray(data)) return data as BackgroundJob[];
  const results = (data as { results?: unknown })?.results;
  return Array.isArray(results) ? (results as BackgroundJob[]) : [];
}

// Running first, then the newest.
export function sortJobs(jobs: BackgroundJob[]): BackgroundJob[] {
  return [...jobs].sort((a, b) => Number(isActiveJob(b)) - Number(isActiveJob(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

export function progressText(j: BackgroundJob): string | null {
  if (!isActiveJob(j)) return null;
  if (j.progress_total > 0) return `${j.progress_current} of ${j.progress_total} (${j.progress_percent}%)`;
  return j.status === 'PENDING' ? 'Waiting to start' : 'Working...';
}

// 0-100 for a bar, or null when there is no total to measure against.
export function progressFraction(j: BackgroundJob): number | null {
  if (!isActiveJob(j) || j.progress_total <= 0) return null;
  return Math.max(0, Math.min(100, j.progress_percent));
}

export function jobsChipLabel(active: number): string {
  return active === 1 ? '1 job' : `${active} jobs`;
}
