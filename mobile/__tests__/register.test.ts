import {
  buildRegister, daysInMonth, joinedBeforeDay, leftFromDay, monthLabel, offDayMap, stepMonth,
  type RegisterRecord, type RegisterStudent,
} from '../services/register';

// October 2026: 31 days, the 3rd is a Saturday, the 4th a Sunday.
const Y = 2026;
const M = 9;

describe('month helpers', () => {
  it('counts days including leap February', () => {
    expect(daysInMonth(2026, 9)).toBe(31);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it('steps across year ends and never past the current month', () => {
    const current = { year: 2026, month0: 9 };
    expect(stepMonth(2026, 0, -1, current)).toEqual({ year: 2025, month0: 11 });
    expect(stepMonth(2025, 11, 1, current)).toEqual({ year: 2026, month0: 0 });
    expect(stepMonth(2026, 9, 1, current)).toEqual({ year: 2026, month0: 9 });
  });

  it('labels the month', () => {
    expect(monthLabel(2026, 9)).toBe('October 2026');
  });
});

describe('enrolment bounds', () => {
  it('finds the day a student left, within the month', () => {
    expect(leftFromDay('2026-10-15', Y, M, 31)).toBe(15);
    expect(leftFromDay('2026-09-30', Y, M, 31)).toBe(1);
    expect(leftFromDay('2026-11-02', Y, M, 31)).toBeNull();
    expect(leftFromDay(null, Y, M, 31)).toBeNull();
  });

  it('counts the days before admission', () => {
    expect(joinedBeforeDay('2026-10-10', Y, M, 31)).toBe(9);
    expect(joinedBeforeDay('2026-09-01', Y, M, 31)).toBe(0);
    expect(joinedBeforeDay('2026-11-01', Y, M, 31)).toBe(31);
    expect(joinedBeforeDay(null, Y, M, 31)).toBe(0);
  });
});

describe('offDayMap', () => {
  it('marks Sundays and student-affecting holidays only', () => {
    const map = offDayMap([
      { day: 4, is_sunday: true },
      { day: 9, entries: [{ entry_kind: 'OFF_DAY', name: 'Iqbal Day' }] },
      { day: 10, entries: [{ entry_kind: 'OFF_DAY', name: 'Staff training', affects_students: false }] },
      { day: 11, entries: [{ entry_kind: 'EVENT', name: 'Sports' }] },
    ]);
    expect(map).toEqual({ 4: 'Sunday', 9: 'Iqbal Day' });
  });
});

describe('buildRegister', () => {
  const student = (id: number, extra: Partial<RegisterStudent> = {}): RegisterStudent => ({ id, name: `S${id}`, roll_number: String(id), ...extra });
  const rec = (student_id: number, day: number, status: string): RegisterRecord => ({ student_id, date: `2026-10-${String(day).padStart(2, '0')}`, status });

  it('counts each status and the percent of marked days', () => {
    const reg = buildRegister({
      students: [student(1)],
      records: [rec(1, 1, 'PRESENT'), rec(1, 2, 'PRESENT'), rec(1, 5, 'ABSENT'), rec(1, 6, 'LEAVE')],
      offDays: {}, year: Y, month0: M,
    });
    const row = reg.rows[0];
    expect([row.present, row.absent, row.leave]).toEqual([2, 1, 1]);
    expect(row.percent).toBe(50);
    expect(row.cells).toHaveLength(31);
    expect(row.cells[0]).toBe('PRESENT');
    expect(row.cells[4]).toBe('ABSENT');
    expect(row.cells[10]).toBe('NONE');
  });

  it('has no percent until something is marked', () => {
    const reg = buildRegister({ students: [student(1)], records: [], offDays: {}, year: Y, month0: M });
    expect(reg.rows[0].percent).toBeNull();
    expect(reg.totals.percent).toBeNull();
  });

  it('shades off days but still shows a mark saved on one', () => {
    const reg = buildRegister({
      students: [student(1)], records: [rec(1, 4, 'PRESENT')], offDays: { 3: 'Holiday', 4: 'Sunday' }, year: Y, month0: M,
    });
    expect(reg.rows[0].cells[2]).toBe('OFF');
    expect(reg.rows[0].cells[3]).toBe('PRESENT');
  });

  it('leaves days outside enrolment blank: before admission, after leaving, and while away', () => {
    const reg = buildRegister({
      students: [
        student(1, { admission_date: '2026-10-03' }),
        student(2, { left_date: '2026-10-29' }),
        student(3, { away_periods: [{ start: '2026-10-10', end: '2026-10-13' }] }),
      ],
      records: [], offDays: {}, year: Y, month0: M,
    });
    const [a, b, c] = reg.rows;
    expect(a.cells.slice(0, 3)).toEqual(['NOT_ENROLLED', 'NOT_ENROLLED', 'NONE']);
    expect(b.cells[27]).toBe('NONE');
    expect(b.cells[28]).toBe('NOT_ENROLLED');
    expect(b.hasLeft).toBe(true);
    expect(c.cells.slice(8, 13)).toEqual(['NONE', 'NOT_ENROLLED', 'NOT_ENROLLED', 'NOT_ENROLLED', 'NONE']);
  });

  it('sorts by numeric roll number and totals across students', () => {
    const reg = buildRegister({
      students: [student(10), student(2)],
      records: [rec(10, 1, 'PRESENT'), rec(2, 1, 'ABSENT')],
      offDays: {}, year: Y, month0: M,
    });
    expect(reg.rows.map((r) => r.id)).toEqual([2, 10]);
    expect(reg.totals).toEqual({ present: 1, absent: 1, leave: 0, percent: 50 });
  });

  it('ignores a status it does not know', () => {
    const reg = buildRegister({ students: [student(1)], records: [rec(1, 1, 'HOLIDAY')], offDays: {}, year: Y, month0: M });
    expect(reg.rows[0].cells[0]).toBe('NONE');
  });
});
