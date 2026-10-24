import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { listWindowsVoices } from '../scripts/lib/check.mjs';
import { buildMixArgs, measureLoudness, mixTracks, muxWithLoudness } from '../scripts/lib/audio.mjs';

process.env.WDV_MUSIC_SECONDS = '14';
const { BUILT_IN, generateTrack, listTracks, resolveTrack } = await import('../scripts/lib/music.mjs');
const { ConsentError, audioDuration, narrationItems, narrationScript, prepareNarration, pronounce } = await import('../scripts/lib/tts.mjs');

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'wdv-audio-'));
});

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
const tone = (file, freq, seconds, volume = 0.5) => ff(['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-af', `volume=${volume * 8}`, '-ar', '48000', file]);
const stat = (file, filter, fromSec, toSec) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(fromSec), '-t', String(toSec - fromSec), '-i', file, '-af', `${filter ? `${filter},` : ''}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? -91);
};

const scenario = (extra = {}) => ({
  name: 'audio',
  __dir: dir,
  meta: { title: { en: 'Title' } },
  intro: { say: { en: 'Welcome to MediDesk.' } },
  steps: [
    { id: 'one', chapter: { en: 'Part' }, chapterSay: { en: 'Part one.' }, say: { en: 'Click the button.' } },
    { id: 'two', say: { en: 'Done now.', ur: 'ہو گیا۔' } },
    { id: 'silent' },
  ],
  outro: { say: { en: 'Goodbye.' } },
  ...extra,
});

test('narration lines are collected in the order they are spoken, with only the ones that exist', () => {
  assert.deepEqual(narrationItems(scenario(), 'en').map((i) => i.key), ['intro', 'chapter:one', 'one', 'two', 'outro']);
  assert.deepEqual(narrationItems(scenario(), 'ur').map((i) => i.key), ['two']);
  assert.match(narrationScript(scenario(), 'en'), /\[one\]\nClick the button\./);
});

test('product names can be given a spoken form', () => {
  assert.equal(pronounce('Open MediDesk now', { MediDesk: 'Medi Desk' }), 'Open Medi Desk now');
});

test('the online voice is refused until the user has agreed, and the text to be sent is shown', () => {
  const s = scenario({ voice: { engine: 'edge' } });
  assert.throws(() => prepareNarration({ scenario: s, lang: 'en', outDir: dir }), (e) => {
    assert.ok(e instanceof ConsentError);
    assert.match(e.message, /sends the narration text over the internet to Microsoft/);
    assert.match(e.message, /\[one\] Click the button\./);
    assert.match(e.message, /--allow-online-tts/);
    return true;
  });
});

test('your own recordings are found by step name and language, and a missing one is named', () => {
  const audioDir = join(dir, 'own');
  mkdirSync(audioDir, { recursive: true });
  for (const k of ['intro', 'chapter-one', 'one', 'two']) tone(join(audioDir, `${k}.en.wav`), 440, 1.2);
  const s = scenario({ voice: { engine: 'files', dir: 'own' } });
  assert.throws(() => prepareNarration({ scenario: s, lang: 'en', outDir: dir }), /No audio file for "outro"/);
  tone(join(audioDir, 'outro.wav'), 440, 0.8);
  const { clips } = prepareNarration({ scenario: s, lang: 'en', outDir: dir });
  assert.deepEqual(Object.keys(clips), ['intro', 'chapter:one', 'one', 'two', 'outro']);
  assert.ok(Math.abs(clips.one.duration - 1.2) < 0.1);
});

test('an Urdu voice that does not exist is explained instead of silently using English', { skip: process.platform !== 'win32' }, () => {
  if (listWindowsVoices().some((v) => v.culture.toLowerCase().startsWith('ur'))) return;
  assert.throws(() => prepareNarration({ scenario: scenario({ voice: { engine: 'sapi' } }), lang: 'ur', outDir: dir }), /No Urdu voice is installed/);
});

test('the offline Windows voice speaks, and the same line is not spoken twice', { skip: !listWindowsVoices().some((v) => v.culture.startsWith('en')), timeout: 120000 }, () => {
  const s = scenario({ voice: { engine: 'sapi', pronounce: { MediDesk: 'Medi Desk' } } });
  const first = prepareNarration({ scenario: s, lang: 'en', outDir: dir });
  assert.equal(first.engine, 'sapi');
  const clip = first.clips.intro;
  assert.ok(existsSync(clip.file));
  assert.ok(clip.duration > 0.8 && clip.duration < 6, `intro line is ${clip.duration}s`);
  const mtime = (await_free(clip.file));
  const again = prepareNarration({ scenario: s, lang: 'en', outDir: dir });
  assert.equal(again.clips.intro.file, clip.file);
  assert.equal(await_free(again.clips.intro.file), mtime, 'cached clip reused');
  assert.ok(audioDuration(clip.file) > 0.5);
});
function await_free(file) {
  return spawnSync('node', ['-e', `console.log(require('fs').statSync(${JSON.stringify(file)}).mtimeMs)`], { encoding: 'utf8' }).stdout.trim();
}

test('all four built-in music tracks can be made, are stereo, audible and do not clip', { timeout: 300000 }, () => {
  for (const name of Object.keys(BUILT_IN)) {
    const out = join(dir, `music-${name}.m4a`);
    generateTrack(name, out);
    assert.ok(Math.abs(audioDuration(out) - 14) < 0.5, `${name} is about 14 s`);
    const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels,codec_name', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim();
    assert.equal(info, 'aac,2');
    const loud = measureLoudness(out);
    assert.ok(loud.integrated > -30 && loud.integrated < -12, `${name} loudness ${loud.integrated}`);
    assert.ok(loud.truePeak < -0.5, `${name} true peak ${loud.truePeak}`);
    assert.ok(stat(out, '', 4, 12) > -45, `${name} is not silent`);
  }
});

test('track names resolve, unknown ones are explained, and "none" means no music', () => {
  assert.equal(resolveTrack('none'), null);
  assert.throws(() => resolveTrack('jazz-fusion'), /Music "jazz-fusion" was not found/);
  assert.ok(listTracks().some((t) => t.name === 'calm' && t.kind === 'built-in'));
});

test('narration lands at the right moments, music dips under speech, and the final level is steady', { timeout: 300000 }, () => {
  const music = join(dir, 'music-calm.m4a');
  const v1 = join(dir, 'v1.wav'), v2 = join(dir, 'v2.wav');
  tone(v1, 220, 1.5, 0.6);
  tone(v2, 220, 1.5, 0.6);
  const clips = [{ file: v1, start: 2.0 }, { file: v2, start: 8.0 }];

  // where does speech start?
  const voiceOnly = join(dir, 'voice-only.wav');
  mixTracks({ clips, duration: 12, out: voiceOnly });
  assert.ok(Math.abs(audioDuration(voiceOnly) - 12) < 0.05);
  assert.ok(stat(voiceOnly, '', 1.0, 1.8) < -80, 'silent before the first line');
  assert.ok(stat(voiceOnly, '', 2.1, 3.3) > -20, 'speech at 2.0 s');
  assert.ok(stat(voiceOnly, '', 3.7, 7.5) < -80, 'silent between the lines');
  assert.ok(stat(voiceOnly, '', 8.1, 9.3) > -20, 'speech at 8.0 s');

  // does the music dip? Use a steady 1 kHz tone as the "music" and look only above 800 Hz, where the 220 Hz "voice" is not.
  const steady = join(dir, 'music-tone.wav');
  tone(steady, 1000, 14, 0.4);
  const ducked = join(dir, 'ducked.wav'), plain = join(dir, 'plain.wav');
  mixTracks({ clips, music: { file: steady, volume: 0.5 }, duration: 12, duck: true, out: ducked });
  mixTracks({ clips, music: { file: steady, volume: 0.5 }, duration: 12, duck: false, out: plain });
  const band = 'highpass=f=800,highpass=f=800';
  const dip = stat(plain, band, 2.4, 3.2) - stat(ducked, band, 2.4, 3.2);
  assert.ok(dip > 6, `music is ${dip.toFixed(1)} dB lower while someone speaks`);
  const recovered = Math.abs(stat(plain, band, 5.6, 7.0) - stat(ducked, band, 5.6, 7.0));
  assert.ok(recovered < 2, `music is back to normal between the lines (${recovered.toFixed(1)} dB apart)`);

  // a steady final level, correct length, and AAC sound on the video
  const video = join(dir, 'blank.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  const final = join(dir, 'final.mp4');
  muxWithLoudness({ video, audio: ducked, out: final, duration: 12 });
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-show_entries', 'format=duration', '-of', 'json', final], { encoding: 'utf8' });
  const j = JSON.parse(probe.stdout);
  assert.deepEqual(j.streams.map((s) => s.codec_name).sort(), ['aac', 'h264']);
  assert.ok(Math.abs(Number(j.format.duration) - 12) < 0.15);
  const loud = measureLoudness(final);
  assert.ok(Math.abs(loud.integrated + 16) < 1.5, `final loudness ${loud.integrated} LUFS (target -16)`);
  assert.ok(loud.truePeak <= -1, `true peak ${loud.truePeak}`);
});

test('a mix with nothing in it is an error, not an empty file', () => {
  assert.throws(() => buildMixArgs({ duration: 5, out: 'x.wav' }), /nothing to mix/);
});
