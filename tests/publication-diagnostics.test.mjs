import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {runCaptured} from './release/command.mjs';
import {readPublishedResult, publicationPrefix} from './release/evidence-io.mjs';
import {instrumentTraceNative} from './release/resource-diagnostics.mjs';
import {closeWithEvidence} from './release/close-with-evidence.mjs';
import {closeAfterEvidence, closeDiagnostics, capturePolicy} from './browser-failure-evidence.mjs';
import {cleanupProfile} from './release/profile-cleanup.mjs';
import {executionOrigin} from './execution-origin.mjs';
const root = path.resolve(process.env.TILT_PUBLICATION_ROOT || 'output/playwright/publication-diagnostics', 'run-' + randomUUID());
await fs.mkdir(path.join(root, 'commands'), {recursive: true});
const cases = [], read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const passed = async (name, data) => {cases.push({name, status: 'pass', data}); await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({...executionOrigin(), cases}, null, 2));};
const nativeSuccess = {rawExitCode: 0, signal: null, watchdogTriggered: false};

test('on-time result is accepted only with matching acknowledgement and successful native exit', async () => {
  const name = 'on-time', out = path.join(root, name);
  const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
    args: ['tests/fixtures/publication-child.mjs', out, name, 'passed'], resultFile: path.join(out, 'results.json'), expectedChecks: 0, requirePublication: true});
  assert.equal(execution.rawExitCode, 0); assert.equal(execution.exitCode, 0); assert.ok(execution.resultPublication);
  assert.equal((await read(path.join(out, 'results.json'))).status, 'unsealed');
  assert.equal((await readPublishedResult(path.join(out, 'results.json'), {execution, requirePublication: true})).value.status, 'passed');
  await passed('on-time-ack-and-native-exit', {nativeExit: 0, rawStatus: 'unsealed', acceptedStatus: 'passed'});
});

for (const mode of ['rename-delay', 'rename-reject-sync', 'rename-reject-async']) test(mode + ' cannot publish a passed receipt or replace the original', async () => {
  for (const prior of ['passed', 'failed']) {
    const name = mode + '-' + prior, out = path.join(root, name), start = performance.now();
    const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
      args: ['tests/fixtures/publication-child.mjs', out, mode, prior]});
    assert.equal(execution.rawExitCode, 1); assert.equal(execution.signal, null); assert.equal(execution.watchdogTriggered, false);
    const observation = await read(path.join(out, 'observation.json'));
    assert.equal(observation.removed, true); assert.equal(observation.record.status, 'failed');
    if (prior === 'failed') {assert.equal(observation.sameOriginalError, true); assert.equal(observation.record.error.message, 'ORIGINAL PUBLICATION FAILURE');}
    else assert.equal(observation.record.error.name, 'EvidenceWriteError');
    const stdout = await fs.readFile(path.join(root, 'commands', name, 'stdout.log'), 'utf8');
    const stderr = await fs.readFile(path.join(root, 'commands', name, 'stderr.log'), 'utf8');
    assert.ok(!stdout.includes(publicationPrefix)); assert.match(stderr, /Live final fallback record:/);
    if (mode === 'rename-delay') {
      assert.ok(performance.now() - start >= capturePolicy.artifactMs);
      assert.equal(observation.record.evidenceErrors[0].status, 'timed-out');
      assert.equal(observation.raw.status, prior === 'passed' ? 'unsealed' : 'failed');
      if (prior === 'passed') {
        await assert.rejects(readPublishedResult(path.join(out, 'results.json'), {execution}), /successful native exit/);
        await assert.rejects(readPublishedResult(path.join(out, 'results.json'), {execution: nativeSuccess}), /acknowledgement/);
      }
    } else {assert.equal(observation.raw, null); assert.match(stderr, /INJECTED RENAME REJECTION/);}
  }
  await passed(mode, {priorSuccessAndFailure: true, nativeFailureChildren: 2, originalDeadlineMs: 2000});
});

test('payload or acknowledgement tampering cannot turn an envelope into an accepted pass', async () => {
  const original = await read(path.join(root, 'on-time/results.json')), file = path.join(root, 'tamper.json');
  const stored = structuredClone(original); stored.publication.file = 'tamper.json';
  await fs.writeFile(file, JSON.stringify(stored));
  const validAck = publicationPrefix + JSON.stringify(stored.publication);
  assert.equal((await readPublishedResult(file, {execution: nativeSuccess, stdout: validAck})).value.status, 'passed');
  await assert.rejects(readPublishedResult(file, {execution: {...nativeSuccess, rawExitCode: 1}, stdout: validAck}), /successful native exit/);
  await assert.rejects(readPublishedResult(file, {execution: nativeSuccess, stdout: publicationPrefix + JSON.stringify({...stored.publication, token: 'wrong'})}), /acknowledgement/);
  stored.result.checks.push({status: 'pass'}); await fs.writeFile(file, JSON.stringify(stored));
  await assert.rejects(readPublishedResult(file, {execution: nativeSuccess, stdout: validAck}), /payload/);
  await passed('publication-negative-controls', {nativeFailure: true, wrongToken: true, changedPayload: true});
});

test('required publication cannot be bypassed by an ordinary passed JSON', async () => {
  const file = path.join(root, 'legacy.json'); await fs.writeFile(file, JSON.stringify({status: 'passed', checks: []}));
  await assert.rejects(readPublishedResult(file, {execution: nativeSuccess, requirePublication: true}), /sealed result envelope/);
  await passed('publication-required', {legacyJsonRejected: true});
});

test('native trace boundary excludes a fixture delay placed before the original API', async () => {
  const context = {tracing: {stop: async () => {await new Promise(r => setTimeout(r, 10));}}};
  const observer = instrumentTraceNative(context), actual = context.tracing.stop.bind(context.tracing), start = performance.now();
  context.tracing.stop = async options => {observer.note('fixture-delay-entered'); await new Promise(r => setTimeout(r, 60)); observer.note('fixture-delay-resolved'); return actual(options);};
  assert.equal(instrumentTraceNative(context), observer); await context.tracing.stop({});
  assert.deepEqual(observer.events.map(e => e.stage), ['fixture-delay-entered', 'fixture-delay-resolved', 'native-stop-entered', 'native-stop-resolved']);
  assert.ok(observer.events[2].monotonicMs - start >= 50);
  assert.ok(observer.events[3].nativeElapsedMs < observer.events[3].monotonicMs - start);
  await passed('native-trace-boundary', {events: observer.events, scope: 'unit injection; not real Playwright internals'});
});

test('native trace rejection keeps the exact error and records the original API stage', async () => {
  const original = Error('ORIGINAL NATIVE TRACE ERROR'), context = {tracing: {stop: async () => {throw original;}}};
  const observer = instrumentTraceNative(context); await assert.rejects(context.tracing.stop({}), error => error === original);
  assert.deepEqual(observer.events.map(e => e.stage), ['native-stop-entered', 'native-stop-rejected']);
  await passed('native-trace-rejection', {events: observer.events});
});

test('close timeout saves actual pending native state at the unchanged 2000ms deadline', async () => {
  let finish; const resource = {isConnected: () => true, close: () => new Promise(resolve => {finish = resolve;})};
  const start = performance.now();
  await assert.rejects(closeWithEvidence(resource, {out: root, label: 'hung'}), /diagnostic deadline 2000ms/);
  assert.ok(performance.now() - start >= 2000 && performance.now() - start < 3000);
  const file = path.join(root, 'hung-close-diagnostics.json'), bytes = await fs.readFile(file), record = JSON.parse(bytes);
  assert.equal(record.operation.nativeStatus, 'running'); assert.equal(record.operation.before.connected, true);
  finish(); await new Promise(resolve => setImmediate(resolve)); assert.equal(closeDiagnostics(resource).nativeStatus, 'completed');
  assert.deepEqual(await fs.readFile(file), bytes);
  await passed('close-timeout-native-state', {policyMs: 2000, sealedState: 'running', lateNativeState: 'completed'});
});

for (const mode of ['reject', 'unresponsive']) test('close diagnostic write ' + mode + ' cannot replace the original close error', async () => {
  const original = Error('ORIGINAL CLOSE ERROR'), logs = [], start = performance.now();
  await assert.rejects(closeWithEvidence({}, {out: root, label: mode, close: async () => {throw original;},
    write: mode === 'reject' ? async () => {throw Error('INJECTED DIAGNOSTIC WRITE');} : () => new Promise(() => {}), stderr: value => logs.push(value)}), error => error === original);
  assert.ok(logs.some(v => v.includes('ORIGINAL CLOSE ERROR')));
  if (mode === 'unresponsive') assert.ok(performance.now() - start >= 2000 && performance.now() - start < 3000);
  await passed('close-diagnostic-' + mode, {originalErrorPreserved: true, artifactMs: 2000});
});

test('profile close timeout records independent native/wait phases and still attempts removal', async () => {
  let removed = false;
  const result = await cleanupProfile({profile: path.join(os.tmpdir(), 'tilt-map-live-publication-unit-' + randomUUID()),
    context: {isClosed: () => false, close: () => new Promise(() => {})}, timeoutMs: 40, remove: async () => {removed = true;}});
  assert.equal(result.status, 'failed'); assert.equal(result.stages[0].nativeStatus, 'running'); assert.equal(result.stages[0].status, 'timed-out');
  assert.ok(result.stages[0].waitElapsedMs >= 30); assert.equal(removed, true); assert.ok(result.stages.some(s => s.name === 'profile-remove'));
  await passed('profile-native-wait-diagnostics', {scope: 'unit policy 40ms; production remains 2000ms', result});
});

test.after(async () => {
  const files = []; const walk = async dir => {for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else {const bytes = await fs.readFile(file);
      files.push({file: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});}
  }}; await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(files, null, 2));
});
