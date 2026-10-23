import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = (await fs.readFile(path.join(repo, '.github/workflows/pages.yml'), 'utf8')).replaceAll('\r\n', '\n');
const checks = workflow.split('  checks:\n')[1].split('\n  build:')[0];
const steps = checks.split(/^      - /m).slice(1);
const step = id => {
  const matches = steps.filter(s => s.includes(`        id: ${id}\n`));
  assert.equal(matches.length, 1, `Workflow must have one ${id} step`);
  return matches[0];
};
const markedScript = marker => {
  const lines = workflow.split('\n');
  const start = lines.findIndex(s => s.trim() === `# BEGIN_CI_EVIDENCE_${marker}`);
  const end = lines.findIndex(s => s.trim() === `# END_CI_EVIDENCE_${marker}`);
  assert.ok(start >= 0 && end > start);
  return lines.slice(start + 1, end).map(s => {
    assert.ok(s.startsWith('          '));
    return s.slice(10);
  }).join('\n');
};
const bootstrap = markedScript('BOOTSTRAP'), finalize = markedScript('FINALIZE');
const ids = steps.map(s => s.match(/^        id: (\w+)$/m)?.[1]).filter(Boolean);
assert.equal(ids[0], 'evidence_start');
assert.ok(ids.indexOf('evidence_start') < ids.indexOf('checkout'));
assert.match(checks, /TILT_CI_EVIDENCE_ROOT: \$\{\{ runner\.temp \}\}/);
assert.doesNotMatch(checks.split('    steps:\n')[0], /\$\{\{\s*runner[.\[]/);
for (const id of ['evidence_start', 'evidence_finish', 'artifact_upload']) {
  assert.match(step(id), /        env:\n          TILT_CI_EVIDENCE_ROOT: \$\{\{ runner\.temp \}\}/);
}
assert.match(bootstrap, /AppendAllText\(\$env:GITHUB_ENV/);
assert.match(step('workflow_semantics'), /test:workflow/);
assert.match(step('browser_diagnostic_regressions'), /run-command\.ps1 -Name browser_diagnostic_regressions/);
assert.match(step('browser_diagnostic_regressions'), /test:browser-evidence/);
assert.match(step('evidence_finish'), /if: always\(\)/);
assert.match(step('artifact_upload'), /if: always\(\)/);
assert.match(step('artifact_upload'), /\$\{\{ env\.TILT_CI_EVIDENCE_ROOT \}\}\//);
assert.match(step('artifact_upload'), /if-no-files-found: error/);
assert.ok(ids.indexOf('evidence_finish') < ids.indexOf('artifact_upload'));
assert.doesNotMatch(checks, /continue-on-error/);
const installs = ['npm_install', 'python_install', 'browser_install', 'font_install'];
for (const name of installs) {
  assert.match(step(name), new RegExp(`run-command\\.ps1 -Name ${name} -Executable`));
  assert.ok(ids.indexOf(name) > ids.indexOf('python_setup'));
}
for (const name of ['data', 'browser', 'site_build', 'desktop', 'ci_regressions']) {
  assert.match(step(name), new RegExp(`run-command\\.ps1 -Name ${name} -Executable`));
}
assert.match(step('ci_regressions'), /test:ci-evidence/);
assert.match(workflow, /needs: checks/);
assert.equal((workflow.match(/if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/g) || []).length, 2);

const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
const root = path.resolve(process.env.TILT_CI_REGRESSION_OUTPUT_ROOT || path.join(repo, 'output/ci-evidence-regressions'));
await fs.mkdir(root, {recursive: true});
const out = path.join(root, process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out); // Preserve every previous attempt, including failed tests.
const powershell = process.env.TILT_CI_POWERSHELL || 'pwsh';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const wrapper = path.join(repo, 'tests/ci/run-command.ps1');
const results = [];
const ps = async (script, cwd, env, label) => {
  const chunks = [];
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => chunks.push(bytes));
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  await fs.writeFile(label, Buffer.concat(chunks));
  return code;
};
const cases = [
  {name: 'successful-native-stderr', fail: null},
  ...installs.map(fail => ({name: `failed-${fail}`, fail})),
  ...['checkout', 'node_setup', 'python_setup'].map(action => ({name: `failed-${action}`, action})),
  {name: 'missing-executable', missing: true},
  {name: 'duplicate-path-resolves-first-command', ambiguous: true},
  {name: 'existing-evidence-is-preserved', repeat: true},
];
try {
  for (const test of cases) {
    const dir = path.join(out, test.name), workspace = path.join(dir, 'workspace'), evidence = path.join(dir, 'evidence');
    await fs.mkdir(workspace, {recursive: true});
    assert.ok(!evidence.startsWith(workspace + path.sep), 'Evidence must survive checkout cleanup');
    const env = {...process.env, TILT_CI_EVIDENCE_ROOT: evidence,
      TILT_CI_EVIDENCE_SCOPE: 'local-fault-injection', GITHUB_SHA: head,
      GITHUB_ENV: path.join(dir, 'github-env'),
      GITHUB_RUN_ID: 'local-regression', GITHUB_RUN_ATTEMPT: '1'};
    const states = Object.fromEntries(ids.filter(s => !['evidence_finish', 'artifact_upload'].includes(s))
      .map(id => [id, {outcome: 'skipped', conclusion: 'skipped'}]));
    const state = (id, value) => { states[id] = {outcome: value, conclusion: value}; };
    assert.equal(await ps(bootstrap, workspace, env, path.join(dir, 'bootstrap.log')), 0);
    assert.equal((await fs.readFile(env.GITHUB_ENV, 'utf8')).trim(), `TILT_CI_EVIDENCE_ROOT=${evidence}`);
    state('evidence_start', 'success');
    const originalBootstrap = digest(await fs.readFile(path.join(evidence, 'bootstrap.json')));
    // Simulate checkout cleaning workspace files. The evidence is outside that workspace.
    const sentinel = path.join(workspace, 'checkout-cleanup-sentinel');
    await fs.writeFile(sentinel, 'temporary checkout file');
    await fs.unlink(sentinel);
    assert.equal(digest(await fs.readFile(path.join(evidence, 'bootstrap.json'))), originalBootstrap);
    let failed = false;
    for (const action of ['checkout', 'node_setup', 'python_setup']) {
      state(action, action === test.action ? 'failure' : 'success');
      if (action === test.action) { failed = true; break; }
    }
    const fixture = path.join(workspace, 'install-fixture.mjs');
    await fs.writeFile(fixture, "console.log('前置安裝 stdout '+process.argv[2]);console.error('前置安裝 stderr '+process.argv[2]);process.exit(Number(process.argv[3]));\n");
    const cmdFixture = path.join(workspace, 'install-fixture.cmd');
    await fs.writeFile(cmdFixture, `@"${process.execPath}" "%~dp0install-fixture.mjs" %*\r\n@exit /b %errorlevel%\r\n`);
    for (const name of installs) {
      if (failed) break;
      const expectedCode = test.fail === name ? (name === 'font_install' ? 1 : 47) : test.missing ? 1 : 0;
      let executable = ['npm_install', 'browser_install'].includes(name) ? cmdFixture : process.execPath;
      let args = executable === cmdFixture ? [name, String(expectedCode)] : [fixture, name, String(expectedCode)];
      if (name === 'font_install') {
        executable = path.join(workspace, 'font-fixture.ps1'); args = [];
        await fs.writeFile(executable, `Write-Output 'font stdout';${expectedCode ? "throw 'injected font installation failure'" : ''}\n`);
      }
      if (test.missing) { executable = path.join(workspace, 'missing-command.exe'); args = []; }
      if (test.ambiguous && name === 'npm_install') {
        const firstPath = path.join(workspace, 'first-path'), secondPath = path.join(workspace, 'second-path');
        await fs.mkdir(firstPath); await fs.mkdir(secondPath);
        await fs.writeFile(path.join(firstPath, 'ambiguous-install.cmd'), `@"${process.execPath}" "${fixture}" %*\r\n@exit /b %errorlevel%\r\n`);
        await fs.writeFile(path.join(secondPath, 'ambiguous-install.cmd'), '@echo wrong PATH entry\r\n@exit /b 99\r\n');
        env.PATH = firstPath + path.delimiter + secondPath + path.delimiter + process.env.PATH;
        executable = 'ambiguous-install.cmd'; args = [name, '0'];
        assert.equal(await ps("if (@(Get-Command ambiguous-install.cmd -CommandType Application,ExternalScript).Count -lt 2) { exit 1 }", workspace, env, path.join(dir, 'path-ambiguity-proof.log')), 0);
      }
      // Match the explicit workflow exit, rather than pwsh -Command normalizing nonzero to 1.
      const script = `& ${quote(wrapper)} -Name ${quote(name)} -Executable ${quote(executable)} -Arguments @(${args.map(quote).join(',')}); exit $LASTEXITCODE`;
      const code = await ps(script, workspace, env, path.join(dir, `${name}-host.log`));
      assert.equal(code, expectedCode, `${test.name}: original failure must reach the caller`);
      const record = await readJson(path.join(evidence, 'commands', `${name}.json`));
      assert.equal(record.exitCode, expectedCode);
      assert.equal(record.status, expectedCode ? 'failure' : 'success');
      assert.equal(record.commit, head);
      assert.equal(record.scope, 'local-fault-injection');
      assert.ok(record.startedUtc && record.endedUtc);
      const log = await fs.readFile(path.join(evidence, 'commands', `${name}.log`));
      assert.equal(record.logSha256, digest(log));
      if (name !== 'font_install' && !test.missing) {
        assert.match(log.toString('utf8'), /前置安裝 stdout/);
        assert.match(log.toString('utf8'), /前置安裝 stderr/);
      }
      if (name === 'font_install' && expectedCode) assert.match(log.toString('utf8'), /injected font installation failure/);
      if (test.missing) assert.ok(record.error && log.length > 0);
      state(name, expectedCode ? 'failure' : 'success');
      failed = expectedCode !== 0;
    }
    const finalEnv = {...env, TILT_CI_STEPS: JSON.stringify(states)};
    assert.equal(await ps(finalize, workspace, finalEnv, path.join(dir, 'finalize.log')), 0);
    const summary = await readJson(path.join(evidence, 'summary.json'));
    assert.equal(summary.scope, 'local-fault-injection');
    assert.equal(summary.commit, head);
    assert.equal(summary.bootstrapPresent, true);
    assert.deepEqual(summary.steps, states);
    if (test.fail || test.missing || test.action) assert.ok(Object.values(summary.steps).some(s => s.conclusion === 'failure'));
    for (const name of installs.filter(s => states[s].conclusion === 'skipped')) {
      await assert.rejects(fs.stat(path.join(evidence, 'commands', `${name}.json`)), {code: 'ENOENT'});
    }
    const manifest = await readJson(path.join(evidence, 'sha256.json'));
    assert.ok(manifest.some(f => f.file === 'bootstrap.json') && manifest.some(f => f.file === 'summary.json'));
    for (const f of manifest) {
      const bytes = await fs.readFile(path.join(evidence, f.file));
      assert.equal(bytes.length, f.bytes); assert.equal(digest(bytes), f.sha256);
    }
    // Prove there are uploadable bytes even when no checkout or dependency setup succeeded.
    const zip = path.join(dir, 'local-artifact.zip');
    const archiveScript = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory(${quote(evidence)},${quote(zip)});$archive=[IO.Compression.ZipFile]::OpenRead(${quote(zip)});try{foreach($name in @('bootstrap.json','summary.json','sha256.json')){if(-not $archive.GetEntry($name)){throw "Archive missing $name"}}}finally{$archive.Dispose()}`;
    assert.equal(await ps(archiveScript, workspace, env, path.join(dir, 'archive.log')), 0);
    assert.ok((await fs.stat(zip)).size > 0);
    if (test.repeat) {
      assert.notEqual(await ps(bootstrap, workspace, env, path.join(dir, 'repeat-bootstrap.log')), 0);
      assert.equal(digest(await fs.readFile(path.join(evidence, 'bootstrap.json'))), originalBootstrap);
    }
    results.push({name: test.name, status: 'pass', injectedFailure: Boolean(test.fail || test.action || test.missing),
      expectedFailedStep: test.fail || test.action || (test.missing ? 'npm_install' : null),
      sha256Entries: manifest.length, archiveSha256: digest(await fs.readFile(zip)),
      evidenceScope: 'local-fault-injection; not a cloud CI execution'});
    console.log(`PASS CI evidence: ${test.name}`);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({head, scope: 'local-fault-injection', cases: results}, null, 2));
  }
  assert.equal(results.length, 11);
} finally {
  const files = [];
  const collect = async dir => {
    for (const item of await fs.readdir(dir, {withFileTypes: true})) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await collect(file);
      else { const bytes = await fs.readFile(file); files.push({file: path.relative(out, file).replaceAll(path.sep, '/'), bytes: bytes.length, sha256: digest(bytes)}); }
    }
  };
  await collect(out);
  await fs.writeFile(path.join(out, 'sha256.json'), JSON.stringify(files, null, 2));
}
console.log(JSON.stringify({cases: results.length, passed: results.length, head, evidence: out,
  scope: 'local-fault-injection; not a cloud CI execution'}));
