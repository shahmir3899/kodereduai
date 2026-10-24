// Recording. Two drivers:
//   "page"    asks the browser itself for its picture (screencast). Nothing else on the desktop can get in the way,
//             and it works with no window at all. This is the default.
//   "desktop" grabs a region of the screen (Windows gdigrab). Slower to set up, but shows things the page
//             recorder cannot see, such as the open list of a native <select>.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sleep } from './cdp.mjs';

export const ffmpegArgsForEncode = ({ input, output, fps = 30, crf = 16, preset = 'fast', duration }) => [
  '-hide_banner', '-loglevel', 'error', '-y',
  ...input,
  '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=pc:out_range=tv,format=yuv420p`,
  '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-r', String(fps), '-an', '-movflags', '+faststart',
  ...(duration ? ['-t', duration.toFixed(3)] : []),
  output,
];

function probeVideo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(r.stdout);
    return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
  } catch {
    return null;
  }
}

/** Builds the list ffmpeg's concat reader needs: each saved frame stays on screen until the next one arrives. */
export function buildConcatList(frames, startWall, endWall) {
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const from = i === 0 ? startWall : frames[i].ts;
    const to = i + 1 < frames.length ? frames[i + 1].ts : endWall;
    lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
  }
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  return lines.join('\n');
}

async function startPageRecording({ session, outFile, fps = 30, viewport, quality = 92, log = () => {} }) {
  const { page } = session;
  const dir = mkdtempSync(join(tmpdir(), 'wdv-frames-'));
  const frames = [];
  let stopped = false;
  const width = viewport.width;
  const height = viewport.height;

  const off = page.on('Page.screencastFrame', (p) => {
    if (stopped) return;
    const ts = p.metadata?.timestamp ?? Date.now() / 1000;
    const file = join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(p.data, 'base64'));
    frames.push({ ts, file });
    page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });

  const startWall = Date.now() / 1000;
  // Every frame the browser draws is kept (about 30 a second while things move); still moments cost nothing.
  await page.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  for (let i = 0; i < 20 && frames.length === 0; i++) {
    await sleep(100);
    if (i === 5) await page.evaluate('document.documentElement.style.outline="1px solid transparent"; requestAnimationFrame(() => (document.documentElement.style.outline = ""))').catch(() => {});
  }
  if (!frames.length) throw new Error('The page recorder received no picture from the browser');

  return {
    driver: 'page',
    startWall,
    async stop() {
      stopped = true;
      const endWall = Date.now() / 1000;
      await page.send('Page.stopScreencast').catch(() => {});
      off();
      if (!frames.length) throw new Error('No frames were recorded');
      writeFileSync(join(dir, 'list.txt'), buildConcatList(frames, Math.min(startWall, frames[0].ts), endWall));
      const r = spawnSync('ffmpeg', ffmpegArgsForEncode({ input: ['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt')], output: outFile, fps, duration: endWall - Math.min(startWall, frames[0].ts) }), { encoding: 'utf8' });
      const count = frames.length;
      if (process.env.WDV_KEEP_FRAMES) console.log(`frames kept in ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
      if (r.status !== 0) throw new Error(`ffmpeg could not build the video: ${r.stderr}`);
      const info = probeVideo(outFile);
      return { file: outFile, driver: 'page', frames: count, framesPerSecond: count / Math.max(0.1, endWall - startWall), ...info, startWall, endWall };
    },
  };
}

// ---------- desktop driver (Windows) ----------

/** One screenshot of the whole desktop as raw RGB, plus its size. */
function grabDesktop() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '5', '-draw_mouse', '0', '-i', 'desktop', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'ppm', 'pipe:1'], { maxBuffer: 80 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Could not take a picture of the desktop (is this Windows?)');
  const buf = r.stdout;
  // PPM header: "P6\n<w> <h>\n255\n"
  let pos = 0;
  const token = () => {
    while (buf[pos] === 0x0a || buf[pos] === 0x20) pos++;
    let s = '';
    while (buf[pos] !== 0x0a && buf[pos] !== 0x20) s += String.fromCharCode(buf[pos++]);
    return s;
  };
  token();
  const width = Number(token()), height = Number(token());
  token();
  pos++;
  return { width, height, rgb: buf.subarray(pos) };
}

/** Finds the page on screen by drawing a magenta border in it and looking for that border. */
export async function calibrateDesktop(page) {
  await page.evaluate(`(() => { document.getElementById('__calib')?.remove(); const d = document.createElement('div'); d.id = '__calib'; d.style.cssText = 'position:fixed;inset:0;border:4px solid rgb(255,0,255);box-sizing:border-box;z-index:2147483647;pointer-events:none'; document.documentElement.appendChild(d); })()`);
  await sleep(500);
  const { width, height, rgb } = grabDesktop();
  await page.evaluate(`document.getElementById('__calib')?.remove()`);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (rgb[i] > 245 && rgb[i + 1] < 12 && rgb[i + 2] > 245) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('The browser window was not found on screen. Is it visible and not covered by another window?');
  const w = maxX - minX + 1, h = maxY - minY + 1;
  return { x: minX, y: minY, width: w - (w % 2), height: h - (h % 2), screen: { width, height } };
}

async function startDesktopRecording({ session, outFile, fps = 30, log = () => {} }) {
  const region = await calibrateDesktop(session.page);
  log(`  desktop region: ${region.width}x${region.height} at ${region.x},${region.y}`);
  const raw = `${outFile}.rec.mkv`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '0', '-offset_x', String(region.x), '-offset_y', String(region.y), '-video_size', `${region.width}x${region.height}`, '-i', 'desktop', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', raw];
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const closed = new Promise((resolve) => child.on('close', resolve));
  const spawnWall = Date.now() / 1000;
  await sleep(1200);
  // The screen grabber needs a moment to start; everything before `startWall` is cut off at the end.
  const startWall = Date.now() / 1000;
  return {
    driver: 'desktop',
    startWall,
    async stop() {
      await sleep(600);
      child.stdin.write('q');
      await closed;
      const endWall = Date.now() / 1000;
      if (!existsSync(raw)) throw new Error(`The desktop recorder produced nothing. ${err.slice(0, 300)}`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (startWall - spawnWall).toFixed(3), '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { encoding: 'utf8' });
      rmSync(raw, { force: true });
      if (r.status !== 0) throw new Error(`ffmpeg could not finish the video: ${r.stderr}`);
      return { file: outFile, driver: 'desktop', ...probeVideo(outFile), startWall, endWall };
    },
  };
}

export async function startRecording(options) {
  mkdirSync(join(options.outFile, '..'), { recursive: true });
  return options.driver === 'desktop' ? startDesktopRecording(options) : startPageRecording(options);
}
