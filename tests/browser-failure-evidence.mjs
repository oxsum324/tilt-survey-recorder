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

export const capturePolicy = Object.freeze({artifactMs: 2000, totalMs: 12000, cleanupMs: 2000});
const closing = new WeakMap();
const alreadyFailed = new WeakSet();
const timed = async (label, operation, timeoutMs) => {
  let timer;
  const timeout = () => Object.assign(new Error(`${label}: diagnostic deadline ${timeoutMs}ms exceeded`),
    {name: 'CaptureTimeoutError', code: 'CAPTURE_TIMEOUT'});
  if (timeoutMs <= 0) throw timeout();
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeout()), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
};

// A failed cleanup must not replace an exception already being rethrown by the guard.
export async function closeAfterEvidence(resource, timeoutMs = capturePolicy.cleanupMs) {
  const started = Date.now();
  try {
    if (!closing.has(resource)) closing.set(resource, Promise.resolve().then(() => resource.close()));
    await timed('diagnostic cleanup', () => closing.get(resource), timeoutMs);
    return {status: 'closed', elapsedMs: Date.now() - started};
  } catch (error) {
    console.error(`Browser diagnostic cleanup failure: ${error.stack || error}`);
    if (!alreadyFailed.has(resource)) throw error;
    return {status: 'failed', elapsedMs: Date.now() - started, error: errorRecord(error)};
  }
}

// The caller must close the context only after this guard returns or rethrows.
// No retry, timeout change, or assertion filtering is performed here.
export async function withFailureEvidence({context, page, name, root = failureEvidenceRoot,
  policy = capturePolicy}, action) {
  for (const key of ['artifactMs', 'totalMs', 'cleanupMs']) {
    if (!Number.isFinite(policy[key]) || policy[key] <= 0) throw new Error(`Invalid diagnostic policy: ${key}`);
  }
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
    attachedUtc: new Date().toISOString(), status: 'running', captureErrors: [], policy};
  let tracing = false;
  const manifest = async () => {
    const files = [];
    for (const entry of await fs.readdir(out, {withFileTypes: true})) {
      if (!entry.isFile() || entry.name === 'sha256.json' || entry.name.startsWith('.')) continue;
      const bytes = await fs.readFile(path.join(out, entry.name));
      files.push({file: entry.name, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')});
    }
    await json(path.join(out, 'sha256.json'), files);
  };
  try {
    await json(path.join(out, 'result.json'), record);
    await timed('tracing.start', () => context.tracing.start({screenshots: true, snapshots: true, sources: true}), policy.artifactMs);
    tracing = true;
    const value = await action();
    await timed('tracing.stop', () => context.tracing.stop(), policy.artifactMs); // Successful cases keep event receipts, not a failure trace.
    tracing = false;
    record.status = 'passed'; record.finishedUtc = new Date().toISOString();
    await json(path.join(out, 'events.json'), events);
    await json(path.join(out, 'result.json'), record);
    await manifest();
    return value;
  } catch (error) {
    alreadyFailed.add(context);
    if (context.browser?.()) alreadyFailed.add(context.browser());
    record.status = 'failed'; record.failedUtc = new Date().toISOString();
    record.originalError = errorRecord(error);
    record.pageClosedAtFailure = page.isClosed(); record.urlAtFailure = page.url();
    const started = performance.now(), until = started + policy.totalMs;
    const remaining = () => Math.max(0, until - performance.now());
    const bounded = (label, operation) => timed(label, operation, Math.min(policy.artifactMs, remaining()));
    const captureError = (artifact, stage, failure) => {
      record.captureErrors.push({artifact, stage, code: failure?.code || null, error: errorRecord(failure)});
    };
    // Only a completed, on-time capture can be published under a final artifact name.
    // Expired operations have no continuation that can write a late page-state/HTML/PNG.
    const publish = async (artifact, bytes) => {
      const pending = path.join(out, `.${artifact}.${randomUUID()}.pending`);
      const controller = new AbortController(); let active = true;
      try {
        await bounded(`${artifact} write`, async () => {
          await fs.writeFile(pending, bytes, {flag: 'wx', signal: controller.signal});
          if (active) await fs.rename(pending, path.join(out, artifact));
        });
      } finally { active = false; controller.abort(); }
    };
    const writeRecord = async (artifact, value, stage) => {
      try { await publish(artifact, JSON.stringify(value, null, 2)); }
      catch (failure) { captureError(artifact, stage, failure); }
    };
    record.artifactAttempts = [];
    const attempt = async (artifact, capture, encode = value => value) => {
      const state = {artifact, startedUtc: new Date().toISOString(), status: 'running'};
      record.artifactAttempts.push(state);
      try {
        const value = await bounded(`${artifact} capture`, capture);
        await publish(artifact, encode(value)); state.status = 'saved';
      } catch (failure) {
        state.status = failure?.code === 'CAPTURE_TIMEOUT' ? 'timed-out' : 'failed';
        captureError(artifact, 'capture-or-write', failure);
      } finally { state.finishedUtc = new Date().toISOString(); }
    };
    // Each metadata write is independent. failure.json being unwritable cannot skip captures.
    try {
      await writeRecord('failure.json', record, 'initial');
      await writeRecord('events.json', events, 'initial');
      const tracePending = path.join(out, `.trace.${randomUUID()}.pending`);
      await Promise.all([
      attempt('page-state.json', () => page.evaluate(() => ({url: location.href, title: document.title,
          readyState: document.readyState, caseNumber: [...document.querySelectorAll('[data-field="header.caseNumber"]')].map(e => ({
            html: e.outerHTML, display: getComputedStyle(e).display, visibility: getComputedStyle(e).visibility,
            rect: {x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y,
              width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height}}))})), value => JSON.stringify(value, null, 2)),
      attempt('page.html', () => page.content()),
      attempt('screenshot.png', () => page.screenshot({fullPage: true, timeout: policy.artifactMs})),
      attempt('trace.zip', async () => {
        if (!tracing) throw new Error('Trace was not started');
        await context.tracing.stop({path: tracePending}); tracing = false;
        return fs.readFile(tracePending);
      }),
      ]);
      if (record.captureErrors.some(item => item.code === 'CAPTURE_TIMEOUT')) {
        record.cleanup = await closeAfterEvidence(context, policy.cleanupMs);
      }
      record.finishedUtc = new Date().toISOString();
      record.captureElapsedMs = performance.now() - started;
      await writeRecord('failure.json', record, 'final');
      await writeRecord('events.json', events, 'final');
      await writeRecord('result.json', record, 'final');
      await bounded('manifest', manifest);
    } catch (captureError) {
      // Storage failures must never replace the original test exception or make it pass.
      console.error(`Browser diagnostic storage failure: ${captureError.stack || captureError}`);
      console.error(`Browser diagnostic fallback record: ${JSON.stringify(record)}`);
    }
    throw error;
  } finally {
    for (const remove of listeners) remove();
  }
}
