import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID, createHash} from 'node:crypto';
import {withFailureEvidence, capturePolicy} from './browser-failure-evidence.mjs';
import {executionOrigin} from './execution-origin.mjs';
import {runCaptured} from './release/command.mjs';

const root = path.resolve(process.env.TILT_TRACE_COMPLETION_ROOT || 'output/playwright/trace-completion', 'trace-' + randomUUID());
await fs.mkdir(root, {recursive: true});
await fs.mkdir(path.join(root, 'commands'));
const cases = [], read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const passed = async (name, data = {}) => {
  cases.push({name, status: 'pass', ...data});
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({...executionOrigin(), cases}, null, 2));
};
const simulation = stop => {
  const context = new EventEmitter(), page = new EventEmitter(); let closed = false;
  Object.assign(context, {close: async () => {closed = true;}, tracing: {start: async () => {}, stop}});
  Object.assign(page, {isClosed: () => closed, url: () => 'http://simulation.invalid',
    evaluate: async () => ({simulation: true}), content: async () => '<html>simulation</html>', screenshot: async () => Buffer.from('simulation; not real PNG')});
  return {context, page};
};
const unitPolicy = {artifactMs: 80, totalMs: 1000, cleanupMs: 80};

test('execution provenance distinguishes local verification and real GitHub execution', async () => {
  assert.deepEqual(executionOrigin({GITHUB_SHA: 'local-sha', GITHUB_RUN_ID: 'local-label'}), {
    scope: 'local-verification', execution: {environment: 'local', runId: null, attempt: null, job: null, event: null, workflowCommit: null}});
  assert.deepEqual(executionOrigin({GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'checks', GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: 'virtual-sha'}), {
    scope: 'github-actions', execution: {environment: 'github-actions', runId: '123', attempt: '2', job: 'checks', event: 'pull_request', workflowCommit: 'virtual-sha'}});
  await passed('execution-origin');
});

test('successful completion stages exactly one trace then discards it after successful receipts', async () => {
  let calls = 0, staged;
  const resources = simulation(async options => {calls++; staged = options.path; await fs.writeFile(staged, 'unit simulated trace');});
  assert.equal(await withFailureEvidence({...resources, root, name: 'on-time', policy: unitPolicy}, async () => 42), 42);
  assert.equal(calls, 1); assert.ok(path.basename(staged).endsWith('.pending'));
  await assert.rejects(fs.stat(staged), {code: 'ENOENT'});
  await assert.rejects(fs.stat(path.join(root, 'on-time/trace.zip')), {code: 'ENOENT'});
  const record = await read(path.join(root, 'on-time/result.json'));
  assert.equal(record.status, 'passed'); assert.equal(record.traceStop.status, 'completed');
  await passed('on-time-single-export', {scope: 'unit simulation'});
});

for (const mode of ['late-after-save', 'late-before-native']) test(mode + ' retains real trace and original nonzero failure', async () => {
  for (const channel of ['chrome', 'msedge']) {
    const childRoot = path.join(root, channel), name = channel + '-' + mode;
    const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
      args: ['tests/fixtures/trace-completion-child.mjs', childRoot, mode, channel]});
    assert.equal(execution.rawExitCode, 1); assert.equal(execution.exitCode, 1);
    assert.equal(execution.watchdogTriggered, false); assert.equal(execution.signal, null);
    const out = path.join(childRoot, mode), record = await read(path.join(out, 'failure.json'));
    const observation = await read(path.join(out, 'child-observation.json'));
    assert.equal(observation.completedAction, true); assert.equal(observation.calls, 1);
    assert.equal(observation.sameOriginalError, true); assert.equal(observation.pageClosedAfterGuard, false);
    assert.deepEqual(record.policy, capturePolicy); assert.deepEqual(record.execution, executionOrigin().execution);
    assert.equal(record.originalError.name, 'CaptureTimeoutError');
    assert.equal(record.originalError.message, 'tracing.stop: diagnostic deadline 2000ms exceeded');
    assert.equal(record.traceStop.calls, 1); assert.equal(record.traceStop.status, 'completed');
    assert.deepEqual(record.captureErrors, []); assert.equal(record.artifactAttempts.length, 4);
    assert.ok(record.artifactAttempts.every(a => a.status === 'saved'));
    assert.equal((await fs.readFile(path.join(out, 'trace.zip'))).subarray(0, 2).toString(), 'PK');
    const stderr = await fs.readFile(path.join(root, 'commands', name, 'stderr.log'), 'utf8');
    assert.match(stderr, /tracing.stop: diagnostic deadline 2000ms exceeded/);
    assert.doesNotMatch(stderr, /Must start tracing before stopping/);
  }
  await passed(mode, {realBrowserChildren: 2, expectedExitCode: 1, artifactsPerBrowser: 4});
});

test('a late stop rejection cannot replace the original success-boundary timeout', async () => {
  let calls = 0;
  const lateError = new Error('injected late export rejection');
  const resources = simulation(async () => {calls++; await new Promise(r => setTimeout(r, 120)); throw lateError;});
  await assert.rejects(withFailureEvidence({...resources, root, name: 'late-reject', policy: unitPolicy}, async () => 42), error =>
    error.name === 'CaptureTimeoutError' && error.message === 'tracing.stop: diagnostic deadline 80ms exceeded');
  const record = await read(path.join(root, 'late-reject/failure.json'));
  assert.equal(calls, 1); assert.equal(record.originalError.name, 'CaptureTimeoutError');
  assert.equal(record.captureErrors.find(x => x.artifact === 'trace.zip').error.message, lateError.message);
  assert.ok(record.artifactAttempts.filter(x => x.artifact !== 'trace.zip').every(x => x.status === 'saved'));
  await passed('late-rejection-preserves-original', {scope: 'unit simulation; trace rejection explicitly disclosed'});
});

test('a stop that never completes is bounded and cannot replace other saved attachments or pass', async () => {
  let calls = 0; const resources = simulation(() => {calls++; return new Promise(() => {});});
  const started = performance.now();
  await assert.rejects(withFailureEvidence({...resources, root, name: 'never-completes', policy: unitPolicy}, async () => 42), {name: 'CaptureTimeoutError'});
  const record = await read(path.join(root, 'never-completes/failure.json'));
  assert.equal(calls, 1); assert.ok(performance.now() - started < 1000);
  assert.equal(record.artifactAttempts.find(x => x.artifact === 'trace.zip').status, 'timed-out');
  assert.ok(record.artifactAttempts.filter(x => x.artifact !== 'trace.zip').every(x => x.status === 'saved'));
  assert.equal(record.cleanup.status, 'closed'); await assert.rejects(fs.stat(path.join(root, 'never-completes/trace.zip')), {code: 'ENOENT'});
  await passed('never-completes-bounded', {scope: 'unit simulation; missing trace is explicit'});
});

test('completion after capture deadline stays pending and cannot mutate final evidence', async () => {
  let calls = 0; const resources = simulation(async options => {
    calls++; await new Promise(r => setTimeout(r, 400)); await fs.writeFile(options.path, 'late unit trace');
  });
  await assert.rejects(withFailureEvidence({...resources, root, name: 'beyond-capture', policy: unitPolicy}, async () => 42), {name: 'CaptureTimeoutError'});
  const manifest = path.join(root, 'beyond-capture/sha256.json'), before = await fs.readFile(manifest);
  await new Promise(r => setTimeout(r, 450)); assert.equal(calls, 1);
  assert.deepEqual(await fs.readFile(manifest), before);
  await assert.rejects(fs.stat(path.join(root, 'beyond-capture/trace.zip')), {code: 'ENOENT'});
  assert.ok((await fs.readdir(path.join(root, 'beyond-capture'))).some(x => x.endsWith('.pending')));
  assert.ok((await read(manifest)).every(x => !x.file.endsWith('.pending')));
  await passed('late-completion-quarantined', {scope: 'unit simulation; pending bytes are not a final artifact'});
});

test.after(async () => {
  const entries = [];
  const walk = async dir => {for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, item.name); if (item.isDirectory()) await walk(p);
    else {const b = await fs.readFile(p); entries.push({file: path.relative(root, p).replaceAll('\\', '/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex')});}
  }};
  await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(entries, null, 2));
});
