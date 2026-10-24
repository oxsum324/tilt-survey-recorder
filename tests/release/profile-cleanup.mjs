import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {capturePolicy} from '../browser-failure-evidence.mjs';

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
  timeoutMs = capturePolicy.cleanupMs, remove = p => fs.rm(p, {recursive: true, force: true, maxRetries: 2})}) {
  const absolute = path.resolve(profile), temp = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(absolute.startsWith(temp) && path.basename(absolute).startsWith('tilt-map-live-'), 'Only isolated synthetic profiles may be removed');
  const start = performance.now(), until = start + timeoutMs, stages = [];
  const attempt = async (name, operation) => {
    const entry = {name, status: 'running', startedUtc: new Date().toISOString()}; stages.push(entry);
    let timer;
    // Start every independent operation even when a previous stage used the budget.
    const pending = Promise.resolve().then(operation);
    try {
      await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(name + ': cleanup deadline exceeded'), {code: 'CLEANUP_TIMEOUT'})), Math.max(0, until - performance.now()));
      })]);
      entry.status = 'completed';
    } catch (error) {entry.status = error.code === 'CLEANUP_TIMEOUT' ? 'timed-out' : 'failed'; entry.error = {name: error.name, message: error.message, code: error.code || null};}
    finally {clearTimeout(timer); entry.finishedUtc = new Date().toISOString();}
  };
  if (gate) await attempt('transport-close', () => gate.close());
  if (seed) await attempt('seed-close', () => seed.close());
  // Closing needs no network restoration; avoiding setOffline removes an unbounded
  // protocol roundtrip after a failed browser. All raw network records remain intact.
  if (context) await attempt('context-close', () => context.close());
  await attempt('profile-remove', () => remove(absolute));
  const result = {status: stages.every(s => s.status === 'completed') ? 'completed' : 'failed',
    timeoutMs, elapsedMs: performance.now() - start, profile: absolute, originalFailure: failed, stages};
  return structuredClone(result);
}
