import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {finalizeLiveUpgrade} from '../release/live-finalize.mjs';
import {writeEvidence, createWorkerJournal} from '../release/evidence-io.mjs';
import {cleanupProfile} from '../release/profile-cleanup.mjs';

const [out, mode] = process.argv.slice(2); await fs.mkdir(out, {recursive: true});
const profile = path.join(os.tmpdir(), 'tilt-map-live-io-test-' + randomUUID());
await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'synthetic'), 'SYNTHETIC');
const original = {name: 'AssertionError', message: 'ORIGINAL IO REGRESSION', stack: 'ORIGINAL IO STACK'};
const record = {status: 'failed', error: original}, attempts = [];
const injected = () => Object.assign(Error('INJECTED IO ' + mode), {code: 'ENOSPC'});
let cleanupCalled = false, observer;
if (mode.startsWith('worker-')) {
  const io = {...fs, appendFile: mode === 'worker-sync' ? () => {throw injected();} :
    mode === 'worker-async' ? () => Promise.reject(injected()) : () => new Promise(() => {})};
  observer = createWorkerJournal(path.join(out, 'worker-lifecycle.jsonl'), {io});
  observer.emit({type: 'injected-worker', data: 'SYNTHETIC'});
}
const write = (file, bytes, options) => {
  const name = path.basename(file); attempts.push(name);
  if (mode === 'transport-reject' && name === 'transport-events.json') return Promise.reject(injected());
  if (mode === 'transport-hang' && name === 'transport-events.json') return new Promise(() => {});
  if (mode === 'results-reject' && name === 'results.json') throw injected();
  if (mode === 'results-hang' && name === 'results.json') return new Promise(() => {});
  return writeEvidence(file, bytes, options);
};
const result = await finalizeLiveUpgrade({record, out, profile, gate: {events: [{type: 'synthetic'}], close: async () => {}}, observer,
  cleanup: async options => {cleanupCalled = true; return cleanupProfile(options);}, write});
let removed = false; try {await fs.stat(profile);} catch (error) {removed = error.code === 'ENOENT';}
await fs.writeFile(path.join(out, 'observation.json'), JSON.stringify({mode, result, record, attempts, cleanupCalled, removed,
  sameOriginalError: record.error === original}, null, 2));
if (result.failed) process.exitCode = 1;
