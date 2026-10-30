import { attendanceSegments, dayHero, feeBreakdown, money } from '../services/dashboardView';
import { shouldShowYearChip, unreadLabel } from '../services/headerView';

const att = { total_students: 200, present_count: 150, leave_count: 10, absent_count: 20, not_marked_count: 20 };

describe('attendanceSegments', () => {
  it('gives all four states with their share of the class', () => {
    const s = attendanceSegments(att as never);
    expect(s.map((x) => [x.key, x.count, x.pct])).toEqual([
      ['present_count', 150, 75], ['leave_count', 10, 5], ['absent_count', 20, 10], ['not_marked_count', 20, 10],
    ]);
  });

  it('never divides by zero and treats a missing field as 0', () => {
    expect(attendanceSegments({ total_students: 0 } as never).every((x) => x.pct === 0 && x.count === 0)).toBe(true);
    expect(attendanceSegments({ total_students: 10, present_count: 5 } as never)[1].count).toBe(0);
    expect(attendanceSegments(null).every((x) => Number.isFinite(x.pct))).toBe(true);
  });
});

describe('feeBreakdown', () => {
  it('computes the collected share and keeps the counts', () => {
    const b = feeBreakdown({ total_due: '1000', total_collected: '250', total_pending: '750', unpaid_count: 3, partial_count: 2, paid_count: 5 });
    expect(b).toEqual({ collected: 250, due: 1000, pending: 750, paid: 5, partial: 2, unpaid: 3, rate: 25 });
  });

  it('has no rate when nothing is due, and none for a missing section', () => {
    expect(feeBreakdown({ total_due: 0, total_collected: 0, total_pending: 0, unpaid_count: 0, partial_count: 0 })?.rate).toBeNull();
    expect(feeBreakdown(null)).toBeNull();
  });

  it('caps the rate at 100 when more was collected than due', () => {
    expect(feeBreakdown({ total_due: 100, total_collected: 150, total_pending: 0, unpaid_count: 0, partial_count: 0 })?.rate).toBe(100);
  });
});

describe('dayHero', () => {
  it('says no school on an off day', () => {
    expect(dayHero({ isOffDay: true, offTypes: ['Sunday'], rate: null, present: 0, total: 0 })).toMatchObject({ tone: 'gray', title: 'No school today', subtitle: 'Sunday' });
  });
  it('asks to mark attendance when there is no rate yet', () => {
    expect(dayHero({ isOffDay: false, rate: null, present: 0, total: 0 }).title).toBe('Attendance not marked yet');
  });
  it('shows the rate, green from 90', () => {
    expect(dayHero({ isOffDay: false, rate: 92, present: 184, total: 200 })).toMatchObject({ tone: 'green', title: '92% present', subtitle: '184 of 200 students' });
    expect(dayHero({ isOffDay: false, rate: 80, present: 160, total: 200 }).tone).toBe('blue');
  });
});

describe('money', () => {
  it('rounds and groups', () => {
    expect(money('1234.6')).toBe('PKR 1,235');
    expect(money(undefined)).toBe('PKR 0');
  });
});

describe('header rules', () => {
  it('shows the year only to the staff-type shells', () => {
    expect(['admin', 'teacher', 'manager', 'accountant', 'staff'].every((p) => shouldShowYearChip(p as never))).toBe(true);
    expect(['parent', 'student', 'driver'].some((p) => shouldShowYearChip(p as never))).toBe(false);
  });
  it('labels the unread badge', () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(-2)).toBeNull();
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(100)).toBe('99+');
  });
});
