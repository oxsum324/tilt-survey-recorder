import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {capturePolicy} from '../browser-failure-evidence.mjs';

export const ioError = error => ({name: error?.name || 'Error', message: String(error?.message || error),
  code: error?.code || null, stack: error?.stack || null});
export const stderrFallback = value => {try {console.error(value);} catch { /* No observer may throw into its caller. */ }};

export async function evidenceAttempt(name, operation, timeoutMs = capturePolicy.artifactMs,
  {clock = () => performance.now(), schedule = setTimeout, cancel = clearTimeout} = {}) {
  let timer;
  try {
    if (timeoutMs <= 0) throw Object.assign(Error(name + ': evidence deadline exceeded'), {code: 'EVIDENCE_TIMEOUT'});
    const until = clock() + timeoutMs;
    const value = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      const expire = () => {
        const remaining = until - clock();
        // Node timers may wake early. Keep the same absolute deadline, and never
        // declare a timeout before the monotonic clock has actually reached it.
        if (remaining > 0) {timer = schedule(expire, Math.ceil(remaining)); return;}
        reject(Object.assign(Error(name + ': evidence deadline exceeded'), {code: 'EVIDENCE_TIMEOUT'}));
      };
      timer = schedule(expire, Math.ceil(timeoutMs));
    })]);
    return {name, status: 'saved', value};
  } catch (error) {
    return {name, status: error?.code === 'EVIDENCE_TIMEOUT' ? 'timed-out' : 'failed', error: ioError(error)};
  } finally {cancel(timer);}
}

// A late write can only leave a pending file; it cannot publish a successful receipt.
export async function writeEvidence(file, bytes, {timeoutMs = capturePolicy.artifactMs, io = fs} = {}) {
  const pending = path.join(path.dirname(file), 'pending-' + path.basename(file) + '-' + randomUUID() + '.pending');
  const controller = new AbortController(); let active = true;
  try {
    return await evidenceAttempt(path.basename(file), async () => {
      await io.writeFile(pending, bytes, {flag: 'wx', signal: controller.signal});
      if (active) await io.rename(pending, file);
    }, timeoutMs);
  } finally {active = false; controller.abort();}
}

// Event callbacks only enqueue async I/O. Both synchronous throws from an injected
// writer and async rejections are consumed; the sealed receipt never changes late.
export function createWorkerJournal(file, {io = fs, stderr = stderrFallback} = {}) {
  const events = [], errors = [];
  let sealed = false, diskFailed = false, controller = new AbortController();
  const fail = (stage, error) => {
    if (sealed) return;
    const item = {stage, error: ioError(error)}; errors.push(item);
    try {stderr('Worker observer evidence failure: ' + JSON.stringify(item));} catch {}
  };
  let tail = Promise.resolve().then(async () => {
    await io.mkdir(path.dirname(file), {recursive: true});
    await io.writeFile(file, '', {flag: 'wx', signal: controller.signal});
  }).catch(error => {diskFailed = true; fail('initialize', error);});
  const emit = event => {
    if (sealed) return;
    events.push(event);
    tail = tail.then(async () => {
      if (sealed || diskFailed) return;
      await io.appendFile(file, JSON.stringify(event) + '\n', {signal: controller.signal});
    }).catch(error => {diskFailed = true; fail('append', error);});
  };
  const seal = async (timeoutMs = capturePolicy.artifactMs) => {
    const result = await evidenceAttempt('worker-journal-drain', () => tail, timeoutMs);
    if (result.status !== 'saved') fail('drain', result.error);
    sealed = true; controller.abort();
    return structuredClone({status: errors.length ? 'failed' : 'completed', events, errors,
      journal: {file: path.basename(file), status: diskFailed || result.status !== 'saved' ? 'incomplete' : 'saved'}});
  };
  return {events, emit, fail, seal};
}
