import fs from 'node:fs/promises';
import path from 'node:path';
import {finalizeStaged} from '../release/staged-finalize.mjs';
import {closeWithEvidence} from '../release/close-with-evidence.mjs';
import {closeAfterEvidence} from '../browser-failure-evidence.mjs';
import {writeEvidence} from '../release/evidence-io.mjs';
const [out, mode] = process.argv.slice(2); await fs.mkdir(out, {recursive: true});
const order = [], original = mode === 'action-close' ? Object.assign(Error('ORIGINAL ACTION FAILURE'), {code: 'ACTION'}) : null;
const record = {status: original ? 'failed' : 'passed', checks: [{status: 'pass'}]};
const browser = {close() {order.push('browser');
  if (mode === 'action-close' || mode === 'close-reject') throw Object.assign(Error('INJECTED CLOSE FAILURE'), {code: 'CLOSE'});
  if (mode === 'close-hang') return new Promise(() => {});
}};
const server = {close() {order.push('server');
  if (mode === 'server-reject') throw Object.assign(Error('INJECTED SERVER FAILURE'), {code: 'SERVER'});
  if (mode === 'server-hang') return new Promise(() => {});
}};
const result = await finalizeStaged({record, originalError: original, browser, server, out,
  close: resource => closeWithEvidence(resource, {out, label: 'fixture-browser', close: closeAfterEvidence}),
  write: (...args) => {order.push('receipt');
    if (mode === 'final-reject') throw Object.assign(Error('INJECTED FINAL WRITE FAILURE'), {code: 'ENOSPC'});
    return writeEvidence(...args);
  }});
await fs.writeFile(path.join(out, 'observation.json'), JSON.stringify({order, record, failed: result.failed,
  sameOriginalError: original ? result.error === original : null, receipt: result.receipt}, null, 2));
if (result.failed) process.exitCode = 1;
