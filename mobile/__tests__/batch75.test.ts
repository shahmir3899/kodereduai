import {
  batchesOf, bulkRemoveError, namesPreview, removeInBatches, skippedLines, validateBulkRemove,
} from '../services/studentBulkRemove';
import { isActiveJob, jobsChipLabel, jobsOf, progressFraction, progressText, sortJobs, type BackgroundJob } from '../services/backgroundJobs';
import { missingSteps, nextStepLink, progressTone, type SetupModule } from '../services/setupProgress';
import { pickSummary } from '../services/sessionHealth';

describe('students bulk remove', () => {
  it('asks for the count typed back and a reason', () => {
    expect(validateBulkRemove('3', 4, 'dup')).toBe('Type 4 to confirm.');
    expect(validateBulkRemove(' 4 ', 4, '  ')).toBe('A reason is required.');
    expect(validateBulkRemove('4', 4, 'duplicate entries')).toBeNull();
  });

  it('sends at most 100 ids per call and adds the replies up', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => i + 1);
    expect(batchesOf(ids).map((b) => b.length)).toEqual([100, 100, 5]);
    const send = jest.fn(async (body: { student_ids: number[]; reason: string }) => ({
      data: { deleted: body.student_ids.slice(1), skipped: [{ id: body.student_ids[0], name: 'A', detail: 'transfer' }] },
    }));
    const out = await removeInBatches(ids, ' dup ', send);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0].reason).toBe('dup');
    expect(out.deleted).toHaveLength(202);
    expect(out.skipped).toHaveLength(3);
    expect(out.error).toBeUndefined();
  });

  it('keeps what earlier batches removed when a later one fails, and says so', async () => {
    let n = 0;
    const send = jest.fn(async (body: { student_ids: number[] }) => {
      n += 1;
      if (n === 2) throw { response: { data: { detail: 'Server busy.' } } };
      return { data: { deleted: body.student_ids, skipped: [] } };
    });
    const out = await removeInBatches(Array.from({ length: 150 }, (_, i) => i), 'x', send);
    expect(out.deleted).toHaveLength(100);
    expect(bulkRemoveError(out.error, out.deleted.length)).toBe('Server busy. (100 were already removed.)');
    expect(bulkRemoveError(new Error('net'), 0)).toMatch(/No connection/);
  });

  it('lists up to ten skipped students and names', () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({ id: i, name: i === 0 ? null : `S${i}`, detail: 'history' }));
    const lines = skippedLines(skipped);
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe('Student 0: history');
    expect(lines[10]).toBe('...and 2 more');
    expect(namesPreview(['a', 'b', 'c'], 2)).toBe('a, b and 1 more');
  });
});

const job = (over: Partial<BackgroundJob>): BackgroundJob => ({
  id: 1, celery_task_id: 't', task_type: 'PAYSLIP_GENERATION', title: 'Payslips', status: 'SUCCESS',
  progress_current: 0, progress_total: 0, progress_percent: 0, created_at: '2026-11-25T08:00:00Z', ...over,
});

describe('running jobs', () => {
  it('reads a plain or paged list and puts running jobs first, newest next', () => {
    expect(jobsOf({ results: [job({})] })).toHaveLength(1);
    expect(jobsOf(null)).toEqual([]);
    const sorted = sortJobs([
      job({ celery_task_id: 'old', created_at: '2026-11-25T07:00:00Z' }),
      job({ celery_task_id: 'new', created_at: '2026-11-25T09:00:00Z' }),
      job({ celery_task_id: 'run', status: 'IN_PROGRESS', created_at: '2026-11-25T06:00:00Z' }),
    ]);
    expect(sorted.map((j) => j.celery_task_id)).toEqual(['run', 'new', 'old']);
  });

  it('shows progress only while running', () => {
    expect(progressText(job({ status: 'IN_PROGRESS', progress_current: 3, progress_total: 12, progress_percent: 25 }))).toBe('3 of 12 (25%)');
    expect(progressFraction(job({ status: 'IN_PROGRESS', progress_total: 12, progress_percent: 25 }))).toBe(25);
    expect(progressText(job({ status: 'IN_PROGRESS', progress_percent: -1 }))).toBe('Working...');
    expect(progressFraction(job({ status: 'IN_PROGRESS', progress_percent: -1 }))).toBeNull();
    expect(progressText(job({ status: 'PENDING' }))).toBe('Waiting to start');
    expect(progressText(job({ status: 'FAILED' }))).toBeNull();
    expect(isActiveJob({ status: 'SUCCESS' })).toBe(false);
    expect(jobsChipLabel(1)).toBe('1 job');
    expect(jobsChipLabel(3)).toBe('3 jobs');
  });
});

describe('dashboard extras', () => {
  const mod: SetupModule = {
    key: 'hr', label: 'HR', percentage: 33, steps: [
      { name: 'Departments created', completed: true, count: 2, target: 2, link: '/hr/departments' },
      { name: 'Staff members added', completed: false, count: 1, target: 3, link: '/hr/staff' },
      { name: 'Salary structures defined', completed: false, count: 0, target: 1, link: '/hr/salary' },
    ],
  };

  it('leads a module to its first unfinished step and names what is missing', () => {
    expect(nextStepLink(mod)).toBe('/hr/staff');
    expect(nextStepLink({ ...mod, steps: mod.steps.map((s) => ({ ...s, completed: true })) })).toBe('/hr/departments');
    expect(missingSteps(mod)).toBe('Staff members added (1/3), Salary structures defined');
    expect([progressTone(100), progressTone(50), progressTone(10)]).toEqual(['success', 'info', 'warning']);
  });

  it('prefers the AI summary once it says something', () => {
    const rules = { highlights: ['rule'] };
    expect(pickSummary({ source: 'ai', highlights: ['ai'] }, rules)).toEqual({ source: 'ai', highlights: ['ai'] });
    expect(pickSummary({ source: 'ai', highlights: [] }, rules)).toBe(rules);
    expect(pickSummary(null, null)).toBeNull();
  });
});
