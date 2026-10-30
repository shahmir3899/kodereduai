import {
  buildDateSheetEntry, canAnnounce, groupProgress, progressText, progressTone, resultsReplyText, scheduleReplyText, shortTime, sortRows,
  subjectsInSheet, toRows, unscheduledCount, validateDateSheetEdit, type DateSheetSubjectDto, type GroupExam,
} from '../services/examGroups';

const exam = (over: Partial<GroupExam> = {}): GroupExam => ({ id: 1, status: 'COMPLETED', schedule_published_at: null, ...over });

describe('publishing progress', () => {
  it('counts classes with a published schedule and announced results', () => {
    const p = groupProgress([exam({ schedule_published_at: 'x' }), exam({ id: 2, status: 'PUBLISHED' }), exam({ id: 3 })]);
    expect(p.schedule).toEqual({ done: 1, total: 3 });
    expect(p.results).toEqual({ done: 1, total: 3 });
  });

  it('words none, partly and all', () => {
    expect(progressText('Schedule', { done: 0, total: 4 }, 'published', 'not published')).toBe('Schedule: not published');
    expect(progressText('Schedule', { done: 3, total: 4 }, 'published', 'not published')).toBe('Schedule: published for 3 of 4 classes');
    expect(progressText('Schedule', { done: 4, total: 4 }, 'published', 'not published')).toBe('Schedule: published');
    expect(progressText('Results', { done: 0, total: 0 }, 'announced', 'not announced')).toBe('Results: no classes');
  });

  it('picks a tone', () => {
    expect(progressTone({ done: 0, total: 2 })).toBe('neutral');
    expect(progressTone({ done: 1, total: 2 })).toBe('warning');
    expect(progressTone({ done: 2, total: 2 })).toBe('success');
  });
});

describe('reply wording', () => {
  it('reports the schedule count', () => {
    expect(scheduleReplyText({ published_count: 5 }, true)).toBe('Published the exam schedule for 5 exam(s).');
    expect(scheduleReplyText({ unpublished_count: 2 }, false)).toBe('Unpublished the exam schedule for 2 exam(s).');
  });

  it('names the classes announcing skipped for missing marks', () => {
    const r = resultsReplyText({ published_count: 2, skipped: [{ class_name: 'Class 3' }, { class_name: 'Class 4' }] }, true);
    expect(r.partial).toBe(true);
    expect(r.text).toContain('Class 3, Class 4');
    expect(resultsReplyText({ published_count: 3, skipped: [] }, true)).toEqual({ text: 'Announced results for 3 class(es).', partial: false });
    expect(resultsReplyText({ unpublished_count: 3 }, false).text).toBe('Withdrew results for 3 exam(s).');
  });

  it('only lets a class with every mark entered be announced', () => {
    expect(canAnnounce(exam({ marks_entry_complete: true }))).toBe(true);
    expect(canAnnounce(exam({ marks_entry_complete: false }))).toBe(false);
    expect(canAnnounce(exam({ status: 'PUBLISHED', marks_entry_complete: true }))).toBe(false);
  });
});

const sheet: DateSheetSubjectDto[] = [
  { subject_id: 1, subject_name: 'Maths', classes: [
    { exam_subject_id: 11, exam_id: 1, class_name: 'Class 2', exam_date: '2026-11-03', start_time: '09:00:00', end_time: '11:00:00' },
    { exam_subject_id: 12, exam_id: 2, class_name: 'Class 1', exam_date: null, start_time: null, end_time: null },
  ] },
  { subject_id: 2, subject_name: 'English', classes: [
    { exam_subject_id: 21, exam_id: 1, class_name: 'Class 2', exam_date: '2026-11-02', start_time: null, end_time: null },
  ] },
];

describe('date sheet rows', () => {
  it('trims server times to HH:MM', () => {
    expect(shortTime('09:00:00')).toBe('09:00');
    expect(shortTime(null)).toBe('');
  });

  it('flattens, sorts by date with undated last, and counts the unscheduled', () => {
    const rows = sortRows(toRows(sheet));
    expect(rows.map((r) => r.examSubjectId)).toEqual([21, 11, 12]);
    expect(rows[1]).toMatchObject({ date: '2026-11-03', start: '09:00', end: '11:00' });
    expect(unscheduledCount(rows)).toBe(1);
  });

  it('lists each subject once for the same-date picker', () => {
    expect(subjectsInSheet(toRows(sheet), sheet)).toEqual([{ id: 1, name: 'Maths' }, { id: 2, name: 'English' }]);
  });
});

describe('date sheet edit', () => {
  it('accepts a date with a valid time range', () => {
    expect(validateDateSheetEdit({ date: '2026-11-03', start: '09:00', end: '11:30' })).toBeNull();
    expect(validateDateSheetEdit({ date: '', start: '', end: '' })).toBeNull();
  });

  it('refuses bad times and a time without a date', () => {
    expect(validateDateSheetEdit({ date: '2026-11-03', start: '9am', end: '' })).toMatch(/Start time/);
    expect(validateDateSheetEdit({ date: '2026-11-03', start: '', end: '25:00' })).toMatch(/End time/);
    expect(validateDateSheetEdit({ date: '2026-11-03', start: '11:00', end: '09:00' })).toMatch(/after the start/);
    expect(validateDateSheetEdit({ date: '', start: '09:00', end: '' })).toMatch(/date before/);
    // A date outside the exam period is allowed, as on the web.
    expect(validateDateSheetEdit({ date: '2026-12-31', start: '', end: '' })).toBeNull();
  });

  it('sends null for anything cleared', () => {
    expect(buildDateSheetEntry(11, { date: '', start: '', end: '' })).toEqual({ exam_subject_id: 11, exam_date: null, start_time: null, end_time: null });
    expect(buildDateSheetEntry(11, { date: '2026-11-03', start: '09:00', end: '' })).toEqual({ exam_subject_id: 11, exam_date: '2026-11-03', start_time: '09:00', end_time: null });
  });
});
