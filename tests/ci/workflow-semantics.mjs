import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {executionOrigin} from '../execution-origin.mjs';

const root = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(root, '../..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'actionlint-version.json'), 'utf8'));
const executable = path.join(repo, 'output/tools/actionlint', lock.version, 'actionlint.exe');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(await fs.readFile(executable)), lock.executableSha256, 'Install and verify the pinned actionlint binary first');
const version = spawnSync(executable, ['-version'], {encoding: 'utf8', cwd: repo});
assert.equal(version.status, 0);
assert.match(version.stdout, new RegExp(`^${lock.version.replaceAll('.', '\\.')}\\b`));
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const outputRoot = path.resolve(process.env.TILT_WORKFLOW_EVIDENCE_ROOT || path.join(repo, 'output/workflow-semantics'));
await fs.mkdir(outputRoot, {recursive: true});
const out = path.join(outputRoot, process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out);
const workflows = (await fs.readdir(path.join(repo, '.github/workflows'))).filter(s => /\.ya?ml$/.test(s)).sort();
assert.ok(workflows.length > 0, 'Validate every actual workflow');
const cases = [
  ...workflows.map(file => ({name: `workflow-${file}`, file: `.github/workflows/${file}`, valid: true})),
  {name: 'step-env-runner-valid', file: 'tests/ci/fixtures/step-env-runner-valid.yml', valid: true},
  {name: 'job-env-runner-rejected', file: 'tests/ci/fixtures/job-env-runner-invalid.yml', valid: false,
    expected: /context "runner" is not allowed here/},
  {name: 'missing-needs-rejected', file: 'tests/ci/fixtures/missing-needs-invalid.yml', valid: false,
    expected: /missing_job/},
];
const results = [];
try {
  for (const test of cases) {
    const file = path.join(repo, test.file), bytes = await fs.readFile(file);
    // Empty shellcheck/pyflakes commands disable optional external script linters only.
    // Workflow parsing, expression context/type checks, action inputs and job graphs remain enabled.
    const args = ['-no-color', '-shellcheck=', '-pyflakes=', file];
    const startedUtc = new Date().toISOString();
    const result = spawnSync(executable, args, {cwd: repo, encoding: 'utf8'});
    const diagnostics = (result.stdout || '') + (result.stderr || '');
    await fs.writeFile(path.join(out, `${test.name}.log`), diagnostics);
    const record = {name: test.name, file: test.file, sourceSha256: sha(bytes),
      expected: test.valid ? 'accepted' : 'rejected', exitCode: result.status,
      startedUtc, endedUtc: new Date().toISOString(), error: result.error?.message || null};
    results.push(record);
    assert.equal(result.status, test.valid ? 0 : 1, `${test.name}: ${diagnostics}`);
    if (test.valid) assert.equal(diagnostics, '', `${test.name}: no ignored warnings or errors`);
    else assert.match(diagnostics, test.expected);
    record.status = 'pass';
    console.log(`PASS workflow semantics: ${test.name} (${record.expected})`);
  }
} finally {
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({head,
    ...executionOrigin(), validationScope: 'static workflow semantic validation with rejection controls; not a dispatched workflow',
    tool: {...lock, executable, versionOutput: version.stdout.trim()},
    optionalExternalLinters: {shellcheck: false, pyflakes: false},
    ignoredWorkflowRules: [], cases: results}, null, 2));
  const files = [];
  for (const name of await fs.readdir(out)) {
    const bytes = await fs.readFile(path.join(out, name));
    files.push({file: name, bytes: bytes.length, sha256: sha(bytes)});
  }
  await fs.writeFile(path.join(out, 'sha256.json'), JSON.stringify(files, null, 2));
}
console.log(JSON.stringify({head, actualWorkflows: workflows.length, cases: results.length,
  passed: results.filter(r => r.status === 'pass').length,
  ...executionOrigin(), validationScope: 'static workflow semantic validation with rejection controls', evidence: out}));
