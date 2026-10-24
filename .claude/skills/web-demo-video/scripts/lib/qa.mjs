// Quality checks after every take: contact sheet, black and frozen pictures, sound level, voice presence,
// and the problems the page itself reported. Produces a verdict the skill reads before showing the video to the user.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { measureLoudness } from './audio.mjs';

const run = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });

export function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { duration: Number(j.format.duration), sizeMB: Number(j.format.size) / 1048576, width: v?.width, height: v?.height, fps: v ? Number(v.r_frame_rate.split('/')[0]) / Number(v.r_frame_rate.split('/')[1] || 1) : null, video: v?.codec_name, audio: a?.codec_name ?? null };
}

/** One small picture per step (taken just after it starts), tiled into a single image to look at. */
export function contactSheet(video, out, times, { columns = 4, width = 480 } = {}) {
  mkdirSync(dirname(out), { recursive: true });
  const rows = Math.ceil(times.length / columns);
  const inputs = times.flatMap((t) => ['-ss', Math.max(0, t).toFixed(2), '-i', video]);
  const scaled = times.map((_, i) => `[${i}:v]select=eq(n\\,0),scale=${width}:-1[s${i}]`).join(';');
  const stack = `${times.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${times.length}:layout=${times.map((_, i) => `${(i % columns) * width}_${Math.floor(i / columns) * Math.round((width * 9) / 16)}`).join('|')}:fill=black[out]`;
  const r = run(['-y', ...inputs, '-filter_complex', `${scaled};${stack}`, '-map', '[out]', '-frames:v', '1', out]);
  if (r.status !== 0) {
    // fall back to a simple one-frame-per-5-seconds sheet
    const f = run(['-y', '-i', video, '-vf', `fps=1/5,scale=${width}:-1,tile=${columns}x${rows}`, '-frames:v', '1', out]);
    if (f.status !== 0) throw new Error(`Could not make the contact sheet: ${r.stderr.slice(0, 200)}`);
  }
  return out;
}

function windows(stderr, startKey, endKey) {
  const starts = [...stderr.matchAll(new RegExp(`${startKey}[:=] ?([\\d.]+)`, 'g'))].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(new RegExp(`${endKey}[:=] ?([\\d.]+)`, 'g'))].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? null }));
}

/**
 * Looks for trouble. `allowStill` lists spans where a still picture is intended (heading slides, the final hold).
 * Returns { verdict: 'pass' | 'warn' | 'fail', issues: [{ level, message }], metrics }.
 */
export function analyze({ video, timeline = [], offset = 0, diagnostics = [], warnings = [], expectAudio = false, expectDuration = null }) {
  const issues = [];
  const add = (level, message) => issues.push({ level, message });
  const info = probe(video);
  const metrics = { ...info };

  if (expectDuration && Math.abs(info.duration - expectDuration) > 1) add('fail', `the video is ${info.duration.toFixed(1)} s but the take lasted ${expectDuration.toFixed(1)} s`);
  if (info.fps && Math.abs(info.fps - 30) > 6 && Math.abs(info.fps - 24) > 1) add('warn', `unusual frame rate ${info.fps}`);

  const black = run(['-i', video, '-vf', 'blackdetect=d=0.6:pix_th=0.08', '-an', '-f', 'null', '-']).stderr;
  for (const w of windows(black, 'black_start', 'black_end')) add('fail', `a black picture from ${w.start.toFixed(1)} s${w.end ? ` to ${w.end.toFixed(1)} s` : ''}`);

  const allowStill = timeline.filter((t) => t.kind === 'slide').map((t) => [t.start + offset - 0.2, t.end + offset + 0.2]);
  allowStill.push([info.duration - 4.5, info.duration + 1]);
  // While narration is being spoken a still picture is fine: the listener has something to follow.
  const speaking = timeline.filter((t) => t.say).map((t) => [t.start + offset - 0.5, t.start + offset + t.say.duration + 1.5]);
  const freeze = run(['-i', video, '-vf', 'freezedetect=n=0.0006:d=6', '-an', '-f', 'null', '-']).stderr;
  for (const w of windows(freeze, 'freeze_start', 'freeze_end')) {
    const end = w.end ?? info.duration;
    const intended = allowStill.some(([a, b]) => w.start >= a - 3 && end <= b + 3) || (end - w.start < 12 && speaking.some(([a, b]) => w.start >= a - 1 && end <= b + 1));
    if (!intended) add('warn', `the picture does not change from ${w.start.toFixed(1)} s to ${end.toFixed(1)} s`);
  }

  if (expectAudio) {
    if (!info.audio) add('fail', 'the video has no sound but sound was expected');
    else {
      const l = measureLoudness(video);
      metrics.loudness = l.integrated;
      metrics.truePeak = l.truePeak;
      if (Math.abs(l.integrated + 16) > 2) add('warn', `the sound level is ${l.integrated.toFixed(1)} LUFS (the target is -16)`);
      if (l.truePeak > -0.9) add('warn', `the sound peaks at ${l.truePeak.toFixed(1)} dB and may distort`);
      for (const t of timeline.filter((x) => x.say)) {
        const at = t.start + offset + 0.5;
        const r = run(['-ss', at.toFixed(2), '-t', String(Math.min(1.2, t.say.duration - 0.4)), '-i', video, '-af', 'volumedetect', '-vn', '-f', 'null', '-']).stderr;
        const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(r)?.[1] ?? -91);
        if (mean < -45) add('fail', `no voice is heard where "${t.id}" should be speaking (${at.toFixed(1)} s)`);
      }
    }
  }

  const seen = new Set();
  for (const d of diagnostics) {
    const key = `${d.kind}:${d.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add('warn', `the page reported a problem during the take (${d.kind}): ${String(d.text).slice(0, 160)}`);
  }
  for (const w of warnings) add('warn', w.text);

  const verdict = issues.some((i) => i.level === 'fail') ? 'fail' : issues.length ? 'warn' : 'pass';
  return { verdict, issues, metrics };
}

export function writeReport(dir, name, lang, result, extra = {}) {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${name}.${lang}.qa.json`);
  writeFileSync(json, JSON.stringify({ ...result, ...extra }, null, 2));
  const md = [`# Quality report: ${name} (${lang})`, '', `Verdict: **${result.verdict.toUpperCase()}**`, '', '| Item | Value |', '|---|---|', ...Object.entries(result.metrics).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `| ${k} | ${typeof v === 'number' ? +v.toFixed(2) : v} |`), '', result.issues.length ? '## Issues' : 'No issues found.', ...result.issues.map((i) => `- **${i.level}**: ${i.message}`)].join('\n');
  writeFileSync(join(dir, `${name}.${lang}.qa.md`), md);
  return json;
}
