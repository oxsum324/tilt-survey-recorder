import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {monitorContext, assertOfflineRecovery} from '../desktop/diagnostics.mjs';
import {observeWorkers} from '../release/worker-lifecycle.mjs';
import {withFailureEvidence, closeAfterEvidence} from '../browser-failure-evidence.mjs';
import {cleanupProfile} from '../release/profile-cleanup.mjs';

const [out, channel] = process.argv.slice(2); await fs.mkdir(out, {recursive: true});
const workerText = await fs.readFile('checks/fixtures/upgrade-v0.4.2/sw.js', 'utf8');
const files = JSON.parse(workerText.match(/const APP_FILES=(\[[^;]+\]);/)[1].replaceAll("'", '"'));
const html = '<title>Offline worker probe</title><link rel="icon" href="data:,"><h1>SYNTHETIC-OLD-SHELL</h1><script>navigator.serviceWorker.register("./sw.js")</script>';
let revision = 'old', phase = 'seed'; const serverRequests = [];
const script = () => {
  const source = workerText.replace("const CACHE='tilt-survey-v0.4.2'", `const CACHE='tilt-survey-probe-${revision}'`);
  return revision === 'old' ? source : source.replace("event.waitUntil(caches.open(CACHE)",
    "event.waitUntil(new Promise(resolve => {self.__tiltReleaseInstall = resolve;}).then(() => caches.open(CACHE))");
};
const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  const body = name === '/sw.js' ? script() : name === '/' || name === '/index.html' ? html : '// synthetic cached resource';
  serverRequests.push({url: request.url, revision, at: new Date().toISOString(), sha256: createHash('sha256').update(body).digest('hex')});
  response.setHeader('content-type', name === '/sw.js' ? 'text/javascript' : name === '/' || name === '/index.html' ? 'text/html' : 'text/plain');
  response.setHeader('cache-control', 'no-store'); response.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const profile = path.join(os.tmpdir(), 'tilt-map-live-worker-probe-' + randomUUID());
let context = await chromium.launchPersistentContext(profile, {channel, headless: true}), page = context.pages()[0], originalError;
try {
  await page.goto(url); await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}));
  });
  assert.equal(await page.evaluate(async () => (await (await caches.open('tilt-survey-probe-old')).keys()).length), 27);
  await closeAfterEvidence(context);
  revision = 'new'; phase = 'offline';
  context = await chromium.launchPersistentContext(profile, {channel, headless: true, offline: true}); page = context.pages()[0];
  const lifecycle = await observeWorkers(context, page, out, () => phase);
  const all = monitorContext(context, () => phase);
  await withFailureEvidence({context, page, root: path.join(out, 'diagnostics'), name: 'worker-probe'}, async () => {
    const offline = monitorContext(context, () => phase), offlineUrl = url + '?offline-probe';
    await page.goto(offlineUrl); await page.getByText('SYNTHETIC-OLD-SHELL', {exact: true}).waitFor();
    // Explicitly trigger the browser's registration updater. It is outside page
    // Network emulation on affected Chromium versions; do not synthesize the 27 errors.
    const workers = []; context.on('serviceworker', worker => workers.push(worker));
    await lifecycle.session.send('ServiceWorker.updateRegistration', {scopeURL: url});
    // Hold only this synthetic install until the new worker target exists, then
    // apply offline emulation to that target as well. This explicitly controls
    // the race; it does not assert the same scheduling occurred in the old run.
    let installing;
    const installUntil = performance.now() + 15000;
    while (!installing && performance.now() < installUntil) {
      for (const worker of workers) {
        if (await worker.evaluate(() => typeof self.__tiltReleaseInstall === 'function').catch(() => false)) {installing = worker; break;}
      }
      if (!installing) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(installing, 'Synthetic new install must reach its controlled boundary');
    await context.setOffline(true);
    const version = lifecycle.events.flatMap(e => e.type === 'cdp-workerVersionUpdated' ? e.data.versions : []).findLast(v => v.status === 'installing' && v.targetId);
    assert.ok(version?.targetId);
    const {sessionId} = await lifecycle.session.send('Target.attachToTarget', {targetId: version.targetId, flatten: false});
    let commandId = 0;
    const workerCommand = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId;
      const receive = event => {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message); if (response.id !== id) return;
        lifecycle.session.off('Target.receivedMessageFromTarget', receive);
        response.error ? reject(Error(JSON.stringify(response.error))) : resolve(response.result);
      };
      lifecycle.session.on('Target.receivedMessageFromTarget', receive);
      lifecycle.session.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id, method, params})}).catch(reject);
    });
    await workerCommand('Network.enable');
    await workerCommand('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    lifecycle.emit('controlled-new-worker-offline', {targetId: version.targetId, method: 'public CDP second session; synthetic scheduling only'});
    await installing.evaluate(() => self.__tiltReleaseInstall());
    const until = performance.now() + 15000;
    while (offline.requestFailures.length < 28 && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(offline.requestFailures.length, 28, 'One navigation plus the 27 real install fetch attempts');
    assert.deepEqual(offline.requestFailures.filter(r => r.url !== offlineUrl).map(r => r.url).sort(), files.map(file => new URL(file, url).href).sort());
    assert.ok(serverRequests.some(r => r.url === '/sw.js' && r.revision === 'new'), 'New worker really crossed the emulated offline boundary');
    assert.throws(() => assertOfflineRecovery(offline, {url: offlineUrl, workerUrl: url + 'sw.js', readVerified: true}), /Exactly one intentional worker attempt/);
    assert.equal(await page.getByText('SYNTHETIC-OLD-SHELL', {exact: true}).count(), 1);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({status: 'passed', channel,
      scope: 'controlled localhost shell; explicit CDP updater; synthetic install held until new worker CDP network is offline; not proof of historical scheduling',
      phase, files, serverRequests, all, offline, newWorkerSha256: createHash('sha256').update(script()).digest('hex'),
      conclusions: {pageOfflineEmulationDidNotBlockBrowserUpdater: true, exact28Reproduced: true,
        originalStrictAssertionRejected: true, oldRenderedShellPreserved: true}}, null, 2));
  });
} catch (error) {originalError = error; throw error;}
finally {
  const cleanup = await cleanupProfile({profile, context, failed: Boolean(originalError)});
  await fs.writeFile(path.join(out, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (cleanup.status !== 'completed') {
    console.error('Worker probe cleanup failure: ' + JSON.stringify(cleanup));
    if (!originalError) throw new Error('Worker probe cleanup must complete');
  }
}
