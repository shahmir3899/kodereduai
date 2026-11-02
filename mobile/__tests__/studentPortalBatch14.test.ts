import {
  defaultFeeYear, feeYears, filterFeesByYear, isSpecialSlot, portalPeriods, type PortalFee, type PortalTimetable,
} from '../services/studentPortal';

const fee = (id: number, year: number, month = 1): PortalFee => ({
  id, student: 1, student_name: 's', fee_type: 'MONTHLY', month, year, amount_due: 1000, amount_paid: 0, status: 'PENDING',
} as unknown as PortalFee);

describe('fee years', () => {
  const rows = [fee(1, 2025), fee(2, 2026), fee(3, 2026, 2), fee(4, 2024)];
  it('lists the years with rows, newest first', () => {
    expect(feeYears(rows)).toEqual([2026, 2025, 2024]);
  });
  it('opens on the current year when it has rows, else on all', () => {
    expect(defaultFeeYear([2026, 2025], 2026)).toBe(2026);
    expect(defaultFeeYear([2025, 2024], 2026)).toBe('ALL');
    expect(defaultFeeYear([], 2026)).toBe('ALL');
  });
  it('filters by year or keeps all', () => {
    expect(filterFeesByYear(rows, 2026).map((r) => r.id)).toEqual([2, 3]);
    expect(filterFeesByYear(rows, 'ALL')).toHaveLength(4);
  });
});

describe('portalPeriods with break slots', () => {
  const data: PortalTimetable = {
    slots: [
      { id: 1, name: 'P1', start_time: '08:00:00', end_time: '08:40:00', slot_type: 'PERIOD', order: 1, applicable_days: ['MON', 'TUE'] },
      { id: 2, name: 'Break', start_time: '08:40:00', end_time: '09:00:00', slot_type: 'BREAK', order: 2, applicable_days: ['MON'] },
      { id: 3, name: 'Assembly', start_time: '07:45:00', end_time: '08:00:00', slot_type: 'ASSEMBLY', order: 0, applicable_days: [] },
    ],
    entries: [
      { day: 'MON', slot_id: 1, subject: 'Maths', teacher: 'T' },
      { day: 'TUE', slot_id: 1, subject: 'Art', teacher: 'T' },
    ],
  };
  const out = portalPeriods(data);
  it('adds a special slot only on the days it applies to', () => {
    expect(out.filter((p) => p.slot_type === 'BREAK').map((p) => p.day)).toEqual(['MON']);
  });
  it('treats an empty applicable_days list as every day with lessons', () => {
    expect(out.filter((p) => p.slot_type === 'ASSEMBLY').map((p) => p.day).sort()).toEqual(['MON', 'TUE']);
  });
  it('keeps lessons and gives every row a unique id', () => {
    expect(out.filter((p) => p.subject_name).map((p) => p.subject_name)).toEqual(['Maths', 'Art']);
    expect(new Set(out.map((p) => p.id)).size).toBe(out.length);
  });
  it('adds nothing on a day without lessons', () => {
    expect(portalPeriods({ slots: data.slots, entries: [] })).toEqual([]);
  });
  it('knows what a special slot is', () => {
    expect(isSpecialSlot('LUNCH')).toBe(true);
    expect(isSpecialSlot('PERIOD')).toBe(false);
    expect(isSpecialSlot(undefined)).toBe(false);
  });
});
