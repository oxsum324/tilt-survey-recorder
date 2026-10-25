import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {loadLiveSites, routeOldFixture} from './live-site.mjs';
import {sha, assertRevisionChanged} from './site.mjs';
import {monitorContext, assertOfflineRecovery} from '../desktop/diagnostics.mjs';
import {withFailureEvidence, closeAfterEvidence} from '../browser-failure-evidence.mjs';
import {assertSvgMapVisible, injectSvgMapFault} from './svg-map.mjs';
import {syntheticImages} from './synthetic-images.mjs';
import {createTransportGate} from './transport-gate.mjs';
import {observeWorkers} from './worker-lifecycle.mjs';
import {finalizeLiveUpgrade} from './live-finalize.mjs';
import {closeWithEvidence} from './close-with-evidence.mjs';

const [out, channel, mode, liveHead] = process.argv.slice(2);
await fs.mkdir(out, {recursive: true});
const sites = await loadLiveSites(liveHead); assertRevisionChanged(sites.old, sites.current);
const profile = path.join(os.tmpdir(), 'tilt-map-live-' + randomUUID());
const checks = [], record = {channel, mode, head: liveHead, fixtureCommit: sites.fixture.sourceCommit,
  startedUtc: new Date().toISOString(), status: 'running', checks, verificationRouting: false};
const save = () => fs.writeFile(path.join(out, 'results.json'), JSON.stringify(record, null, 2));
const pass = (name, data) => checks.push({name, status: 'pass', data});
const snapshot = page => page.evaluate(async () => {
  const {loadProject, loadMedia} = await import('./store.js');
  const {mediaIds, sha256Blob, projectFingerprint} = await import('./integrity.js');
  const project = await loadProject(), media = [];
  for (const id of mediaIds(project)) {const blob = await loadMedia(id); media.push({id, type: blob.type, bytes: blob.size, sha256: await sha256Blob(blob)});}
  return {project, media, fingerprint: await projectFingerprint(project, loadMedia)};
});
const runtime = page => page.evaluate(async () => {
  const result = {};
  for (const name of ['app.js', 'style.css']) result[name] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await (await fetch('./' + name)).arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
  return result;
});
let seed, context, before, sources, gate, observer;
try {
  await save();
  gate = await createTransportGate();
  record.transport = {kind: 'CONNECT tunnel; TLS remains end-to-end; no request routing during verification', offline: 'both browser emulation and transport blocked'};
  seed = await chromium.launchPersistentContext(profile, {channel, headless: true, proxy: {server: gate.server}, viewport: {width: 1280, height: 900}});
  const seedPage = seed.pages()[0], seedDiagnostics = monitorContext(seed);
  const finishSeed = await routeOldFixture(seed, sites, out);
  await withFailureEvidence({context: seed, page: seedPage, root: path.join(out, 'diagnostics'), name: 'seed'}, async () => {
    const field = key => seedPage.locator('[data-field="' + key + '"]');
    await seedPage.goto(sites.url); await field('header.caseNumber').waitFor();
    await seedPage.locator('[data-action="sample"]').click();
    await seedPage.locator('#actionDialog').getByRole('button', {name: '直接取代', exact: true}).click();
    await seedPage.getByText('合成示例已載入，可直接預覽成果表。', {exact: true}).waitFor();
    await field('header.caseNumber').fill('舊V0.4.2線上升級－合成－' + channel);
    await seedPage.waitForFunction(() => document.documentElement.dataset.saveState === 'saved');
    const images = await seedPage.evaluate(syntheticImages);
    for (const [tab, input, name] of [['photos', 'photoImport', 'photo'], ['map', 'mapImport', 'map']]) {
      await seedPage.locator('[data-tab="' + tab + '"]').click();
      const buffer = Buffer.from(images[name], 'base64'); await fs.writeFile(path.join(out, 'source-' + name + '.png'), buffer);
      await seedPage.locator('#' + input).setInputFiles({name: 'synthetic-' + name + '.png', mimeType: 'image/png', buffer});
      await seedPage.locator(tab === 'photos' ? '#annotationStage svg' : '#planStage svg').waitFor();
      await seedPage.waitForFunction(() => document.documentElement.dataset.saveState === 'saved');
    }
    await field('map.source').fill('合成底圖，非使用者實檔');
    await seedPage.waitForFunction(() => document.documentElement.dataset.saveState === 'saved');
    await seedPage.locator('[data-tab="case"]').click();
    await seedPage.waitForFunction(() => document.querySelector('#offlineStatus').textContent.includes('離線資源已準備'));
    await seedPage.evaluate(async () => {await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, {once: true}));});
    before = await snapshot(seedPage); const oldRuntime = await runtime(seedPage);
    assert.equal(before.media.length, 2); assert.equal(before.project.pairs.length, 2);
    for (const name of ['app.js', 'style.css']) assert.equal(oldRuntime[name], sha(sites.old.get(name)));
    sources = [{id: before.project.pairs[0].photos[0].mediaId, file: 'source-photo.png'}, {id: before.project.map.mediaId, file: 'source-map.png'}];
    for (const source of sources) {source.sha256 = sha(await fs.readFile(path.join(out, source.file))); assert.equal(before.media.find(m => m.id === source.id).sha256, source.sha256);}
    await fs.writeFile(path.join(out, 'before.json'), JSON.stringify(before, null, 2));
    await fs.writeFile(path.join(out, 'media-sources.json'), JSON.stringify(sources, null, 2));
    await fs.writeFile(path.join(out, 'seed-diagnostics.json'), JSON.stringify(seedDiagnostics, null, 2));
    await finishSeed();
  });
  await closeWithEvidence(seed.browser() || seed, {out, label: 'seed-browser'}); seed = null;
  record.seedSessionClosed = true;

  // Reopen the same real browser profile with NO route handlers, initially offline.
  gate.setOnline(false, 'old-offline-before-browser-launch');
  context = await chromium.launchPersistentContext(profile, {channel, headless: true, offline: true, proxy: {server: gate.server}, viewport: {width: 1280, height: 900}});
  const page = context.pages()[0]; let phase = 'offline'; const startup = monitorContext(context, () => phase);
  observer = await observeWorkers(context, page, out, () => phase);
  const field = key => page.locator('[data-field="' + key + '"]'), tab = name => page.locator('[data-tab="' + name + '"]').click();
  await withFailureEvidence({context, page, root: path.join(out, 'diagnostics'), name: 'upgrade'}, async () => {
    const startupUrl = sites.url + '?baseline-offline=' + channel;
    await page.goto(startupUrl); await field('header.caseNumber').waitFor();
    assert.deepEqual(await snapshot(page), before);
    const oldRuntime = await runtime(page);
    for (const name of ['app.js', 'style.css']) assert.equal(oldRuntime[name], sha(sites.old.get(name)));
    assertOfflineRecovery(startup, {url: startupUrl, workerUrl: sites.url + 'sw.js', readVerified: true});
    record.startupDiagnostics = structuredClone(startup);
    await fs.writeFile(path.join(out, 'startup-offline.json'), JSON.stringify(record.startupDiagnostics, null, 2));
    pass('pinned-old-v042-survives-browser-restart', {oldRuntime, fingerprint: before.fingerprint});

    const diagnostics = monitorContext(context, () => phase); record.diagnostics = diagnostics;
    phase = 'online'; gate.setOnline(true, 'explicit-online-update'); await context.setOffline(false);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.locator('#updateButton').waitFor({state: 'visible'});
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin, 'Update must not silently reload an edited case');
    await Promise.all([page.waitForEvent('load'), page.locator('#updateButton').click()]); await field('header.caseNumber').waitFor();
    const actual = await runtime(page);
    for (const name of ['app.js', 'style.css']) assert.equal(actual[name], sha(sites.current.get(name)), 'runtime must match actual published main');
    const after = await snapshot(page); assert.deepEqual(after, {...before,project:{...before.project,appVersion:sites.manifest.version}});
    await fs.writeFile(path.join(out, 'after.json'), JSON.stringify(after, null, 2));
    pass('new-runtime-and-all-media-retained', {actual, fingerprint: after.fingerprint});
    const keys = await page.evaluate(() => caches.keys()), key = sites.current.get('sw.js').toString().match(/const CACHE='([^']+)'/)[1];
    assert.ok(keys.includes(key)); assert.ok(!keys.includes('tilt-survey-v0.4.2'));
    pass('new-complete-shell-active-old-cache-retired', {keys});

    phase = 'offline'; const url = sites.url + '?upgrade-offline=' + channel;
    gate.setOnline(false, 'new-offline-before-navigation');
    await context.setOffline(true); await page.goto(url); await field('header.caseNumber').waitFor();
    const offline = await snapshot(page); assert.deepEqual(offline, {...before,project:{...before.project,appVersion:sites.manifest.version}});
    await fs.writeFile(path.join(out, 'offline.json'), JSON.stringify(offline, null, 2));
    await tab('photos'); await page.locator('#annotationStage img').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('#annotationStage img')].every(i => i.complete && i.naturalWidth > 0));
    await tab('map'); await page.locator('#planStage svg').waitFor();
    await injectSvgMapFault(page, mode);
    record.svgMap = await assertSvgMapVisible(page, out, {mediaId: before.project.map.mediaId, sha256: sources[1].sha256, width: before.project.map.width, height: before.project.map.height});
    await page.screenshot({path: path.join(out, 'offline-map.png')});
    phase = 'online'; gate.setOnline(true, 'offline-verification-complete'); await context.setOffline(false);
    pass('offline-project-photo-and-painted-svg-map-retained', {fingerprint: offline.fingerprint});
    pass('strict-online-update-through-offline-diagnostics', assertOfflineRecovery(diagnostics, {url, workerUrl: sites.url + 'sw.js', readVerified: true}));
  });
  record.status = 'passed';
  record.browserVersion = context.browser() ? context.browser().version() : (await (await context.newCDPSession(page)).send('Browser.getVersion')).product;
} catch (error) {record.status = 'failed'; record.error = {name: error.name, message: error.message, stack: error.stack}; console.error(error.stack); process.exitCode = 1;}
finally {
  if ((await finalizeLiveUpgrade({record, out, profile, seed, context, gate, observer})).failed) process.exitCode = 1;
}
