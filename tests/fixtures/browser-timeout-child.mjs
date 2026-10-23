import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {withFailureEvidence} from '../browser-failure-evidence.mjs';

// An isolated synthetic page, never the application or a real imported case.
const [root, mode, channel] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  if (req.url === '/503') { res.writeHead(503); res.end('injected HTTP failure'); return; }
  res.writeHead(200, {'Content-Type': 'text/html;charset=utf-8'});
  res.end(`<title>Timeout evidence fixture</title><h1>診斷回歸頁</h1>
    <input data-field="header.caseNumber" style="display:none" value="INJECTED-HIDDEN">
    <script>console.error('INJECTED console error');
    setTimeout(()=>{throw Error('INJECTED page error')},0);
    Promise.allSettled([fetch('/503'),fetch('/abort')]).then(()=>{window.fixtureReady=true})</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({channel: channel === 'chromium' ? undefined : channel, headless: true});
const context = await browser.newContext(), page = await context.newPage();
await page.route('**/abort', route => route.abort('failed'));
try {
  await withFailureEvidence({context, page, root, name: mode}, async () => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.fixtureReady === true);
    if (mode === 'screenshot-write-failure') await fs.mkdir(path.join(root, mode, 'screenshot.png'));
    if (mode === 'closed-page') await page.close();
    // Short timeout belongs only to this injected failure fixture. Production assertions are unchanged.
    await page.locator('[data-field="header.caseNumber"]').waitFor({timeout: 500});
  });
} finally {
  await context.close(); await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
