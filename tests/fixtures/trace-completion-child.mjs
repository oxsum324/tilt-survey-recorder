import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {withFailureEvidence, closeAfterEvidence, capturePolicy} from '../browser-failure-evidence.mjs';

const [root, mode, channel] = process.argv.slice(2);
const browser = await chromium.launch({channel, headless: true});
const context = await browser.newContext(), page = await context.newPage();
const nativeStop = context.tracing.stop.bind(context.tracing);
let calls = 0, completedAction = false;
context.tracing.stop = async options => {
  calls++;
  if (mode === 'late-before-native') await new Promise(resolve => setTimeout(resolve, 2250));
  await nativeStop(options);
  if (mode === 'late-after-save') await new Promise(resolve => setTimeout(resolve, 2250));
};
const started = performance.now();
try {
  await withFailureEvidence({context, page, root, name: mode}, async () => {
    await page.setContent('<title>Trace completion fixture</title><h1>TRACE-SUCCESS-FIXTURE</h1><input data-field="header.caseNumber" value="SYNTHETIC">');
    await page.getByText('TRACE-SUCCESS-FIXTURE', {exact: true}).waitFor();
    completedAction = true; return 42;
  });
  throw new Error('Injected trace completion deadline must fail');
} catch (error) {
  const record = JSON.parse(await fs.readFile(path.join(root, mode, 'failure.json'), 'utf8'));
  await fs.writeFile(path.join(root, mode, 'child-observation.json'), JSON.stringify({
    completedAction, calls, policy: capturePolicy, elapsedMs: performance.now() - started,
    sameOriginalError: record.originalError.name === error.name && record.originalError.message === error.message && record.originalError.stack === error.stack,
    pageClosedAfterGuard: page.isClosed(), injectedDelayMs: 2250,
    injectionScope: 'test wrapper delay around real Playwright trace export; not an actual runner overload',
  }, null, 2));
  throw error;
} finally {await closeAfterEvidence(context); await closeAfterEvidence(browser);}
