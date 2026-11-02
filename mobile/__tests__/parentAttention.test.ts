import { attentionItems, daysUntil, type ChildOverview } from '../services/parentPortal';

const NOW = new Date(2026, 10, 2, 15, 0); // 2 Nov 2026, afternoon
const overview = (over: Partial<ChildOverview> = {}): ChildOverview => ({
  student_id: 1, student_name: 'Demo Ali', class_name: 'Grade 1', roll_number: '1', school_name: 'S',
  attendance_summary: { total_days: 10, present: 9, absent: 1, leave: 0, attendance_rate: 90, today: 'PRESENT', recent: [] },
  fee_summary: { total_due: 0, total_paid: 0, outstanding: 0, overdue_amount: 0, unpaid_items: 0 },
  latest_exam: null, previous_exam: null, next_exam: null,
  today: { date: '2026-11-02', is_off_day: false, off_day_types: [] }, pending_leave_count: 0, ...over,
});

describe('daysUntil', () => {
  it('counts calendar days from today', () => {
    expect(daysUntil('2026-11-02', NOW)).toBe(0);
    expect(daysUntil('2026-11-03', NOW)).toBe(1);
    expect(daysUntil('2026-10-30', NOW)).toBe(-3);
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe('attentionItems', () => {
  it('is empty when all is well or nothing has loaded', () => {
    expect(attentionItems([{ studentId: 1, overview: overview() }], { now: NOW })).toEqual([]);
    expect(attentionItems([{ studentId: 1, overview: undefined }], { now: NOW })).toEqual([]);
  });

  it('flags a child marked absent today, but not on a closed day', () => {
    const absent = overview({ attendance_summary: { ...overview().attendance_summary, today: 'ABSENT' } });
    expect(attentionItems([{ studentId: 1, overview: absent }], { now: NOW })[0]).toMatchObject({ tone: 'red', href: '/(parent)/children/1/attendance', label: 'Demo was marked absent today' });
    const closed = overview({ attendance_summary: absent.attendance_summary, today: { date: 'x', is_off_day: true, off_day_types: ['HOLIDAY'] } });
    expect(attentionItems([{ studentId: 1, overview: closed }], { now: NOW })).toEqual([]);
  });

  it('makes outstanding fees amber, and red when some are overdue', () => {
    const owed = overview({ fee_summary: { ...overview().fee_summary, outstanding: '8500', overdue_amount: 0 } });
    const late = overview({ fee_summary: { ...overview().fee_summary, outstanding: '8500', overdue_amount: '3000' } });
    const a = attentionItems([{ studentId: 1, overview: owed }], { now: NOW })[0];
    const b = attentionItems([{ studentId: 1, overview: late }], { now: NOW })[0];
    expect(a.tone).toBe('amber');
    expect(b.tone).toBe('red');
    expect(b.label).toContain('(some overdue)');
  });

  it('mentions an exam within a week only', () => {
    const next = (date: string) => overview({ next_exam: { exam_name: 'T', subject_name: 'Maths', exam_date: date } });
    const label = (date: string) => attentionItems([{ studentId: 1, overview: next(date) }], { now: NOW })[0]?.label;
    expect(label('2026-11-02')).toBe('Demo: Maths exam today');
    expect(label('2026-11-03')).toBe('Demo: Maths exam tomorrow');
    expect(label('2026-11-09')).toBe('Demo: Maths exam in 7 days');
    expect(label('2026-11-10')).toBeUndefined();
    expect(label('2026-11-01')).toBeUndefined();
  });

  it('totals leave across children, adds unread messages, and sorts red first', () => {
    const a = overview({ pending_leave_count: 1 });
    const b = overview({ student_id: 2, pending_leave_count: 2, attendance_summary: { ...overview().attendance_summary, today: 'ABSENT' } });
    const items = attentionItems([{ studentId: 1, overview: a }, { studentId: 2, overview: b }], { unreadMessages: 1, now: NOW });
    expect(items.map((i) => i.key)).toEqual(['absent-2', 'leave', 'messages']);
    expect(items[1].label).toBe('3 leave requests awaiting approval');
    expect(items[2].label).toBe('1 unread message');
  });
});
