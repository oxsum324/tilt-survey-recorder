import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID, createHash} from 'node:crypto';
import {capturePolicy} from './browser-failure-evidence.mjs';
import {finalizeLiveUpgrade} from './release/live-finalize.mjs';
import {createWorkerJournal, writeEvidence, evidenceAttempt} from './release/evidence-io.mjs';
import {observeWorkers} from './release/worker-lifecycle.mjs';
import {runCaptured} from './release/command.mjs';
import {executionOrigin} from './execution-origin.mjs';

const root = path.resolve(process.env.TILT_EVIDENCE_IO_ROOT || 'output/playwright/evidence-io', 'run-' + randomUUID());
await fs.mkdir(path.join(root, 'commands'), {recursive: true});
const cases = [], passed = async (name, data) => {
  cases.push({name, status: 'pass', data});
  await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({...executionOrigin(), cases}, null, 2));
};
const fail = () => Object.assign(Error('INJECTED WRITE FAILURE'), {code: 'ENOSPC'});
const original = () => ({name: 'AssertionError', message: 'ORIGINAL', stack: 'ORIGINAL STACK'});
const complete = {status: 'completed', stages: []};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('transport rejection cannot skip cleanup, observer receipt or final receipt or replace the original', async () => {
  const error = original(), record = {status: 'failed', error}, calls = [], saved = {};
  const result = await finalizeLiveUpgrade({record, out: root, profile: 'mock', gate: {events: []},
    observer: {seal: async () => {calls.push('seal'); return {status: 'completed'};}},
    cleanup: async () => {calls.push('cleanup'); return complete;}, stderr: () => {},
    write: async (file, bytes) => {const name = path.basename(file); calls.push(name);
      if (name === 'transport-events.json') throw fail(); saved[name] = JSON.parse(bytes); return {status: 'saved'};}});
  assert.equal(calls[0], 'cleanup'); assert.equal(result.failed, true); assert.equal(record.error, error);
  assert.ok(saved['worker-observer.json']); assert.deepEqual(saved['results.json'].error, error);
  await passed('transport-rejection-isolated', {cleanupFirst: true, otherReceiptsSaved: true, originalRetained: true});
});

test('unresponsive transport writer retains the original artifact deadline and still saves results', async () => {
  const error = original(), record = {status: 'failed', error}; let cleaned = false, saved = false;
  const start = performance.now();
  await finalizeLiveUpgrade({record, out: root, profile: 'mock', gate: {events: []},
    cleanup: async () => {cleaned = true; return complete;}, stderr: () => {},
    write: file => path.basename(file) === 'transport-events.json' ? new Promise(() => {}) : (saved = true, Promise.resolve({status: 'saved'}))});
  const elapsedMs = performance.now() - start;
  assert.ok(cleaned && saved); assert.equal(record.error, error); assert.equal(record.evidenceErrors[0].status, 'timed-out');
  assert.ok(elapsedMs >= capturePolicy.artifactMs && elapsedMs < 3000, JSON.stringify({elapsedMs, artifactMs: capturePolicy.artifactMs}));
  await passed('transport-unresponsive-deadline', {elapsedMs, artifactMs: capturePolicy.artifactMs});
});

test('final receipt synchronous failure preserves original and emits a full stderr fallback', async () => {
  for (const status of ['passed', 'failed']) {
    const error = original(), record = status === 'failed' ? {status, error} : {status}, logs = [];
    const result = await finalizeLiveUpgrade({record, out: root, profile: 'mock', cleanup: async () => complete,
      write: () => {throw fail();}, stderr: value => logs.push(value)});
    assert.equal(result.failed, true); assert.equal(record.status, 'failed');
    if (status === 'failed') assert.equal(record.error, error);
    assert.ok(logs.some(v => v.includes('Live final fallback record:')));
    if (status === 'passed') assert.equal(record.error.name, 'EvidenceWriteError');
    else assert.ok(logs.some(v => v.includes('ORIGINAL STACK')));
  }
  await passed('final-receipt-fallback', {priorSuccessAndFailure: true});
});

test('unexpected cleanup rejection still attempts every metadata receipt without replacing original', async () => {
  const error = original(), record = {status: 'failed', error}, writes = [];
  await finalizeLiveUpgrade({record, out: root, profile: 'mock', gate: {events: []}, observer: {seal: async () => ({status: 'completed'})},
    cleanup: () => {throw fail();}, stderr: () => {}, write: async file => {writes.push(path.basename(file)); return {status: 'saved'};}});
  assert.equal(record.error, error); assert.equal(record.cleanup.status, 'failed');
  assert.deepEqual(writes.sort(), ['results.json', 'transport-events.json', 'worker-observer.json']);
  await passed('cleanup-rejection-metadata-independent', {writes});
});

test('worker initial file rejection retains events and a failed observer receipt', async () => {
  const journal = createWorkerJournal('mock.jsonl', {io: {mkdir: async () => {}, writeFile: () => Promise.reject(fail())}, stderr: () => {}});
  assert.doesNotThrow(() => journal.emit({type: 'initial-rejection'}));
  const receipt = await journal.seal(); assert.equal(receipt.status, 'failed');
  assert.equal(receipt.errors[0].stage, 'initialize'); assert.equal(receipt.events.length, 1);
  await passed('worker-initial-write-rejection', receipt);
});

for (const mode of ['sync', 'async']) test('worker append ' + mode + ' failure is consumed and cannot replace original', async () => {
  const journal = createWorkerJournal('mock.jsonl', {io: {mkdir: async () => {}, writeFile: async () => {},
    appendFile: mode === 'sync' ? () => {throw fail();} : () => Promise.reject(fail())}, stderr: () => {}});
  assert.doesNotThrow(() => journal.emit({type: mode}));
  const receipt = await journal.seal(); assert.equal(receipt.status, 'failed'); assert.equal(receipt.errors[0].error.code, 'ENOSPC');
  const error = original(), record = {status: 'failed', error};
  await finalizeLiveUpgrade({record, out: root, profile: 'mock', observer: {seal: async () => receipt},
    cleanup: async () => complete, write: async () => ({status: 'saved'}), stderr: () => {}});
  assert.equal(record.error, error); assert.equal(record.workerObserver.status, 'failed');
  await passed('worker-' + mode + '-append', receipt);
});

test('worker unresponsive writer is bounded and its late result cannot rewrite the sealed receipt', async () => {
  let finish; const journal = createWorkerJournal('mock.jsonl', {io: {mkdir: async () => {}, writeFile: async () => {},
    appendFile: () => new Promise(resolve => {finish = resolve;})}, stderr: () => {}});
  journal.emit({type: 'hung'}); const start = performance.now(), receipt = await journal.seal();
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.journal.status, 'incomplete');
  assert.ok(performance.now() - start >= 2000 && performance.now() - start < 3000);
  const frozen = JSON.stringify(receipt); finish(); await tick(); journal.emit({type: 'late'});
  assert.equal(JSON.stringify(receipt), frozen); assert.equal(journal.events.length, 1);
  await passed('worker-unresponsive-sealed', receipt);
});

test('actual observer CDP callbacks and response-body continuations consume injected sync and async append failures', async () => {
  for (const mode of ['cdp-sync', 'response-async']) {
    const context = new EventEmitter(), session = new EventEmitter();
    session.send = async () => {}; Object.assign(context, {serviceWorkers: () => [], newCDPSession: async () => session,
      exposeBinding: async () => {}, addInitScript: async () => {}});
    const observer = await observeWorkers(context, {}, root, () => 'offline', {stderr: () => {},
      io: {mkdir: async () => {}, writeFile: async () => {}, appendFile: mode === 'cdp-sync' ? () => {throw fail();} : () => Promise.reject(fail())}});
    if (mode === 'cdp-sync') assert.doesNotThrow(() => session.emit('ServiceWorker.workerVersionUpdated', {versions: []}));
    else assert.doesNotThrow(() => context.emit('response', {url: () => 'https://example.test/sw.js', body: async () => Buffer.from('worker'), status: () => 200, fromServiceWorker: () => false}));
    const receipt = await observer.seal(); await tick();
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.errors[0].error.code, 'ENOSPC');
    assert.equal(session.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
    assert.equal(context.listenerCount('response'), 0);
  }
  await passed('actual-observer-callback-isolation', {modes: ['cdp-sync', 'response-async'], unhandledRejections: 0});
});

test('late atomic write never renames a pending file to a successful artifact after timeout', async () => {
  let finish, renamed = false;
  const receipt = await writeEvidence(path.join(root, 'unit-late.json'), 'x', {timeoutMs: 40,
    io: {writeFile: () => new Promise(resolve => {finish = resolve;}), rename: async () => {renamed = true;}}});
  assert.equal(receipt.status, 'timed-out'); const before = JSON.stringify(receipt);
  finish(); await tick(); assert.equal(renamed, false); assert.equal(JSON.stringify(receipt), before);
  await passed('late-write-not-published', receipt);
});

test('native write failure children exit one, retain stderr and original error and delete the actual profile', async () => {
  const modes = ['transport-reject', 'transport-hang', 'results-reject', 'results-hang', 'worker-sync', 'worker-async', 'worker-hang'];
  for (const mode of modes) {
    const out = path.join(root, mode), execution = await runCaptured({root: path.join(root, 'commands'), name: mode,
      executable: process.execPath, args: ['tests/fixtures/evidence-io-child.mjs', out, mode]});
    assert.equal(execution.rawExitCode, 1); assert.equal(execution.signal, null); assert.equal(execution.watchdogTriggered, false);
    const observation = JSON.parse(await fs.readFile(path.join(out, 'observation.json'), 'utf8'));
    assert.equal(observation.cleanupCalled, true); assert.equal(observation.removed, true);
    assert.equal(observation.sameOriginalError, true); assert.equal(observation.record.cleanup.status, 'completed');
    const stderr = await fs.readFile(path.join(root, 'commands', mode, 'stderr.log'), 'utf8');
    assert.match(stderr, /Live final fallback record:/); assert.match(stderr, /ORIGINAL IO STACK/);
    if (!mode.startsWith('results-')) assert.equal(JSON.parse(await fs.readFile(path.join(out, 'results.json'), 'utf8')).status, 'failed');
    if (mode.startsWith('worker-')) {
      assert.ok(observation.attempts.includes('worker-observer.json'));
      const observer = JSON.parse(await fs.readFile(path.join(out, 'worker-observer.json'), 'utf8'));
      assert.deepEqual(observer, observation.record.workerObserver);
      assert.equal(observer.status, 'failed'); assert.equal(observer.journal.status, 'incomplete');
      assert.deepEqual(observer.events, [{type: 'injected-worker', data: 'SYNTHETIC'}]);
      assert.ok(observer.errors.length > 0);
    }
  }
  await passed('native-io-failure-exits-and-cleanup', {modes, rawExitCode: 1, syntheticProfilesActuallyRemoved: 7});
});

test('normal async worker journal preserves ordered real bytes and seals successfully', async () => {
  const file = path.join(root, 'normal-worker.jsonl'), journal = createWorkerJournal(file);
  for (let i = 0; i < 50; i++) journal.emit({type: 'ordered', index: i});
  const receipt = await journal.seal(); assert.equal(receipt.status, 'completed'); assert.deepEqual(receipt.errors, []);
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines, receipt.events); assert.equal(lines.length, 50);
  await passed('real-journal-ordered-success', {lines: lines.length});
});

test('an early timer wakeup cannot declare expiry before the unchanged monotonic deadline', async () => {
  let now = 0; const delays = [], canceled = [];
  const receipt = await evidenceAttempt('early-wakeup', () => new Promise(() => {}), 2000, {
    clock: () => now, cancel: timer => canceled.push(timer),
    schedule: (callback, delay) => {delays.push(delay); const id = delays.length;
      queueMicrotask(() => {now = id === 1 ? 1999 : 2000; callback();}); return id;},
  });
  assert.deepEqual(delays, [2000, 1]); assert.deepEqual(canceled, [2]);
  assert.equal(now, 2000); assert.equal(receipt.status, 'timed-out');
  await passed('monotonic-early-wakeup', {requestedDeadlineMs: 2000, firstWakeMs: 1999, expiryMs: now, delays});
});

test.after(async () => {
  const files = [];
  const walk = async dir => {for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else {const bytes = await fs.readFile(file); files.push({file: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')});}
  }};
  await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(files, null, 2));
});
