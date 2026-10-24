// Packaging: sound + picture into the final MP4 (with chapters), captions files, and a poster image.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { measureLoudness } from './audio.mjs';

export const PRESETS = {
  web: { width: 1280, height: 720, crf: 22, fps: 30, speed: 'slow', audio: '160k', note: '1280x720, good for websites and chat' },
  hd: { width: 1920, height: 1080, crf: 21, fps: 30, speed: 'slow', audio: '192k', note: '1920x1080 (a smaller picture is enlarged)' },
  whatsapp: { width: 1280, height: 720, crf: 27, fps: 24, speed: 'slow', audio: '96k', maxMB: 15, note: 'under about 15 MB for sending in chat apps' },
};

export const pad = (n, w = 2) => String(n).padStart(w, '0');
export function stamp(seconds, comma = true) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${comma ? ',' : '.'}${pad(r, 3)}`;
}

/** Subtitle cues from the timeline: what is spoken (or, if nothing is spoken, the caption) during each step. */
export function cuesFromTimeline(timeline, offset) {
  const cues = [];
  for (const t of timeline) {
    const start = t.start + offset;
    if (t.say?.text) cues.push({ start, end: start + Math.max(1.2, t.say.duration), text: t.say.text });
    else if (t.caption) cues.push({ start, end: Math.max(start + 1.2, t.end + offset), text: t.caption });
    else if (t.kind === 'slide' && t.headline) cues.push({ start, end: t.end + offset, text: t.headline });
  }
  // a cue must not run into the next one
  for (let i = 0; i + 1 < cues.length; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start - 0.05);
  return cues.filter((c) => c.end > c.start);
}

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
}
export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, false)} --> ${stamp(c.end, false)}\n${c.text}\n`).join('\n')}`;
}

/** ffmpeg chapter marks: one per step, plus the slides. */
export function chapterMetadata(timeline, offset, total, title) {
  const lines = [';FFMETADATA1', `title=${title}`];
  const marks = timeline.filter((t) => t.kind === 'step' || t.kind === 'slide');
  marks.forEach((t, i) => {
    const start = Math.max(0, i === 0 ? 0 : t.start + offset);
    const end = i + 1 < marks.length ? marks[i + 1].start + offset : total;
    if (end <= start) return;
    const name = (t.kind === 'slide' ? t.headline : t.caption) || t.id;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(start * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${String(name).replace(/[=;#\\\n]/g, ' ')}`);
  });
  return lines.join('\n');
}

export function buildFinalArgs({ video, audio, metaFile, out, preset, duration, loudness, title, lang }) {
  const p = PRESETS[preset];
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video];
  if (audio) args.push('-i', audio);
  args.push('-i', metaFile);
  const metaIndex = audio ? 2 : 1;
  const vf = `scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${p.fps},format=yuv420p`;
  args.push('-map', '0:v:0');
  if (audio) args.push('-map', '1:a:0');
  args.push('-map_metadata', String(metaIndex), '-map_chapters', String(metaIndex));
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', p.speed, '-crf', String(p.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p');
  if (p.maxMB) {
    const audioKbps = parseInt(p.audio, 10);
    const videoKbps = Math.max(250, Math.floor((p.maxMB * 8 * 1024 * 0.93) / duration - audioKbps));
    args.push('-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`);
  }
  if (audio) {
    const l = loudness;
    args.push('-af', `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${l.integrated}:measured_TP=${l.truePeak}:measured_LRA=${l.range}:measured_thresh=${l.threshold}:offset=${l.offset}:linear=true`, '-c:a', 'aac', '-b:a', p.audio, '-ar', '48000', '-ac', '2');
  }
  const code = lang === 'ur' ? 'urd' : 'eng';
  args.push('-metadata', `title=${title}`, '-metadata:s:v:0', `language=${code}`, ...(audio ? ['-metadata:s:a:0', `language=${code}`] : []), '-t', duration.toFixed(3), '-movflags', '+faststart', out);
  return args;
}

/** Writes the final video, captions, and poster. Returns the loudness measured before levelling. */
export function finalize({ video, audio, timeline, offset, duration, out, preset = 'web', title, lang }) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`Unknown preset "${preset}". Use ${Object.keys(PRESETS).join(', ')}.`);
  mkdirSync(dirname(out), { recursive: true });
  const metaFile = `${out}.chapters.txt`;
  writeFileSync(metaFile, chapterMetadata(timeline, offset, duration, title), 'utf8');
  const loudness = audio ? measureLoudness(audio) : null;
  const r = spawnSync('ffmpeg', buildFinalArgs({ video, audio, metaFile, out, preset, duration, loudness, title, lang }), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`The final video could not be made: ${r.stderr.slice(0, 500)}`);
  const cues = cuesFromTimeline(timeline, offset);
  const base = out.replace(/\.mp4$/, '');
  writeFileSync(`${base}.srt`, toSrt(cues), 'utf8');
  writeFileSync(`${base}.vtt`, toVtt(cues), 'utf8');
  return { loudness, cues, srt: `${base}.srt`, vtt: `${base}.vtt` };
}

export function makePoster(video, out, at) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Could not make the poster image: ${r.stderr.slice(0, 200)}`);
  return out;
}
