// Builds the soundtrack: narration clips placed at the moments their steps began, background music that dips while
// someone speaks, and a final level so every video sounds the same loudness.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMAT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/**
 * ffmpeg arguments for the mix (before loudness levelling).
 * clips: [{ file, start }] with start in seconds.  music: { file, volume } or null.  duration in seconds.
 */
export function buildMixArgs({ clips = [], music = null, duration, duck = true, musicVolume = 0.2, out }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const filters = [];
  clips.forEach((c) => args.push('-i', c.file));
  if (music) args.push('-stream_loop', '-1', '-i', music.file);
  const musicIndex = clips.length;

  clips.forEach((c, i) => filters.push(`[${i}:a]${FORMAT},adelay=${Math.round(c.start * 1000)}:all=1[v${i}]`));
  if (clips.length) {
    const inputs = clips.map((_, i) => `[v${i}]`).join('');
    filters.push(clips.length === 1 ? '[v0]anull[vsum]' : `${inputs}amix=inputs=${clips.length}:normalize=0:dropout_transition=0:duration=longest[vsum]`);
  }
  if (music) {
    const vol = music.volume ?? musicVolume;
    filters.push(`[${musicIndex}:a]${FORMAT},atrim=0:${duration.toFixed(3)},asetpts=N/SR/TB,volume=${vol},afade=t=in:st=0:d=2.5,afade=t=out:st=${Math.max(0, duration - 3.5).toFixed(3)}:d=3.5[mus]`);
  }
  if (clips.length && music) {
    if (duck) {
      filters.push('[vsum]asplit=2[vmain][vkey]');
      filters.push('[mus][vkey]sidechaincompress=threshold=0.02:ratio=12:attack=30:release=800:makeup=1[ducked]');
      filters.push('[vmain][ducked]amix=inputs=2:normalize=0:duration=longest[mix]');
    } else {
      filters.push('[vsum][mus]amix=inputs=2:normalize=0:duration=longest[mix]');
    }
  } else if (clips.length) filters.push('[vsum]anull[mix]');
  else if (music) filters.push('[mus]anull[mix]');
  else throw new Error('There is nothing to mix');
  filters.push(`[mix]apad=whole_dur=${duration.toFixed(3)},atrim=0:${duration.toFixed(3)}[final]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[final]', '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', out);
  return args;
}

export function mixTracks(options) {
  mkdirSync(dirname(options.out), { recursive: true });
  const r = spawnSync('ffmpeg', buildMixArgs(options), { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`The soundtrack could not be mixed: ${r.stderr.slice(0, 500)}`);
  return options.out;
}

/** Measures loudness (EBU R128) of an audio file. */
export function measureLoudness(file, { target = -16, peak = -1.5, range = 11 } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=I=${target}:TP=${peak}:LRA=${range}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!m) throw new Error('Could not measure the loudness');
  const j = JSON.parse(m[0]);
  return { integrated: Number(j.input_i), truePeak: Number(j.input_tp), range: Number(j.input_lra), threshold: Number(j.input_thresh), offset: Number(j.target_offset) };
}

/** Puts the soundtrack onto the video at a steady loudness. Returns the loudness that was measured before levelling. */
export function muxWithLoudness({ video, audio, out, target = -16, peak = -1.5, range = 11, bitrate = '160k', duration }) {
  const m = measureLoudness(audio, { target, peak, range });
  const filter = `loudnorm=I=${target}:TP=${peak}:LRA=${range}:measured_I=${m.integrated}:measured_TP=${m.truePeak}:measured_LRA=${m.range}:measured_thresh=${m.threshold}:offset=${m.offset}:linear=true`;
  mkdirSync(dirname(out), { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', filter, '-c:a', 'aac', '-b:a', bitrate, '-ar', '48000', '-ac', '2', ...(duration ? ['-t', duration.toFixed(3)] : ['-shortest']), '-movflags', '+faststart', out];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Could not add the sound to the video: ${r.stderr.slice(0, 400)}`);
  return { before: m };
}
