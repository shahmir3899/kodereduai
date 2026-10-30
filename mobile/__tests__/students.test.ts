import {
  infoRows, monthLine, sectionRows, statusLabel, statusTone, studentListParams, summaryCards, type ProfileSummary,
} from '../services/students';
import type { ClassOption } from '../services/attendanceEntry';

const section: ClassOption = { id: 11, label: 'Class 5 - A', classObj: 5, isSession: true };
const master: ClassOption = { id: 6, label: 'Class 6', classObj: null, isSession: false };

describe('studentListParams', () => {
  it('scopes to a section with the year, to a master class without one, and to nothing for all', () => {
    expect(studentListParams({ term: '', option: section, academicYearId: 7, page: 2 }))
      .toEqual({ page: 2, page_size: 30, session_class_id: 11, academic_year: 7 });
    expect(studentListParams({ term: '', option: section, academicYearId: null, page: 1 }))
      .toEqual({ page: 1, page_size: 30, class_id: 5 });
    expect(studentListParams({ term: '', option: master, academicYearId: 7, page: 1 }).class_id).toBe(6);
    const all = studentListParams({ term: '', option: null, academicYearId: 7, page: 1 });
    expect(all).toEqual({ page: 1, page_size: 30 });
  });

  it('adds a trimmed search term only when there is one', () => {
    expect(studentListParams({ term: '  Ali ', option: null, academicYearId: null, page: 1 }).search).toBe('Ali');
    expect(studentListParams({ term: '   ', option: null, academicYearId: null, page: 1 })).not.toHaveProperty('search');
  });
});

describe('status', () => {
  it('colours and labels statuses', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('withdrawn')).toBe('error');
    expect(statusTone('GRADUATED')).toBe('neutral');
    expect(statusTone('SOMETHING')).toBe('warning');
    expect(statusLabel('WITHDRAWN')).toBe('Withdrawn');
    expect(statusLabel(null)).toBe('');
  });
});

describe('summaryCards', () => {
  const s: ProfileSummary = { attendance_rate: 92.4, exam_average: 71.26, exam_average_label: 'Final Term average', pending_fee: 1500, total_due: 99, total_paid: 99 } as ProfileSummary;

  it('shows attendance, exam average and what is still owed', () => {
    const cards = summaryCards(s, true);
    expect(cards.map((c) => c.label)).toEqual(['Attendance', 'Final Term average', 'Fees pending']);
    expect(cards[0]).toMatchObject({ value: '92%', tone: 'success' });
    expect(cards[1].value).toBe('71.3%');
    expect(cards[2]).toMatchObject({ value: 'PKR 1,500', tone: 'error' });
  });

  it('never shows total due or total paid', () => {
    expect(JSON.stringify(summaryCards(s, true))).not.toContain('99');
  });

  it('hides the fee card when the role cannot see fees, and handles missing data', () => {
    expect(summaryCards(s, false).map((c) => c.label)).not.toContain('Fees pending');
    expect(summaryCards(null, true)).toEqual([]);
    expect(summaryCards({}, true)[0]).toMatchObject({ value: '—', tone: 'neutral' });
  });

  it('grades the attendance tone', () => {
    expect(summaryCards({ attendance_rate: 80 }, false)[0].tone).toBe('warning');
    expect(summaryCards({ attendance_rate: 60 }, false)[0].tone).toBe('error');
  });
});

describe('infoRows and monthLine', () => {
  it('skips empty fields', () => {
    const rows = infoRows({ roll_number: '12', class_name: 'Class 5', gender: '', address: null, parent_name: ' Mr Khan ' });
    expect(rows).toEqual([
      { label: 'Roll no.', value: '12' }, { label: 'Class', value: 'Class 5' }, { label: 'Parent / guardian', value: 'Mr Khan' },
    ]);
    expect(infoRows(null)).toEqual([]);
  });

  it('summarises a month, leaving out zero late and leave', () => {
    expect(monthLine({ month: 'October 2026', present: 18, absent: 2, late: 0, leave: 0, total: 20, rate: 90 })).toBe('P 18  ·  A 2');
    expect(monthLine({ month: 'x', present: 18, absent: 1, late: 1, leave: 2, total: 22, rate: 90 })).toBe('P 18  ·  A 1  ·  Late 1  ·  L 2');
  });
});

describe('sectionRows', () => {
  const list = [
    { id: 12, class_obj: 5, display_name: 'Class 6', section: 'B', grade_level: 6, enrollment_count: 28 },
    { id: 11, class_obj: 4, display_name: 'Class 5', section: '', grade_level: 5, enrollment_count: 30 },
    { id: 13, class_obj: 9, display_name: 'Class 8', section: 'A', grade_level: 8, is_active: false },
    { id: 14, class_obj: 6, display_name: 'Class 7', grade_level: 7 },
  ];

  it('lists active sections in grade order with their student counts', () => {
    const rows = sectionRows(list, null);
    expect(rows.map((r) => r.id)).toEqual([11, 12, 14]);
    expect(rows[1]).toMatchObject({ label: 'Class 6 - B', students: 28 });
    expect(rows[2].students).toBe(0);
  });

  it('limits a teacher to their own master classes', () => {
    expect(sectionRows(list, new Set([5])).map((r) => r.id)).toEqual([12]);
    expect(sectionRows(list, new Set())).toEqual([]);
  });
});
