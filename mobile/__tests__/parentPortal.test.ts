import {
  apiErrorMessage, canCancelLeave, childName, childPeriods, latestPoint, leaveBody, leaveDays, mapUrl,
  monthSummary, registerBody, registerProblem, validateLeave, type LeaveForm, type RegisterForm,
} from '../services/parentPortal';
import { entriesForDay } from '../services/teacher';
import { recipientKey, recipientLabel } from '../services/messaging';

describe('monthSummary', () => {
  it('counts the rows and treats leave as attended', () => {
    const s = monthSummary([
      { id: 1, date: '2026-10-01', status: 'PRESENT' }, { id: 2, date: '2026-10-02', status: 'PRESENT' },
      { id: 3, date: '2026-10-03', status: 'ABSENT' }, { id: 4, date: '2026-10-04', status: 'LEAVE' },
    ]);
    expect(s).toMatchObject({ present: 2, absent: 1, leave: 1, late: 0, total_days: 4, rate: 75 });
  });
  it('is zero for a month with no records', () => expect(monthSummary([])).toMatchObject({ total_days: 0, rate: 0 }));
});

describe('childPeriods', () => {
  const rows = [
    { id: 1, day: 'MON', slot_name: 'P2', start_time: '09:00:00', end_time: '09:40:00', subject: 'Math', teacher: 'Ms Ali' },
    { id: 2, day: 'MON', slot_name: 'P1', start_time: '08:00:00', end_time: '08:40:00', subject: 'Urdu', teacher: null },
  ];
  it('orders by start time, as the endpoint has no slot order', () => {
    expect(entriesForDay(childPeriods(rows), 'MON').map((p) => p.subject_name)).toEqual(['Urdu', 'Math']);
  });
  it('is empty for nothing', () => expect(childPeriods(undefined)).toEqual([]));
});

describe('leave', () => {
  const ok: LeaveForm = { student: 5, start: '2026-11-02', end: '2026-11-04', reason: ' Fever ', link: '' };
  it('accepts a good form and builds the API body', () => {
    expect(validateLeave(ok)).toBeNull();
    expect(leaveBody(ok)).toEqual({ student: 5, start_date: '2026-11-02', end_date: '2026-11-04', reason: 'Fever' });
    expect(leaveBody({ ...ok, link: ' https://x.com/note.pdf ' })).toMatchObject({ document_url: 'https://x.com/note.pdf' });
  });
  it('rejects each missing or wrong part', () => {
    expect(validateLeave({ ...ok, student: null })).toMatch(/child/);
    expect(validateLeave({ ...ok, start: '' })).toMatch(/first and last/);
    expect(validateLeave({ ...ok, end: '2026-11-01' })).toMatch(/before/);
    expect(validateLeave({ ...ok, reason: '  ' })).toMatch(/reason/);
    expect(validateLeave({ ...ok, link: 'note.pdf' })).toMatch(/http/);
  });
  it('counts days inclusively', () => {
    expect(leaveDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(leaveDays('2026-11-02', '2026-11-04')).toBe(3);
    expect(leaveDays('2026-11-04', '2026-11-02')).toBe(0);
  });
  it('only a pending request can be withdrawn', () => {
    expect(canCancelLeave({ status: 'PENDING' })).toBe(true);
    expect(canCancelLeave({ status: 'APPROVED' })).toBe(false);
    expect(canCancelLeave({ status: 'CANCELLED' })).toBe(false);
  });
});

describe('bus tracking', () => {
  const pts = [
    { id: 1, latitude: '31.50', longitude: '74.30', timestamp: '2026-10-28T07:00:00Z' },
    { id: 2, latitude: '31.52', longitude: '74.32', timestamp: '2026-10-28T07:10:00Z' },
  ];
  it('picks the newest point whatever the order', () => {
    expect(latestPoint(pts)?.id).toBe(2);
    expect(latestPoint([...pts].reverse())?.id).toBe(2);
    expect(latestPoint([])).toBeNull();
    expect(latestPoint(undefined)).toBeNull();
  });
  it('builds a maps link only when there is a position', () => {
    expect(mapUrl(pts[1])).toContain('query=31.52,74.32');
    expect(mapUrl(null)).toBeNull();
  });
});

describe('registration', () => {
  const f: RegisterForm = { username: ' mum ', email: '', password: 'abcdefgh', confirmPassword: 'abcdefgh', phone: '0300', invite_code: ' CODE ' };
  it('sends confirm_password and phone, which the API requires', () => {
    expect(registerBody(f)).toEqual({ invite_code: 'CODE', username: 'mum', password: 'abcdefgh', confirm_password: 'abcdefgh', phone: '0300' });
    expect(registerBody({ ...f, email: ' a@b.pk ' })).toMatchObject({ email: 'a@b.pk' });
  });
  it('flags problems before calling the API', () => {
    expect(registerProblem(f)).toBeNull();
    expect(registerProblem({ ...f, invite_code: '' })).toMatch(/invite/);
    expect(registerProblem({ ...f, phone: '' })).toMatch(/phone/);
    expect(registerProblem({ ...f, password: 'short', confirmPassword: 'short' })).toMatch(/8 characters/);
    expect(registerProblem({ ...f, confirmPassword: 'other123' })).toMatch(/do not match/);
  });
});

describe('apiErrorMessage', () => {
  it('reads detail, error, then the first field message', () => {
    expect(apiErrorMessage({ detail: 'No.' }, 'x')).toBe('No.');
    expect(apiErrorMessage({ error: 'Bad.' }, 'x')).toBe('Bad.');
    expect(apiErrorMessage({ invite_code: ['Invalid invite code.'] }, 'x')).toBe('Invalid invite code.');
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
  });
});

describe('names and recipients', () => {
  it('names a child with their class', () => {
    expect(childName({ student_name: 'Ali', class_name: '5-A' })).toBe('Ali (5-A)');
    expect(childName({ student_name: 'Ali' })).toBe('Ali');
  });
  it('keeps a teacher separate per child', () => {
    const a = { id: 9, student_id: 1, name: 'Ms Ali', role: 'TEACHER', student_name: 'Sara' };
    const b = { ...a, student_id: 2, student_name: 'Zain' };
    expect(recipientKey(a)).not.toBe(recipientKey(b));
    expect(recipientKey({ id: 3 })).toBe('3:');
    expect(recipientLabel(a)).toBe('Ms Ali (Teacher) — Sara');
  });
});
