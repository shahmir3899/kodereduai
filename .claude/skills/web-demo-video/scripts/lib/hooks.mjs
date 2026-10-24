// Setup, reset and teardown commands that belong to one app (start servers, seed demo data, restore state).
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { sleep } from './cdp.mjs';

const background = [];

async function waitForUrl(url, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
}

/**
 * A hook is a command (text) or { run, cwd, background, waitForUrl, env }.
 * Blocking commands must succeed; background ones (servers) are stopped by `teardown`.
 */
export async function runHooks(list = [], { cwd, log = console.log } = {}) {
  for (const hook of list) {
    const h = typeof hook === 'string' ? { run: hook } : hook;
    const options = { cwd: h.cwd ? resolve(cwd, h.cwd) : cwd, shell: true, env: { ...process.env, ...(h.env ?? {}) }, windowsHide: true };
    log(`  $ ${h.run}${h.background ? '  (in the background)' : ''}`);
    if (h.background) {
      const child = spawn(h.run, [], { ...options, stdio: 'ignore', detached: process.platform !== 'win32' });
      background.push(child);
      if (h.waitForUrl) await waitForUrl(h.waitForUrl, (h.timeout ?? 90) * 1000);
    } else {
      const r = spawnSync(h.run, [], { ...options, stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`The command failed (exit ${r.status}): ${h.run}`);
      if (h.waitForUrl) await waitForUrl(h.waitForUrl, (h.timeout ?? 90) * 1000);
    }
  }
}

/** Stops every background command started by runHooks, including the programs they started. */
export function stopBackground() {
  for (const child of background.splice(0)) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-child.pid);
    } catch {
      /* already stopped */
    }
  }
}
