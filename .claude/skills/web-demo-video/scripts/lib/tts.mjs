// Voice-over. Engines:
//   sapi   offline Windows voices (free, private, English)
//   edge   Microsoft's online neural voices through the edge-tts package. The narration text LEAVES this computer,
//          so it is refused unless the caller passes allowOnline (the skill asks the user first, every run).
//   files  your own recordings, named <step-id>.<lang>.wav|mp3|m4a|ogg in a folder
//   none   no voice-over
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWindowsVoices, pythonInfo } from './check.mjs';
// Narration never falls back to another language: an Urdu video must not quietly speak English.
const strict = (value, lang) => (typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? value[lang] : undefined);

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'ogg', 'flac'];

export const DEFAULT_EDGE_VOICES = { en: 'en-US-AriaNeural', ur: 'ur-PK-UzmaNeural' };

export class ConsentError extends Error {
  constructor(lines, engine) {
    super(
      `The ${engine} voice sends the narration text over the internet to Microsoft. It was not allowed for this run.\n` +
        'Text that would be sent:\n' +
        lines.map((l) => `  - ${l}`).join('\n') +
        '\nAsk the user, and if they agree run again with --allow-online-tts.',
    );
    this.lines = lines;
  }
}

export function audioDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number(r.stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`Cannot read the length of ${file}`);
  return d;
}

/** Everything that should be spoken in one language, in order: { key, text }. */
export function narrationItems(scenario, lang) {
  const items = [];
  const push = (key, value) => {
    const text = strict(value, lang);
    if (text && String(text).trim()) items.push({ key, text: String(text).trim() });
  };
  if (scenario.intro && scenario.intro !== false) push('intro', scenario.intro.say ?? scenario.meta?.say);
  for (const step of scenario.steps) {
    if (step.chapter) push(`chapter:${step.id}`, step.chapterSay);
    push(step.id, step.say);
  }
  if (scenario.outro && scenario.outro !== false) push('outro', scenario.outro.say);
  return items;
}

/** Applies the scenario's pronunciation list, for example { "MediDesk": "Medi Desk" }. */
export function pronounce(text, lexicon = {}) {
  let out = text;
  for (const [word, say] of Object.entries(lexicon)) out = out.split(word).join(say);
  return out;
}

function pickSapiVoice(lang, wanted) {
  const voices = listWindowsVoices();
  if (wanted) {
    const hit = voices.find((v) => v.name.toLowerCase().includes(wanted.toLowerCase()));
    if (!hit) throw new Error(`The voice "${wanted}" is not installed. Installed: ${voices.map((v) => v.name).join(', ') || 'none'}`);
    return hit.name;
  }
  const culture = lang === 'ur' ? 'ur' : 'en';
  const matches = voices.filter((v) => v.culture.toLowerCase().startsWith(culture));
  if (!matches.length) {
    throw new Error(
      lang === 'ur'
        ? 'No Urdu voice is installed on this computer. Choose the online Microsoft voice (it asks you first), supply your own audio files, or make the Urdu video with captions only ("voice": {"engine": "none"}).'
        : 'No English voice is installed. Windows normally has Zira and David; check Settings > Time & Language > Speech.',
    );
  }
  return (matches.find((v) => /zira/i.test(v.name)) ?? matches[0]).name;
}

function runSapi({ text, out, voice, rate }) {
  const dir = dirname(out);
  mkdirSync(dir, { recursive: true });
  const textFile = `${out}.txt`;
  writeFileSync(textFile, text, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, '..', 'tts', 'sapi.ps1'), '-TextFile', textFile, '-Out', out, '-Voice', voice, '-Rate', String(rate)], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`The Windows voice failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
}

function runEdge({ text, out, voice, rate }) {
  const py = pythonInfo();
  if (!py) throw new Error('Python is needed for the online voice. Install Python, then: python -m pip install --user edge-tts');
  if (!py.edgeTts) throw new Error('The online voice package is not installed. With the user\'s approval run: python -m pip install --user edge-tts');
  mkdirSync(dirname(out), { recursive: true });
  const textFile = `${out}.txt`;
  writeFileSync(textFile, text, 'utf8');
  const mp3 = `${out}.mp3`;
  const pct = `${rate >= 0 ? '+' : ''}${Math.round(rate * 10)}%`;
  const r = spawnSync(py.cmd, ['-m', 'edge_tts', '--voice', voice, `--rate=${pct}`, '--file', textFile, '--write-media', mp3], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (r.status !== 0 || !existsSync(mp3)) throw new Error(`The online voice failed: ${(r.stderr || r.stdout).slice(0, 300)}. Check the voice name and the internet connection.`);
  const c = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-ar', '48000', '-ac', '1', out], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error(`ffmpeg could not read the online voice: ${c.stderr}`);
}

function findOwnFile(dir, key, lang) {
  const safe = key.replace(':', '-');
  for (const ext of AUDIO_EXT) {
    for (const name of [`${safe}.${lang}.${ext}`, `${safe}.${ext}`]) {
      const f = join(dir, name);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

/**
 * Makes (or finds) the narration clips for one language.
 * Returns { clips: { key: { file, duration, text } }, engine, voice }.
 */
export function prepareNarration({ scenario, lang, outDir, allowOnline = false, log = () => {} }) {
  const cfg = scenario.voice ?? {};
  // "engines" can differ per language, for example { "en": "sapi", "ur": "none" }.
  const engine = cfg.engines?.[lang] ?? cfg.engine ?? 'sapi';
  const items = narrationItems(scenario, lang);
  if (engine === 'none' || !items.length) return { clips: {}, engine: 'none', voice: null };
  const lexicon = cfg.pronounce ?? {};
  const rate = cfg.rate ?? 0;
  const clips = {};

  if (engine === 'files') {
    const dir = resolve(scenario.__dir, cfg.dir ?? 'audio');
    for (const item of items) {
      const file = findOwnFile(dir, item.key, lang);
      if (!file) throw new Error(`No audio file for "${item.key}" in ${lang}. Put ${item.key.replace(':', '-')}.${lang}.wav (or mp3, m4a) in ${dir}`);
      clips[item.key] = { file, duration: audioDuration(file), text: item.text };
    }
    return { clips, engine, voice: 'your recordings' };
  }

  let voice;
  if (engine === 'edge') {
    if (!allowOnline) throw new ConsentError(items.map((i) => `[${i.key}] ${i.text}`), 'online (edge)');
    voice = cfg.voices?.[lang] ?? DEFAULT_EDGE_VOICES[lang];
  } else if (engine === 'sapi') {
    voice = pickSapiVoice(lang, cfg.voices?.[lang]);
  } else throw new Error(`Unknown voice engine "${engine}"`);

  const cache = join(outDir, 'audio', lang);
  for (const item of items) {
    const spoken = pronounce(item.text, lexicon);
    const hash = createHash('sha1').update(`${engine}|${voice}|${rate}|${spoken}`).digest('hex').slice(0, 14);
    const out = join(cache, `${item.key.replace(':', '-')}-${hash}.wav`);
    if (!existsSync(out)) {
      log(`  voice: ${item.key}`);
      (engine === 'edge' ? runEdge : runSapi)({ text: spoken, out, voice, rate });
    }
    clips[item.key] = { file: out, duration: audioDuration(out), text: item.text };
  }
  return { clips, engine, voice };
}

/** A plain-text narration script to read and approve before recording. */
export function narrationScript(scenario, lang) {
  const lines = [`Narration script: ${scenario.name} (${lang})`, ''];
  for (const item of narrationItems(scenario, lang)) lines.push(`[${item.key}]`, item.text, '');
  return lines.join('\n');
}
