// Pure logic for the draggable year bar on the Terms screen; port of frontend/src/components/timeline/timelineMath
// (gaps, overlaps, month boxes) plus the drag rules of YearTimeline. Dates are ISO "YYYY-MM-DD" strings in UTC.

import { addDays, dayNumber, spansOverlap, type ManagedYear } from './academicSessions';

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Span { start_date: string; end_date: string }
export type Edge = 'start' | 'end';
type YearSpan = Pick<ManagedYear, 'start_date' | 'end_date'>;

export const TERM_COLOURS = ['#1e40af', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9'];

export const daysInYear = (y: YearSpan) => dayNumber(y.end_date) - dayNumber(y.start_date) + 1;
// Both ends count: a term from the 1st to the 3rd is three days.
export const termDays = (t: Span) => dayNumber(t.end_date) - dayNumber(t.start_date) + 1;

// Ids of every term that overlaps at least one other.
export function findOverlaps(items: Array<Span & { id: number }>): Set<number> {
  const clashing = new Set<number>();
  items.forEach((a, i) => items.slice(i + 1).forEach((b) => {
    if (spansOverlap(a, b)) { clashing.add(a.id); clashing.add(b.id); }
  }));
  return clashing;
}

// Stretches of the year that no term covers; a term starting the day after another ends leaves no gap.
export function findGaps(items: Span[], rangeStart: string, rangeEnd: string): Array<Span & { days: number }> {
  const sorted = [...items].filter((i) => i.start_date && i.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const gaps: Array<Span & { days: number }> = [];
  let covered = dayNumber(rangeStart) - 1;
  const push = (from: number, to: number) => {
    if (to >= from) {
      gaps.push({ start_date: new Date(from * DAY_MS).toISOString().slice(0, 10), end_date: new Date(to * DAY_MS).toISOString().slice(0, 10), days: to - from + 1 });
    }
  };
  sorted.forEach((item) => {
    push(covered + 1, dayNumber(item.start_date) - 1);
    covered = Math.max(covered, dayNumber(item.end_date));
  });
  push(covered + 1, dayNumber(rangeEnd));
  return gaps;
}

// One entry per calendar month the year touches, clipped to the year, for the faint month boxes.
export function monthSpans(from: string, to: string): Array<Span & { key: string; label: string }> {
  const spans: Array<Span & { key: string; label: string }> = [];
  let [y, m] = from.split('-').map(Number);
  const [endY, endM] = to.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    spans.push({ key: first, label: MONTHS[m - 1], start_date: first < from ? from : first, end_date: last > to ? to : last });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return spans;
}

// The bar draws every day as an equal slice. A start handle sits on the left edge of its day and an end
// handle on the right edge, so a drag to a position picks the day under that edge.
export function dateAtFraction(frac: number, year: YearSpan, edge: Edge): string {
  const total = daysInYear(year);
  const f = Math.min(1, Math.max(0, frac));
  // The epsilon keeps an exact edge (day 3 of 10 is 0.3) from rounding to the next day.
  const index = edge === 'start' ? Math.floor(f * total + 1e-9) : Math.ceil(f * total - 1e-9) - 1;
  return addDays(year.start_date, Math.min(total - 1, Math.max(0, index)));
}

// Moves one edge of a term to `iso`. Edges snap to whole days, stay inside the year and never cross:
// the end is always after the start.
export function moveEdge(range: Span, edge: Edge, iso: string, year: YearSpan): Span {
  if (edge === 'start') {
    const latest = addDays(range.end_date, -1);
    const start = iso < year.start_date ? year.start_date : iso > latest ? latest : iso;
    return { start_date: start, end_date: range.end_date };
  }
  const earliest = addDays(range.start_date, 1);
  const end = iso > year.end_date ? year.end_date : iso < earliest ? earliest : iso;
  return { start_date: range.start_date, end_date: end };
}

export const stepEdge = (range: Span, edge: Edge, days: number, year: YearSpan): Span =>
  moveEdge(range, edge, addDays(edge === 'start' ? range.start_date : range.end_date, days), year);

export function coverageSummary(year: YearSpan, terms: Array<Span & { id: number }>): string {
  const gapDays = findGaps(terms, year.start_date, year.end_date).reduce((sum, g) => sum + g.days, 0);
  return [
    `${terms.length} term${terms.length === 1 ? '' : 's'}`,
    findOverlaps(terms).size ? 'terms overlap' : null,
    gapDays ? `${gapDays} day${gapDays === 1 ? '' : 's'} not covered by a term` : terms.length ? 'every day covered' : null,
  ].filter(Boolean).join(' · ');
}
