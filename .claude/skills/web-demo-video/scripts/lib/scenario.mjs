// Loads and checks a scenario file (JSON, comments allowed). The scenario is the only thing that changes from app to app.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ACTIONS = ['goto', 'click', 'doubleClick', 'hover', 'type', 'clear', 'press', 'scroll', 'select', 'check', 'uncheck', 'drag', 'wait', 'waitFor', 'highlight', 'zoom', 'pause'];
const LOCATOR_KEYS = ['text', 'role', 'name', 'label', 'placeholder', 'testid', 'css', 'within', 'nth', 'exact', 'alt'];
const SPEEDS = ['calm', 'normal', 'brisk'];
const VOICE_ENGINES = ['sapi', 'edge', 'files', 'none'];

/** Removes // and block comments outside strings, so scenario files can be explained inline. */
export function stripComments(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Text that may be one string for every language, or an object keyed by language. */
export function tr(value, lang, fallback = 'en') {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value;
  return value[lang] ?? value[fallback];
}

function closest(word, options) {
  let best = null, bestScore = Infinity;
  for (const o of options) {
    let d = 0;
    const a = word.toLowerCase(), b = o.toLowerCase();
    // cheap edit distance
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    d = m[a.length][b.length];
    if (d < bestScore) [best, bestScore] = [o, d];
  }
  return bestScore <= 3 ? best : null;
}

export function validateLocator(loc, path, errors) {
  if (typeof loc === 'string') return;
  if (!loc || typeof loc !== 'object' || Array.isArray(loc)) return void errors.push(`${path}: a locator is a text or an object such as {"text":"Save"}`);
  const keys = Object.keys(loc);
  for (const k of keys) if (!LOCATOR_KEYS.includes(k)) errors.push(`${path}: unknown locator key "${k}"${closest(k, LOCATOR_KEYS) ? ` (did you mean "${closest(k, LOCATOR_KEYS)}"?)` : ''}`);
  if (!keys.some((k) => ['text', 'role', 'label', 'placeholder', 'testid', 'css', 'alt'].includes(k))) errors.push(`${path}: say what to look for (text, role, label, placeholder, testid or css)`);
  if (loc.within !== undefined) validateLocator(loc.within, `${path}.within`, errors);
  if (loc.nth !== undefined && !Number.isInteger(loc.nth)) errors.push(`${path}.nth: must be a whole number (0 is the first)`);
}

export function validateAction(action, path, errors) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return void errors.push(`${path}: an action is an object such as {"click":"Save"}`);
  const keys = Object.keys(action).filter((k) => ACTIONS.includes(k));
  const unknown = Object.keys(action).filter((k) => !ACTIONS.includes(k) && !['into', 'in', 'for', 'typos', 'cps', 'scale', 'by', 'to', 'within', 'from', 'duration', 'timeout', 'optional'].includes(k));
  for (const k of unknown) errors.push(`${path}: unknown key "${k}"${closest(k, [...ACTIONS, 'into', 'in', 'for', 'typos']) ? ` (did you mean "${closest(k, [...ACTIONS, 'into', 'in', 'for', 'typos'])}"?)` : ''}`);
  if (keys.length !== 1) return void errors.push(`${path}: each action needs exactly one of ${ACTIONS.join(', ')}`);
  const name = keys[0], v = action[name];
  switch (name) {
    case 'goto':
    case 'press':
      if (typeof v !== 'string' || !v) errors.push(`${path}.${name}: must be a text`);
      break;
    case 'type':
      if (typeof v !== 'string') errors.push(`${path}.type: must be the text to type`);
      if (action.into !== undefined) validateLocator(action.into, `${path}.into`, errors);
      break;
    case 'select':
      if (typeof v !== 'string') errors.push(`${path}.select: must be the option text`);
      if (action.in === undefined) errors.push(`${path}: select needs "in" (the list to choose from)`);
      else validateLocator(action.in, `${path}.in`, errors);
      break;
    case 'scroll':
      if (!v || typeof v !== 'object' || (v.by === undefined && v.to === undefined)) errors.push(`${path}.scroll: use {"by": 300} or {"to": "Some text"}`);
      else {
        if (v.to !== undefined) validateLocator(v.to, `${path}.scroll.to`, errors);
        if (v.within !== undefined) validateLocator(v.within, `${path}.scroll.within`, errors);
        if (v.by !== undefined && typeof v.by !== 'number') errors.push(`${path}.scroll.by: must be a number of pixels (negative scrolls up)`);
      }
      break;
    case 'drag':
      if (!v || v.from === undefined || v.to === undefined) errors.push(`${path}.drag: use {"from": ..., "to": ...}`);
      else (validateLocator(v.from, `${path}.drag.from`, errors), validateLocator(v.to, `${path}.drag.to`, errors));
      break;
    case 'wait':
    case 'pause':
      if (typeof v !== 'number' || v < 0) errors.push(`${path}.${name}: must be a number of seconds`);
      break;
    case 'waitFor':
      if (v !== 'idle' && (!v || typeof v !== 'object' || !['text', 'url', 'selector', 'gone'].some((k) => v[k] !== undefined))) errors.push(`${path}.waitFor: use "idle" or {"text": ...}, {"url": ...}, {"selector": ...}, {"gone": ...}`);
      break;
    default:
      validateLocator(v, `${path}.${name}`, errors);
  }
}

/** Returns a list of plain-language problems; empty when the scenario is sound. */
export function validateScenario(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['The scenario must be a JSON object'];
  if (s.version !== 1) errors.push('version: must be 1');
  if (!s.name || !/^[a-z0-9][a-z0-9-]*$/.test(s.name)) errors.push('name: use lowercase letters, digits and hyphens, for example "add-specialty"');
  const langs = s.languages ?? ['en'];
  if (!Array.isArray(langs) || !langs.length || langs.some((l) => !['en', 'ur'].includes(l))) errors.push('languages: a list made of "en" and/or "ur"');
  if (!s.target?.url) errors.push('target.url: where the app is running, for example "http://localhost:3000/"');
  const vp = s.target?.viewport;
  if (vp && (!Number.isInteger(vp.width) || !Number.isInteger(vp.height) || vp.width < 320 || vp.height < 240)) errors.push('target.viewport: width and height in pixels, at least 320 x 240');
  if (s.style?.speed && !SPEEDS.includes(s.style.speed)) errors.push(`style.speed: one of ${SPEEDS.join(', ')}`);
  if (s.voice?.engine && !VOICE_ENGINES.includes(s.voice.engine)) errors.push(`voice.engine: one of ${VOICE_ENGINES.join(', ')}`);
  if (!Array.isArray(s.steps) || !s.steps.length) errors.push('steps: at least one step is needed');
  const ids = new Set();
  (s.steps ?? []).forEach((step, i) => {
    const p = `steps[${i}]`;
    if (!step.id || !/^[a-z0-9][a-z0-9-]*$/.test(step.id)) errors.push(`${p}.id: a short name with lowercase letters, digits and hyphens`);
    else if (ids.has(step.id)) errors.push(`${p}.id: "${step.id}" is used twice`);
    else ids.add(step.id);
    if (step.do !== undefined && !Array.isArray(step.do)) errors.push(`${p}.do: must be a list of actions`);
    (step.do ?? []).forEach((a, j) => validateAction(a, `${p}.do[${j}]`, errors));
    for (const field of ['caption', 'say']) {
      const v = step[field];
      if (v && typeof v === 'object') for (const l of langs) if (v[l] === undefined && v.en === undefined) errors.push(`${p}.${field}: no text for "${l}"`);
    }
    if (step.expect && typeof step.expect === 'object') {
      const bad = Object.keys(step.expect).filter((k) => !['text', 'notText', 'url', 'selector', 'timeout'].includes(k));
      if (bad.length) errors.push(`${p}.expect: unknown key "${bad[0]}" (use text, notText, url, selector)`);
    }
  });
  for (const a of s.setup?.login ?? []) validateAction(a, 'setup.login[]', errors);
  return errors;
}

export function loadScenario(file) {
  const abs = resolve(file);
  let raw;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`Cannot read the scenario "${file}"`);
  }
  let scenario;
  try {
    scenario = JSON.parse(stripComments(raw));
  } catch (e) {
    throw new Error(`The scenario is not valid JSON: ${e.message}`);
  }
  const errors = validateScenario(scenario);
  if (errors.length) throw new Error(`The scenario has ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  scenario.__dir = dirname(abs);
  scenario.__file = abs;
  scenario.languages ??= ['en'];
  scenario.target.viewport ??= { width: 1280, height: 720, scale: 1 };
  scenario.target.viewport.scale ??= 1;
  scenario.style = { speed: 'normal', theme: 'teal', captionPosition: 'top', cursor: true, keys: 'shortcuts', ...scenario.style };
  return scenario;
}

/** The text of a step in one language, with sensible fallbacks. */
export function stepTexts(step, lang) {
  return { caption: tr(step.caption, lang), say: tr(step.say, lang) };
}
