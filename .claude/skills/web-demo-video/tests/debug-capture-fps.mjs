// Developer helper: how many pictures per second can a screenshot loop deliver at each sharpness?
import { connectPage, launchChrome, navigate, setViewport, sleep } from '../scripts/lib/cdp.mjs';

const chrome = await launchChrome({ headless: true });
const page = await connectPage(chrome.port);
for (const scale of [1, 1.5, 2]) {
  await setViewport(page, { width: 1280, height: 720, scale });
  await navigate(page, 'data:text/html,<body style="font:24px sans-serif;margin:0"><div id=x style="position:absolute;width:200px;height:80px;background:teal">moving</div></body>');
  let n = 0, bytes = 0;
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < 3000) {
    page.evaluate(`document.getElementById('x').style.left='${(i++ % 100) * 8}px'`);
    const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, optimizeForSpeed: true });
    n++;
    bytes += r.data.length * 0.75;
  }
  const secs = (Date.now() - start) / 1000;
  console.log(`scale ${scale}: ${(n / secs).toFixed(1)} pictures per second, ${(bytes / n / 1024).toFixed(0)} KB each`);
}
page.close();
await chrome.close();
process.exit(0);
