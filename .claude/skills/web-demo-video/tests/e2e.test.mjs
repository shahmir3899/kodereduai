import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listWindowsVoices } from '../scripts/lib/check.mjs';

const html = readFileSync(new URL('./fixtures/app.html', import.meta.url), 'utf8');
const demo = fileURLToPath(new URL('../scripts/demo.mjs', import.meta.url));
let server, base, dir, scenarioFile, outDir;
const hasVoice = listWindowsVoices().some((v) => v.culture.startsWith('en'));

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  dir = mkdtempSync(join(tmpdir(), 'wdv-e2e-'));
  outDir = join(dir, 'out');
  scenarioFile = join(dir, 'fixture.scenario.json');
  writeFileSync(
    scenarioFile,
    JSON.stringify({
      version: 1,
      name: 'fixture',
      languages: ['en', 'ur'],
      meta: {
        app: 'Test app',
        title: { en: 'Fill in a form', ur: 'فارم بھریں' },
        subtitle: { en: 'It takes less than a minute', ur: 'ایک منٹ سے کم وقت لگتا ہے' },
        learn: { en: ['Open the menu', 'Type your name'], ur: ['مینو کھولیں', 'اپنا نام لکھیں'] },
      },
      target: { url: base, viewport: { width: 1280, height: 720 } },
      voice: { engine: 'sapi', engines: { ur: 'none' } },
      music: { track: 'calm' },
      intro: { say: { en: 'This video shows how to fill in a form.' } },
      outro: { headline: { en: 'That is all', ur: 'بس اتنا ہی' }, say: { en: 'That is all. Thank you.' } },
      steps: [
        { id: 'menu', caption: { en: 'Step 1: Open the menu', ur: 'مرحلہ ۱: مینو کھولیں' }, say: { en: 'First, hover over Reports to open the menu.' }, do: [{ hover: 'Reports', for: 0.8 }, { click: 'Daily report' }], expect: { url: '#daily' } },
        { id: 'name', chapter: { en: 'Your details', ur: 'آپ کی تفصیلات' }, caption: { en: 'Step 2: Type your name', ur: 'مرحلہ ۲: اپنا نام لکھیں' }, say: { en: 'Now type your name.' }, do: [{ type: 'Aisha Khan', into: { label: 'Full name' } }, { press: 'Control+S' }], expect: { text: 'SHORTCUT save' } },
        { id: 'save', caption: { en: 'Step 3: Save', ur: 'مرحلہ ۳: محفوظ کریں' }, say: { en: 'Finally, press Save.' }, do: [{ click: { css: '#save' } }], expect: { text: 'Saved!' } },
      ],
    }),
  );
});
after(() => server?.close());

const cli = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn('node', [demo, ...args], { env: { ...process.env, WDV_MUSIC_SECONDS: '150', ...env }, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const ffprobeJson = (file, extra = []) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-of', 'json', ...extra, file], { encoding: 'utf8' }).stdout);

test('validate and the narration script work without opening a browser', async () => {
  const v = await cli(['validate', scenarioFile]);
  assert.equal(v.code, 0, v.stderr);
  assert.match(v.stdout, /OK: "fixture" has 3 step\(s\) for en and ur/);
  const s = await cli(['script', scenarioFile, '--lang', 'en']);
  assert.match(s.stdout, /\[menu\]\nFirst, hover over Reports/);
  const u = await cli(['script', scenarioFile, '--lang', 'ur']);
  assert.ok(!/First, hover/.test(u.stdout), 'no English narration in the Urdu script');
});

test('the online voice is refused without consent (exit code 3) and nothing is recorded', { timeout: 60000 }, async () => {
  const r = await cli(['record', scenarioFile, '--lang', 'en', '--voice', 'edge', '--out', join(dir, 'nooutput')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /sends the narration text over the internet to Microsoft/);
  assert.ok(!existsSync(join(dir, 'nooutput', 'fixture.en.mp4')));
});

test('English: voice, music, heading slide, chapters, captions files, poster and a passing quality check', { skip: !hasVoice, timeout: 400000 }, async () => {
  const r = await cli(['record', scenarioFile, '--lang', 'en', '--out', outDir, '--music', 'calm']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const mp4 = join(outDir, 'fixture.en.mp4');
  assert.ok(existsSync(mp4));
  const j = ffprobeJson(mp4, ['-show_streams', '-show_format', '-show_chapters']);
  // (the chapter marks appear as a small data stream, which is normal in MP4)
  assert.deepEqual(j.streams.filter((s) => s.codec_type !== 'data').map((s) => s.codec_name).sort(), ['aac', 'h264']);
  const v = j.streams.find((s) => s.codec_type === 'video');
  assert.equal(`${v.width}x${v.height}`, '1280x720');
  assert.ok(Number(j.format.duration) > 25 && Number(j.format.duration) < 90, `duration ${j.format.duration}`);
  assert.ok(j.chapters.length >= 5, `chapters: ${j.chapters.length}`);
  assert.equal(j.format.tags.title, 'Fill in a form');

  const srt = readFileSync(join(outDir, 'fixture.en.srt'), 'utf8');
  assert.match(srt, /First, hover over Reports/);
  assert.match(srt, /00:00:\d\d,\d{3} --> 00:00:\d\d,\d{3}/);
  assert.match(readFileSync(join(outDir, 'fixture.en.vtt'), 'utf8'), /^WEBVTT/);
  for (const f of ['fixture.en.poster.jpg', join('qa', 'fixture.en.contact.jpg'), join('qa', 'fixture.en.qa.json'), join('qa', 'fixture.en.qa.md')]) assert.ok(existsSync(join(outDir, f)), `${f} exists`);

  const qa = JSON.parse(readFileSync(join(outDir, 'qa', 'fixture.en.qa.json'), 'utf8'));
  assert.notEqual(qa.verdict, 'fail', JSON.stringify(qa.issues));
  assert.ok(Math.abs(qa.metrics.loudness + 16) < 2, `loudness ${qa.metrics.loudness}`);
  assert.equal(qa.voiceClips, 5);
});

test('Urdu: captions and slides in Urdu, no voice (no Urdu voice is installed), music still plays', { timeout: 400000 }, async () => {
  const r = await cli(['record', scenarioFile, '--lang', 'ur', '--out', outDir, '--music', 'warm']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  const mp4 = join(outDir, 'fixture.ur.mp4');
  const j = ffprobeJson(mp4, ['-show_streams', '-show_format']);
  assert.ok(j.streams.some((s) => s.codec_type === 'audio'), 'music track present');
  assert.equal(j.streams.find((s) => s.codec_type === 'video').tags?.language, 'urd');
  assert.equal(j.streams.find((s) => s.codec_type === 'audio').tags?.language, 'urd');
  const srt = readFileSync(join(outDir, 'fixture.ur.srt'), 'utf8');
  assert.match(srt, /مرحلہ ۱/);
  const qa = JSON.parse(readFileSync(join(outDir, 'qa', 'fixture.ur.qa.json'), 'utf8'));
  assert.notEqual(qa.verdict, 'fail', JSON.stringify(qa.issues));
  assert.equal(qa.voiceClips, 0);
});

test('render makes new output from the last recording with a different music track and preset, without recording again', { skip: !hasVoice, timeout: 300000 }, async () => {
  const before = readFileSync(join(outDir, '.work', 'fixture', 'en', 'take.json'), 'utf8');
  const r = await cli(['render', scenarioFile, '--lang', 'en', '--out', outDir, '--music', 'minimal', '--preset', 'whatsapp']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(readFileSync(join(outDir, '.work', 'fixture', 'en', 'take.json'), 'utf8'), before, 'the take itself was not redone');
  const info = ffprobeJson(join(outDir, 'fixture.en.mp4'), ['-show_format']);
  assert.ok(Number(info.format.size) / 1048576 < 15, `size ${(Number(info.format.size) / 1048576).toFixed(1)} MB`);
});
