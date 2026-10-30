import {
  buildSlotPayload, bulkSavePayload, dayChanged, draftFromEntries, emptyCell, emptySlotForm, entriesPayload, filledCount, hasOverride, isLessonSlot,
  nextSlotOrder, overlappingSlots, saveErrorLines, setCell, slotRunsOn, slotsForDay, slotToForm, slotTimes, toggleDay, validateSlot, type Entry, type Slot,
} from '../services/timetableEdit';

const slot = (over: Partial<Slot> = {}): Slot => ({ id: 1, name: 'Period 1', slot_type: 'PERIOD', start_time: '08:00:00', end_time: '08:40:00', order: 1, is_active: true, applicable_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], ...over });

describe('slots of a day', () => {
  it('keeps active slots that run that day, in order', () => {
    const slots = [slot({ id: 3, order: 3 }), slot({ id: 1, order: 1 }), slot({ id: 2, order: 2, applicable_days: ['MON'] }), slot({ id: 4, order: 4, is_active: false })];
    expect(slotsForDay(slots, 'MON').map((s) => s.id)).toEqual([1, 2, 3]);
    expect(slotsForDay(slots, 'TUE').map((s) => s.id)).toEqual([1, 3]);
  });

  it('treats an empty day list as every day, and only periods as lessons', () => {
    expect(slotRunsOn({ applicable_days: null }, 'SAT')).toBe(true);
    expect(slotRunsOn({ applicable_days: [] }, 'SAT')).toBe(true);
    expect(slotRunsOn({ applicable_days: ['MON'] }, 'SAT')).toBe(false);
    expect(isLessonSlot(slot())).toBe(true);
    expect(isLessonSlot(slot({ slot_type: 'LUNCH' }))).toBe(false);
    expect(slotTimes(slot())).toBe('08:00 to 08:40');
  });
});

describe('the day grid', () => {
  const entries: Entry[] = [
    { id: 1, day: 'MON', slot: 1, subject: 5, subject_name: 'Maths', teacher: 9, teacher_name: 'Ali', room: '101' },
    { id: 2, day: 'TUE', slot: 1, subject: 6, subject_name: 'English' },
  ];

  it('starts from the entries of the chosen day', () => {
    const d = draftFromEntries(entries, 'MON');
    expect(Object.keys(d)).toEqual(['1']);
    expect(d[1]).toEqual({ subject: 5, subjectName: 'Maths', teacher: 9, teacherName: 'Ali', room: '101' });
    expect(filledCount(d)).toBe(1);
  });

  it('notices a change, ignoring spaces in the room', () => {
    const orig = draftFromEntries(entries, 'MON');
    expect(dayChanged(orig, orig)).toBe(false);
    expect(dayChanged(orig, setCell(orig, 1, { ...orig[1], room: ' 101 ' }))).toBe(false);
    expect(dayChanged(orig, setCell(orig, 1, { ...orig[1], teacher: 10 }))).toBe(true);
    expect(dayChanged(orig, setCell(orig, 1, null))).toBe(true);
    expect(dayChanged(orig, setCell(orig, 2, { ...emptyCell(), subject: 6 }))).toBe(true);
  });

  it('sends only filled periods, in period order', () => {
    const slots = [slot({ id: 2, order: 2 }), slot({ id: 1, order: 1 })];
    const draft = { 2: { ...emptyCell(), subject: 6, room: ' 2B ' }, 1: { ...emptyCell(), subject: 5, teacher: 9 }, 7: { ...emptyCell(), subject: 1 } };
    expect(entriesPayload(draft, [slots[1], slots[0]])).toEqual([
      { slot: 1, subject: 5, teacher: 9, room: '' }, { slot: 2, subject: 6, teacher: null, room: '2B' },
    ]);
    expect(entriesPayload({ 1: emptyCell() }, slots)).toEqual([]);
  });

  it('builds a class payload and a section payload', () => {
    const draft = { 1: { ...emptyCell(), subject: 5 } };
    expect(bulkSavePayload({ classObj: 4, sessionClass: null, academicYear: 3 }, 'MON', draft, [slot()])).toEqual({
      class_obj: 4, day: 'MON', academic_year: 3, entries: [{ slot: 1, subject: 5, teacher: null, room: '' }],
    });
    expect(bulkSavePayload({ classObj: 4, sessionClass: 8, academicYear: null }, 'TUE', {}, [slot()])).toEqual({ class_obj: 4, day: 'TUE', session_class: 8, entries: [] });
  });

  it('spots a section override', () => {
    expect(hasOverride([{ day: 'MON', slot: 1, is_section_override: true }], 'MON')).toBe(true);
    expect(hasOverride([{ day: 'MON', slot: 1, is_section_override: true }], 'TUE')).toBe(false);
  });

  it('reads the server error lines', () => {
    expect(saveErrorLines({ response: { data: { detail: ['Row 1: Teacher is already assigned to Class 2 at Period 1.', 'Row 3: x'] } } })).toHaveLength(2);
    expect(saveErrorLines({ response: { data: { detail: 'No school selected.' } } })).toEqual(['No school selected.']);
    expect(saveErrorLines({ response: { data: {} } })[0]).toMatch(/Could not save/);
    expect(saveErrorLines(new Error('x'))[0]).toMatch(/No connection/);
  });
});

describe('slot form', () => {
  const ok = { ...emptySlotForm(2), name: ' Period 2 ', start: '08:40', end: '09:20' };

  it('proposes the next free order and every day', () => {
    expect(nextSlotOrder([slot({ order: 3 }), slot({ id: 2, order: 5 })])).toBe(6);
    expect(nextSlotOrder([])).toBe(1);
    expect(emptySlotForm(4)).toMatchObject({ order: '4', type: 'PERIOD' });
    expect(emptySlotForm(4).days).toHaveLength(6);
  });

  it('validates name, times, order and days', () => {
    const others = [slot({ id: 1, order: 1 })];
    expect(validateSlot({ ...ok, name: '' }, others, null)).toMatch(/name/);
    expect(validateSlot({ ...ok, start: '8am' }, others, null)).toMatch(/Start time/);
    expect(validateSlot({ ...ok, end: '25:00' }, others, null)).toMatch(/End time/);
    expect(validateSlot({ ...ok, end: '08:00' }, others, null)).toMatch(/after/);
    expect(validateSlot({ ...ok, order: 'x' }, others, null)).toMatch(/order/);
    expect(validateSlot({ ...ok, order: '1' }, others, null)).toMatch(/already/);
    expect(validateSlot({ ...ok, order: '1' }, others, 1)).toBeNull();
    expect(validateSlot({ ...ok, days: [] }, others, null)).toMatch(/day/);
    expect(validateSlot(ok, others, null)).toBeNull();
  });

  it('builds the payload and round-trips a saved slot', () => {
    expect(buildSlotPayload(ok)).toEqual({ name: 'Period 2', slot_type: 'PERIOD', start_time: '08:40', end_time: '09:20', order: 2, applicable_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] });
    expect(slotToForm(slot({ applicable_days: ['MON', 'FRI'] }))).toMatchObject({ name: 'Period 1', start: '08:00', end: '08:40', order: '1', days: ['MON', 'FRI'] });
    expect(slotToForm(slot({ applicable_days: null })).days).toHaveLength(6);
  });

  it('toggles days in week order', () => {
    expect(toggleDay(['MON', 'WED'], 'TUE')).toEqual(['MON', 'TUE', 'WED']);
    expect(toggleDay(['MON', 'TUE'], 'MON')).toEqual(['TUE']);
  });

  it('flags periods that overlap on a shared day', () => {
    expect(overlappingSlots([slot(), slot({ id: 2, order: 2, start_time: '08:40:00', end_time: '09:20:00' })])).toEqual([]);
    expect(overlappingSlots([slot(), slot({ id: 2, name: 'Period 2', order: 2, start_time: '08:30:00', end_time: '09:10:00' })])).toEqual(['Period 1 and Period 2 overlap.']);
    expect(overlappingSlots([slot({ applicable_days: ['MON'] }), slot({ id: 2, name: 'B', order: 2, start_time: '08:30:00', end_time: '09:10:00', applicable_days: ['TUE'] })])).toEqual([]);
  });
});
