// Chrome launch and a tiny DevTools Protocol client. Node 22+ has WebSocket built in, so no packages are needed.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${local}/Google/Chrome/Application/chrome.exe`,
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Starts Chrome in its own temporary profile with remote control on a free port.
 * `headless` (default) shows no window, so nothing on the desktop can get in the way of a take.
 */
export async function launchChrome({ headless = true, width = 1280, height = 720, lang = 'en-US', extraArgs = [] } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome was not found. Install Google Chrome, or set CHROME_PATH to chrome.exe.');
  const profile = mkdtempSync(join(tmpdir(), 'web-demo-video-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio',
    '--hide-crash-restore-bubble',
    `--lang=${lang}`,
    `--window-size=${width},${height}`,
    ...(headless ? ['--headless=new', '--hide-scrollbars=false'] : ['--window-position=0,0']),
    ...extraArgs,
    'about:blank',
  ];
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  // Chrome writes its chosen port into DevToolsActivePort inside the profile folder.
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    if (exited) throw new Error('Chrome closed straight after starting');
    const file = join(profile, 'DevToolsActivePort');
    if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0]);
  }
  if (!port) {
    child.kill();
    throw new Error('Chrome did not open its remote-control port');
  }

  const close = async () => {
    try {
      if (!exited) child.kill();
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 20 && !exited; i++) await sleep(100);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* temporary folder, harmless if left */
    }
  };
  return { port, profile, close, exe, headless };
}

/** Connects to the first page of a running Chrome. */
export async function connectPage(port) {
  let targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    page = await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT' }).then((r) => r.json());
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Could not connect to the page'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params, msg);
    }
  };
  ws.onclose = () => {
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: the browser closed`));
    pending.clear();
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== 1) return reject(new Error(`${method}: the browser connection is closed`));
      const n = ++id;
      pending.set(n, { resolve, reject, method });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const on = (method, fn) => {
    listeners.set(method, [...(listeners.get(method) ?? []), fn]);
    return () => listeners.set(method, (listeners.get(method) ?? []).filter((f) => f !== fn));
  };
  /** Runs JavaScript in the page and returns its value. Errors in the page become errors here. */
  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    return out.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  return { send, on, evaluate, close: () => ws.close(), ws };
}

/** Fixes the page to an exact size and sharpness. `scale` 1.5 makes a 1280x720 page record as 1920x1080. */
export async function setViewport(page, { width, height, scale = 1 }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  // Keep the page "focused" so carets, :focus styles and hover work even without a visible window.
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
}

export async function navigate(page, url, { timeout = 20000 } = {}) {
  const loaded = new Promise((resolve) => {
    const off = page.on('Page.loadEventFired', () => {
      off();
      resolve();
    });
  });
  await page.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(timeout)]);
}
