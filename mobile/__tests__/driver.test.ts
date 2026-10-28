import {
  activeJourneyOf, boardingCounts, changedRecords, durationLabel, groupByStop, isToday, journeyStateFromHistory,
  markAll, nextBoarding, sortStops, statusOf, type BoardingStudent, type JourneyRow,
} from '../services/driver';

const stu = (id: number, stop: string | null, order: number | null, status: BoardingStudent['boarding_status'] = null): BoardingStudent => ({
  student_id: id, name: `S${id}`, stop_name: stop, stop_order: order, boarding_status: status,
});

describe('boarding', () => {
  const students = [stu(1, 'B', 2), stu(2, 'A', 1, 'BOARDED'), stu(3, 'A', 1), stu(4, null, null)];

  it('cycles unmarked -> boarded -> not boarded -> absent -> unmarked', () => {
    expect(nextBoarding(null)).toBe('BOARDED');
    expect(nextBoarding('BOARDED')).toBe('NOT_BOARDED');
    expect(nextBoarding('NOT_BOARDED')).toBe('ABSENT');
    expect(nextBoarding('ABSENT')).toBeNull();
    expect(nextBoarding(undefined)).toBe('BOARDED');
  });

  it('shows the draft over the saved status', () => {
    expect(statusOf(students[1], {})).toBe('BOARDED');
    expect(statusOf(students[1], { 2: 'ABSENT' })).toBe('ABSENT');
    expect(statusOf(students[1], { 2: null })).toBeNull();
  });

  it('sends only what changed, and nothing for a student set back to unmarked', () => {
    expect(changedRecords(students, { 1: 'BOARDED', 2: 'BOARDED', 3: null })).toEqual([{ student_id: 1, boarding_status: 'BOARDED' }]);
    expect(changedRecords(students, { 2: 'ABSENT' })).toEqual([{ student_id: 2, boarding_status: 'ABSENT' }]);
    expect(changedRecords(students, {})).toEqual([]);
  });

  it('counts by status including unmarked', () => {
    expect(boardingCounts(students, { 1: 'ABSENT' })).toEqual({ BOARDED: 1, NOT_BOARDED: 0, ABSENT: 1, unmarked: 2 });
  });

  it('groups by stop order with unassigned last', () => {
    expect(groupByStop(students).map((g) => [g.title, g.students.length])).toEqual([['A', 2], ['B', 1], ['No stop', 1]]);
  });

  it('marks only the unmarked ones when marking all', () => {
    const next = markAll(students, 'BOARDED', { 3: 'ABSENT' });
    expect(next).toEqual({ 3: 'ABSENT', 1: 'BOARDED', 4: 'BOARDED' });
  });
});

describe('journey history', () => {
  const rows: JourneyRow[] = [
    { id: 5, status: 'ACTIVE', journey_type: 'TO_SCHOOL', started_at: '2026-10-28T07:00:00Z', route: 2 },
    { id: 4, status: 'COMPLETED', journey_type: 'FROM_SCHOOL', started_at: '2026-10-27T13:00:00Z', ended_at: '2026-10-27T14:30:00Z', route: 2 },
  ];
  it('reports what the server says about a remembered journey', () => {
    expect(journeyStateFromHistory(rows, 5)).toBe('ACTIVE');
    expect(journeyStateFromHistory(rows, 4)).toBe('ENDED');
    expect(journeyStateFromHistory(rows, 99)).toBe('UNKNOWN');
    expect(journeyStateFromHistory(undefined, 5)).toBe('UNKNOWN');
  });
  it('finds the active journey on a route', () => {
    expect(activeJourneyOf(rows, 2)?.id).toBe(5);
    expect(activeJourneyOf(rows, 3)).toBeNull();
    expect(activeJourneyOf(rows, null)?.id).toBe(5);
  });
  it('labels a duration only once a journey has ended', () => {
    expect(durationLabel('2026-10-27T13:00:00Z', '2026-10-27T14:30:00Z')).toBe('1h 30m');
    expect(durationLabel('2026-10-27T13:00:00Z', '2026-10-27T13:20:00Z')).toBe('20m');
    expect(durationLabel('2026-10-27T13:00:00Z', null)).toBe('');
  });
  it('recognises today', () => {
    const now = new Date(2026, 9, 28, 12, 0);
    expect(isToday(new Date(2026, 9, 28, 7, 0).toISOString(), now)).toBe(true);
    expect(isToday(new Date(2026, 9, 27, 7, 0).toISOString(), now)).toBe(false);
  });
});

describe('stops', () => {
  it('orders by stop order without changing the input', () => {
    const stops = [{ id: 1, name: 'b', stop_order: 2, pickup_time: null, drop_time: null }, { id: 2, name: 'a', stop_order: 1, pickup_time: null, drop_time: null }];
    expect(sortStops(stops).map((s) => s.id)).toEqual([2, 1]);
    expect(stops[0].id).toBe(1);
  });
});
