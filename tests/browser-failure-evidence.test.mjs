import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {EventEmitter} from 'node:events';
import {withFailureEvidence, capturePolicy, closeAfterEvidence} from './browser-failure-evidence.mjs';
import {executionOrigin} from './execution-origin.mjs';

const root = path.resolve(process.env.TILT_BROWSER_REGRESSION_ROOT ||
  path.join('output/playwright/timeout-regressions', new Date().toISOString().replace(/[:.]/g, '-')));
await fs.mkdir(path.dirname(root), {recursive: true}); await fs.mkdir(root);
const channels = process.platform === 'win32' ? ['chrome', 'msedge'] : [undefined];
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const save = () => fs.writeFile(path.join(root, 'results.json'), JSON.stringify({
  ...executionOrigin(), targetScope: 'synthetic injected failures; child exit 1 is required', cases: results}, null, 2));
const injected = async (mode, channel) => {
  const channelRoot = path.join(root, channel || 'chromium');
  const chunks = [], child = spawn(process.execPath, ['tests/fixtures/browser-timeout-child.mjs', channelRoot, mode, channel || 'chromium'],
    {stdio: ['ignore', 'pipe', 'pipe']});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => chunks.push(b));
  let watchdogTriggered = false;
  const watchdog = setTimeout(() => {
    watchdogTriggered = true;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
    else child.kill('SIGKILL');
  }, 30000);
  const completion = await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', (code, signal) => resolve({exitCode: code, signal, watchdogTriggered}));
  }).finally(() => clearTimeout(watchdog));
  clearTimeout(watchdog);
  await fs.writeFile(path.join(root, `${channel || 'chromium'}-${mode}-child.log`), Buffer.concat(chunks));
  await fs.writeFile(path.join(root, `${channel || 'chromium'}-${mode}-child.json`), JSON.stringify(completion, null, 2));
  assert.equal(watchdogTriggered, false, 'A hung diagnostic must fail rather than pass by being killed');
  assert.equal(completion.exitCode, 1); assert.equal(completion.signal, null);
  const out = path.join(channelRoot, mode), record = await read(path.join(out,
    mode === 'first-receipt-write-failure' ? 'result.json' : 'failure.json'));
  assert.equal(record.status, 'failed'); assert.equal(record.scope, executionOrigin().scope);
  assert.deepEqual(record.execution, executionOrigin().execution);
  assert.equal((await read(path.join(out, 'child-observation.json'))).sameOriginalError, true);
  const manifest = await read(path.join(out, 'sha256.json'));
  for (const entry of manifest) {
    const bytes = await fs.readFile(path.join(out, entry.file));
    assert.equal(bytes.length, entry.bytes); assert.equal(sha(bytes), entry.sha256);
  }
  return {out, record, log: Buffer.concat(chunks).toString('utf8')};
};
const passed = async (name, data) => { results.push({name, status: 'pass', ...data}); await save(); };

test('real locator timeout saves live page, trace, events and original nonzero exit before cleanup', async () => {
  for (const channel of channels) {
  const {out, record, log} = await injected('timeout', channel);
  assert.equal(record.originalError.name, 'TimeoutError'); assert.match(record.originalError.message, /Timeout 500ms exceeded/);
  assert.match(log, /locator.waitFor: Timeout 500ms exceeded/); assert.equal(record.pageClosedAtFailure, false);
  assert.deepEqual(record.captureErrors, []);
  const state = await read(path.join(out, 'page-state.json'));
  assert.equal(state.title, 'Timeout evidence fixture'); assert.equal(state.caseNumber.length, 1);
  assert.equal(state.caseNumber[0].display, 'none'); assert.match(await fs.readFile(path.join(out, 'page.html'), 'utf8'), /INJECTED-HIDDEN/);
  assert.deepEqual([...(await fs.readFile(path.join(out, 'screenshot.png'))).subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.equal((await fs.readFile(path.join(out, 'trace.zip'))).subarray(0, 2).toString(), 'PK');
  const events = await read(path.join(out, 'events.json'));
  for (const predicate of [e => e.type === 'console' && e.level === 'error' && /INJECTED console/.test(e.text),
    e => e.type === 'pageerror' && /INJECTED page/.test(e.error.message),
    e => e.type === 'response' && e.status === 503, e => e.type === 'requestfailed' && e.url.endsWith('/abort')]) assert.ok(events.some(predicate));
  assert.ok(events.every(e => Date.parse(e.at) >= Date.parse(record.attachedUtc)));
  }
  await passed('live-timeout-capture', {channels, expectedChildExitCode: 1, artifactsPerBrowser: 7});
});

test('failed screenshot storage is explicit and cannot mask or pass the original timeout', async () => {
  for (const channel of channels) {
  const {out, record, log} = await injected('screenshot-write-failure', channel);
  assert.equal(record.originalError.name, 'TimeoutError'); assert.match(log, /locator.waitFor: Timeout 500ms exceeded/);
  assert.ok(record.captureErrors.some(e => e.artifact === 'screenshot.png'));
  assert.ok((await fs.stat(path.join(out, 'trace.zip'))).size > 0);
  assert.ok((await fs.stat(path.join(out, 'page.html'))).size > 0);
  }
  await passed('partial-storage-failure', {channels, expectedChildExitCode: 1});
});

test('closed page retains the original error and explicitly records unavailable live artifacts', async () => {
  for (const channel of channels) {
  const {record, log} = await injected('closed-page', channel);
  assert.equal(record.pageClosedAtFailure, true); assert.match(record.originalError.message, /closed/);
  assert.match(log, /Target page, context or browser has been closed/);
  for (const name of ['page-state.json', 'page.html', 'screenshot.png']) assert.ok(record.captureErrors.some(e => e.artifact === name));
  }
  await passed('closed-page-failure', {channels, expectedChildExitCode: 1});
});

test('successful action keeps its value and does not create failure artifacts', async () => {
  for (const channel of channels) {
  const browser = await chromium.launch({channel, headless: true}), context = await browser.newContext(), page = await context.newPage();
  try {
    const channelRoot = path.join(root, channel || 'chromium');
    const value = await withFailureEvidence({context, page, root: channelRoot, name: 'success'}, async () => { await page.setContent('<title>success</title>'); return 42; });
    assert.equal(value, 42); assert.equal((await read(path.join(channelRoot, 'success/result.json'))).status, 'passed');
    await assert.rejects(fs.stat(path.join(channelRoot, 'success/failure.json')), {code: 'ENOENT'});
    await assert.rejects(fs.stat(path.join(channelRoot, 'success/trace.zip')), {code: 'ENOENT'});
  } finally { await context.close(); await browser.close(); }
  }
  await passed('success-is-not-a-failure', {channels});
});

test('reusing an evidence directory is rejected without changing prior failure bytes', async () => {
  for (const channel of channels) {
  const channelRoot = path.join(root, channel || 'chromium');
  const before = await fs.readFile(path.join(channelRoot, 'timeout/failure.json'));
  await assert.rejects(withFailureEvidence({context: null, page: null, root: channelRoot, name: 'timeout'}, () => assert.fail('must not run')), {code: 'EEXIST'});
  assert.deepEqual(await fs.readFile(path.join(channelRoot, 'timeout/failure.json')), before);
  }
  await passed('preserve-prior-failure', {channels});
});

test('failure.json write failure cannot skip other attachments or replace the original timeout', async () => {
  for (const channel of channels) {
    const {out, record, log} = await injected('first-receipt-write-failure', channel);
    assert.equal(record.originalError.name, 'TimeoutError');
    assert.match(log, /locator.waitFor: Timeout 500ms exceeded/);
    assert.ok(record.captureErrors.some(e => e.artifact === 'failure.json' && e.stage === 'initial'));
    assert.ok((await fs.stat(path.join(out, 'failure.json'))).isDirectory());
    assert.equal(record.artifactAttempts.length, 4);
    assert.ok(record.artifactAttempts.every(item => item.status === 'saved'));
    const pending = (await fs.readdir(out)).filter(file => file.endsWith('.pending'));
    assert.ok(pending.length > 0);
    assert.ok(pending.every(file => !file.startsWith('.')), 'Staging evidence must not be excluded as a hidden upload file');
    assert.ok((await read(path.join(out, 'sha256.json'))).every(item => !item.file.endsWith('.pending')));
    for (const name of ['page-state.json', 'page.html', 'screenshot.png', 'trace.zip', 'events.json']) {
      assert.ok((await fs.stat(path.join(out, name))).size > 0, name);
    }
  }
  await passed('first-receipt-isolated', {channels, expectedChildExitCode: 1});
});

test('a real unresponsive renderer has bounded capture, cleanup and original-error propagation', async () => {
  for (const channel of channels) {
    const {out, record, log} = await injected('unresponsive-page', channel);
    assert.equal(record.originalError.name, 'TimeoutError'); assert.match(log, /locator.waitFor: Timeout 500ms exceeded/);
    assert.deepEqual(record.policy, capturePolicy);
    assert.equal(record.artifactAttempts.length, 4);
    assert.ok(record.captureErrors.some(item => item.code === 'CAPTURE_TIMEOUT'));
    assert.equal(record.cleanup.status, 'closed');
    assert.ok(record.captureElapsedMs <= capturePolicy.totalMs + capturePolicy.cleanupMs);
    const child = await read(path.join(out, 'child-observation.json'));
    assert.equal(child.sameOriginalError, true); assert.equal(child.pageClosedAfterGuard, true);
    assert.ok(child.elapsedMs < 20000, 'Default diagnostic budgets must not reach the 30s subprocess watchdog');
    const before = await fs.readFile(path.join(out, 'sha256.json'));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual(await fs.readFile(path.join(out, 'sha256.json')), before);
  }
  await passed('unresponsive-renderer-bounded', {channels, expectedChildExitCode: 1});
});

const mock = ({evaluate, close = async () => {}}) => {
  const context = new EventEmitter(), page = new EventEmitter();
  context.close = close;
  context.tracing = {start: async () => {}, stop: async options => {
    if (options?.path) await fs.writeFile(options.path, 'mock trace; not a real browser artifact');
  }};
  Object.assign(page, {isClosed: () => false, url: () => 'http://memory.invalid', evaluate,
    content: async () => '<html>mock</html>', screenshot: async () => Buffer.from('mock screenshot')});
  return {context, page};
};

test('late page-state completion cannot publish an artifact after its capture deadline', async () => {
  const name = 'late-page-state', resources = mock({evaluate: () => new Promise(resolve => setTimeout(() => resolve({late: true}), 400))});
  const original = Object.assign(new Error('unit original timeout'), {name: 'TimeoutError'});
  const policy = {artifactMs: 80, totalMs: 1000, cleanupMs: 80};
  await assert.rejects(withFailureEvidence({...resources, name, root, policy}, async () => { throw original; }), error => error === original);
  const out = path.join(root, name), record = await read(path.join(out, 'result.json'));
  assert.ok(record.captureErrors.some(e => e.artifact === 'page-state.json' && e.code === 'CAPTURE_TIMEOUT'));
  const manifest = await fs.readFile(path.join(out, 'sha256.json'));
  await new Promise(resolve => setTimeout(resolve, 450));
  await assert.rejects(fs.stat(path.join(out, 'page-state.json')), {code: 'ENOENT'});
  assert.deepEqual(await fs.readFile(path.join(out, 'sha256.json')), manifest);
  await passed('late-completion-not-published', {scope: 'unit simulation; not real browser artifacts'});
});

test('cleanup that never settles has its own deadline and cannot replace the original error', async () => {
  const name = 'cleanup-deadline', resources = mock({evaluate: () => new Promise(() => {}), close: () => new Promise(() => {})});
  const original = Object.assign(new Error('unit original timeout'), {name: 'TimeoutError'});
  const policy = {artifactMs: 80, totalMs: 1000, cleanupMs: 80}, started = performance.now();
  await assert.rejects(withFailureEvidence({...resources, name, root, policy}, async () => { throw original; }), error => error === original);
  const record = await read(path.join(root, name, 'result.json'));
  assert.equal(record.cleanup.status, 'failed');
  assert.equal(record.originalError.message, original.message);
  assert.ok(performance.now() - started < 1000);
  assert.equal((await closeAfterEvidence(resources.context, 80)).status, 'failed');
  const cleanupFailure = new Error('standalone cleanup must still fail');
  await assert.rejects(closeAfterEvidence({close: async () => { throw cleanupFailure; }}, 80), error => error === cleanupFailure);
  await passed('cleanup-own-deadline', {scope: 'unit simulation; not real browser artifacts'});
});

test('total capture budget limits all stalled artifacts and retains a failed fallback record', async () => {
  const name = 'total-capture-budget', resources = mock({evaluate: () => new Promise(() => {})});
  resources.page.content = () => new Promise(() => {});
  resources.page.screenshot = () => new Promise(() => {});
  resources.context.tracing.stop = () => new Promise(() => {});
  const original = Object.assign(new Error('unit total-budget original'), {name: 'TimeoutError'});
  const policy = {artifactMs: 2000, totalMs: 100, cleanupMs: 80};
  const logs = [], priorError = console.error, started = performance.now();
  console.error = (...values) => logs.push(values.join(' '));
  try {
    await assert.rejects(withFailureEvidence({...resources, name, root, policy}, async () => { throw original; }), error => error === original);
  } finally { console.error = priorError; }
  assert.ok(performance.now() - started < 1000);
  const prefix = 'Browser diagnostic fallback record: ';
  const record = JSON.parse(logs.find(line => line.startsWith(prefix)).slice(prefix.length));
  assert.equal(record.status, 'failed'); assert.equal(record.originalError.message, original.message);
  assert.equal(record.artifactAttempts.length, 4);
  assert.ok(record.artifactAttempts.every(item => item.status === 'timed-out'));
  const initial = await read(path.join(root, name, 'failure.json'));
  assert.equal(initial.status, 'failed'); assert.equal(initial.originalError.message, original.message);
  await fs.writeFile(path.join(root, name, 'unit-fallback-observation.json'), JSON.stringify({record, logs}, null, 2));
  await passed('total-capture-budget', {scope: 'unit simulation; final metadata cannot finish after budget expiry'});
});

// Separate results and counts; the ten existing families above remain unchanged.
await import('./disclosure-regressions.mjs');
