import {
  attendanceTone, buildLeavePayload, canCancelLeave, emptyLeaveForm, filterLeave, leaveDays, leaveErrorMessage, leaveTone,
  monthRange, resolveMyStaffId, shortTime, sortAttendance, sortLeave, usedPercent, validateLeave,
  type LeaveApplication, type LeaveForm, type StaffAttendanceRecord,
} from '../services/myHr';

const app = (id: number, extra: Partial<LeaveApplication> = {}): LeaveApplication => ({
  id, staff_member: 7, leave_policy: 1, start_date: '2026-10-10', end_date: '2026-10-11', status: 'PENDING', ...extra,
});

describe('leave list', () => {
  it('only pending and approved leave can be cancelled', () => {
    expect(canCancelLeave({ status: 'PENDING' })).toBe(true);
    expect(canCancelLeave({ status: 'APPROVED' })).toBe(true);
    expect(canCancelLeave({ status: 'REJECTED' })).toBe(false);
    expect(canCancelLeave({ status: 'CANCELLED' })).toBe(false);
  });

  it('filters by status and sorts newest first', () => {
    const list = [app(1, { start_date: '2026-09-01' }), app(2, { start_date: '2026-10-20', status: 'APPROVED' }), app(3, { start_date: '2026-10-20' })];
    expect(filterLeave(list, 'APPROVED').map((a) => a.id)).toEqual([2]);
    expect(filterLeave(list, '')).toHaveLength(3);
    expect(sortLeave(list).map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it('colours each status', () => {
    expect(leaveTone('PENDING')).toBe('warning');
    expect(leaveTone('APPROVED')).toBe('success');
    expect(leaveTone('REJECTED')).toBe('error');
    expect(leaveTone('CANCELLED')).toBe('neutral');
  });
});

describe('applying for leave', () => {
  const ok: LeaveForm = { policy: 2, start: '2026-11-02', end: '2026-11-04', reason: ' Family event ' };

  it('counts days with both ends included', () => {
    expect(leaveDays('2026-11-02', '2026-11-04')).toBe(3);
    expect(leaveDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(leaveDays('2026-10-30', '2026-11-02')).toBe(4);
    expect(leaveDays('2026-11-04', '2026-11-02')).toBeNull();
    expect(leaveDays('', '2026-11-02')).toBeNull();
  });

  it('checks each field in order', () => {
    expect(validateLeave(emptyLeaveForm())).toBe('Please choose the type of leave');
    expect(validateLeave({ ...ok, start: '' })).toBe('Please pick the first day');
    expect(validateLeave({ ...ok, end: '' })).toBe('Please pick the last day');
    expect(validateLeave({ ...ok, end: '2026-11-01' })).toBe('The last day cannot be before the first day');
    expect(validateLeave({ ...ok, reason: '   ' })).toBe('Please give a reason');
    expect(validateLeave(ok)).toBeNull();
  });

  it('sends no staff member, because the server fills in the caller', () => {
    const payload = buildLeavePayload(ok);
    expect(payload).toEqual({ leave_policy: 2, start_date: '2026-11-02', end_date: '2026-11-04', reason: 'Family event' });
    expect(payload).not.toHaveProperty('staff_member');
  });

  it('reads the server error the way the web does', () => {
    expect(leaveErrorMessage({ end_date: ['Overlaps existing leave.'] })).toBe('Overlaps existing leave.');
    expect(leaveErrorMessage({ detail: 'No staff profile.' })).toBe('No staff profile.');
    expect(leaveErrorMessage({ non_field_errors: ['Too many days.'] })).toBe('Too many days.');
    expect(leaveErrorMessage(undefined)).toBe('Failed to submit leave application');
  });
});

describe('own staff record and balances', () => {
  it('prefers the record on their applications, then the staff list, then the timetable', () => {
    const staff = [{ id: 1, user: 50 }, { id: 2, user: 60 }];
    expect(resolveMyStaffId({ applications: [{ staff_member: 9 }], staff, userId: 60 })).toBe(9);
    expect(resolveMyStaffId({ applications: [], staff, userId: 60 })).toBe(2);
    expect(resolveMyStaffId({ applications: [], staff, userId: 99, timetableTeacherId: 4 })).toBe(4);
    expect(resolveMyStaffId({ applications: [], staff: [], userId: undefined })).toBeNull();
  });

  it('shows how much of the allowance is used, capped at 100', () => {
    expect(usedPercent({ days_allowed: 10, days_used: 4 })).toBe(40);
    expect(usedPercent({ days_allowed: 10, days_used: 14 })).toBe(100);
    expect(usedPercent({ days_allowed: 0, days_used: 3 })).toBe(0);
  });
});

describe('my attendance', () => {
  const rec = (id: number, date: string): StaffAttendanceRecord => ({ id, date, status: 'PRESENT' });

  it('covers the whole month, stopping at today for the current one', () => {
    expect(monthRange(2026, 8, '2026-10-28')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthRange(2026, 9, '2026-10-28')).toEqual({ start: '2026-10-01', end: '2026-10-28' });
    expect(monthRange(2028, 1, '2028-12-01')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('lists the newest day first', () => {
    expect(sortAttendance([rec(1, '2026-10-01'), rec(2, '2026-10-03'), rec(3, '2026-10-02')]).map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('colours each status and trims times', () => {
    expect(attendanceTone('PRESENT')).toBe('success');
    expect(attendanceTone('ABSENT')).toBe('error');
    expect(attendanceTone('ON_LEAVE')).toBe('info');
    expect(attendanceTone('LATE')).toBe('warning');
    expect(shortTime('08:05:30')).toBe('08:05');
    expect(shortTime(null)).toBe('—');
  });
});
