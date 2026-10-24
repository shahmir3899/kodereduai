// Background music. Four calm, royalty-free ambient tracks are generated with ffmpeg itself (no downloads, no licences),
// plus anything in the user's own music folder. A track name, or a path to any audio file, picks one.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(here, '..', '..');
export const BUILT_IN_DIR = join(SKILL_DIR, 'assets', 'music');
export const USER_DIR = process.env.WEB_DEMO_MUSIC_DIR ?? join(SKILL_DIR, 'music');
const AUDIO = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'];
// 150 seconds covers a normal video; WDV_MUSIC_SECONDS makes short tracks for tests.
const DURATION = Number(process.env.WDV_MUSIC_SECONDS ?? 150);

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const num = (n) => Number(n.toFixed(4));

/** A soft pad: each note drifts a little in pitch and swells slowly, so it never sounds like a held organ. */
function pad(midis, T, level, detune) {
  const each = level / Math.sqrt(midis.length);
  return midis
    .map((m, i) => `${num(each)}*(0.68+0.32*sin(2*PI*${num(0.035 + 0.019 * i)}*${T}+${i * 1.7}))*sin(2*PI*${num(hz(m) * (1 + detune))}*${T}+0.55*sin(2*PI*${num(0.09 + 0.027 * i)}*${T}+${i}))`)
    .join('+');
}

/** A gentle repeating melody of soft plucks. */
function plucks(midis, T, interval, decay, level) {
  const idx = `mod(floor(${T}/${interval}),${midis.length})`;
  const pick = midis.reduceRight((acc, m, i) => `if(eq(${idx},${i}),${num(hz(m))},${acc})`, `${num(hz(midis[0]))}`);
  const since = `mod(${T},${interval})`;
  return `${level}*exp(-${decay}*${since})*(1-exp(-70*${since}))*(sin(2*PI*${pick}*${since})+0.28*sin(4*PI*${pick}*${since}))`;
}

export const BUILT_IN = {
  calm: { mood: 'slow, spacious, relaxed', pad: [45, 52, 57, 60, 64, 67, 71], melody: [69, 72, 76, 72, 74, 71, 67, 71], interval: 3.0, decay: 1.3, level: 0.1 },
  warm: { mood: 'friendly and gentle, slightly brighter', pad: [36, 48, 55, 59, 62, 64], melody: [72, 76, 79, 76, 74, 71, 67, 74], interval: 2.5, decay: 1.7, level: 0.11 },
  bright: { mood: 'light and upbeat, a little quicker', pad: [43, 50, 55, 59, 62, 69], melody: [79, 83, 86, 83, 81, 78, 74, 78], interval: 1.25, decay: 3.0, level: 0.1 },
  minimal: { mood: 'a quiet drone with a few notes, stays out of the way', pad: [38, 45, 50, 57], melody: [74, 81, 78], interval: 6.0, decay: 0.9, level: 0.07 },
};

function expression(spec, shift, detune) {
  const T = shift ? `(t+${shift})` : 't';
  return `${pad(spec.pad, T, 0.34, detune)}+${plucks(spec.melody, T, spec.interval, spec.decay, spec.level)}`;
}

export function generateTrack(name, outFile) {
  const spec = BUILT_IN[name];
  if (!spec) throw new Error(`There is no built-in track "${name}". Choose ${Object.keys(BUILT_IN).join(', ')}.`);
  mkdirSync(dirname(outFile), { recursive: true });
  const left = expression(spec, 0, 0);
  const right = expression(spec, 0.37, 0.0025);
  const source = `aevalsrc=exprs='${left}|${right}':s=44100:d=${DURATION}`;
  const post = `lowpass=f=2600,aecho=0.8:0.82:70|140:0.32|0.22,loudnorm=I=-20:TP=-3:LRA=7,afade=t=in:d=3,afade=t=out:st=${DURATION - 4}:d=4`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-af', post, '-c:a', 'aac', '-b:a', '128k', outFile], { encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) throw new Error(`Could not make the music track "${name}": ${r.stderr.slice(0, 300)}`);
  return outFile;
}

export function builtInPath(name) {
  return join(BUILT_IN_DIR, `${name}.m4a`);
}

/** Every track a person can pick. Built-in ones are made the first time they are needed. */
export function listTracks() {
  const tracks = Object.entries(BUILT_IN).map(([name, s]) => ({ name, kind: 'built-in', mood: s.mood, file: builtInPath(name), ready: existsSync(builtInPath(name)) }));
  for (const dir of [USER_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (AUDIO.includes(extname(f).toLowerCase())) tracks.push({ name: f.replace(/\.[^.]+$/, ''), kind: 'yours', mood: 'your own file', file: join(dir, f), ready: true });
  }
  return tracks;
}

/** Turns a scenario's "track" value (a name, a path, "none") into an audio file path, or null. */
export function resolveTrack(spec, baseDir = process.cwd(), { log = () => {} } = {}) {
  if (!spec || spec === 'none') return null;
  if (BUILT_IN[spec]) {
    const file = builtInPath(spec);
    if (!existsSync(file)) {
      log(`  making the "${spec}" music track (once, about a minute)`);
      generateTrack(spec, file);
    }
    return file;
  }
  const own = listTracks().find((t) => t.kind === 'yours' && t.name === spec);
  if (own) return own.file;
  const file = resolve(baseDir, spec);
  if (existsSync(file)) return file;
  throw new Error(`Music "${spec}" was not found. Use calm, warm, bright, minimal, none, a name from your music folder (${USER_DIR}), or a file path.`);
}
