import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
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

export const publicationPrefix = 'TILT_EVIDENCE_PUBLISHED ';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Even a rename already issued to the OS can finish late. Its bytes therefore
// never claim a passed result: acceptance needs the on-time acknowledgement in
// the captured stdout AND a successful native exit, checked by the parent.
export async function writeEvidence(file, bytes, {timeoutMs = capturePolicy.artifactMs, io = fs} = {}) {
  const pending = path.join(path.dirname(file), 'pending-' + path.basename(file) + '-' + randomUUID() + '.pending');
  const controller = new AbortController(); let active = true;
  let value; try {value = JSON.parse(bytes);} catch {}
  const publication = value?.status === 'passed' ? {schema: 1, token: randomUUID(), file: path.basename(file), sha256: digest(value)} : null;
  const stored = publication ? JSON.stringify({status: 'unsealed', publication, result: value}, null, 2) : bytes;
  const until = performance.now() + timeoutMs;
  try {
    const receipt = await evidenceAttempt(path.basename(file), async () => {
      await io.writeFile(pending, stored, {flag: 'wx', signal: controller.signal});
      if (active) await io.rename(pending, file);
      if (!active || performance.now() >= until) throw Object.assign(Error('Publication deadline exceeded'), {code: 'EVIDENCE_TIMEOUT'});
    }, timeoutMs);
    return publication && receipt.status === 'saved' ? {...receipt, publication} : receipt;
  } finally {active = false; controller.abort();}
}

export async function readPublishedResult(file, {execution, stdout = '', requirePublication = false} = {}) {
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  if (stored.status !== 'unsealed') {
    if (requirePublication) throw Error('A sealed result envelope is required');
    return {value: stored, publication: null};
  }
  if (!execution || execution.rawExitCode !== 0 || execution.signal || execution.watchdogTriggered)
    throw Error('An unsealed result requires a successful native exit');
  const expected = stored.publication;
  if (expected?.schema !== 1 || expected.file !== path.basename(file) || expected.sha256 !== digest(stored.result))
    throw Error('Result publication payload does not match');
  const acknowledgements = stdout.split(/\r?\n/).filter(line => line.startsWith(publicationPrefix)).map(line => {
    try {return JSON.parse(line.slice(publicationPrefix.length));} catch {return null;}
  });
  if (execution.resultPublication) acknowledgements.push(execution.resultPublication);
  if (!acknowledgements.some(item => item && JSON.stringify(item) === JSON.stringify(expected)))
    throw Error('Result publication acknowledgement is missing or mismatched');
  return {value: stored.result, publication: expected};
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
