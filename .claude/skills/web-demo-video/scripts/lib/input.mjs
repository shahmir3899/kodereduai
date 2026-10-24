// Real input through the browser: a pointer that travels along a curve (so hover styles appear for real),
// genuine key down / key up events with human timing, and wheel scrolling.
import { sleep } from './cdp.mjs';

const rand = (a, b) => a + Math.random() * (b - a);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const MOD = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Win: 4, Shift: 8 };

/** How quickly a person seems to act. */
export const SPEEDS = {
  calm: { move: 1.3, dwell: 1.25, type: 1.3, pause: 1.25 },
  normal: { move: 1, dwell: 1, type: 1, pause: 1 },
  brisk: { move: 0.7, dwell: 0.7, type: 0.75, pause: 0.7 },
};

const SPECIAL = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Esc: { key: 'Escape', code: 'Escape', vk: 27 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
};
const MODIFIER_KEYS = { Control: { key: 'Control', code: 'ControlLeft', vk: 17 }, Alt: { key: 'Alt', code: 'AltLeft', vk: 18 }, Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 }, Meta: { key: 'Meta', code: 'MetaLeft', vk: 91 } };

const SHIFTED = { '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };
const PUNCT = { ' ': ['Space', 32], '.': ['Period', 190], ',': ['Comma', 188], '-': ['Minus', 189], '=': ['Equal', 187], '/': ['Slash', 191], ';': ['Semicolon', 186], "'": ['Quote', 222], '[': ['BracketLeft', 219], ']': ['BracketRight', 221], '\\': ['Backslash', 220], '`': ['Backquote', 192] };
const NEIGHBOURS = { a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj', i: 'uo', j: 'hk', k: 'jl', l: 'k', m: 'n', n: 'bm', o: 'ip', p: 'o', q: 'wa', r: 'et', s: 'ad', t: 'ry', u: 'yi', v: 'cb', w: 'qe', x: 'zc', y: 'tu', z: 'x' };

/** Key description for one typed character, or null when it has no key on an English keyboard (e.g. Urdu letters). */
export function keyFor(ch) {
  if (/[a-z]/.test(ch)) return { key: ch, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), text: ch };
  if (/[A-Z]/.test(ch)) return { key: ch, code: `Key${ch}`, vk: ch.charCodeAt(0), text: ch, shift: true };
  if (/[0-9]/.test(ch)) return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), text: ch };
  if (PUNCT[ch]) return { key: ch, code: PUNCT[ch][0], vk: PUNCT[ch][1], text: ch };
  if (SHIFTED[ch]) {
    const base = SHIFTED[ch];
    const [code, vk] = /[0-9]/.test(base) ? [`Digit${base}`, base.charCodeAt(0)] : PUNCT[base];
    return { key: ch, code, vk, text: ch, shift: true };
  }
  return null;
}

/** Parses "Control+S" into modifiers and a main key. */
export function parseCombo(combo) {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const main = parts.pop();
  const mods = parts.map((p) => {
    if (!(p in MOD)) throw new Error(`Unknown modifier "${p}" in "${combo}"`);
    return p === 'Ctrl' ? 'Control' : p === 'Cmd' || p === 'Win' ? 'Meta' : p;
  });
  return { mods, main };
}

export function createInput(page, { speed = 'normal', factor = 1 } = {}) {
  // `factor` below 1 squeezes every duration (used by rehearsals, which only need to prove the steps work).
  const sp = Object.fromEntries(Object.entries(SPEEDS[speed] ?? SPEEDS.normal).map(([k, v]) => [k, v * factor]));
  const mouse = { x: 0, y: 0, placed: false };
  const dispatch = (params) => page.send('Input.dispatchMouseEvent', { button: 'none', buttons: 0, ...params });
  let modifiers = 0;

  async function teleport(x, y) {
    mouse.x = x;
    mouse.y = y;
    mouse.placed = true;
    await dispatch({ type: 'mouseMoved', x, y });
  }

  /** Moves the real pointer along a gentle curve, with easing and a small overshoot on long moves. */
  async function moveTo(x1, y1, { duration } = {}) {
    if (!mouse.placed) await teleport(x1 - 120, y1 - 80);
    const x0 = mouse.x, y0 = mouse.y;
    const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const ux = dx / dist, uy = dy / dist;
    const overshoot = dist > 450;
    const tx = overshoot ? x1 + ux * 8 : x1, ty = overshoot ? y1 + uy * 8 : y1;
    const dur = (duration ?? Math.min(1300, Math.max(560, 430 + dist * 0.85))) * sp.move;
    const bend = rand(-0.12, 0.12) * dist;
    const cx = (x0 + tx) / 2 - uy * bend, cy = (y0 + ty) / 2 + ux * bend;
    const start = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / dur);
      const e = ease(t), u = 1 - e;
      mouse.x = u * u * x0 + 2 * u * e * cx + e * e * tx;
      mouse.y = u * u * y0 + 2 * u * e * cy + e * e * ty;
      await dispatch({ type: 'mouseMoved', x: mouse.x, y: mouse.y, modifiers });
      if (t >= 1) break;
      await sleep(8);
    }
    if (overshoot) {
      const s2 = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - s2) / 150);
        mouse.x = tx + (x1 - tx) * t;
        mouse.y = ty + (y1 - ty) * t;
        await dispatch({ type: 'mouseMoved', x: mouse.x, y: mouse.y, modifiers });
        if (t >= 1) break;
        await sleep(8);
      }
    }
  }

  /** A person's click: press, hold a moment, release. */
  async function click({ button = 'left', clickCount = 1 } = {}) {
    await dispatch({ type: 'mousePressed', x: mouse.x, y: mouse.y, button, buttons: button === 'left' ? 1 : 2, clickCount, modifiers });
    await sleep(rand(75, 115));
    await dispatch({ type: 'mouseReleased', x: mouse.x, y: mouse.y, button, buttons: 0, clickCount, modifiers });
  }
  async function doubleClick() {
    await click({ clickCount: 1 });
    await sleep(rand(60, 90));
    await click({ clickCount: 2 });
  }

  async function drag(x1, y1, { duration = 800 } = {}) {
    await dispatch({ type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 });
    const x0 = mouse.x, y0 = mouse.y, start = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / (duration * sp.move));
      mouse.x = x0 + (x1 - x0) * ease(t);
      mouse.y = y0 + (y1 - y0) * ease(t);
      await dispatch({ type: 'mouseMoved', x: mouse.x, y: mouse.y, button: 'left', buttons: 1 });
      if (t >= 1) break;
      await sleep(8);
    }
    await sleep(120);
    await dispatch({ type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** Wheel scrolling in small eased steps at the current pointer position. Positive dy scrolls down. */
  async function wheel(dy, { duration = 800, dx = 0 } = {}) {
    const dur = duration * sp.move;
    const start = performance.now();
    let sent = 0;
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / dur);
      const target = dy * ease(t);
      const delta = target - sent;
      if (Math.abs(delta) >= 1 || t >= 1) {
        await dispatch({ type: 'mouseWheel', x: mouse.x, y: mouse.y, deltaX: dx * (delta / (dy || 1)), deltaY: delta, modifiers });
        sent = target;
      }
      if (t >= 1) break;
      await sleep(14);
    }
  }

  async function keyEvent(type, k, extra = {}) {
    await page.send('Input.dispatchKeyEvent', {
      type,
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
      modifiers,
      ...extra,
    });
  }

  /** One real keystroke. Characters with no English key (Urdu letters) are inserted as text. */
  async function typeChar(ch) {
    const k = keyFor(ch);
    if (!k) {
      await page.send('Input.insertText', { text: ch });
      return;
    }
    const savedMods = modifiers;
    if (k.shift) modifiers |= MOD.Shift;
    await keyEvent('keyDown', k, { text: k.text, unmodifiedText: k.text });
    await sleep(rand(18, 40));
    await keyEvent('keyUp', k);
    modifiers = savedMods;
  }

  /** Types like a person: uneven rhythm, the odd hesitation, and optionally a typo that is corrected. */
  async function type(text, { cps = 9, typos = 0 } = {}) {
    const base = 1000 / cps;
    for (const ch of text) {
      if (typos > 0 && NEIGHBOURS[ch.toLowerCase()] && Math.random() < typos) {
        const wrong = NEIGHBOURS[ch.toLowerCase()][Math.floor(Math.random() * NEIGHBOURS[ch.toLowerCase()].length)];
        await typeChar(wrong);
        await sleep(rand(240, 420) * sp.type);
        await press('Backspace');
        await sleep(rand(120, 220) * sp.type);
      }
      await typeChar(ch);
      await sleep((base * rand(0.65, 1.35) + (Math.random() < 0.12 ? rand(120, 260) : 0)) * sp.type);
    }
  }

  /** Presses a key or a shortcut such as "Control+S" or "Enter". */
  async function press(combo) {
    const { mods, main } = parseCombo(combo);
    const pressed = [];
    for (const m of mods) {
      modifiers |= MOD[m];
      await keyEvent('rawKeyDown', MODIFIER_KEYS[m]);
      pressed.push(m);
      await sleep(rand(40, 80));
    }
    const special = SPECIAL[main];
    // A real keyboard reports a capital letter only when Shift is held.
    const letter = main.length === 1 && /[a-zA-Z]/.test(main) && !mods.includes('Shift') ? main.toLowerCase() : main;
    const k = special ?? keyFor(letter.length === 1 ? letter : '') ?? null;
    if (!k) throw new Error(`Do not know how to press "${main}"`);
    const hasCommandMod = (modifiers & (MOD.Control | MOD.Alt | MOD.Meta)) !== 0;
    await keyEvent(special && !special.text ? 'rawKeyDown' : 'keyDown', k, hasCommandMod ? {} : { text: k.text, unmodifiedText: k.text });
    await sleep(rand(60, 110));
    await keyEvent('keyUp', k);
    for (const m of pressed.reverse()) {
      modifiers &= ~MOD[m];
      await keyEvent('keyUp', MODIFIER_KEYS[m]);
    }
  }

  return { mouse, speed: sp, teleport, moveTo, click, doubleClick, drag, wheel, type, press, typeChar };
}
