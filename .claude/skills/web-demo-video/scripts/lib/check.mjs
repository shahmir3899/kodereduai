// Prerequisite checker: tells in plain words what is missing and how to fix it.
import { spawnSync } from 'node:child_process';
import { findChrome } from './cdp.mjs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, windowsHide: true, ...opts });

export function ffmpegInfo() {
  const v = run('ffmpeg', ['-hide_banner', '-version']);
  if (v.error || v.status !== 0) return null;
  const filters = run('ffmpeg', ['-hide_banner', '-filters']).stdout ?? '';
  const encoders = run('ffmpeg', ['-hide_banner', '-encoders']).stdout ?? '';
  const has = (text, name) => new RegExp(`\\s${name}\\s`).test(text);
  return {
    version: (v.stdout.split('\n')[0] ?? '').replace('ffmpeg version ', '').split(' ')[0],
    filter: (name) => has(filters, name),
    encoder: (name) => has(encoders, name),
  };
}

export function listWindowsVoices() {
  if (process.platform !== 'win32') return [];
  const script = 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture + "|" + $_.VoiceInfo.Gender }';
  const r = run('powershell', ['-NoProfile', '-Command', script]);
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, culture, gender] = line.split('|');
      return { name, culture, gender };
    });
}

export function listUrduFonts() {
  const wanted = /Urdu|Nastaliq|Nastaleeq|Noto Naskh Arabic|Noto Nastaliq|Jameel|Arabic Typesetting|Scheherazade/i;
  if (process.platform === 'win32') {
    const script = '[void][System.Reflection.Assembly]::LoadWithPartialName("System.Drawing"); (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
    const r = run('powershell', ['-NoProfile', '-Command', script]);
    return (r.stdout ?? '').split(/\r?\n/).filter((n) => wanted.test(n));
  }
  const r = run('fc-list', [':', 'family']);
  return [...new Set((r.stdout ?? '').split(/\r?\n/).filter((n) => wanted.test(n)))];
}

export function pythonInfo() {
  for (const cmd of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const r = run(cmd, ['--version']);
    if (r.status === 0) {
      const edge = run(cmd, ['-c', 'import edge_tts; print("ok")']);
      return { cmd, version: (r.stdout || r.stderr).trim(), edgeTts: edge.status === 0 };
    }
  }
  return null;
}

/** Returns a list of { name, ok, required, detail, fix }. */
export function runChecks() {
  const out = [];
  const add = (name, ok, detail, fix, required = true) => out.push({ name, ok, required, detail, fix: ok ? '' : fix });

  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js 22 or newer', major >= 22, `version ${process.versions.node}`, 'Install Node.js 22 or newer from nodejs.org.');

  const chrome = findChrome();
  add('Google Chrome (or Edge)', Boolean(chrome), chrome ?? 'not found', 'Install Google Chrome, or set the CHROME_PATH environment variable to its program file.');

  const ff = ffmpegInfo();
  add('ffmpeg', Boolean(ff), ff ? `version ${ff.version}` : 'not found', 'Install ffmpeg (for example: winget install Gyan.FFmpeg) and open a new terminal.');
  if (ff) {
    const probe = run('ffprobe', ['-version']);
    add('ffprobe', probe.status === 0, probe.status === 0 ? 'found' : 'not found', 'ffprobe comes with ffmpeg; reinstall the full build.');
    add('H.264 video encoder (libx264)', ff.encoder('libx264'), ff.encoder('libx264') ? 'found' : 'missing', 'Use a full ffmpeg build (for example the "full" build from gyan.dev).');
    add('AAC audio encoder', ff.encoder('aac'), ff.encoder('aac') ? 'found' : 'missing', 'Use a full ffmpeg build.');
    for (const f of ['sidechaincompress', 'loudnorm', 'amix', 'adelay', 'afade', 'aevalsrc', 'blackdetect', 'freezedetect', 'concat']) {
      add(`ffmpeg filter ${f}`, ff.filter(f) || f === 'concat', ff.filter(f) ? 'found' : 'missing', 'Use a full ffmpeg build.');
    }
  }

  const voices = listWindowsVoices();
  add('Offline voice for narration', voices.length > 0, voices.length ? voices.map((v) => `${v.name} (${v.culture})`).join(', ') : 'none found', 'Narration needs a voice. Windows has David and Zira built in; otherwise supply your own audio files.', false);
  const fonts = listUrduFonts();
  add('Urdu fonts', fonts.length > 0, fonts.length ? fonts.slice(0, 4).join(', ') : 'none found', 'Install an Urdu font (for example Noto Nastaliq Urdu) to make Urdu captions look right.', false);
  const py = pythonInfo();
  add('Python + edge-tts (online voices, optional)', Boolean(py?.edgeTts), py ? `${py.version}${py.edgeTts ? ', edge-tts installed' : ', edge-tts not installed'}` : 'Python not found', 'Only needed for natural or Urdu voice-over: python -m pip install --user edge-tts (this sends narration text to Microsoft, so it is always asked first).', false);
  return out;
}

export function formatChecks(results) {
  const lines = [];
  for (const r of results) {
    const mark = r.ok ? 'OK     ' : r.required ? 'MISSING' : 'optional';
    lines.push(`${mark}  ${r.name}: ${r.detail}${r.fix ? `\n         -> ${r.fix}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok && r.required);
  lines.push('', failed.length ? `${failed.length} required item(s) missing. Fix them, then run check again.` : 'Everything required is in place.');
  return lines.join('\n');
}
