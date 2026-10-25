import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {runCaptured} from './release/command.mjs';
import {readPublishedResult, publicationPrefix} from './release/evidence-io.mjs';
import {finalizeStaged} from './release/staged-finalize.mjs';
import {closeWithEvidence} from './release/close-with-evidence.mjs';
import {capturePolicy} from './browser-failure-evidence.mjs';
import {executionOrigin} from './execution-origin.mjs';
const root = path.resolve(process.env.TILT_TEARDOWN_ROOT || 'output/playwright/staged-teardown', 'run-' + randomUUID());
await fs.mkdir(path.join(root, 'commands'), {recursive: true});
const cases = [], raw = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function passed(name, data) {cases.push({name, status: 'pass', data});
 await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({...executionOrigin(), policy: capturePolicy, cases}, null, 2));}
for (const mode of ['action-close', 'close-reject', 'close-hang', 'server-reject', 'server-hang', 'final-reject', 'success']) {
 test('staged native teardown: ' + mode, async () => {
  const out = path.join(root, mode), started = performance.now();
  const execution = await runCaptured({root: path.join(root, 'commands'), name: mode, executable: process.execPath,
   args: ['tests/fixtures/staged-teardown-child.mjs', out, mode],
   resultFile: mode === 'success' ? path.join(out, 'results.json') : null, requirePublication: mode === 'success', expectedChecks: 1});
  assert.equal(execution.rawExitCode, mode === 'success' ? 0 : 1); assert.equal(execution.exitCode, execution.rawExitCode);
  assert.equal(execution.signal, null); assert.equal(execution.watchdogTriggered, false);
  const d = await raw(path.join(out, 'observation.json'));
  assert.deepEqual(d.order, ['browser', 'server', 'receipt']); assert.equal(d.failed, mode !== 'success');
  const stdout = await fs.readFile(path.join(root, 'commands', mode, 'stdout.log'), 'utf8');
  const stderr = await fs.readFile(path.join(root, 'commands', mode, 'stderr.log'), 'utf8');
  if (mode === 'success') {
   assert.equal((await readPublishedResult(path.join(out, 'results.json'), {execution, requirePublication: true})).value.status, 'passed');
   assert.ok(stdout.includes(publicationPrefix));
  } else {
   assert.equal(d.record.status, 'failed'); assert.ok(!stdout.includes(publicationPrefix)); assert.match(stderr, /Staged final fallback record:/);
   if (mode !== 'final-reject') {const result = await raw(path.join(out, 'results.json')); assert.equal(result.status, 'failed'); assert.equal(result.teardownAttempts.length, 2);}
  }
  if (mode === 'action-close') {assert.equal(d.sameOriginalError, true); assert.equal(d.record.error.code, 'ACTION'); assert.equal(d.record.teardownErrors[0].receipt.error.code, 'CLOSE');}
  if (mode === 'close-hang' || mode === 'server-hang') assert.ok(performance.now() - started >= capturePolicy.cleanupMs);
  if (mode === 'server-hang') assert.equal(d.record.teardownErrors[0].receipt.status, 'timed-out');
  if (mode === 'final-reject') assert.equal(d.receipt.error.code, 'ENOSPC');
  await passed(mode, d);
 });
}
for (const mode of ['final-reject-with-original', 'final-hang-with-original']) test(mode, async () => {
 const original = Object.assign(Error('FIRST ACTION ERROR'), {code: 'ACTION'}), order = [], fallback = [];
 const started = performance.now(), record = {status: 'failed', checks: []};
 const result = await finalizeStaged({record, originalError: original, browser: {}, server: {close() {order.push('server');}}, out: root,
  close() {order.push('browser'); throw Error('SECOND CLOSE ERROR');},
  write() {order.push('receipt'); if (mode.includes('hang')) return new Promise(() => {}); throw Object.assign(Error('WRITE DENIED'), {code: 'EACCES'});},
  acknowledge() {assert.fail('failed receipt cannot be acknowledged');}, stderr: line => fallback.push(line)});
 assert.deepEqual(order, ['browser', 'server', 'receipt']); assert.equal(result.error, original); assert.equal(record.error.code, 'ACTION');
 assert.equal(record.teardownErrors.length, 2); assert.equal(result.failed, true);
 assert.equal(result.receipt.status, mode.includes('hang') ? 'timed-out' : 'failed');
 assert.equal(result.receipt.error.code, mode.includes('hang') ? 'EVIDENCE_TIMEOUT' : 'EACCES');
 if (mode.includes('hang')) assert.ok(performance.now() - started >= capturePolicy.artifactMs);
 assert.match(fallback[0], /FIRST ACTION ERROR/); await passed(mode, {order, receipt: result.receipt, originalPreserved: true});
});
for (const mode of ['sync-reject', 'async-reject', 'no-response', 'failed-receipt', 'timeout-receipt']) test('diagnostic fallback: ' + mode, async () => {
 const original = Object.assign(Error('ORIGINAL CLOSE ERROR'), {code: 'CLOSE'}), lines = [], started = performance.now();
 const code = mode === 'no-response' || mode === 'timeout-receipt' ? 'EVIDENCE_TIMEOUT' : mode === 'async-reject' ? 'EACCES' : 'ENOSPC';
 const error = Object.assign(Error('UNDERLYING WRITE FAILURE'), {code});
 const writer = () => {
  if (mode === 'sync-reject') throw error;
  if (mode === 'async-reject') return Promise.reject(error);
  if (mode === 'no-response') return new Promise(() => {});
  return {name: 'diagnostic.json', status: mode === 'timeout-receipt' ? 'timed-out' : 'failed', error: {name: error.name, message: error.message, code}};
 };
 await assert.rejects(closeWithEvidence({}, {out: root, label: mode, close() {throw original;}, write: writer, stderr: line => lines.push(line)}), value => value === original);
 const fallback = JSON.parse(lines[0].slice('Close diagnostic write failure: '.length));
 assert.ok(fallback.receipt); assert.ok(fallback.attempt); assert.equal(fallback.underlyingError.code, code);
 assert.equal(fallback.receipt.error.code, code); assert.equal(fallback.timedOut, code === 'EVIDENCE_TIMEOUT');
 assert.equal(fallback.original.error.code, 'CLOSE');
 if (mode === 'no-response') assert.ok(performance.now() - started >= capturePolicy.artifactMs);
 else assert.equal(fallback.underlyingError.message, 'UNDERLYING WRITE FAILURE');
 await passed('diagnostic-' + mode, fallback);
});
test.after(async () => {
 const files = []; async function walk(dir) {for (const e of await fs.readdir(dir, {withFileTypes: true})) {
  const p = path.join(dir, e.name); if (e.isDirectory()) await walk(p); else {const b = await fs.readFile(p); files.push({file: path.relative(root,p).replaceAll('\\','/'), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex')});}
 }} await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(files,null,2));
 console.log(JSON.stringify({teardownRegressions: cases.length, evidence: root}));
});
