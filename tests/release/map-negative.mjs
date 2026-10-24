import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runCaptured} from './command.mjs';

export async function runMapNegative({root, channel, mode, liveHead}) {
  const name = channel + '-' + mode, out = path.join(root, name);
  const execution = await runCaptured({root: path.join(root, 'commands'), name, executable: process.execPath,
    args: [liveHead ? 'tests/release/live-upgrade.mjs' : 'tests/release/upgrade-child.mjs', out, channel, mode, ...(liveHead ? [liveHead] : [])]});
  assert.equal(execution.rawExitCode, 1); assert.equal(execution.exitCode, 1);
  assert.equal(execution.watchdogTriggered, false); assert.equal(execution.signal, null);
  const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const result = await read(path.join(out, 'results.json'));
  assert.equal(result.status, 'failed'); assert.equal(result.checks.length, 3);
  const proof = await read(path.join(out, 'diagnostics/upgrade/failure.json'));
  assert.equal(proof.pageClosedAtFailure, false); assert.deepEqual(proof.captureErrors, []);
  assert.equal(proof.artifactAttempts.length, 4); assert.ok(proof.artifactAttempts.every(a => a.status === 'saved'));
  const expected = mode === 'map-missing' ? /SVG map must contain exactly one image/ : /SVG map source decode failed/;
  const stderr = await fs.readFile(path.join(root, 'commands', name, 'stderr.log'), 'utf8');
  assert.match(stderr, expected); assert.match(result.error.message, expected);
  assert.equal(result.error.name, mode === 'map-missing' ? 'AssertionError' : 'Error');
  const before = await read(path.join(out, 'before.json'));
  assert.deepEqual(await read(path.join(out, 'after.json')), before);
  assert.deepEqual(await read(path.join(out, 'offline.json')), before);
  return {name, data: {nativeExitCode: execution.rawExitCode, expectedFailure: true,
    checksBeforeFailure: 3, caseAndMediaPreserved: true, fourArtifactsSaved: true, error: result.error.message}};
}
