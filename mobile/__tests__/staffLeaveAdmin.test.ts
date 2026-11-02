import {
  LEAVE_FILTERS, buildApplyPayload, canDecide, decisionPayload, emptyApplyForm, leaveDatesLine, leaveListParams,
  staffLeaveErrorMessage, validateApply,
} from '../services/staffLeave';

describe('leaveListParams', () => {
  it('sends the status and search, and nothing for All', () => {
    expect(leaveListParams('PENDING', ' ali ')).toEqual({ page_size: 9999, status: 'PENDING', search: 'ali' });
    expect(leaveListParams('ALL', '')).toEqual({ page_size: 9999 });
  });

  it('opens on Pending first and ends with All', () => {
    expect(LEAVE_FILTERS[0].value).toBe('PENDING');
    expect(LEAVE_FILTERS[LEAVE_FILTERS.length - 1].value).toBe('ALL');
  });
});

describe('canDecide and decisionPayload', () => {
  it('only a pending application can be approved or rejected', () => {
    expect(canDecide({ status: 'PENDING' })).toBe(true);
    for (const s of ['APPROVED', 'REJECTED', 'CANCELLED'] as const) expect(canDecide({ status: s })).toBe(false);
  });

  it('trims the remarks and sends an empty string when there are none', () => {
    expect(decisionPayload('  ok  ')).toEqual({ admin_remarks: 'ok' });
    expect(decisionPayload('')).toEqual({ admin_remarks: '' });
  });
});

describe('leaveDatesLine', () => {
  it('shows a range with the day count', () => {
    expect(leaveDatesLine({ start_date: '2026-11-10', end_date: '2026-11-12', total_days: 3 })).toBe('2026-11-10 to 2026-11-12  ·  3 days');
  });

  it('shows one date for a single day and works out the days when the server omits them', () => {
    expect(leaveDatesLine({ start_date: '2026-11-10', end_date: '2026-11-10', total_days: 1 })).toBe('2026-11-10  ·  1 day');
    expect(leaveDatesLine({ start_date: '2026-11-10', end_date: '2026-11-11' })).toContain('2 days');
  });
});

describe('apply for a staff member', () => {
  const ok = { staff: 3, policy: 2, start: '2026-11-10', end: '2026-11-11', reason: ' fever ' };

  it('accepts a complete form and trims the reason', () => {
    expect(validateApply(ok)).toBeNull();
    expect(buildApplyPayload(ok)).toEqual({ staff_member: 3, leave_policy: 2, start_date: '2026-11-10', end_date: '2026-11-11', reason: 'fever' });
  });

  it.each([
    [{ ...ok, staff: null }, 'staff member'],
    [{ ...ok, policy: null }, 'type of leave'],
    [{ ...ok, start: '' }, 'dates'],
    [{ ...ok, end: '2026-11-09' }, 'before'],
    [{ ...ok, reason: '  ' }, 'reason'],
  ])('refuses %#', (form, word) => {
    expect(validateApply(form)).toContain(word);
  });

  it('starts empty', () => {
    expect(validateApply(emptyApplyForm())).not.toBeNull();
  });
});

describe('staffLeaveErrorMessage', () => {
  it('shows the server detail or the first field message', () => {
    expect(staffLeaveErrorMessage({ response: { data: { detail: 'Cannot approve leave with status APPROVED.' } } }, 'x')).toBe('Cannot approve leave with status APPROVED.');
    expect(staffLeaveErrorMessage({ response: { data: { end_date: ['End date must be on or after start date.'] } } }, 'x')).toBe('End date must be on or after start date.');
  });

  it('falls back when there is nothing to show', () => {
    expect(staffLeaveErrorMessage(new Error('boom'), 'Could not save.')).toBe('Could not save.');
  });
});
