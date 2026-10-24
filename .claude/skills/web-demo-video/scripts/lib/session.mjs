// Opens Chrome for a scenario: exact size, overlay and locator installed in every page, diagnostics collected.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPage, launchChrome, setViewport } from './cdp.mjs';
import { createInput } from './input.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OVERLAY = readFileSync(join(here, 'overlay.js'), 'utf8');
const LOCATE = readFileSync(join(here, 'locate.js'), 'utf8');

export function loadTheme(spec) {
  if (spec && typeof spec === 'object') return spec;
  const name = spec ?? 'teal';
  try {
    return JSON.parse(readFileSync(join(here, '..', '..', 'assets', 'themes', `${name}.json`), 'utf8'));
  } catch {
    throw new Error(`There is no theme called "${name}". Use teal, blue, slate or warm, or give the colours as an object.`);
  }
}

export async function openSession({ scenario, lang = 'en', headed = false, speed, factor = 1 } = {}) {
  const vp = scenario.target.viewport;
  const chrome = await launchChrome({ headless: !headed, width: vp.width, height: vp.height + (headed ? 90 : 0), lang: lang === 'ur' ? 'ur-PK' : 'en-US' });
  const page = await connectPage(chrome.port);
  // The page recorder delivers the page at its own pixel size, so the picture size is the viewport size.
  // For a sharper video, give the scenario a larger viewport (for example 1920x1080).
  await setViewport(page, { width: vp.width, height: vp.height, scale: 1 });
  const theme = loadTheme(scenario.style.theme);
  const config = { theme: { ...theme }, showCursor: scenario.style.cursor !== false, showKeys: scenario.style.keys };
  if (theme.fontLatin) config.theme.fontLatin = theme.fontLatin;
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__demoConfig = ${JSON.stringify(config)}; window.__demoHide = ${JSON.stringify(scenario.target.hide ?? [])};\n${OVERLAY}\n${LOCATE}`,
  });
  const locale = scenario.target.locale?.[lang];
  if (locale) {
    await page.send('Emulation.setLocaleOverride', { locale }).catch(() => {});
    await page.send('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': locale } });
  }

  // Page problems are collected, not hidden: the quality report shows them.
  const diagnostics = [];
  page.on('Runtime.exceptionThrown', (p) => diagnostics.push({ kind: 'page-error', text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text }));
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') diagnostics.push({ kind: 'console-error', text: (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
  });
  const urls = new Map();
  page.on('Network.requestWillBeSent', (p) => urls.set(p.requestId, p.request.url));
  page.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400 && !/favicon/.test(p.response.url)) diagnostics.push({ kind: 'http-error', text: `${p.response.status} ${p.response.url}` });
  });
  page.on('Network.loadingFailed', (p) => {
    if (!p.canceled && !/favicon/.test(urls.get(p.requestId) ?? '')) diagnostics.push({ kind: 'network-failed', text: `${p.errorText} ${urls.get(p.requestId) ?? ''}` });
  });

  // Quiet-network tracking for the "idle" wait.
  const net = { inflight: 0, lastChange: performance.now() };
  page.on('Network.requestWillBeSent', () => ((net.inflight += 1), (net.lastChange = performance.now())));
  page.on('Network.loadingFinished', () => ((net.inflight = Math.max(0, net.inflight - 1)), (net.lastChange = performance.now())));
  page.on('Network.loadingFailed', () => ((net.inflight = Math.max(0, net.inflight - 1)), (net.lastChange = performance.now())));

  const input = createInput(page, { speed: speed ?? scenario.style.speed, factor });
  return {
    chrome,
    page,
    input,
    diagnostics,
    net,
    async close() {
      try {
        page.close();
      } catch {
        /* closing anyway */
      }
      await chrome.close();
    },
  };
}
