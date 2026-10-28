import {
  dayCodeFor, daysWithEntries, entriesForDay, formatSlotTime, teacherClassOptions, type TimetableEntry,
} from '../services/teacher';

describe('teacherClassOptions', () => {
  const mine = [{ id: 5, name: 'Class 6', grade_level: 6 }];
  const sessions = [
    { id: 11, class_obj: 5, display_name: 'Class 6', section: 'A', grade_level: 6 },
    { id: 12, class_obj: 5, display_name: 'Class 6', section: 'B', grade_level: 6 },
    { id: 13, class_obj: 9, display_name: 'Class 8', section: 'A', grade_level: 8 },
  ];

  it('keeps only session classes of the assigned master classes', () => {
    const options = teacherClassOptions(mine, sessions);
    expect(options.map((o) => o.id)).toEqual([11, 12]);
    expect(options.every((o) => o.isSession)).toBe(true);
  });

  it('falls back to the assigned master classes when the year has none of their sections', () => {
    const options = teacherClassOptions(mine, [sessions[2]]);
    expect(options).toEqual([{ id: 5, label: 'Class 6', classObj: null, isSession: false }]);
  });

  it('gives nothing to a teacher with no assignments', () => {
    expect(teacherClassOptions([], sessions)).toEqual([]);
  });
});

describe('timetable helpers', () => {
  const entry = (id: number, day: TimetableEntry['day'], order: number): TimetableEntry => ({ id, day, slot_order: order });
  const entries = [entry(1, 'TUE', 2), entry(2, 'MON', 3), entry(3, 'MON', 1)];

  it('orders a day by slot', () => {
    expect(entriesForDay(entries, 'MON').map((e) => e.id)).toEqual([3, 2]);
  });

  it('lists teaching days in week order', () => {
    expect(daysWithEntries(entries)).toEqual(['MON', 'TUE']);
  });

  it('maps JS weekdays to day codes with Monday first', () => {
    expect(dayCodeFor(new Date(2026, 9, 26))).toBe('MON');
    expect(dayCodeFor(new Date(2026, 9, 31))).toBe('SAT');
    expect(dayCodeFor(new Date(2026, 10, 1))).toBe('SUN');
  });

  it('formats slot times', () => {
    expect(formatSlotTime('08:00:00')).toBe('8:00 AM');
    expect(formatSlotTime('13:05:00')).toBe('1:05 PM');
    expect(formatSlotTime('00:30:00')).toBe('12:30 AM');
    expect(formatSlotTime(null)).toBe('');
  });
});
