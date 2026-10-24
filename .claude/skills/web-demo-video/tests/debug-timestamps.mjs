// Developer helper: are screencast frame timestamps on the same clock as Date.now()?
import { connectPage, launchChrome, navigate, setViewport, sleep } from '../scripts/lib/cdp.mjs';

const chrome = await launchChrome({ headless: true });
const page = await connectPage(chrome.port);
await setViewport(page, { width: 800, height: 500, scale: 1 });
await navigate(page, 'data:text/html,<body><div id=x>hi</div></body>');
const frames = [];
page.on('Page.screencastFrame', (p) => {
  frames.push({ ts: p.metadata.timestamp, now: Date.now() / 1000 });
  page.send('Page.screencastFrameAck', { sessionId: p.sessionId });
});
const before = Date.now() / 1000;
await page.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 800, maxHeight: 500, everyNthFrame: 1 });
for (let i = 0; i < 40; i++) {
  await page.evaluate(`document.getElementById('x').style.marginLeft='${i * 4}px'`);
  await sleep(40);
}
await page.send('Page.stopScreencast');
console.log('call time          ', before.toFixed(3));
console.log('first frame ts     ', frames[0].ts.toFixed(3), ' arrived at', frames[0].now.toFixed(3));
console.log('last frame ts      ', frames.at(-1).ts.toFixed(3), ' arrived at', frames.at(-1).now.toFixed(3));
console.log('offset (arrival - ts) first/last:', (frames[0].now - frames[0].ts).toFixed(3), (frames.at(-1).now - frames.at(-1).ts).toFixed(3));
page.close();
await chrome.close();
process.exit(0);
