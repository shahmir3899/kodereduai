// The school's own clock (School.timezone, Asia/Karachi unless the school says otherwise).
// `new Date().toISOString()` is UTC and getFullYear()/getMonth() follow the phone, so a school
// opened at 02:00 in Pakistan would read yesterday's date. AuthContext calls setSchoolTimeZone()
// whenever the active school changes, so plain helpers can read "today" without a hook.

export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Karachi';

let currentZone = DEFAULT_SCHOOL_TIME_ZONE;

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function setSchoolTimeZone(zone?: string | null): void {
  currentZone = zone && isValidZone(zone) ? zone : DEFAULT_SCHOOL_TIME_ZONE;
}

export function getSchoolTimeZone(): string {
  return currentZone;
}

export interface YMD { year: number; month: number; day: number }

function partsOf(date: Date, zone: string): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

const pad = (n: number) => String(n).padStart(2, '0');

// 'YYYY-MM-DD' for an instant, as read on the school's calendar.
export function schoolDateStr(date: Date = new Date(), zone: string = currentZone): string {
  const { year, month, day } = partsOf(date, zone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function schoolToday(): string {
  return schoolDateStr(new Date());
}

// { year, month (1-12), day } on the school's calendar right now.
export function schoolYMD(): YMD {
  return partsOf(new Date(), currentZone);
}
