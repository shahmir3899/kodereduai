import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { connectPage, launchChrome, navigate, setViewport, sleep } from '../scripts/lib/cdp.mjs';
import { createInput, keyFor, parseCombo } from '../scripts/lib/input.mjs';

const overlay = readFileSync(new URL('../scripts/lib/overlay.js', import.meta.url), 'utf8');
const fixture = pathToFileURL(new URL('./fixtures/app.html', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')).href;

let chrome, page, input;
const center = async (selector) => page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const events = () => page.evaluate('window.__events.slice()');

before(async () => {
  chrome = await launchChrome({ headless: true });
  page = await connectPage(chrome.port);
  await setViewport(page, { width: 1100, height: 700 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: overlay });
  await navigate(page, fixture);
  input = createInput(page, { speed: 'brisk' });
});
after(async () => {
  page?.close();
  await chrome?.close();
});

test('key descriptions and shortcuts are parsed correctly', () => {
  assert.equal(keyFor('a').code, 'KeyA');
  assert.equal(keyFor('A').shift, true);
  assert.equal(keyFor('7').code, 'Digit7');
  assert.equal(keyFor('@').shift, true);
  assert.equal(keyFor('ع'), null);
  assert.deepEqual(parseCombo('Control+Shift+S'), { mods: ['Control', 'Shift'], main: 'S' });
  assert.deepEqual(parseCombo('Ctrl+S'), { mods: ['Control'], main: 'S' });
  assert.throws(() => parseCombo('Hyper+S'), /Unknown modifier/);
});

test('the overlay is installed in an isolated shadow root and starts with no cursor', async () => {
  assert.equal(await page.evaluate('typeof window.__demo'), 'object');
  assert.equal(await page.evaluate('document.getElementById("__demo_host").shadowRoot !== null'), true);
  assert.equal(await page.evaluate('window.__demo.pointer.seen'), false);
});

test('a real pointer makes hover styles appear, and the cursor follows it', async () => {
  const [x, y] = await center('.menu > button');
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".drop")).display'), 'none');
  await input.moveTo(x, y);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".drop")).display'), 'block');
  const p = await page.evaluate('({x: __demo.pointer.x, y: __demo.pointer.y, seen: __demo.pointer.seen})');
  assert.ok(p.seen);
  assert.ok(Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1, 'overlay cursor sits on the pointer');
  assert.equal(await page.evaluate('document.getElementById("__demo_host").shadowRoot.querySelector(".cursor").dataset.shape'), 'hand');
});

test('moving away hides the hover menu again', async () => {
  const [x, y] = await center('#scroller');
  await input.moveTo(x, y);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".drop")).display'), 'none');
});

test('a click is a real, trusted click with a ripple, and it toggles panels', async () => {
  const [x, y] = await center('#save');
  await input.moveTo(x, y);
  assert.equal(await page.evaluate('document.getElementById("__demo_host").shadowRoot.querySelector(".cursor").dataset.shape'), 'hand');
  await input.click();
  await sleep(100);
  assert.equal(await page.evaluate('document.getElementById("saved").hidden'), false);
  assert.ok((await events()).some((e) => e === 'click trusted=true'));
  assert.ok((await page.evaluate('__demo.ripples')) >= 1);

  const [dx, dy] = await center('#more summary');
  await input.moveTo(dx, dy);
  await input.click();
  assert.equal(await page.evaluate('document.getElementById("more").open'), true);
});

test('typing produces real key events, with the text cursor shape over inputs', async () => {
  const [x, y] = await center('#name');
  await input.moveTo(x, y);
  assert.equal(await page.evaluate('document.getElementById("__demo_host").shadowRoot.querySelector(".cursor").dataset.shape'), 'text');
  await input.click();
  await input.type('Hello, World 42!', { cps: 40 });
  assert.equal(await page.evaluate('document.getElementById("name").value'), 'Hello, World 42!');
  const ev = await events();
  assert.ok(ev.some((e) => e.startsWith('keydown H trusted=true')));
  assert.ok(ev.includes('keyup H'));
});

test('Urdu text can be typed', async () => {
  const [x, y] = await center('#urdu');
  await input.moveTo(x, y);
  await input.click();
  await input.type('علی احمد', { cps: 40 });
  assert.equal(await page.evaluate('document.getElementById("urdu").value'), 'علی احمد');
});

test('a typo is made and then corrected, ending with the right text', async () => {
  const [x, y] = await center('#name');
  await input.moveTo(x, y);
  await input.click();
  await input.press('Control+A');
  await input.type('typing with typos', { cps: 50, typos: 0.5 });
  assert.equal(await page.evaluate('document.getElementById("name").value'), 'typing with typos');
});

test('shortcuts and special keys work, and a key badge is shown', async () => {
  await input.press('Control+S');
  await sleep(150);
  const ev = await events();
  assert.ok(ev.includes('SHORTCUT save'));
  assert.ok(ev.some((e) => e.startsWith('keydown s ') && e.includes('ctrl=true')));
  assert.ok((await page.evaluate('__demo.keyBadges')) >= 1);
  await input.press('Backspace');
  assert.equal(await page.evaluate('document.getElementById("name").value'), 'typing with typo');
});

test('wheel scrolling moves the scroll area under the pointer, not the page', async () => {
  await page.evaluate('document.getElementById("scroller").scrollIntoView({block:"center"})');
  await sleep(200);
  const [x, y] = await center('#scroller');
  await input.moveTo(x, y);
  const before = await page.evaluate('[document.getElementById("scroller").scrollTop, document.scrollingElement.scrollTop]');
  await input.wheel(220, { duration: 500 });
  await sleep(500);
  const after = await page.evaluate('[document.getElementById("scroller").scrollTop, document.scrollingElement.scrollTop]');
  assert.ok(after[0] > before[0] + 100, `scroll area moved: ${before[0]} -> ${after[0]}`);
});

test('wheel scrolling over the page moves the page smoothly', async () => {
  await input.moveTo(1000, 300);
  await input.wheel(600, { duration: 600 });
  await sleep(600);
  assert.ok((await page.evaluate('document.scrollingElement.scrollTop')) > 400);
});
