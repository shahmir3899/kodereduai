import {
  buildModuleCards, currentTermName, goingColdCount, visiblePredictors,
  type AttendanceSection, type DashboardData,
} from '../services/adminDashboard';

const att = (over: Partial<AttendanceSection> = {}): AttendanceSection => ({
  is_off_day: false, total_students: 200, present_count: 180, absent_count: 10, leave_count: 4, not_marked_count: 6, ...over,
});

describe('module overview', () => {
  const on = () => true;
  const base = (data: DashboardData, extra: Partial<Parameters<typeof buildModuleCards>[0]> = {}) =>
    buildModuleCards({ isModuleEnabled: on, data, upcomingExams: 3, routes: {}, ...extra });
  const card = (cards: ReturnType<typeof buildModuleCards>, key: string) => cards.find((c) => c.key === key);

  it('colours attendance by rate and shows N/A on an off day', () => {
    expect(card(base({ attendance: att() }), 'attendance')).toMatchObject({ metric: '90%', status: 'green' });
    expect(card(base({ attendance: att({ present_count: 140 }) }), 'attendance')).toMatchObject({ metric: '70%', status: 'red' });
    expect(card(base({ attendance: att({ is_off_day: true }) }), 'attendance')).toMatchObject({ metric: 'N/A', metricLabel: 'off day', status: 'gray' });
  });

  it('shows a dash on grey, never a made-up number, when a section failed', () => {
    const cards = base({ attendance: null, finance: null, hr: null, admissions_new_count: null, library: null, inventory: null });
    expect(card(cards, 'attendance')).toMatchObject({ metric: '—', status: 'gray' });
    expect(card(cards, 'finance')).toMatchObject({ metric: '—', status: 'gray' });
    expect(card(cards, 'admissions')).toMatchObject({ metric: '—', status: 'gray' });
    expect(card(cards, 'library')).toMatchObject({ metric: '—', status: 'gray' });
    expect(card(cards, 'inventory')).toMatchObject({ metric: '—', status: 'gray' });
  });

  it('leaves out module sections the server did not send, and modules that are off', () => {
    const cards = base({ attendance: att() });
    expect(card(cards, 'transport')).toBeUndefined();
    expect(card(cards, 'hostel')).toBeUndefined();
    const off = base({ attendance: att() }, { isModuleEnabled: (k) => k !== 'attendance' });
    expect(card(off, 'attendance')).toBeUndefined();
  });

  it('flags overdue books, low stock and new enquiries', () => {
    const cards = base({ library: { total_overdue: 4, total_books: 900 }, inventory: { low_stock_count: 2, total_items: 50 }, admissions_new_count: 5 });
    expect(card(cards, 'library')).toMatchObject({ metric: 4, metricLabel: 'overdue', status: 'yellow' });
    expect(card(cards, 'inventory')).toMatchObject({ metric: 2, metricLabel: 'low stock', status: 'red' });
    expect(card(cards, 'admissions')).toMatchObject({ metric: 5, status: 'yellow' });
    const calm = base({ library: { total_overdue: 0, total_books: 900 }, inventory: { low_stock_count: 0, total_items: 50 }, admissions_new_count: 0 });
    expect(card(calm, 'library')).toMatchObject({ metric: 900, metricLabel: 'books', status: 'green' });
    expect(card(calm, 'inventory')).toMatchObject({ metric: 50, metricLabel: 'items', status: 'green' });
    expect(card(calm, 'admissions')).toMatchObject({ metric: 0, status: 'green' });
  });

  it('computes hostel occupancy and tolerates zero capacity', () => {
    expect(card(base({ hostel: { total_capacity: 80, current_occupancy: 60 } }), 'hostel')?.metric).toBe('75%');
    expect(card(base({ hostel: { total_capacity: 0, current_occupancy: 0 } }), 'hostel')?.metric).toBe('—');
  });

  it('shows the upcoming exam count, or a dash while it is unknown', () => {
    expect(card(base({}), 'exams')?.metric).toBe(3);
    expect(card(base({}, { upcomingExams: null }), 'exams')?.metric).toBe('—');
  });
});

describe('term and predictors', () => {
  it('finds the term that contains today', () => {
    const terms = [
      { name: 'Term 1', start_date: '2026-04-01', end_date: '2026-07-31' },
      { name: 'Term 2', start_date: '2026-09-01', end_date: '2026-12-20' },
    ];
    expect(currentTermName(terms, '2026-11-03')).toBe('Term 2');
    expect(currentTermName(terms, '2026-08-15')).toBeNull();
  });

  it('counts only LOW likelihood leads as going cold', () => {
    expect(goingColdCount({ enquiries: [{ likelihood: 'LOW' }, { likelihood: 'HIGH' }, { likelihood: 'LOW' }] })).toBe(2);
    expect(goingColdCount(undefined)).toBe(0);
  });

  it('drops predictor rows with nothing flagged', () => {
    const rows = visiblePredictors([{ key: 'a', label: 'A', count: 0 }, { key: 'b', label: 'B', count: 3 }]);
    expect(rows.map((r) => r.key)).toEqual(['b']);
  });
});
