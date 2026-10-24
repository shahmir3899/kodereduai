import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { createRunner } from '../scripts/lib/actor.mjs';
import { buildConcatList, startRecording } from '../scripts/lib/recorder.mjs';
import { loadScenario } from '../scripts/lib/scenario.mjs';
import { openSession } from '../scripts/lib/session.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
let server, base, dir;
before(async () => {
  server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  dir = mkdtempSync(join(tmpdir(), 'wdv-rec-'));
});
after(() => server?.close());

test('every saved frame stays on screen until the next arrives, and the list covers the whole take', () => {
  const list = buildConcatList([{ ts: 10.2, file: 'a.jpg' }, { ts: 10.5, file: 'b.jpg' }, { ts: 12.5, file: 'c.jpg' }], 10, 13);
  const durations = [...list.matchAll(/duration ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(durations.map((d) => +d.toFixed(2)), [0.5, 2, 0.5]);
  assert.equal(+durations.reduce((a, b) => a + b, 0).toFixed(2), 3);
  assert.ok(list.trim().endsWith("file 'c.jpg'"), 'last file is repeated, as ffmpeg requires');
});

async function take(viewport, steps) {
  const file = join(dir, `s-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, name: 'rec', languages: ['en'], meta: { title: { en: 'Recording test' } }, target: { url: base, viewport }, steps }));
  const scenario = loadScenario(file);
  const session = await openSession({ scenario, lang: 'en' });
  const runner = createRunner({ scenario, lang: 'en', session, outDir: dir });
  try {
    await runner.setup();
    const out = join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`);
    const recorder = await startRecording({ driver: 'page', session, outFile: out, viewport: scenario.target.viewport });
    await runner.run();
    const result = await recorder.stop();
    return { result, elapsed: result.endWall - result.startWall };
  } finally {
    await session.close();
  }
}

const steps = [
  { id: 'hover', caption: { en: 'Hover over Reports' }, do: [{ hover: 'Reports', for: 0.6 }, { click: 'Daily report' }] },
  { id: 'type', caption: { en: 'Type a name' }, do: [{ type: 'Aisha Khan', into: { label: 'Full name' } }] },
];

test('the page recorder makes a smooth, exact-size MP4 whose length matches the take', { timeout: 120000 }, async () => {
  const { result, elapsed } = await take({ width: 1100, height: 700, scale: 1 }, steps);
  assert.equal(result.width, 1100);
  assert.equal(result.height, 700);
  assert.ok(Math.abs(result.duration - elapsed) < 0.6, `video ${result.duration.toFixed(2)}s vs take ${elapsed.toFixed(2)}s`);
  assert.ok(result.framesPerSecond > 10, `screencast delivered ${result.framesPerSecond.toFixed(1)} frames per second on average`);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,codec_name,pix_fmt', '-of', 'csv=p=0', result.file], { encoding: 'utf8' }).stdout.trim();
  assert.equal(probe, 'h264,yuv420p,30/1');
  const frozen = spawnSync('ffmpeg', ['-hide_banner', '-ss', '7.5', '-i', result.file, '-vf', 'freezedetect=n=0.003:d=5', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  assert.ok(!/freeze_start/.test(frozen), `no frozen stretch longer than 5 s after the heading slide\n${frozen.split('\n').filter((l) => /freeze/.test(l)).join('\n')}`);
});

test('a larger viewport gives a larger, sharper video', { timeout: 120000 }, async () => {
  const { result } = await take({ width: 1600, height: 900, scale: 1 }, steps.slice(0, 1));
  assert.equal(result.width, 1600);
  assert.equal(result.height, 900);
});
