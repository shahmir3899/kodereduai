import {
  buildWeek, conflictLine, conflictParams, hasSharedEntries, hasSuggestions, overrideDays, resolutionView, scoreParts, scoreTone, showScore,
  slotLine, splitResultText, strongSubstitute, subjectColours, substituteView, validateSubstitute, weekCounts, weekDays,
} from '../services/timetableWeek';
import type { Entry, Slot } from '../services/timetableEdit';

const slot = (o: Partial<Slot>): Slot => ({ id: 1, name: 'P1', slot_type: 'PERIOD', start_time: '08:00:00', end_time: '08:40:00', order: 1, is_active: true, ...o });
const slots: Slot[] = [slot({ id: 1, order: 1 }), slot({ id: 2, order: 2, name: 'Break', slot_type: 'BREAK' }), slot({ id: 3, order: 3, name: 'P2', applicable_days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] })];
const entries: Entry[] = [
  { day: 'MON', slot: 1, subject: 7, subject_name: 'Maths', teacher_name: 'Ali', room: '3' },
  { day: 'TUE', slot: 1, subject: 4, subject_name: 'English', is_section_override: true },
  { day: 'MON', slot: 3, subject: 7, subject_name: 'Maths' },
  { day: 'SAT', slot: 1, subject: null },
];

describe('week grid', () => {
  const rows = buildWeek(slots, entries);
  it('has a row per period and break in order', () => {
    expect(rows.map((r) => r.slot.name)).toEqual(['P1', 'Break', 'P2']);
    expect(rows.map((r) => r.lesson)).toEqual([true, false, true]);
  });
  it('fills cells, leaves empty ones null and marks days a period does not run', () => {
    expect(rows[0].days.MON).toMatchObject({ subject: 'Maths', teacher: 'Ali', room: '3', override: false });
    expect(rows[0].days.TUE).toMatchObject({ subject: 'English', override: true });
    expect(rows[0].days.WED).toBeNull();
    expect(rows[0].days.SAT).toBeNull(); // an entry with no subject is an empty cell
    expect(rows[2].days.SAT).toBe('off');
  });
  it('counts lesson cells and picks the days to show', () => {
    expect(weekCounts(rows)).toEqual({ filled: 3, total: 11 });
    expect(weekDays(rows)).toEqual(['MON', 'TUE']);
    expect(weekCounts(rows, weekDays(rows))).toEqual({ filled: 3, total: 4 });
    expect(weekDays(buildWeek(slots, []))).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
  });
  it('keeps one colour per subject whatever the order', () => {
    const a = subjectColours(entries);
    const b = subjectColours([...entries].reverse());
    expect(a.get(7)).toBe(b.get(7));
    expect(a.get(4)).not.toBe(a.get(7));
  });
  it('finds section-only days and shared entries', () => {
    expect(overrideDays(entries)).toEqual(['TUE']);
    expect(hasSharedEntries(entries)).toBe(true);
    expect(hasSharedEntries([{ day: 'MON', slot: 1, is_section_override: true }])).toBe(false);
  });
});

describe('quality score', () => {
  it('tones and parts', () => {
    expect(scoreTone(85)).toBe('success');
    expect(scoreTone(70)).toBe('warning');
    expect(scoreTone(40)).toBe('error');
    expect(showScore({ overall_score: 0 })).toBe(false);
    expect(showScore(null)).toBe(false);
    expect(showScore({ overall_score: 72 })).toBe(true);
    const parts = scoreParts({ overall_score: 72, constraint_satisfaction: 90, subject_distribution: 61.4, teacher_idle_gaps: 20 });
    expect(parts.map((p) => p.label)[0]).toBe('Constraint satisfaction');
    expect(parts[1]).toMatchObject({ value: 61, tone: 'warning', weight: '25%' });
    expect(parts[2]).toMatchObject({ value: 20, tone: 'error' });
    expect(parts[4].value).toBe(0);
  });
});

describe('clash and alternatives', () => {
  it('words the clash', () => {
    expect(conflictLine({ has_conflict: false })).toBeNull();
    expect(conflictLine(null)).toBeNull();
    expect(conflictLine({ has_conflict: true, conflicts: [{ class_name: 'Class 5 - A' }] })).toMatch(/Class 5 - A/);
    expect(conflictLine({ has_conflict: true, conflicts: [] })).toMatch(/another class/);
  });
  it('excludes the right rows when checking', () => {
    expect(conflictParams(9, 'MON', 4, 12, null)).toEqual({ teacher: 9, day: 'MON', slot: 4, exclude_class: 12 });
    expect(conflictParams(9, 'MON', 4, 12, 33)).toEqual({ teacher: 9, day: 'MON', slot: 4, exclude_session_class: 33 });
  });
  it('limits the suggestions', () => {
    const v = resolutionView({
      alternative_teachers: Array.from({ length: 8 }, (_, i) => ({ teacher_id: i, teacher_name: `T${i}` })),
      alternative_slots: Array.from({ length: 12 }, () => ({ day: 'TUE', slot_name: 'P3' })), swap_suggestions: [{ reason: 'Swap with X' }],
    });
    expect(v.teachers).toHaveLength(5);
    expect(v.slots).toHaveLength(8);
    expect(hasSuggestions(v)).toBe(true);
    expect(hasSuggestions(resolutionView(null))).toBe(false);
    expect(slotLine({ day: 'TUE', slot_name: 'P3' })).toBe('Tue P3');
  });
});

describe('substitutes and split', () => {
  it('reads the substitute answer', () => {
    expect(substituteView({ error: 'Teacher not found.' }).error).toBe('Teacher not found.');
    const v = substituteView({ absent_teacher_name: 'Ali', date: '2026-11-03', message: 'No classes', entries_needing_cover: [{ slot_name: 'P1' }] });
    expect(v.heading).toBe('Ali on 2026-11-03 — No classes');
    expect(v.entries).toHaveLength(1);
    expect(substituteView(null).entries).toEqual([]);
    expect(strongSubstitute(70)).toBe(true);
    expect(strongSubstitute(69)).toBe(false);
  });
  it('validates the form', () => {
    expect(validateSubstitute(null, '2026-11-03')).toMatch(/teacher/);
    expect(validateSubstitute(4, '')).toMatch(/date/);
    expect(validateSubstitute(4, '2026-11-03')).toBeNull();
  });
  it('words the split result', () => {
    expect(splitResultText({ sections: ['A', 'B'], created: 40, teacher_clashes: 0 })).toBe('Each section now has its own timetable (A, B; 40 entries). No teacher is double-booked.');
    expect(splitResultText({ sections: ['A'], created: 10, teacher_clashes: 1 })).toMatch(/1 period have the same teacher/);
    expect(splitResultText({ sections: ['A'], created: 10, teacher_clashes: 3 })).toMatch(/3 periods have/);
  });
});
