import type { Tile } from '../components/dashboard/StatTiles';

// Most figures fit in one row of the Home banner card; four go in two rows, more spill into the
// tile grid under the banner, so no number is shown twice.
export const HERO_MAX = 4;

export function splitTiles(tiles: Tile[], max = 3): { hero: Tile[]; rest: Tile[] } {
  return { hero: tiles.slice(0, max), rest: tiles.slice(max) };
}

// "Good morning" until noon, "Good afternoon" until 5 pm, then "Good evening".
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Percent tone used by every role's attendance-style figure: 85+ good, 70+ warn, below bad.
export function pctTone(pct: number | null | undefined): Tile['tone'] {
  if (pct == null) return undefined;
  return pct >= 85 ? 'good' : pct >= 70 ? 'warn' : 'bad';
}

// A parent's banner figures across all linked children: the fees still owed (sum of outstanding)
// and the average attendance rate. Null while no child's overview has loaded, so the card shows a
// dash rather than a made-up 0.
export function parentFigures(overviews: Array<{ attendance_summary?: { attendance_rate: number | null }; fee_summary?: { outstanding: string | number } } | undefined>): { feesDue: number | null; attendance: number | null } {
  const loaded = overviews.filter((o): o is NonNullable<typeof o> => !!o);
  if (loaded.length === 0) return { feesDue: null, attendance: null };
  const feesDue = loaded.reduce((sum, o) => sum + (Number(o.fee_summary?.outstanding) || 0), 0);
  const rates = loaded.map((o) => o.attendance_summary?.attendance_rate).filter((r): r is number => typeof r === 'number');
  const attendance = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  return { feesDue, attendance };
}
