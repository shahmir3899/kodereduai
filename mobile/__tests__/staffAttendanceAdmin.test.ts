import {
  buildRows, buildSavePayload, countStatuses, isDirty, markUnmarkedPresent, staffName, validateDay, validateTimes,
} from '../services/staffAttendance';

const staff = [
  { id: 2, full_name: 'Zara Khan', employee_id: 'E2', department_name: 'Science' },
  { id: 1, first_name: 'Ali', last_name: 'Raza', employee_id: 'E1' },
  { id: 3 },
];

describe('buildRows', () => {
  it('lists staff by name and pre-fills what is already saved', () => {
    const rows = buildRows(staff, [{ staff_member: 2, status: 'LATE', check_in: '08:45:00', check_out: null, notes: 'bus' }]);
    expect(rows.map((r) => r.name)).toEqual(['Ali Raza', 'Staff 3', 'Zara Khan']);
    const zara = rows.find((r) => r.staffId === 2)!;
    expect(zara).toMatchObject({ status: 'LATE', checkIn: '08:45', checkOut: '', notes: 'bus', department: 'Science' });
    expect(rows.find((r) => r.staffId === 1)!.status).toBe('');
  });

  it('names a staff member from first and last name when there is no full name', () => {
    expect(staffName(staff[1])).toBe('Ali Raza');
  });
});

describe('countStatuses and markUnmarkedPresent', () => {
  const rows = buildRows(staff, [{ staff_member: 2, status: 'ABSENT' }]);

  it('counts every status including unmarked', () => {
    expect(countStatuses(rows)).toEqual({ PRESENT: 0, ABSENT: 1, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0, UNMARKED: 2 });
  });

  it('marks only the unmarked rows, leaving a saved Absent alone', () => {
    const next = markUnmarkedPresent(rows);
    expect(next.find((r) => r.staffId === 2)!.status).toBe('ABSENT');
    expect(countStatuses(next)).toMatchObject({ PRESENT: 2, ABSENT: 1, UNMARKED: 0 });
  });
});

describe('isDirty', () => {
  it('is false until something changes', () => {
    const base = buildRows(staff, []);
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty(markUnmarkedPresent(base), base)).toBe(true);
  });
});

describe('validateTimes', () => {
  const row = (checkIn: string, checkOut: string) => ({ name: 'Ali', checkIn, checkOut });
  it('allows empty and valid 24-hour times', () => {
    expect(validateTimes(row('', ''))).toBeNull();
    expect(validateTimes(row('08:30', '15:00'))).toBeNull();
  });
  it('refuses a malformed time or a check-out before the check-in', () => {
    expect(validateTimes(row('8:30', ''))).toContain('check-in');
    expect(validateTimes(row('', '25:00'))).toContain('check-out');
    expect(validateTimes(row('15:00', '08:30'))).toContain('before');
  });
});

describe('validateDay and buildSavePayload', () => {
  const marked = markUnmarkedPresent(buildRows(staff, []));

  it('needs at least one marked row and no future date', () => {
    expect(validateDay('2020-01-01', buildRows(staff, []))).toContain('at least one');
    expect(validateDay('2999-01-01', marked)).toContain('future');
    expect(validateDay('2020-01-01', marked)).toBeNull();
  });

  it('sends only marked rows, with empty times as null', () => {
    const rows = buildRows(staff, [{ staff_member: 2, status: 'LATE', check_in: '09:00' }]);
    const payload = buildSavePayload('2026-11-02', rows);
    expect(payload.date).toBe('2026-11-02');
    expect(payload.records).toEqual([
      { staff_member: 2, date: '2026-11-02', status: 'LATE', check_in: '09:00', check_out: null, notes: '' },
    ]);
  });
});
