import { tasksApi } from '../services/api';
import { useScopedQuery } from './useScopedQuery';
import { isActiveJob, jobsOf, sortJobs, type BackgroundJob } from '../services/backgroundJobs';

// The person's jobs from the last day. Checks every 3 seconds only while one is still running (as
// the web drawer does); otherwise it refreshes when a screen mounts, at most every 30 seconds, so the
// header chip costs no steady polling.
export function useMyJobs(enabled = true) {
  return useScopedQuery<BackgroundJob[]>('myJobs', [], async () => sortJobs(jobsOf((await tasksApi.getMyTasks()).data)), {
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: (q) => ((q.state.data as BackgroundJob[] | undefined)?.some(isActiveJob) ? 3000 : false),
  });
}
