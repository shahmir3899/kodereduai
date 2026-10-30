import { setSchoolTimeZone, schoolToday, schoolDateStr, schoolYMD, getSchoolTimeZone, DEFAULT_SCHOOL_TIME_ZONE } from '../services/schoolTime';
import { todayString } from '../services/attendanceEntry';

// 21:00 UTC on 29 Oct = 02:00 on 30 Oct in Karachi, still the evening of 29 Oct in New York
const INSTANT = new Date('2026-10-29T21:00:00Z');

afterEach(() => {
  jest.useRealTimers();
  setSchoolTimeZone(undefined);
});

describe('schoolTime', () => {
  it('defaults to Pakistan time and ignores an unknown zone', () => {
    setSchoolTimeZone('Mars/Olympus');
    expect(getSchoolTimeZone()).toBe(DEFAULT_SCHOOL_TIME_ZONE);
  });

  it("reads today on the school's calendar, not the phone's", () => {
    jest.useFakeTimers().setSystemTime(INSTANT);
    expect(schoolToday()).toBe('2026-10-30');
    expect(todayString()).toBe('2026-10-30');
    setSchoolTimeZone('America/New_York');
    expect(schoolToday()).toBe('2026-10-29');
    expect(todayString()).toBe('2026-10-29');
    expect(schoolYMD()).toEqual({ year: 2026, month: 10, day: 29 });
  });

  it('formats a given instant in a given zone', () => {
    expect(schoolDateStr(INSTANT, 'Asia/Karachi')).toBe('2026-10-30');
  });
});
