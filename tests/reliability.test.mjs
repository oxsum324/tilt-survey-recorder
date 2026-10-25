import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID, createHash} from 'node:crypto';
import {cleanupProfile, applyCleanupResult, profileCleanupPolicy} from './release/profile-cleanup.mjs';
import {createTransportGate} from './release/transport-gate.mjs';
import {capturePolicy} from './browser-failure-evidence.mjs';
import {runCaptured} from './release/command.mjs';
import {executionOrigin} from './execution-origin.mjs';

const root = path.resolve(process.env.TILT_RELIABILITY_ROOT || 'output/playwright/reliability', 'run-' + randomUUID());
await fs.mkdir(path.join(root, 'commands'), {recursive: true});
const cases = [], read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const passed = async (name, data) => {cases.push({name, status: 'pass', data}); await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({...executionOrigin(), cases}, null, 2));};
const profile = () => path.join(os.tmpdir(), 'tilt-map-live-regression-' + randomUUID());

test('successful isolated profile teardown uses the independent 10000ms shared deadline and deletes actual files', async () => {
  const p = profile(); await fs.mkdir(p); await fs.writeFile(path.join(p, 'synthetic'), 'test');
  const result = await cleanupProfile({profile: p, context: {close: async () => {}}});
  assert.equal(result.status, 'completed'); assert.equal(result.timeoutMs, profileCleanupPolicy.totalMs);
  await assert.rejects(fs.stat(p), {code: 'ENOENT'}); assert.equal(result.verification.absent, true); await passed('profile-complete', result);
});

test('unresponsive context is bounded by the approved 10000ms and removal is still attempted', async () => {
  let removed = false;
  const result = await cleanupProfile({profile: profile(), context: {close: () => new Promise(() => {})},
    failed: true, remove: async () => {removed = true;}});
  assert.equal(result.status, 'failed'); assert.equal(result.originalFailure, true); assert.ok(removed);
  assert.equal(result.stages[0].status, 'timed-out'); assert.ok(result.elapsedMs < 11000); await passed('profile-unresponsive', result);
});

test('explicitly owned persistent browser closes directly without waiting for context protocol disposal', async () => {
  const calls = [];
  const browser = {close: async () => {calls.push('browser');}};
  const context = {browser: () => browser, close: () => {calls.push('context'); return new Promise(() => {});}};
  const result = await cleanupProfile({profile: profile(), context, closeOwnedBrowser: true, remove: async () => calls.push('remove')});
  assert.deepEqual(calls, ['browser', 'remove']); assert.equal(result.status, 'completed'); assert.equal(result.timeoutMs, 10000);
  assert.deepEqual(result.stages.map(s => s.name), ['browser-close', 'profile-remove', 'profile-verify-absent']);
  await passed('owned-browser-direct-close', result);
});

test('EBUSY is a failed cleanup, never a successful status', async () => {
  const result = await cleanupProfile({profile: profile(), remove: async () => {throw Object.assign(new Error('injected lockfile'), {code: 'EBUSY'});}});
  assert.equal(result.status, 'failed'); assert.equal(result.stages[0].error.code, 'EBUSY'); await passed('profile-locked', result);
});

test('cleanup failure makes prior success fail and cannot replace an original test error', async () => {
  const cleanup = {status: 'failed', stages: [{name: 'profile-remove', status: 'failed', error: {code: 'EBUSY'}}]};
  const success = {status: 'passed'}; assert.equal(applyCleanupResult(success, cleanup), true);
  assert.equal(success.status, 'failed'); assert.equal(success.error.name, 'CleanupError');
  const original = {name: 'AssertionError', message: 'ORIGINAL', stack: 'ORIGINAL STACK'}, failure = {status: 'failed', error: original};
  assert.equal(applyCleanupResult(failure, cleanup), true); assert.equal(failure.error, original);
  await passed('profile-result-and-original-error', {successCannotHideFailure: true, originalErrorPreserved: true});
});

test('transport gate forwards unchanged online bytes and blocks offline before the upstream', async () => {
  let hits = 0;
  const server = http.createServer((_, response) => {hits++; response.end('UNMODIFIED-SYNTHETIC-BYTES');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gate = await createTransportGate(), proxy = new URL(gate.server), target = `http://127.0.0.1:${server.address().port}/`;
  const request = () => new Promise((resolve, reject) => {
    const req = http.get({hostname: proxy.hostname, port: proxy.port, path: target, agent: false}, response => {
      const chunks = []; response.on('data', b => chunks.push(b)); response.on('end', () => resolve(Buffer.concat(chunks).toString()));
    }); req.on('error', reject);
  });
  try {
    gate.setOnline(true, 'online'); assert.equal(await request(), 'UNMODIFIED-SYNTHETIC-BYTES'); assert.equal(hits, 1);
    gate.setOnline(false, 'offline'); await assert.rejects(request()); assert.equal(hits, 1);
    assert.ok(gate.events.some(e => e.status === 'blocked')); await passed('transport-boundary', {upstreamHits: hits, events: gate.events});
  } finally {await gate.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
});

test('cleanup lock failure exits nonzero with stderr and original failure intact', async () => {
  for (const mode of ['prior-success', 'original-failure']) {
    const out = path.join(root, 'cleanup-' + mode), name = 'cleanup-' + mode;
    const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
      args: ['tests/fixtures/cleanup-failure-child.mjs', out, mode]});
    assert.equal(execution.rawExitCode, 1); assert.equal(execution.signal, null); assert.equal(execution.watchdogTriggered, false);
    const record = await read(path.join(out, 'results.json')); assert.equal(record.status, 'failed');
    assert.equal(record.cleanup.status, 'failed');
    if (mode === 'original-failure') assert.deepEqual(record.error, {name: 'AssertionError', message: 'ORIGINAL ASSERTION', stack: 'ORIGINAL STACK'});
    else assert.equal(record.error.name, 'CleanupError');
    assert.match(await fs.readFile(path.join(root, 'commands', name, 'stderr.log'), 'utf8'), /INJECTED LOCKFILE BUSY/);
  }
  await passed('cleanup-native-failure-and-stderr', {children: 2, rawExitCode: 1});
});

test('seed-close rejection does not skip context close or profile removal', async () => {
  const calls = [];
  const result = await cleanupProfile({profile: profile(), seed: {close: async () => {calls.push('seed'); throw Error('injected seed close');}},
    context: {close: async () => calls.push('context')}, remove: async () => calls.push('remove'), failed: true});
  assert.deepEqual(calls, ['seed', 'context', 'remove']); assert.equal(result.status, 'failed'); await passed('profile-independent-attempts', result);
});

test('late cleanup completion cannot mutate sealed failure receipt', async () => {
  let finish;
  const result = await cleanupProfile({profile: profile(), timeoutMs: 40, remove: () => new Promise(resolve => {finish = resolve;})});
  const before = JSON.stringify(result); finish(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(JSON.stringify(result), before); assert.equal(result.status, 'failed'); await passed('profile-late-completion', result);
});

test('unsafe cleanup paths reject before any deletion', async () => {
  let called = false;
  await assert.rejects(cleanupProfile({profile: process.cwd(), remove: async () => {called = true;}}), /Only isolated/);
  assert.equal(called, false); await passed('profile-path-boundary', {deletionAttempted: false});
});

test('failure-path native export timeout records phases and preserves the original action error', async () => {
  for (const channel of ['chrome', 'msedge']) {
    const base = path.join(root, channel), name = channel + '-failure-export-delay';
    const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
      args: ['tests/fixtures/trace-completion-child.mjs', base, 'failure-export-delay', channel]});
    assert.equal(execution.rawExitCode, 1); assert.equal(execution.signal, null); assert.equal(execution.watchdogTriggered, false);
    const out = path.join(base, 'failure-export-delay'), failure = await read(path.join(out, 'failure.json'));
    assert.equal(failure.originalError.message, 'INJECTED ORIGINAL ACTION FAILURE'); assert.equal(failure.traceStop.calls, 1);
    assert.equal(failure.artifactAttempts.find(a => a.artifact === 'trace.zip').status, 'timed-out');
    assert.ok(failure.artifactAttempts.filter(a => a.artifact !== 'trace.zip').every(a => a.status === 'saved'));
    const diagnostic = await read(path.join(out, 'trace-export.json'));
    for (const stage of ['guard-failed', 'failure-capture-wait', 'stop-requested', 'native-stop-entered', 'capture-sealed']) assert.ok(diagnostic.stages.some(s => s.stage === stage), stage);
    assert.match(diagnostic.nativeInternals, /opaque/);
    assert.equal((await read(path.join(out, 'child-observation.json'))).sameOriginalError, true);
    assert.match(await fs.readFile(path.join(root, 'commands', name, 'stderr.log'), 'utf8'), /INJECTED ORIGINAL ACTION FAILURE/);
    await assert.rejects(fs.stat(path.join(out, 'trace.zip')), {code: 'ENOENT'});
  }
  await passed('failure-export-stage-diagnostics', {realChildren: 2, missingTraceRequired: true});
});

for (const channel of ['chrome', 'msedge']) test(channel + ' reproduces real updater crossing page offline emulation and 27 install failures', async () => {
  const out = path.join(root, channel + '-worker'), execution = await runCaptured({root: path.join(root, 'commands'), name: channel + '-worker', executable: process.execPath,
    args: ['tests/fixtures/worker-offline-child.mjs', out, channel]});
  assert.equal(execution.rawExitCode, 0); assert.equal(execution.watchdogTriggered, false); assert.equal(execution.signal, null);
  const result = await read(path.join(out, 'results.json')); assert.equal(result.status, 'passed'); assert.equal(result.offline.requestFailures.length, 28);
  assert.equal((await read(path.join(out, 'cleanup.json'))).status, 'completed');
  const lifecycle = (await fs.readFile(path.join(out, 'worker-lifecycle.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(lifecycle.some(e => e.type === 'cdp-workerVersionUpdated'));
  assert.ok(lifecycle.some(e => e.type === 'worker-script-body' && e.data.sha256 === result.newWorkerSha256 && e.data.responsePhase === 'offline'));
  await passed(channel + '-updater-offline-reproduction', {realBrowser: true, failures: 28, preciseCauseInControlledFixture: true});
});

test('profile policy alone accepts a 2250ms owned close and confirms actual deletion', async () => {
  const p = profile(); await fs.mkdir(p); await fs.writeFile(path.join(p, 'synthetic'), 'test');
  const browser = {close: async () => new Promise(resolve => setTimeout(resolve, 2250))};
  const result = await cleanupProfile({profile: p, context: {browser: () => browser}, closeOwnedBrowser: true});
  assert.equal(result.status, 'completed'); assert.equal(result.timeoutMs, 10000);
  assert.deepEqual(capturePolicy, {artifactMs: 2000, totalMs: 12000, cleanupMs: 2000});
  assert.equal(result.verification.absent, true); assert.equal(result.verification.status, 'confirmed');
  await assert.rejects(fs.lstat(p), {code: 'ENOENT'}); await passed('profile-independent-budget-and-absence', result);
});

test('a no-op removal cannot claim a remaining actual profile was deleted', async () => {
  const p = profile(); await fs.mkdir(p); await fs.writeFile(path.join(p, 'synthetic'), 'test');
  try {
    const result = await cleanupProfile({profile: p, remove: async () => {}});
    assert.equal(result.status, 'failed'); assert.equal(result.verification.status, 'unconfirmed');
    assert.equal(result.verification.absent, null);
    assert.equal(result.stages.at(-1).error.code, 'PROFILE_STILL_EXISTS');
    await passed('profile-remains-rejected', result);
  } finally {await fs.rm(p, {recursive: true, force: true});}
});

test('a rejected absence inspection cannot be treated as ENOENT confirmation', async () => {
  const result = await cleanupProfile({profile: profile(), inspect: async () => {
    throw Object.assign(Error('INJECTED PROFILE INSPECTION DENIAL'), {code: 'EACCES'});
  }});
  assert.equal(result.status, 'failed'); assert.equal(result.verification.absent, null);
  assert.equal(result.stages.at(-1).error.code, 'EACCES'); await passed('profile-inspection-denial', result);
});

test.after(async () => {
  const entries = [];
  const walk = async dir => {for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, item.name); if (item.isDirectory()) await walk(p);
    else {const b = await fs.readFile(p); entries.push({file: path.relative(root, p).replaceAll('\\', '/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex')});}
  }};
  await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(entries, null, 2));
});
