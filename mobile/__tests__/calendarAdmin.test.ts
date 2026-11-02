import {
  buildEntryPayload, emptyEntryForm, entryDatesLine, entryErrorMessage, entryMeta, entryToForm, listParams, masterClassId,
  monthRange, offDayEffect, sortEntries, validateEntry, type CalendarEntry,
} from '../services/calendarAdmin';

const form = (over: object = {}) => ({ ...emptyEntryForm('2026-12-25'), name: 'Quaid Day', ...over });

describe('validateEntry', () => {
  it('needs a title and a sensible date range', () => {
    expect(validateEntry(form({ name: ' ' }))).toContain('title');
    expect(validateEntry(form({ start: '' }))).toContain('dates');
    expect(validateEntry(form({ start: '2026-12-26', end: '2026-12-25' }))).toContain('before');
    expect(validateEntry(form())).toBeNull();
  });

  it('needs a class when the scope is classes, and someone affected for an OFF day', () => {
    expect(validateEntry(form({ scope: 'CLASS' }))).toContain('class');
    expect(validateEntry(form({ scope: 'CLASS', classIds: [4] }))).toBeNull();
    expect(validateEntry(form({ kind: 'OFF_DAY', students: false, staff: false }))).toContain('students, staff');
    expect(validateEntry(form({ kind: 'OFF_DAY', students: true, staff: false }))).toBeNull();
  });
});

describe('buildEntryPayload', () => {
  it('sends an event as applying to everyone, with no category', () => {
    expect(buildEntryPayload(46, form({ students: false, offType: 'EXAM_BREAK' }))).toEqual({
      academic_year: 46, name: 'Quaid Day', description: '', entry_kind: 'EVENT', off_day_type: '', scope: 'SCHOOL',
      start_date: '2026-12-25', end_date: '2026-12-25', color: '#0ea5e9', affects_students: true, affects_staff: true, class_ids: [], is_active: true,
    });
  });

  it('sends an OFF day with its category and who it affects, and class ids only for a class scope', () => {
    const p = buildEntryPayload(46, form({ kind: 'OFF_DAY', offType: 'NATIONAL_HOLIDAY', students: true, staff: false, scope: 'CLASS', classIds: [4, 5] }));
    expect(p).toMatchObject({ entry_kind: 'OFF_DAY', off_day_type: 'NATIONAL_HOLIDAY', affects_students: true, affects_staff: false, class_ids: [4, 5] });
    expect(buildEntryPayload(46, form({ scope: 'SCHOOL', classIds: [4] })).class_ids).toEqual([]);
  });

  it('trims the text', () => {
    expect(buildEntryPayload(46, form({ name: ' X ', description: ' d ' }))).toMatchObject({ name: 'X', description: 'd' });
  });
});

describe('entryToForm and the OFF day effect', () => {
  const entry: CalendarEntry = {
    id: 1, name: 'Eid', entry_kind: 'OFF_DAY', off_day_type: 'RELIGIOUS_HOLIDAY', scope: 'CLASS', class_ids: [4], class_names: ['Grade 1'],
    start_date: '2026-03-20', end_date: '2026-03-22', color: null, affects_students: true, affects_staff: false,
  };

  it('fills the form from a saved entry, with a default colour', () => {
    expect(entryToForm(entry)).toMatchObject({ kind: 'OFF_DAY', offType: 'RELIGIOUS_HOLIDAY', classIds: [4], students: true, staff: false, color: '#dc2626' });
  });

  it('says what an OFF day does, and nothing for an event', () => {
    expect(offDayEffect({ kind: 'EVENT', students: true, staff: true, scope: 'SCHOOL' })).toBeNull();
    expect(offDayEffect({ kind: 'OFF_DAY', students: true, staff: true, scope: 'SCHOOL' })).toBe('On these days attendance is not taken for students and staff are marked On leave automatically.');
    expect(offDayEffect({ kind: 'OFF_DAY', students: true, staff: false, scope: 'CLASS' })).toBe('On these days attendance is not taken for students (only in the chosen classes).');
  });
});

describe('month and lines', () => {
  it('covers whole months, including February and the year end', () => {
    expect(monthRange(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(listParams(46, 2026, 11)).toEqual({ academic_year: 46, date_from: '2026-11-01', date_to: '2026-11-30', is_active: true, page_size: 200 });
  });

  it('describes dates and what an entry is', () => {
    expect(entryDatesLine({ start_date: '2026-03-20', end_date: '2026-03-20' })).toBe('2026-03-20');
    expect(entryDatesLine({ start_date: '2026-03-20', end_date: '2026-03-22' })).toBe('2026-03-20 to 2026-03-22');
    const e = { id: 1, name: 'x', entry_kind: 'OFF_DAY', off_day_type: 'EXAM_BREAK', scope: 'SCHOOL', start_date: 'a', end_date: 'a' } as CalendarEntry;
    expect(entryMeta(e)).toBe('Exam break  ·  Whole school');
    expect(entryMeta({ ...e, entry_kind: 'EVENT', scope: 'CLASS', class_names: ['Grade 1', 'Grade 2'] })).toBe('Event  ·  Grade 1, Grade 2');
  });

  it('sorts by start date then name', () => {
    const mk = (id: number, name: string, d: string) => ({ id, name, start_date: d, end_date: d } as CalendarEntry);
    expect(sortEntries([mk(1, 'b', '2026-03-02'), mk(2, 'a', '2026-03-02'), mk(3, 'z', '2026-03-01')]).map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it('takes the master class of a section or a class', () => {
    expect(masterClassId({ id: 9, classObj: 4, isSession: true })).toBe(4);
    expect(masterClassId({ id: 4, classObj: null, isSession: false })).toBe(4);
  });
});

describe('entryErrorMessage', () => {
  it('shows what the server said, or the fallback', () => {
    expect(entryErrorMessage({ response: { data: { end_date: ['End date must be on or after start date.'] } } }, 'x')).toBe('End date must be on or after start date.');
    expect(entryErrorMessage({ response: { data: { detail: 'Overlaps an existing entry.' } } }, 'x')).toBe('Overlaps an existing entry.');
    expect(entryErrorMessage(new Error('boom'), 'Could not save.')).toBe('Could not save.');
  });
});
