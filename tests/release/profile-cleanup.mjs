import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {capturePolicy} from '../browser-failure-evidence.mjs';
import {resourceState} from './resource-diagnostics.mjs';

export function applyCleanupResult(record, cleanup) {
  record.cleanup = cleanup;
  if (cleanup.status === 'completed') return false;
  record.profileCleanupError = JSON.stringify(cleanup.stages.filter(stage => stage.status !== 'completed'));
  if (record.status !== 'failed') {
    record.status = 'failed'; record.error = {name: 'CleanupError', message: record.profileCleanupError};
  }
  return true;
}

// The whole teardown shares the original cleanup deadline. An earlier failure does
// not skip later attempts, and no late operation can change the returned receipt.
export async function cleanupProfile({profile, context, seed, gate, failed = false,
  closeOwnedBrowser = false, timeoutMs = capturePolicy.cleanupMs,
  remove = p => fs.rm(p, {recursive: true, force: true, maxRetries: 2})}) {
  const absolute = path.resolve(profile), temp = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(absolute.startsWith(temp) && path.basename(absolute).startsWith('tilt-map-live-'), 'Only isolated synthetic profiles may be removed');
  const start = performance.now(), until = start + timeoutMs, stages = [];
  let sealed = false;
  const attempt = async (name, operation, resource) => {
    const entered = performance.now();
    const entry = {name, status: 'running', startedUtc: new Date().toISOString(),
      budgetRemainingMs: Math.max(0, until - entered), nativeStatus: 'queued', before: resource ? resourceState(resource) : null}; stages.push(entry);
    let timer;
    // Start every independent operation even when a previous stage used the budget.
    const pending = Promise.resolve().then(() => {entry.nativeStatus = 'running'; entry.nativeEnteredUtc = new Date().toISOString(); return operation();}).then(value => {
      entry.nativeStatus = 'completed'; entry.nativeElapsedMs = performance.now() - entered; entry.nativeSettledUtc = new Date().toISOString();
      if (sealed) {try {console.error('Late cleanup operation: ' + JSON.stringify({name, nativeStatus: entry.nativeStatus, nativeElapsedMs: entry.nativeElapsedMs}));} catch {}}
      return value;
    }, error => {entry.nativeStatus = 'failed'; entry.nativeElapsedMs = performance.now() - entered; entry.nativeSettledUtc = new Date().toISOString(); throw error;});
    try {
      await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(name + ': cleanup deadline exceeded'), {code: 'CLEANUP_TIMEOUT'})), Math.max(0, until - performance.now()));
      })]);
      entry.status = 'completed';
    } catch (error) {entry.status = error.code === 'CLEANUP_TIMEOUT' ? 'timed-out' : 'failed'; entry.error = {name: error.name, message: error.message, code: error.code || null};}
    finally {clearTimeout(timer); entry.finishedUtc = new Date().toISOString(); entry.waitElapsedMs = performance.now() - entered; if (resource) entry.after = resourceState(resource);}
  };
  if (gate) await attempt('transport-close', () => gate.close(), gate);
  const close = async (resource, seedResource = false) => {
    const browser = closeOwnedBrowser ? resource.browser?.() : null;
    // Only callers that launched their own isolated persistent browser opt in.
    // Browser.close avoids context-close protocol disposal before browser shutdown.
    await attempt(seedResource ? (browser ? 'seed-browser-close' : 'seed-close') :
      (browser ? 'browser-close' : 'context-close'), () => (browser || resource).close(), browser || resource);
  };
  if (seed) await close(seed, true);
  // Closing needs no network restoration; avoiding setOffline removes an unbounded
  // protocol roundtrip after a failed browser. All raw network records remain intact.
  if (context) await close(context);
  await attempt('profile-remove', () => remove(absolute));
  const result = {status: stages.every(s => s.status === 'completed') ? 'completed' : 'failed',
    timeoutMs, elapsedMs: performance.now() - start, profile: absolute, originalFailure: failed, stages};
  sealed = true; return structuredClone(result);
}
