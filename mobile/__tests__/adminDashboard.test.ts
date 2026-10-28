import {
  attendanceRate, buildAttentionItems, collectionRate, staffPresentPct, stepDate,
  type AttendanceSection, type DashboardData, type HrSection,
} from '../services/adminDashboard';

const att = (over: Partial<AttendanceSection> = {}): AttendanceSection => ({
  is_off_day: false, total_students: 200, present_count: 180, absent_count: 10, leave_count: 4, not_marked_count: 6, ...over,
});
const hr = (over: Partial<HrSection> = {}): HrSection => ({
  active_staff: 20, pending_leave_applications: 3, pending_payroll_approvals: 2, staff_on_leave_today: 1,
  attendance_present_today: 15, attendance_marked_today: 18, ...over,
});

describe('rates', () => {
  it('rounds the attendance rate and caps it at 100', () => {
    expect(attendanceRate(att())).toBe(90);
    expect(attendanceRate(att({ present_count: 250 }))).toBe(100);
  });

  it('has no attendance rate on an OFF day, with no students, or when the section failed', () => {
    expect(attendanceRate(att({ is_off_day: true }))).toBeNull();
    expect(attendanceRate(att({ total_students: 0 }))).toBeNull();
    expect(attendanceRate(null)).toBeNull();
  });

  it('computes staff present against active staff', () => {
    expect(staffPresentPct(hr(), false)).toBe(75);
    expect(staffPresentPct(hr(), true)).toBeNull();
    expect(staffPresentPct(hr({ active_staff: 0 }), false)).toBeNull();
  });

  it('computes the collection rate from decimal strings', () => {
    const f = { total_due: '10000.00', total_collected: '2500.00', total_pending: '7500.00', unpaid_count: 4, partial_count: 1 };
    expect(collectionRate(f)).toBe(25);
    expect(collectionRate({ ...f, total_due: 0 })).toBeNull();
    expect(collectionRate(undefined)).toBeNull();
  });
});

describe('stepDate', () => {
  it('steps by days across month ends', () => {
    expect(stepDate('2026-10-01', -1, '2026-10-27')).toBe('2026-09-30');
    expect(stepDate('2026-10-26', 1, '2026-10-27')).toBe('2026-10-27');
  });

  it('never goes past today', () => {
    expect(stepDate('2026-10-27', 1, '2026-10-27')).toBe('2026-10-27');
  });
});

describe('buildAttentionItems', () => {
  const data: DashboardData = {
    attendance: att(),
    hr: hr(),
    finance: { total_due: 100, total_collected: 40, total_pending: 60, unpaid_count: 5, partial_count: 2 },
    admissions_new_count: 7,
  };
  const routes = { attendance: '/a', unpaid: '/f', leave: '/l' };
  const on = () => true;
  const keys = (items: { key: string }[]) => items.map((i) => i.key);

  it('lists the to-dos worst first and keeps the order within a tone', () => {
    const items = buildAttentionItems({ isModuleEnabled: on, data, isToday: true, routes });
    expect(keys(items)).toEqual(['att', 'unpaid', 'partial', 'leave', 'payroll', 'staffatt', 'enq']);
  });

  it('only links to screens that exist', () => {
    const items = buildAttentionItems({ isModuleEnabled: on, data, isToday: true, routes });
    expect(items.find((i) => i.key === 'att')?.href).toBe('/a');
    expect(items.find((i) => i.key === 'payroll')?.href).toBeUndefined();
  });

  it('drops the unmarked to-dos for a past day or an OFF day', () => {
    const past = buildAttentionItems({ isModuleEnabled: on, data, isToday: false, routes });
    expect(keys(past)).not.toContain('att');
    expect(keys(past)).not.toContain('staffatt');
    const off = buildAttentionItems({ isModuleEnabled: on, data: { ...data, attendance: att({ is_off_day: true }) }, isToday: true, routes });
    expect(keys(off)).not.toContain('att');
  });

  it('skips modules that are off and sections that failed to load', () => {
    const items = buildAttentionItems({ isModuleEnabled: (k) => k === 'hr', data: { ...data, hr: null }, isToday: true, routes });
    expect(items).toEqual([]);
  });

  it('omits zero counts', () => {
    const items = buildAttentionItems({ isModuleEnabled: on, data: { attendance: att({ not_marked_count: 0 }) }, isToday: true, routes });
    expect(items).toEqual([]);
  });
});
