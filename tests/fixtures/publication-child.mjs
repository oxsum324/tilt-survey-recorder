import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {finalizeLiveUpgrade} from '../release/live-finalize.mjs';
import {writeEvidence} from '../release/evidence-io.mjs';
const [out, mode, prior] = process.argv.slice(2); await fs.mkdir(out, {recursive: true});
const profile = path.join(os.tmpdir(), 'tilt-map-live-publication-' + randomUUID());
await fs.mkdir(profile); await fs.writeFile(path.join(profile, 'synthetic'), 'SYNTHETIC');
const original = {name: 'AssertionError', message: 'ORIGINAL PUBLICATION FAILURE', stack: 'ORIGINAL PUBLICATION STACK'};
const record = prior === 'failed' ? {status: 'failed', error: original, checks: []} : {status: 'passed', checks: []};
let late;
const io = {...fs, rename: (from, to) => {
  if (mode === 'rename-delay') return late = new Promise(resolve => setTimeout(resolve, 2250)).then(() => fs.rename(from, to));
  if (mode === 'rename-reject-sync') throw Object.assign(Error('INJECTED RENAME REJECTION'), {code: 'EACCES'});
  if (mode === 'rename-reject-async') return Promise.reject(Object.assign(Error('INJECTED RENAME REJECTION'), {code: 'EACCES'}));
  return fs.rename(from, to);
}};
const result = await finalizeLiveUpgrade({record, out, profile, write: (file, bytes, options) => writeEvidence(file, bytes, {...options, io})});
// Observe a late OS operation; this does not extend the 2000ms publication limit.
if (late) await late;
let raw = null; try {raw = JSON.parse(await fs.readFile(path.join(out, 'results.json'), 'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
let removed = false; try {await fs.stat(profile);} catch (error) {removed = error.code === 'ENOENT';}
await fs.writeFile(path.join(out, 'observation.json'), JSON.stringify({mode, prior, record, result, raw, removed,
  sameOriginalError: prior === 'failed' ? record.error === original : null}, null, 2));
if (result.failed) process.exitCode = 1;
