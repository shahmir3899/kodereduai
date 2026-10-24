import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createRunner, StepError } from '../scripts/lib/actor.mjs';
import { loadScenario, stripComments, tr, validateScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
let server, base, dir;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  dir = mkdtempSync(join(tmpdir(), 'wdv-test-'));
});
after(() => server?.close());

const baseScenario = (extra = {}) => ({
  version: 1,
  name: 'fixture',
  languages: ['en', 'ur'],
  meta: { app: 'Test app', title: { en: 'Fill the form', ur: 'فارم بھریں' }, subtitle: { en: 'A short demo' }, learn: { en: ['Hover', 'Type'] } },
  target: { url: base, viewport: { width: 1100, height: 700 } },
  steps: [],
  ...extra,
});
const write = (s) => {
  const file = join(dir, `${s.name}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(s));
  return file;
};

test('comments and trailing commas are allowed in scenario files', () => {
  const parsed = JSON.parse(stripComments('{ "a": "x // not a comment", /* gone */ "b": [1, 2,], // end\n}'));
  assert.deepEqual(parsed, { a: 'x // not a comment', b: [1, 2] });
});

test('texts fall back to English and plain strings serve every language', () => {
  assert.equal(tr({ en: 'Hi', ur: 'سلام' }, 'ur'), 'سلام');
  assert.equal(tr({ en: 'Hi' }, 'ur'), 'Hi');
  assert.equal(tr('Same', 'ur'), 'Same');
  assert.equal(tr(undefined, 'en'), undefined);
});

test('mistakes are explained in plain words, with a suggestion for typos', () => {
  const errors = validateScenario(baseScenario({ steps: [{ id: 'a', do: [{ clik: 'Save' }] }, { id: 'a', do: [{ click: { txt: 'x' } }] }, { id: 'c', do: [{ type: 5 }, { select: 'Red' }, { scroll: {} }, { wait: -1 }] }] }));
  const text = errors.join('\n');
  assert.match(text, /steps\[0\]\.do\[0\]: unknown key "clik" \(did you mean "click"\?\)/);
  assert.match(text, /"a" is used twice/);
  assert.match(text, /unknown locator key "txt"/);
  assert.match(text, /type: must be the text to type/);
  assert.match(text, /select needs "in"/);
  assert.match(text, /use \{"by": 300\} or \{"to"/);
  assert.match(text, /wait: must be a number of seconds/);
});

test('a valid scenario loads with defaults filled in', () => {
  const s = loadScenario(write(baseScenario({ steps: [{ id: 'one', do: [{ click: 'Save' }] }] })));
  assert.equal(s.style.speed, 'normal');
  assert.equal(s.target.viewport.scale, 1);
  assert.throws(() => loadScenario(write(baseScenario())), /at least one step/);
  assert.throws(() => loadScenario(join(dir, 'missing.json')), /Cannot read the scenario/);
});

async function rehearse(steps, extra = {}, after = null) {
  const scenario = loadScenario(write(baseScenario({ steps, ...extra })));
  const session = await openSession({ scenario, lang: 'en', speed: 'brisk', factor: 0.4 });
  const runner = createRunner({ scenario, lang: 'en', session, outDir: dir, fast: true });
  try {
    await runner.setup();
    const result = await runner.run();
    const state = after ? await after(session.page) : null;
    return { result, session, runner, state };
  } finally {
    await session.close();
  }
}

test('every kind of action works on the test page, with real input', { timeout: 120000 }, async () => {
  const steps = JSON.parse(readFileSync(new URL('./fixtures/all-actions.steps.json', import.meta.url), 'utf8'));
  const { result, session, state } = await rehearse(steps, {}, (page) =>
    page.evaluate('({name: document.getElementById("name").value, pick: document.getElementById("pick").value, agree: document.getElementById("agree").checked, urdu: document.getElementById("urdu").value, scroller: document.getElementById("scroller").scrollTop, tab: document.getElementById("tabtext").textContent, trusted: __events.filter((e) => e.includes("trusted=true")).length, saved: !document.getElementById("saved").hidden, details: document.getElementById("more").open})'),
  );
  assert.equal(result.timeline.filter((t) => t.kind === 'step').length, 9);
  assert.equal(state.name, 'Aisha Khan');
  assert.equal(state.pick, 'green');
  assert.equal(state.agree, true);
  assert.equal(state.urdu, 'علی');
  assert.equal(state.tab, 'Details content.');
  assert.equal(state.saved, true);
  assert.equal(state.details, true);
  assert.ok(state.scroller > 100, 'the inner scroll area moved');
  assert.ok(state.trusted >= 10, 'keys and clicks were real (trusted) events');
  assert.equal(session.diagnostics.filter((d) => d.kind === 'page-error').length, 0);
});

test('a missing thing fails with the step, the locator, and a screenshot', { timeout: 60000 }, async () => {
  await assert.rejects(
    () => rehearse([{ id: 'oops', do: [{ click: { text: 'No such button' } }] }]),
    (e) => {
      assert.ok(e instanceof StepError);
      assert.match(e.message, /Step "oops": could not find .*No such button/);
      assert.ok(e.screenshot && e.screenshot.endsWith('oops.en.png'));
      return true;
    },
  );
});

test('a wrong expectation fails instead of being recorded', { timeout: 60000 }, async () => {
  await assert.rejects(() => rehearse([{ id: 'wrong', do: [{ click: 'Save' }], expect: { text: 'This never appears', timeout: 0.5 } }]), /expected the page to show "This never appears"/);
  await assert.rejects(() => rehearse([{ id: 'bad-text', do: [{ click: 'Save' }], expect: { notText: 'Saved!', timeout: 0.5 } }]), /must not show "Saved!"/);
});

test('forbidden text stops the take', { timeout: 60000 }, async () => {
  await assert.rejects(() => rehearse([{ id: 'peek', do: [{ click: 'Save' }] }], { target: { url: base, viewport: { width: 1100, height: 700 }, forbidden: ['Bottom of the page'] } }), /must never be in a demo: "Bottom of the page"/);
});

test('an address that is not on this machine is refused', { timeout: 60000 }, async () => {
  await assert.rejects(() => rehearse([{ id: 'away', do: [{ goto: 'https://example.com/' }] }]), /Refusing to record example\.com/);
});

test('an ambiguous locator is reported as a warning, with the first one used', { timeout: 60000 }, async () => {
  const { result } = await rehearse([{ id: 'two', do: [{ click: { role: 'tab' } }] }]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].text, /matches 2 elements/);
});

test('captions and slides show, and the timeline has start and end times for each', { timeout: 60000 }, async () => {
  const { result } = await rehearse([{ id: 'a', caption: { en: 'Hello caption' }, do: [{ wait: 0.1 }] }, { id: 'b', chapter: { en: 'Part two' }, do: [{ wait: 0.1 }] }], { outro: { headline: { en: 'Bye' } } });
  const kinds = result.timeline.map((t) => `${t.kind}:${t.id}`);
  assert.deepEqual(kinds, ['slide:intro', 'step:a', 'slide:chapter:b', 'step:b', 'slide:outro']);
  for (const t of result.timeline) assert.ok(t.end >= t.start, `${t.id} ends after it starts`);
  assert.equal(result.timeline.find((t) => t.id === 'a').caption, 'Hello caption');
});
