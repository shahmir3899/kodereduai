import { attendanceCounts, attendanceTile, leaveRemaining } from '../services/myHr';

// The server's summary row, as hr/views.py builds it.
const row = { present: 12, absent: 1, late: 2, half_day: 1, on_leave: 3, total: 19, working_days: 22, off_days: 8, attendance_rate: 63.6 };

describe('attendanceCounts', () => {
  it('reads the lowercase keys the server sends', () => {
    expect(attendanceCounts(row)).toEqual({
      present: 12, absent: 1, late: 2, halfDay: 1, onLeave: 3, workingDays: 22, offDays: 8, rate: 63.6,
    });
  });
  it('still accepts the old uppercase names and tolerates nothing', () => {
    expect(attendanceCounts({ PRESENT: 4, HALF_DAY: 1 }).present).toBe(4);
    expect(attendanceCounts({ PRESENT: 4, HALF_DAY: 1 }).halfDay).toBe(1);
    expect(attendanceCounts(null)).toMatchObject({ present: 0, workingDays: null, rate: null });
  });
});

describe('attendanceTile', () => {
  it('shows present over working days with the rate and off days', () => {
    expect(attendanceTile(row)).toEqual({ value: '12/22', hint: '64% present · 8 off' });
  });
  it('is N/A with no working days and a dash before the summary loads', () => {
    expect(attendanceTile({ ...row, working_days: 0 }).value).toBe('N/A');
    expect(attendanceTile(null)).toEqual({ value: '–', hint: '' });
  });
  it('falls back to the recorded days when the server gives no working days', () => {
    expect(attendanceTile({ present: 3, absent: 1 }).value).toBe('3/4');
  });
});

describe('leaveRemaining', () => {
  it('adds the days left across leave types', () => {
    expect(leaveRemaining([{ days_remaining: 5 }, { days_remaining: 2.5 }])).toBe(7.5);
  });
  it('is null before the balance loads and 0 for none', () => {
    expect(leaveRemaining(null)).toBeNull();
    expect(leaveRemaining([])).toBe(0);
  });
});
