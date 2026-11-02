import {
  commentErrorMessage, commentProblem, commentRows, isJobActive, jobPercent, jobProgressLabel, jobSummary, justFinished, sourceBadge,
} from '../services/examComments';

describe('job state', () => {
  it('is active while pending or in progress only', () => {
    expect(isJobActive('PENDING')).toBe(true);
    expect(isJobActive('IN_PROGRESS')).toBe(true);
    expect(isJobActive('SUCCESS')).toBe(false);
    expect(isJobActive('NONE')).toBe(false);
    expect(isJobActive(undefined)).toBe(false);
  });

  it('gives a percent only once the total is known, within 0..100', () => {
    expect(jobPercent({ status: 'IN_PROGRESS', current: 0, total: 0 })).toBeNull();
    expect(jobPercent({ status: 'IN_PROGRESS', current: 3, total: 12 })).toBe(25);
    expect(jobPercent({ status: 'IN_PROGRESS', current: 20, total: 12 })).toBe(100);
    expect(jobPercent(undefined)).toBeNull();
  });

  it('words the progress', () => {
    expect(jobProgressLabel({ status: 'PENDING' })).toBe('Starting...');
    expect(jobProgressLabel({ status: 'IN_PROGRESS', current: 3, total: 12 })).toBe('Writing comments: 3 of 12 students');
    expect(jobProgressLabel({ status: 'IN_PROGRESS', current: 3, total: 12, cancel_requested: true })).toMatch(/Stopping/);
  });

  it('notices a run that has just ended, and only that run', () => {
    const done = { status: 'SUCCESS', task_id: 'a' };
    expect(justFinished({ id: 'a', active: true }, done)).toBe(true);
    expect(justFinished({ id: 'a', active: false }, done)).toBe(false);
    expect(justFinished({ id: 'b', active: true }, done)).toBe(false);
    expect(justFinished({ id: 'a', active: true }, { status: 'IN_PROGRESS', task_id: 'a' })).toBe(false);
  });
});

describe('jobSummary', () => {
  it('reports what was written, templated and kept', () => {
    const text = jobSummary({ status: 'SUCCESS', result: { generated: 20, overall_generated: 5, fallback_used: 2, skipped: 4, incomplete: 1 } });
    expect(text).toContain('Wrote 20 subject comments and 5 overall comments');
    expect(text).toContain('2 of them used the standard template');
    expect(text).toContain('4 subject comments already existed');
    expect(text).toContain('1 students skipped');
  });

  it('says so when nothing new was needed, and when stopped', () => {
    expect(jobSummary({ status: 'SUCCESS', result: { skipped: 9 } })).toMatch(/Nothing new to write: all 9/);
    expect(jobSummary({ status: 'SUCCESS', result: { generated: 3, cancelled: true } })).toMatch(/^Stopped\. Saved 3/);
  });

  it('shows the failure reason', () => {
    expect(jobSummary({ status: 'FAILED', error: 'No AI key.' })).toBe('No AI key.');
    expect(jobSummary({ status: 'FAILED' })).toBe('Comment generation failed.');
  });
});

describe('sourceBadge', () => {
  it('labels each source and flags untracked old text', () => {
    expect(sourceBadge('AI', true)).toEqual({ label: 'AI', tone: 'info' });
    expect(sourceBadge('FALLBACK', true)?.label).toBe('Template');
    expect(sourceBadge('EDITED', true)?.label).toBe('Edited');
    expect(sourceBadge(null, true)?.label).toBe('Older');
    expect(sourceBadge(null, false)).toBeNull();
  });
});

describe('commentRows', () => {
  it('lists overall first, then subjects with marks only', () => {
    const rows = commentRows({
      overall_comment: 'Good term.', overall_comment_source: 'AI',
      marks: [
        { subject_id: 1, subject_name: 'Math', marks_obtained: 40, ai_comment: 'Strong.', comment_source: 'EDITED' },
        { subject_id: 2, subject_name: 'Art', marks_obtained: null },
        { subject_id: 3, subject_name: 'Urdu', marks_obtained: 0, is_absent: true },
        { subject_name: 'No id', marks_obtained: 5 },
      ],
    });
    expect(rows.map((r) => [r.label, r.subjectId, r.text, r.source])).toEqual([
      ['Overall', null, 'Good term.', 'AI'],
      ['Math', 1, 'Strong.', 'EDITED'],
    ]);
  });
});

describe('commentProblem and commentErrorMessage', () => {
  it('limits the length to 800', () => {
    expect(commentProblem('x'.repeat(800))).toBeNull();
    expect(commentProblem('x'.repeat(801))).toMatch(/800/);
  });

  it('shows the server reason, or a 403 default', () => {
    expect(commentErrorMessage({ response: { status: 403, data: { detail: 'Only admins or the class teacher can generate comments for this exam.' } } }, 'x'))
      .toMatch(/class teacher/);
    expect(commentErrorMessage({ response: { status: 403, data: {} } }, 'x')).toMatch(/your own class and subject/);
    expect(commentErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
