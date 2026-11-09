// Pure rules for the draggable Aura button, kept apart from React so they can be tested without a phone.

export const TAP_SLOP = 8; // a finger that moves this little or less is still a tap

export type FabSide = 'left' | 'right';
export type FabSpot = { side: FabSide; yFrac: number }; // 0 = top of the allowed band, 1 = bottom
export type FabBounds = { width: number; height: number; boxW: number; boxH: number; margin: number; top: number; bottomReserve: number };

export const DEFAULT_SPOT: FabSpot = { side: 'right', yFrac: 1 };

export const isTap = (dx: number, dy: number) => Math.hypot(dx, dy) <= TAP_SLOP;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The lowest top-left y the button may take: above the tab bar. Never below the highest. */
export function yRange(b: FabBounds): { min: number; max: number } {
  const max = Math.max(b.top, b.height - b.bottomReserve - b.boxH);
  return { min: b.top, max };
}

/** Where (top-left) a remembered spot sits on this screen. A bad or old saved value falls back inside the screen. */
export function positionFor(spot: FabSpot | null | undefined, b: FabBounds): { x: number; y: number } {
  const s = spot && (spot.side === 'left' || spot.side === 'right') && Number.isFinite(spot.yFrac) ? spot : DEFAULT_SPOT;
  const { min, max } = yRange(b);
  return {
    x: s.side === 'left' ? b.margin : b.width - b.margin - b.boxW,
    y: min + clamp(s.yFrac, 0, 1) * (max - min),
  };
}

/** Where a drop at (x, y) top-left ends up: the nearer side edge, same height. */
export function spotFromDrop(x: number, y: number, b: FabBounds): FabSpot {
  const { min, max } = yRange(b);
  const centre = x + b.boxW / 2;
  return { side: centre < b.width / 2 ? 'left' : 'right', yFrac: max > min ? clamp((y - min) / (max - min), 0, 1) : 1 };
}

/** Keeps a live drag inside the screen. */
export function clampDrag(x: number, y: number, b: FabBounds): { x: number; y: number } {
  const { min, max } = yRange(b);
  return { x: clamp(x, 0, b.width - b.boxW), y: clamp(y, min, max) };
}

export function parseSpot(raw: string | null): FabSpot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && (v.side === 'left' || v.side === 'right') && typeof v.yFrac === 'number' ? { side: v.side, yFrac: v.yFrac } : null;
  } catch { return null; }
}
