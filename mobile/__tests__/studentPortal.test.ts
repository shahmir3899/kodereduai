import {
  attendanceCells, canSubmit, dueLabel, examPercentage, feeTotals, filterTasks, portalPeriods, rateTone,
  sortFees, sortSheet, sortTasks, splitIssues, subjectMarks, submissionBody, taskState, totalFines,
  validateSubmission, type LibraryIssue, type PortalAssignment, type PortalFee, type PortalResultExam,
} from '../services/studentPortal';
import { entriesForDay, formatSlotTime } from '../services/teacher';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const base: PortalAssignment = {
  id: 1, title: 'Essay', subject: 'English', assignment_type: 'HOMEWORK', requires_submission: true,
  due_date: '2026-10-30T12:00:00Z', total_marks: 20, status: 'PUBLISHED', submission: null,
};
const a = (over: Partial<PortalAssignment>): PortalAssignment => ({ ...base, ...over });

describe('taskState', () => {
  it('open, overdue, info, submitted, graded', () => {
    expect(taskState(base, NOW)).toBe('open');
    expect(taskState(a({ due_date: '2026-10-20T00:00:00Z' }), NOW)).toBe('overdue');
    expect(taskState(a({ requires_submission: false }), NOW)).toBe('info');
    expect(taskState(a({ submission: { id: 1, status: 'LATE', submitted_at: '', marks_obtained: null } }), NOW)).toBe('submitted');
    expect(taskState(a({ submission: { id: 1, status: 'GRADED', submitted_at: '', marks_obtained: 0 } }), NOW)).toBe('graded');
  });
  it('an assignment with no due date is open, not overdue', () => {
    expect(taskState(a({ due_date: null }), NOW)).toBe('open');
  });
});

describe('task lists', () => {
  const list = [
    a({ id: 1, due_date: '2026-10-31T00:00:00Z' }),
    a({ id: 2, due_date: '2026-10-20T00:00:00Z' }),
    a({ id: 3, submission: { id: 9, status: 'SUBMITTED', submitted_at: '', marks_obtained: null } }),
    a({ id: 4, requires_submission: false }),
  ];
  it('filters to-do and done', () => {
    expect(filterTasks(list, 'TODO', NOW).map((x) => x.id)).toEqual([1, 2]);
    expect(filterTasks(list, 'DONE', NOW).map((x) => x.id)).toEqual([3]);
    expect(filterTasks(list, 'ALL', NOW)).toHaveLength(4);
  });
  it('lists overdue first, then soonest due, then the rest', () => {
    expect(sortTasks(list, NOW).map((x) => x.id)).toEqual([2, 1, 3, 4].sort((x, y) => [2, 1, 3, 4].indexOf(x) - [2, 1, 3, 4].indexOf(y)));
  });
  it('labels due dates by calendar day', () => {
    const at = (days: number, hour: number) => new Date(2026, 9, 28 + days, hour, 0).toISOString();
    const now = new Date(2026, 9, 28, 12, 0).getTime();
    expect(dueLabel(at(0, 23), now)).toBe('Due today');
    expect(dueLabel(at(1, 1), now)).toBe('Due tomorrow');
    expect(dueLabel(at(3, 9), now)).toBe('Due in 3 days');
    expect(dueLabel(at(-1, 20), now)).toBe('1 day overdue');
    expect(dueLabel(at(-3, 8), now)).toBe('3 days overdue');
    expect(dueLabel(null, now)).toBe('No due date');
  });
});

describe('submission', () => {
  it('only an open, published, submittable task takes work', () => {
    expect(canSubmit(base)).toBe(true);
    expect(canSubmit(a({ status: 'CLOSED' }))).toBe(false);
    expect(canSubmit(a({ requires_submission: false }))).toBe(false);
    expect(canSubmit(a({ submission: { id: 1, status: 'SUBMITTED', submitted_at: '', marks_obtained: null } }))).toBe(false);
  });
  it('needs text or a valid link', () => {
    expect(validateSubmission(' ', ' ')).toMatch(/answer or add a link/);
    expect(validateSubmission('done', '')).toBeNull();
    expect(validateSubmission('', 'https://x.com/a.pdf')).toBeNull();
    expect(validateSubmission('', 'ftp://x')).toMatch(/http/);
  });
  it('builds the body with file fields only when a link is given', () => {
    expect(submissionBody(' done ', '')).toEqual({ submission_text: 'done' });
    expect(submissionBody('', 'https://x.com/docs/hw.pdf')).toEqual({ submission_text: '', file_url: 'https://x.com/docs/hw.pdf', file_name: 'hw.pdf' });
  });
});

describe('portalPeriods', () => {
  const data = {
    slots: [{ id: 1, name: 'P1', start_time: '08:00:00', end_time: '08:40:00', order: 1 }, { id: 2, name: 'P2', start_time: '08:40:00', end_time: '09:20:00', order: 2 }],
    entries: [
      { day: 'MON', slot_id: 2, subject: 'Math', teacher: 'Ms Ali' },
      { day: 'MON', slot_id: 1, subject: 'Urdu', teacher: null },
      { day: 'TUE', slot_id: 99, subject: 'Ghost', teacher: null },
    ],
  };
  it('joins entries to slots, drops entries without a slot, and orders by slot', () => {
    const periods = portalPeriods(data);
    expect(periods).toHaveLength(2);
    expect(entriesForDay(periods, 'MON').map((p) => p.subject_name)).toEqual(['Urdu', 'Math']);
    expect(formatSlotTime(periods[0].slot_start_time)).toBe('8:40 AM');
  });
  it('is empty for no data', () => expect(portalPeriods(undefined)).toEqual([]));
});

describe('attendance', () => {
  it('pads to whole weeks, Monday first, and places statuses', () => {
    // October 2026 starts on a Thursday: three blanks first.
    const cells = attendanceCells(2026, 10, [
      { id: 1, date: '2026-10-01', status: 'PRESENT' }, { id: 2, date: '2026-10-02', status: 'ABSENT' }, { id: 3, date: '2026-09-30', status: 'LEAVE' },
    ]);
    expect(cells.length % 7).toBe(0);
    expect(cells.slice(0, 3).every((c) => c.day === null)).toBe(true);
    expect(cells[3]).toEqual({ day: 1, status: 'PRESENT' });
    expect(cells[4]).toEqual({ day: 2, status: 'ABSENT' });
    expect(cells.filter((c) => c.day !== null)).toHaveLength(31);
  });
  it('tones the rate', () => {
    expect(rateTone(95)).toBe('success');
    expect(rateTone(80)).toBe('warning');
    expect(rateTone(60)).toBe('error');
  });
});

describe('results', () => {
  const exam: PortalResultExam = {
    exam_id: 1, exam_name: 'Mid', subjects: [
      { subject: 'Math', marks_obtained: 40, total_marks: 50, is_absent: false },
      { subject: 'Urdu', marks_obtained: null, total_marks: 50, is_absent: true },
      { subject: 'Art', marks_obtained: 30, total_marks: 50, is_absent: false },
    ],
  };
  it('averages only marked subjects, so absent is not a zero', () => {
    expect(examPercentage(exam)).toBe(70);
    expect(examPercentage({ ...exam, subjects: [] })).toBeNull();
  });
  it('shows absent and a real zero differently', () => {
    expect(subjectMarks(exam.subjects[1])).toBe('Absent');
    expect(subjectMarks({ subject: 'x', marks_obtained: 0, total_marks: 20, is_absent: false })).toBe('0 / 20');
    expect(subjectMarks({ subject: 'x', marks_obtained: null, total_marks: 20, is_absent: false })).toBe('–');
  });
});

describe('exam schedule and fees', () => {
  it('orders the date sheet, undated last', () => {
    const out = sortSheet([{ subject_name: 'C' }, { subject_name: 'B', exam_date: '2026-11-03' }, { subject_name: 'A', exam_date: '2026-11-01' }]);
    expect(out.map((s) => s.subject_name)).toEqual(['A', 'B', 'C']);
  });
  const fee = (over: Partial<PortalFee>): PortalFee => ({
    id: 1, student: 1, student_name: 's', fee_type: 'MONTHLY', month: 1, year: 2026, amount_due: 1000, amount_paid: 400, status: 'PARTIAL', ...over,
  });
  it('does not count a handed-over row twice', () => {
    expect(feeTotals([fee({}), fee({ id: 2, handed_over: true, amount_due: 5000, amount_paid: 0 })])).toEqual({ due: 1000, paid: 400, pending: 600 });
  });
  it('never reports a negative balance', () => {
    expect(feeTotals([fee({ amount_paid: 1500, status: 'ADVANCE' })]).pending).toBe(0);
  });
  it('sorts newest month first', () => {
    expect(sortFees([fee({ id: 1, month: 3 }), fee({ id: 2, month: 5 }), fee({ id: 3, month: 12, year: 2025 })]).map((f) => f.id)).toEqual([2, 1, 3]);
  });
});

describe('library', () => {
  const issue = (over: Partial<LibraryIssue>): LibraryIssue => ({
    id: 1, book_title: 'B', issue_date: '2026-10-01', due_date: '2026-10-15', status: 'ISSUED', fine_amount: '0.00', is_overdue: false, ...over,
  });
  it('splits current from returned and totals fines', () => {
    const list = [issue({ id: 1 }), issue({ id: 2, status: 'RETURNED', return_date: '2026-10-10' }), issue({ id: 3, status: 'OVERDUE', fine_amount: '50.00' })];
    const { current, past } = splitIssues(list);
    expect(current.map((i) => i.id)).toEqual([1, 3]);
    expect(past.map((i) => i.id)).toEqual([2]);
    expect(totalFines(list)).toBe(50);
  });
});
