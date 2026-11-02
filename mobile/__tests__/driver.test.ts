import {
  activeJourneyOf, durationLabel, isToday, journeyStateFromHistory, sortStops, type JourneyRow,
} from '../services/driver';

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
