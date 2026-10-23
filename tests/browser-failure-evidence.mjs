import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID()}`;
export const failureEvidenceRoot = path.resolve(process.env.TILT_BROWSER_FAILURE_ROOT ||
  path.join('output/playwright/failure-evidence', run));
const errorRecord = error => ({name: error?.name || 'Error', message: String(error?.message || error),
  stack: error?.stack || null});
const json = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2));

// The caller must close the context only after this guard returns or rethrows.
// No retry, timeout change, or assertion filtering is performed here.
export async function withFailureEvidence({context, page, name, root = failureEvidenceRoot}, action) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Use a simple diagnostic scenario name');
  await fs.mkdir(root, {recursive: true});
  const out = path.join(root, name);
  await fs.mkdir(out); // EEXIST preserves every prior attempt, including failures.
  const events = [], listeners = [];
  const observe = (emitter, event, convert) => {
    const listener = value => {
      try { events.push({at: new Date().toISOString(), type: event, ...convert(value)}); }
      catch (error) { events.push({at: new Date().toISOString(), type: 'observer-error', event, error: errorRecord(error)}); }
    };
    emitter.on(event, listener); listeners.push(() => emitter.off(event, listener));
  };
  observe(page, 'console', message => ({level: message.type(), text: message.text(), location: message.location()}));
  observe(page, 'pageerror', error => ({error: errorRecord(error)}));
  observe(page, 'crash', () => ({}));
  observe(page, 'close', () => ({}));
  observe(context, 'response', response => ({url: response.url(), status: response.status(), fromServiceWorker: response.fromServiceWorker()}));
  observe(context, 'requestfailed', request => ({url: request.url(), method: request.method(),
    resourceType: request.resourceType(), serviceWorker: request.serviceWorker()?.url() || null, failure: request.failure()}));
  const record = {schema: 1, scope: 'local-browser-diagnostics; not a GitHub cloud run',
    head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), name,
    attachedUtc: new Date().toISOString(), status: 'running', captureErrors: []};
  let tracing = false;
  const manifest = async () => {
    const files = [];
    for (const entry of await fs.readdir(out, {withFileTypes: true})) {
      if (!entry.isFile() || entry.name === 'sha256.json') continue;
      const bytes = await fs.readFile(path.join(out, entry.name));
      files.push({file: entry.name, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')});
    }
    await json(path.join(out, 'sha256.json'), files);
  };
  try {
    await json(path.join(out, 'result.json'), record);
    await context.tracing.start({screenshots: true, snapshots: true, sources: true});
    tracing = true;
    const value = await action();
    await context.tracing.stop(); // Successful cases keep event receipts, not a failure trace.
    tracing = false;
    record.status = 'passed'; record.finishedUtc = new Date().toISOString();
    await json(path.join(out, 'events.json'), events);
    await json(path.join(out, 'result.json'), record);
    await manifest();
    return value;
  } catch (error) {
    record.status = 'failed'; record.failedUtc = new Date().toISOString();
    record.originalError = errorRecord(error);
    record.pageClosedAtFailure = page.isClosed(); record.urlAtFailure = page.url();
    const attempt = async (artifact, capture) => {
      try { await capture(); }
      catch (captureError) { record.captureErrors.push({artifact, error: errorRecord(captureError)}); }
    };
    // Persist the original failure before asking a potentially unhealthy page for artifacts.
    try {
      await json(path.join(out, 'failure.json'), record);
      await json(path.join(out, 'events.json'), events);
      await attempt('page-state.json', async () => {
        const state = await page.evaluate(() => ({url: location.href, title: document.title,
          readyState: document.readyState, caseNumber: [...document.querySelectorAll('[data-field="header.caseNumber"]')].map(e => ({
            html: e.outerHTML, display: getComputedStyle(e).display, visibility: getComputedStyle(e).visibility,
            rect: {x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y,
              width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height}}))}));
        await json(path.join(out, 'page-state.json'), state);
      });
      await attempt('page.html', async () => fs.writeFile(path.join(out, 'page.html'), await page.content(), {flag: 'wx'}));
      await attempt('screenshot.png', async () => fs.writeFile(path.join(out, 'screenshot.png'),
        await page.screenshot({fullPage: true, timeout: 5000}), {flag: 'wx'}));
      if (tracing) await attempt('trace.zip', async () => {
        await context.tracing.stop({path: path.join(out, 'trace.zip')}); tracing = false;
      });
      record.finishedUtc = new Date().toISOString();
      await json(path.join(out, 'events.json'), events);
      await json(path.join(out, 'failure.json'), record);
      await json(path.join(out, 'result.json'), record);
      await manifest();
    } catch (captureError) {
      // Storage failures must never replace the original test exception or make it pass.
      console.error(`Browser diagnostic storage failure: ${captureError.stack || captureError}`);
    }
    throw error;
  } finally {
    for (const remove of listeners) remove();
  }
}
