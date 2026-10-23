import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {withFailureEvidence} from './browser-failure-evidence.mjs';

const root = path.resolve(process.env.TILT_BROWSER_REGRESSION_ROOT ||
  path.join('output/playwright/timeout-regressions', new Date().toISOString().replace(/[:.]/g, '-')));
await fs.mkdir(path.dirname(root), {recursive: true}); await fs.mkdir(root);
const channels = process.platform === 'win32' ? ['chrome', 'msedge'] : [undefined];
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
const save = () => fs.writeFile(path.join(root, 'results.json'), JSON.stringify({
  scope: 'local injected failures; child exit 1 is required; not a cloud CI run', cases: results}, null, 2));
const injected = async (mode, channel) => {
  const channelRoot = path.join(root, channel || 'chromium');
  const chunks = [], child = spawn(process.execPath, ['tests/fixtures/browser-timeout-child.mjs', channelRoot, mode, channel || 'chromium'],
    {stdio: ['ignore', 'pipe', 'pipe']});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => chunks.push(b));
  const completion = await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', (code, signal) => resolve({exitCode: code, signal}));
  });
  await fs.writeFile(path.join(root, `${channel || 'chromium'}-${mode}-child.log`), Buffer.concat(chunks));
  await fs.writeFile(path.join(root, `${channel || 'chromium'}-${mode}-child.json`), JSON.stringify(completion, null, 2));
  assert.equal(completion.exitCode, 1); assert.equal(completion.signal, null);
  const out = path.join(channelRoot, mode), record = await read(path.join(out, 'failure.json'));
  assert.equal(record.status, 'failed'); assert.match(record.scope, /not a GitHub cloud run/);
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
