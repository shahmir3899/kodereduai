import { clampDrag, isTap, parseSpot, positionFor, spotFromDrop, yRange, type FabBounds } from '../services/assistantFab';

const b: FabBounds = { width: 400, height: 800, boxW: 56, boxH: 74, margin: 16, top: 40, bottomReserve: 100 };

describe('tap versus drag', () => {
  it('treats a small wobble as a tap and a real move as a drag', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(5, 5)).toBe(true);
    expect(isTap(9, 0)).toBe(false);
    expect(isTap(0, -30)).toBe(false);
  });
});

describe('placement', () => {
  it('puts the default spot bottom-right, above the tab bar', () => {
    const { max } = yRange(b);
    expect(positionFor(null, b)).toEqual({ x: 400 - 16 - 56, y: max });
    expect(max).toBe(800 - 100 - 74);
  });

  it('snaps a drop to the nearer side and keeps the height', () => {
    const left = spotFromDrop(60, 300, b);
    const right = spotFromDrop(300, 300, b);
    expect(left.side).toBe('left');
    expect(right.side).toBe('right');
    const back = positionFor(left, b);
    expect(back.x).toBe(16);
    expect(back.y).toBeCloseTo(300);
  });

  it('never leaves the allowed band', () => {
    expect(spotFromDrop(10, -500, b).yFrac).toBe(0);
    expect(spotFromDrop(10, 5000, b).yFrac).toBe(1);
    expect(clampDrag(-50, -50, b)).toEqual({ x: 0, y: 40 });
    expect(clampDrag(900, 900, b)).toEqual({ x: 400 - 56, y: 800 - 100 - 74 });
  });

  it('keeps a remembered spot inside a different screen size', () => {
    const wide: FabBounds = { ...b, width: 800, height: 360 };
    const p = positionFor({ side: 'right', yFrac: 1 }, wide);
    expect(p.x).toBe(800 - 16 - 56);
    expect(p.y).toBeGreaterThanOrEqual(wide.top);
  });
});

describe('saved spot', () => {
  it('reads good values and ignores bad ones', () => {
    expect(parseSpot('{"side":"left","yFrac":0.4}')).toEqual({ side: 'left', yFrac: 0.4 });
    expect(parseSpot('{"side":"top","yFrac":0.4}')).toBeNull();
    expect(parseSpot('nope')).toBeNull();
    expect(parseSpot(null)).toBeNull();
    // An out-of-range value is pulled back into the band rather than rejected.
    expect(positionFor({ side: 'left', yFrac: 9 }, b).y).toBe(yRange(b).max);
  });
});
