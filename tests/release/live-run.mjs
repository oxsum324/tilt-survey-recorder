import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {runCaptured} from './command.mjs';
import {runMapNegative} from './map-negative.mjs';
import {liveUrl} from './live-site.mjs';

const harnessHead = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const liveHead = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {encoding: 'utf8'}).split(/\s/)[0];
assert.match(liveHead, /^[a-f0-9]{40}$/);
const root = path.resolve(process.env.TILT_RELEASE_OUTPUT_ROOT || 'output/playwright/release-regressions', 'live-' + randomUUID());
await fs.mkdir(root, {recursive: true}); await fs.mkdir(path.join(root, 'commands'));
const cases = [], record = {harnessHead, liveHead, url: liveUrl, cases,
  scope: 'actual published main; old fixture seeded in a separate persistent browser session; no routing in the verification session; not a deployment of this branch'};
const save = () => fs.writeFile(path.join(root, 'results.json'), JSON.stringify(record, null, 2));
const pass = async (name, data) => {cases.push({name, status: 'pass', data}); await save(); console.log('PASS live regression: ' + name);};
try {
  for (const channel of ['chrome', 'msedge']) {
    for (const mode of ['upgrade', 'basic']) {
      const name = channel + '-' + mode, out = path.join(root, name);
      const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
        args: [mode === 'basic' ? 'tests/release/basic-child.mjs' : 'tests/release/live-upgrade.mjs', out, channel, mode, liveHead],
        resultFile: path.join(out, 'results.json'), expectedChecks: mode === 'basic' ? 16 : 5});
      assert.equal(execution.rawExitCode, 0); assert.equal(execution.exitCode, 0);
      assert.equal(execution.watchdogTriggered, false); assert.equal(execution.signal, null);
      const result = JSON.parse(await fs.readFile(path.join(out, 'results.json'), 'utf8'));
      assert.equal(result.head, liveHead);
      if (mode === 'upgrade') assert.equal(result.svgMap.passed, true);
      await pass(name, {runtimeCommit: liveHead, checks: result.checks.length, nativeExitCode: 0});
    }
    for (const mode of ['map-missing', 'map-corrupt']) {
      const proof = await runMapNegative({root, channel, mode, liveHead}); await pass(proof.name, proof.data);
    }
  }
  assert.equal(cases.length, 8); record.status = 'passed';
} catch (error) {
  record.status = 'failed'; record.error = {name: error.name, message: error.message, stack: error.stack}; throw error;
} finally {
  await save();
  const files = [];
  const walk = async dir => {for (const item of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else {const bytes = await fs.readFile(file); files.push({file: path.relative(root, file).replaceAll('\\', '/'),
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});}
  }};
  await walk(root); await fs.writeFile(path.join(root, 'sha256.json'), JSON.stringify(files, null, 2));
}
console.log(JSON.stringify({harnessHead, liveHead, liveCases: 8, freshBasicChecks: 32, expectedFailingBrowserChildren: 4, evidence: root}));
