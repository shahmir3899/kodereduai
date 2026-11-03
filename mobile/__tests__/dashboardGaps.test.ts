import { buildAttentionItems } from '../services/adminDashboard';
import { badgeLabel, periodSubtitle, shortDate } from '../services/teacherDashboard';
import { assignmentTypeTone, isCurrentPeriod, lastExamPct, offDayNote, type PortalResultExam } from '../services/studentPortal';
import { childrenLinked, CHILD_LINKS, examDelta, feeNote, nextExamWhen } from '../services/parentPortal';

describe('admin attention strip: library, stock, AI alerts', () => {
  const on = () => true;
  const run = (over: Partial<Parameters<typeof buildAttentionItems>[0]> = {}) =>
    buildAttentionItems({ isModuleEnabled: on, data: {}, isToday: true, routes: {}, ...over });

  it('adds overdue books, low stock and AI alerts with the web wording', () => {
    const items = run({ data: { library: { total_overdue: 3 }, inventory: { low_stock_count: 2 } }, aiAlerts: 1 });
    expect(items.map((i) => [i.key, i.count, i.label, i.tone])).toEqual([
      ['stock', 2, 'items low on stock', 'red'],
      ['ai', 1, 'AI alerts', 'red'],
      ['lib', 3, 'overdue library books', 'amber'],
    ]);
  });

  it('shows nothing for zero, for a module that is off, or when the section failed', () => {
    expect(run({ data: { library: { total_overdue: 0 }, inventory: null }, aiAlerts: 0 })).toEqual([]);
    expect(run({ isModuleEnabled: (k) => k !== 'library', data: { library: { total_overdue: 5 } } })).toEqual([]);
  });
});

describe('teacher dashboard helpers', () => {
  it('caps and hides the quick-action badge', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(null)).toBe('');
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(250)).toBe('99+');
  });

  it('writes the class and room line', () => {
    expect(periodSubtitle({ class_name: 'Grade 5 - A', room: '12' })).toBe('Grade 5 - A  ·  Room 12');
    expect(periodSubtitle({ class_name: 'Grade 5 - A', room: null })).toBe('Grade 5 - A');
    expect(periodSubtitle({})).toBe('');
  });

  it('formats a submission date and survives junk', () => {
    expect(shortDate('2026-03-05T10:00:00Z')).toMatch(/Mar 5|Mar 4|Mar 6/);
    expect(shortDate(null)).toBe('');
    expect(shortDate('not a date')).toBe('');
  });
});

describe('student dashboard helpers', () => {
  it('names the off-day types', () => {
    expect(offDayNote({ is_off_day: true, off_day_types: ['Holiday', 'Weekend'] })).toBe('OFF day (Holiday, Weekend)');
    expect(offDayNote({ is_off_day: true })).toBe('OFF day');
    expect(offDayNote({ is_off_day: false })).toBe('');
    expect(offDayNote(null)).toBe('');
  });

  it('marks a period current only between its start (inclusive) and end (exclusive)', () => {
    expect(isCurrentPeriod('09:00:00', '09:45:00', '09:00')).toBe(true);
    expect(isCurrentPeriod('09:00:00', '09:45:00', '09:44')).toBe(true);
    expect(isCurrentPeriod('09:00:00', '09:45:00', '09:45')).toBe(false);
    expect(isCurrentPeriod(null, '09:45:00', '09:10')).toBe(false);
  });

  it('colours assignment types', () => {
    expect(assignmentTypeTone('HOMEWORK')).toBe('info');
    expect(assignmentTypeTone('project')).toBe('warning');
    expect(assignmentTypeTone('TEST')).toBe('error');
    expect(assignmentTypeTone(undefined)).toBe('neutral');
  });

  it('takes the newest marked exam for the Last Exam tile', () => {
    const exam = (subjects: PortalResultExam['subjects']) => ({ exam_id: 1, exam_name: 'E', subjects }) as unknown as PortalResultExam;
    const unmarked = exam([{ marks_obtained: null, total_marks: 50, is_absent: false }] as never);
    const marked = exam([{ marks_obtained: 40, total_marks: 50, is_absent: false }] as never);
    expect(lastExamPct([unmarked, marked])).toBe(80);
    expect(lastExamPct([unmarked])).toBeNull();
    expect(lastExamPct(undefined)).toBeNull();
  });
});

describe('parent dashboard helpers', () => {
  it('works out the change since the previous exam', () => {
    expect(examDelta({ percentage: 72.5 }, { percentage: 68 })).toBe(4.5);
    expect(examDelta({ percentage: 60 }, { percentage: 64 })).toBe(-4);
    expect(examDelta({ percentage: 60 }, { percentage: 60 })).toBe(0);
    expect(examDelta({ percentage: 60 }, null)).toBeNull();
    expect(examDelta(null, { percentage: 60 })).toBeNull();
  });

  it('says when the next exam is', () => {
    const now = new Date(2026, 10, 3);
    expect(nextExamWhen('2026-11-03', now)).toMatch(/^Today · /);
    expect(nextExamWhen('2026-11-04', now)).toMatch(/^Tomorrow · /);
    expect(nextExamWhen('2026-11-09', now)).toMatch(/^In 6 days · /);
    expect(nextExamWhen('2026-10-30', now)).not.toMatch(/Today|Tomorrow|In /);
  });

  it('notes earlier-month fees, or that nothing is due', () => {
    expect(feeNote(0, 0)).toBe('Nothing due');
    expect(feeNote(5000, 0)).toBe('outstanding');
    expect(feeNote(5000, 2000)).toMatch(/from earlier months$/);
  });

  it('counts linked children and lists the child pages in web order', () => {
    expect(childrenLinked(0)).toBe('');
    expect(childrenLinked(1)).toBe('1 child linked');
    expect(childrenLinked(3)).toBe('3 children linked');
    expect(CHILD_LINKS.map((l) => l.label)).toEqual(['Overview', 'Attendance', 'Fees', 'Results', 'Timetable', 'Exam schedule', 'Library', 'Transport']);
  });
});
