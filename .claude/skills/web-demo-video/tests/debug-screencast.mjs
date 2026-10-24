// Developer helper: how does Chrome's screencast behave on a still page?
import { connectPage, launchChrome, navigate, setViewport, sleep } from '../scripts/lib/cdp.mjs';

const nth = Number(process.argv[2] ?? 1);
const chrome = await launchChrome({ headless: true });
const page = await connectPage(chrome.port);
await setViewport(page, { width: 1100, height: 700, scale: 1 });
await navigate(page, 'data:text/html,<body style="font:24px sans-serif"><div id=x>still page</div></body>');
let n = 0;
const times = [];
page.on('Page.screencastFrame', (p) => {
  n++;
  times.push(Date.now());
  page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
});
await page.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1100, maxHeight: 700, everyNthFrame: nth });
await sleep(1500);
console.log(`everyNthFrame=${nth}: frames on a still page after 1.5 s: ${n}`);
const t0 = Date.now();
for (let i = 0; i < 60; i++) {
  await page.evaluate(`document.getElementById('x').style.marginLeft = '${i * 5}px'`);
  await sleep(16);
}
const moving = times.filter((t) => t >= t0).length;
console.log(`frames during 60 changes over ${((Date.now() - t0) / 1000).toFixed(2)} s: ${moving}`);
await page.send('Page.stopScreencast');
page.close();
await chrome.close();
process.exit(0);
