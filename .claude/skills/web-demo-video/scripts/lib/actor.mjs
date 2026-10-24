// Runs a scenario: for each step it shows the caption, starts the narration clock, performs the actions
// with the real pointer and keyboard, checks what should be on screen, and writes a timeline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { navigate, sleep } from './cdp.mjs';
import { assertUrlAllowed, compileForbidden, expandEnv, findForbidden, redact } from './safety.mjs';
import { tr } from './scenario.mjs';

const rand = (a, b) => a + Math.random() * (b - a);
const json = (v) => JSON.stringify(v);

export class StepError extends Error {
  constructor(stepId, message, extra = {}) {
    super(`Step "${stepId}": ${message}`);
    this.stepId = stepId;
    Object.assign(this, extra);
  }
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function logoUrl(scenario) {
  const logo = scenario.meta?.logo;
  if (!logo) return '';
  if (/^(https?:|data:)/.test(logo)) return logo;
  const file = isAbsolute(logo) ? logo : join(scenario.__dir, logo);
  return `data:${MIME[extname(file).toLowerCase()] ?? 'image/png'};base64,${readFileSync(file).toString('base64')}`;
}

export function createRunner({ scenario, lang, session, outDir = '.', fast = false, clips = {}, log = () => {} }) {
  const { page, input } = session;
  const sp = input.speed;
  const secrets = [...JSON.stringify(scenario).matchAll(/\$\{ENV:([A-Za-z_]\w*)\}/g)].map((m) => process.env[m[1]]).filter(Boolean);
  const forbidden = compileForbidden(scenario.target.forbidden ?? []);
  const warnings = [];
  const timeline = [];
  const vp = scenario.target.viewport;
  let t0 = performance.now();
  let captionPos = scenario.style.captionPosition ?? 'top';
  const clock = () => (performance.now() - t0) / 1000;
  const pause = (ms) => sleep(fast ? Math.min(ms, 120) : ms * sp.pause);
  const say = (m) => log(redact(m, secrets));

  /** Page code can be interrupted by a page change; try again a few times. */
  async function ev(expr) {
    for (let i = 0; ; i++) {
      try {
        return await page.evaluate(expr);
      } catch (e) {
        if (i < 4 && /context|destroyed|navigat|Inspected target/i.test(e.message)) {
          await sleep(250);
          continue;
        }
        throw e;
      }
    }
  }

  async function findWait(stepId, loc, { timeout = 8000, optional = false } = {}) {
    const end = performance.now() + timeout;
    let last;
    for (;;) {
      last = await ev(`__demo.find(${json(loc)})`);
      if (last.ok) break;
      if (performance.now() > end) {
        if (optional) return null;
        throw new StepError(stepId, `could not find ${json(loc)}: ${last.why}`);
      }
      await sleep(150);
    }
    if (last.count > 1 && (typeof loc === 'string' || loc.nth === undefined)) {
      const key = json(loc);
      if (!warnings.some((w) => w.key === key)) warnings.push({ key, stepId, text: `${key} matches ${last.count} elements; the first is used. Add "nth" or "within" to be sure.` });
    }
    return last;
  }

  const point = (r) => {
    const x = Math.min(Math.max(r.x + r.w * rand(0.4, 0.62), 4), vp.width - 4);
    const y = Math.min(Math.max(r.y + r.h * rand(0.4, 0.62), 4), vp.height - 4);
    return [x, y];
  };

  /** Scrolls with the real wheel until the element sits comfortably in view. */
  async function reveal(stepId, loc, { center = false } = {}) {
    for (let i = 0; i < 9; i++) {
      const info = await findWait(stepId, loc);
      const si = await ev('__demo.scrollInfo()');
      const top = si.view.top + (captionPos === 'top' ? 74 : 24);
      const bottom = si.view.bottom - (captionPos === 'bottom' ? 90 : 34);
      const mid = (si.el.top + si.el.bottom) / 2;
      const fits = si.el.top >= top && si.el.bottom <= bottom;
      const tall = si.el.bottom - si.el.top > bottom - top;
      if (!center && (fits || (tall && si.el.top >= top - 4 && si.el.top <= bottom))) return info;
      let delta = mid - (top + bottom) / 2;
      delta = Math.max(-si.maxUp, Math.min(si.maxDown, delta));
      if (Math.abs(delta) < 3) return info;
      const px = (si.view.left + si.view.right) / 2 + rand(-30, 30);
      const py = (si.view.top + si.view.bottom) / 2 + rand(-20, 20);
      await input.moveTo(px, py);
      const chunk = Math.sign(delta) * Math.min(Math.abs(delta), 520);
      await input.wheel(chunk, { duration: 450 + Math.abs(chunk) * 0.9 });
      await pause(380);
      if (Math.abs(delta) < 4) return info;
    }
    throw new StepError(stepId, `could not scroll ${json(loc)} into view`);
  }

  async function hoverOver(stepId, loc, dwell) {
    const info = await reveal(stepId, loc);
    const [x, y] = point(info.rect);
    await input.moveTo(x, y);
    await pause(dwell ?? rand(380, 560) * sp.dwell);
    return info;
  }

  async function clickOn(stepId, loc, { double = false, after = [700, 1000] } = {}) {
    const info = await hoverOver(stepId, loc);
    if (info.disabled) throw new StepError(stepId, `${json(loc)} is disabled, so a person could not click it`);
    if (double) await input.doubleClick();
    else await input.click();
    await pause(rand(after[0], after[1]));
    return info;
  }

  const expand = (s) => expandEnv(s);

  async function networkIdle(timeout = 10000) {
    const end = performance.now() + timeout;
    while (performance.now() < end) {
      if (session.net.inflight === 0 && performance.now() - session.net.lastChange > 500) return;
      await sleep(100);
    }
  }

  async function waitFor(stepId, spec, timeout = 10000) {
    if (spec === 'idle') return networkIdle(timeout);
    const end = performance.now() + timeout;
    for (;;) {
      const hit = await ev(`(() => { const t = __demo.textOnPage().toLowerCase(); const s = ${json(spec)};
        if (s.text !== undefined) return t.includes(String(s.text).toLowerCase());
        if (s.gone !== undefined) return !t.includes(String(s.gone).toLowerCase());
        if (s.url !== undefined) return location.href.includes(s.url);
        if (s.selector !== undefined) return !!document.querySelector(s.selector);
        return false; })()`);
      if (hit) return;
      if (performance.now() > end) throw new StepError(stepId, `waited ${timeout / 1000}s for ${json(spec)} but it never happened`);
      await sleep(150);
    }
  }

  async function runAction(stepId, action) {
    const name = Object.keys(action).find((k) => ['goto', 'click', 'doubleClick', 'hover', 'type', 'clear', 'press', 'scroll', 'select', 'check', 'uncheck', 'drag', 'wait', 'waitFor', 'highlight', 'zoom', 'pause'].includes(k));
    const v = action[name];
    switch (name) {
      case 'goto': {
        const url = new URL(expand(v), page.currentUrl ?? scenario.target.url).href;
        assertUrlAllowed(url, scenario.target.allowHosts ?? []);
        await navigate(page, url);
        page.currentUrl = url;
        await pause(500);
        break;
      }
      case 'click':
        await clickOn(stepId, v);
        break;
      case 'doubleClick':
        await clickOn(stepId, v, { double: true });
        break;
      case 'hover':
        await hoverOver(stepId, v, (action.for ?? 1) * 1000 * sp.dwell);
        break;
      case 'type': {
        if (action.into !== undefined) await clickOn(stepId, action.into, { after: [200, 350] });
        if (!(await ev('__demo.activeEditable()'))) throw new StepError(stepId, 'nothing is ready for typing. Give "into" so the field is clicked first');
        await input.type(expand(v), { cps: action.cps ?? scenario.style.cps ?? 9, typos: action.typos ?? scenario.style.typos ?? 0 });
        await pause(700);
        break;
      }
      case 'clear':
        await clickOn(stepId, v, { after: [150, 250] });
        await input.press('Control+A');
        await input.press('Backspace');
        await pause(400);
        break;
      case 'press':
        await input.press(v);
        await pause(500);
        break;
      case 'scroll': {
        if (v.to !== undefined) {
          await reveal(stepId, v.to, { center: true });
        } else {
          if (v.within !== undefined) {
            const info = await findWait(stepId, v.within);
            await input.moveTo(info.rect.x + info.rect.w / 2, info.rect.y + info.rect.h / 2);
          } else if (!input.mouse.placed) await input.moveTo(vp.width * 0.6, vp.height * 0.55);
          const at = `${Math.round(input.mouse.x)}, ${Math.round(input.mouse.y)}`;
          const before = await ev(`__demo.scrollAt(${at})`);
          await input.wheel(v.by, { duration: 500 + Math.abs(v.by) * 1.2 });
          await sleep(350);
          const moved = Math.abs((await ev(`__demo.scrollAt(${at})`)) - before);
          if (moved < 2) warnings.push({ key: `scroll:${stepId}:${v.by}`, stepId, text: `Step "${stepId}": scrolling by ${v.by} moved nothing, because the page cannot scroll that far there. The video will show no movement.` });
        }
        await pause(700);
        break;
      }
      case 'select': {
        await clickOn(stepId, action.in, { after: [300, 450] });
        const st = await ev('__demo.selectState()');
        if (!st) throw new StepError(stepId, `${json(action.in)} is not a <select> list. Use click actions for custom dropdowns`);
        const want = st.options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
        if (want < 0) throw new StepError(stepId, `the list has no option "${v}" (it has: ${st.options.join(', ')})`);
        for (let i = 0; i < Math.abs(want - st.index); i++) {
          await input.press(want > st.index ? 'ArrowDown' : 'ArrowUp');
          await pause(240);
        }
        await input.press('Enter');
        await pause(500);
        const after = await ev('__demo.selectState()');
        if (after.index !== want) throw new StepError(stepId, `could not choose "${v}"`);
        break;
      }
      case 'check':
      case 'uncheck': {
        const info = await findWait(stepId, v);
        const want = name === 'check';
        if (info.checked === want) break;
        await clickOn(stepId, v);
        break;
      }
      case 'drag': {
        const from = await reveal(stepId, v.from);
        const [fx, fy] = point(from.rect);
        await input.moveTo(fx, fy);
        await pause(400);
        const to = await findWait(stepId, v.to);
        const [tx, ty] = point(to.rect);
        await input.drag(tx, ty);
        await pause(700);
        break;
      }
      case 'wait':
      case 'pause':
        await sleep(fast ? Math.min(v * 1000, 150) : v * 1000);
        break;
      case 'waitFor':
        await waitFor(stepId, v, (action.timeout ?? 10) * 1000);
        break;
      case 'highlight': {
        const info = await reveal(stepId, v);
        await ev(`__demo.spotlight(${json(info.rect)})`);
        await sleep(fast ? 150 : (action.for ?? 2) * 1000);
        await ev('__demo.spotlight(null)');
        await pause(400);
        break;
      }
      case 'zoom': {
        const info = await reveal(stepId, v);
        await ev(`__demo.zoom({cx: ${info.rect.x + info.rect.w / 2}, cy: ${info.rect.y + info.rect.h / 2}, scale: ${action.scale ?? 1.6}})`);
        await sleep(fast ? 150 : (action.for ?? 2.2) * 1000 + 700);
        await ev('__demo.zoomReset()');
        await pause(900);
        break;
      }
      default:
        throw new StepError(stepId, `unknown action ${json(action)}`);
    }
    if (forbidden.length) {
      const hit = findForbidden(await ev('__demo.textOnPage()'), forbidden);
      if (hit) throw new StepError(stepId, `the page shows text that must never be in a demo: "${hit.match}" (pattern ${hit.pattern})`);
    }
  }

  /** A rough guess of how long an action takes on screen, to share narration time between actions. */
  function estimate(action) {
    const name = Object.keys(action).find((k) => ['goto', 'click', 'doubleClick', 'hover', 'type', 'clear', 'press', 'scroll', 'select', 'check', 'uncheck', 'drag', 'wait', 'waitFor', 'highlight', 'zoom', 'pause'].includes(k));
    switch (name) {
      case 'click': case 'doubleClick': case 'check': case 'uncheck': return 2.2;
      case 'hover': return 1.6 + (action.for ?? 1);
      case 'type': return 2 + String(action.type).length / (action.cps ?? scenario.style.cps ?? 9);
      case 'clear': return 2.4;
      case 'press': return 0.9;
      case 'scroll': return action.scroll.to !== undefined ? 2.4 : 0.8 + Math.abs(action.scroll.by ?? 0) * 0.0012;
      case 'select': return 3.6;
      case 'drag': return 3;
      case 'wait': case 'pause': return action[name];
      case 'highlight': return 1 + (action.for ?? 2);
      case 'zoom': return 2.5 + (action.for ?? 2.2);
      default: return 1;
    }
  }

  async function checkExpect(stepId, expect) {
    if (!expect) return;
    const timeout = (expect.timeout ?? 8) * 1000;
    if (expect.text !== undefined) await waitFor(stepId, { text: expect.text }, timeout).catch(() => { throw new StepError(stepId, `expected the page to show "${expect.text}"`); });
    if (expect.url !== undefined) await waitFor(stepId, { url: expect.url }, timeout).catch(() => { throw new StepError(stepId, `expected the address to contain "${expect.url}"`); });
    if (expect.selector !== undefined) await waitFor(stepId, { selector: expect.selector }, timeout).catch(() => { throw new StepError(stepId, `expected an element matching "${expect.selector}"`); });
    if (expect.notText !== undefined) {
      const present = await ev(`__demo.textOnPage().toLowerCase().includes(${json(String(expect.notText).toLowerCase())})`);
      if (present) throw new StepError(stepId, `the page must not show "${expect.notText}" but it does`);
    }
  }

  async function screenshotFailure(id) {
    try {
      mkdirSync(join(outDir, 'failures'), { recursive: true });
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      const file = join(outDir, 'failures', `${id}.${lang}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    } catch {
      return null;
    }
  }

  function slideSpec(kind, step) {
    const m = scenario.meta ?? {};
    if (kind === 'chapter') return { kind, headline: tr(step.chapter, lang), logo: '' };
    const s = scenario[kind] && typeof scenario[kind] === 'object' ? scenario[kind] : {};
    return {
      kind,
      kicker: tr(s.kicker ?? (kind === 'intro' ? m.app : undefined), lang) ?? '',
      headline: tr(s.headline ?? (kind === 'intro' ? m.title : undefined), lang) ?? '',
      subtitle: tr(s.subtitle ?? (kind === 'intro' ? m.subtitle : undefined), lang) ?? '',
      bullets: tr(s.bullets ?? (kind === 'intro' ? m.learn : undefined), lang) ?? [],
      logo: logoUrl(scenario),
    };
  }

  async function showSlide(kind, step) {
    const spec = slideSpec(kind, step);
    if (!spec.headline) return;
    const key = kind === 'chapter' ? `chapter:${step.id}` : kind;
    const clip = clips[key];
    const base = scenario[kind]?.seconds ?? (kind === 'chapter' ? 2.4 : kind === 'intro' ? 5 : 4);
    const seconds = fast ? 0.4 : Math.max(base, (clip?.duration ?? 0) + 1);
    const entry = { kind: 'slide', id: key, slide: kind, start: clock(), say: clip ? { file: clip.file, duration: clip.duration } : null, headline: spec.headline };
    await ev('__demo.hideCaption()');
    await ev(`__demo.slide(${json({ ...spec, lang })})`);
    await sleep(seconds * 1000);
    await ev('__demo.hideSlide(500)');
    await sleep(fast ? 100 : 650);
    entry.end = clock();
    timeline.push(entry);
  }

  async function runStep(step, index, total) {
    const id = step.id;
    const caption = tr(step.caption, lang);
    const narration = tr(step.say, lang);
    const clip = clips[id];
    captionPos = step.captionPosition ?? scenario.style.captionPosition ?? 'top';
    if (step.chapter) await showSlide('chapter', step);
    await ev(`__demo.progress(${index / total})`);
    if (caption) await ev(`__demo.caption(${json(caption)}, ${json({ pos: captionPos, lang })})`);
    else await ev('__demo.hideCaption()');
    const entry = { kind: 'step', id, start: clock(), caption: caption ?? null, say: clip ? { file: clip.file, duration: clip.duration, text: narration } : null };
    say(`  ${String(index + 1).padStart(2)}/${total} ${id}${caption ? ` — ${caption}` : ''}`);
    try {
      if (clip || narration) await pause(rand(350, 500));
      // Words come first, then the doing: spare time while the narration plays is shared out as pauses before each action,
      // instead of one long freeze at the end of the step.
      const actions = step.do ?? [];
      let pad = 0;
      if (clip && !fast && actions.length) {
        const spare = clip.duration + 0.45 - 0.45 - actions.reduce((sum, a) => sum + estimate(a), 0);
        pad = Math.min(5, Math.max(0, spare) / actions.length);
      }
      for (const action of actions) {
        if (pad > 0.15) await sleep(pad * 1000);
        await runAction(id, action);
      }
      await checkExpect(id, step.expect);
      const hold = (step.hold ?? 0.6) * 1000;
      await sleep(fast ? Math.min(hold, 150) : hold);
      if (clip && !fast) {
        const need = (clip.duration + 0.45) * 1000 - (clock() - entry.start) * 1000;
        if (need > 0) await sleep(need);
      }
    } catch (e) {
      entry.failed = e.message;
      entry.end = clock();
      timeline.push(entry);
      e.screenshot = await screenshotFailure(id);
      throw e;
    }
    entry.end = clock();
    timeline.push(entry);
  }

  /** Signing in and other preparation: done before recording, with the cursor and key badges hidden. */
  async function setup() {
    await navigate(page, scenario.target.url).catch(() => {});
    page.currentUrl = scenario.target.url;
    assertUrlAllowed(scenario.target.url, scenario.target.allowHosts ?? []);
    await ev('__demo.configure({showCursor: false, showKeys: "none"})');
    for (const action of scenario.setup?.login ?? []) await runAction('login', action);
    await networkIdle(8000);
    if (scenario.setup?.login?.length) await sleep(400);
    await ev(`__demo.configure({showCursor: ${scenario.style.cursor !== false}, showKeys: ${json(scenario.style.keys)}})`);
    if (scenario.target.start) {
      const url = new URL(scenario.target.start, scenario.target.url).href;
      assertUrlAllowed(url, scenario.target.allowHosts ?? []);
      await navigate(page, url);
      page.currentUrl = url;
      await networkIdle(8000);
    }
    await ev('window.scrollTo(0, 0)');
    // Park the pointer in a neutral place so the first move starts from somewhere real.
    await input.teleport(vp.width * 0.62, vp.height * 0.3);
    await sleep(300);
  }

  /** The whole video: intro slide, every step, outro slide. Returns the timeline. */
  async function run({ onStart } = {}) {
    t0 = performance.now();
    onStart?.(t0);
    if (scenario.intro !== false && (scenario.intro || scenario.meta?.title)) await showSlide('intro');
    const steps = scenario.steps;
    for (let i = 0; i < steps.length; i++) await runStep(steps[i], i, steps.length);
    await ev('__demo.progress(1)');
    if (scenario.outro && scenario.outro !== false) {
      await ev('__demo.hideCaption()');
      await sleep(fast ? 50 : 500);
      await showSlide('outro');
    } else {
      await sleep(fast ? 100 : 1800);
      await ev('__demo.hideCaption()');
      await sleep(fast ? 50 : 600);
    }
    return { timeline, warnings, duration: clock() };
  }

  return { setup, run, clock, timeline, warnings, runAction, ev };
}
