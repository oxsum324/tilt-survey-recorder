import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {cleanupProfile, applyCleanupResult} from '../release/profile-cleanup.mjs';

const [out, mode] = process.argv.slice(2); await fs.mkdir(out, {recursive: true});
const record = {status: mode === 'original-failure' ? 'failed' : 'passed'};
if (mode === 'original-failure') record.error = {name: 'AssertionError', message: 'ORIGINAL ASSERTION', stack: 'ORIGINAL STACK'};
const cleanup = await cleanupProfile({profile: path.join(os.tmpdir(), 'tilt-map-live-injected-' + randomUUID()),
  failed: record.status === 'failed', remove: async () => {throw Object.assign(new Error('INJECTED LOCKFILE BUSY'), {code: 'EBUSY'});}});
if (applyCleanupResult(record, cleanup)) {console.error('Cleanup failure: ' + record.profileCleanupError); process.exitCode = 1;}
if (record.error) console.error(record.error.stack || record.error.message);
await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(record, null, 2));
