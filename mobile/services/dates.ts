import { format } from 'date-fns';

// The one way the app writes a date on screen. Screens used to pick their own locale ('en-US' gave
// "Mar 5", 'en-GB' "5 Mar", the phone's default "3/5/2026"), so the same date read three ways.
// date-fns rather than toLocaleDateString, so the phone, the web build and the tests all print the
// same text whatever the device language. Dates sent to the server stay 'YYYY-MM-DD' and never pass through here.
// Each helper returns '' for a missing or unreadable value; the caller picks its own fallback.

type DateInput = string | number | Date | null | undefined;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' is read as a local day: new Date('2026-01-05') is UTC midnight and shows the
// previous day west of UTC. Anything else (a server timestamp) is a real instant.
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    const local = new Date(y, m - 1, d);
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const as = (pattern: string) => (value: DateInput): string => {
  const d = toDate(value);
  return d ? format(d, pattern) : '';
};

/** "26 Nov 2026" */
export const day = as('d MMM yyyy');
/** "26 Nov" */
export const dayShort = as('d MMM');
/** "26 Nov, 10:42 AM" */
export const dayTime = as('d MMM, h:mm a');
/** "Nov 2026" */
export const monthYear = as('MMM yyyy');
/** "November 2026": month headings and pickers, where the month is the whole title. */
export const monthLong = as('MMMM yyyy');
