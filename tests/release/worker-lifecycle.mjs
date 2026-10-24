import {appendFileSync, writeFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export async function observeWorkers(context, page, out, phase) {
  await fs.mkdir(out, {recursive: true});
  const file = path.join(out, 'worker-lifecycle.jsonl');
  writeFileSync(file, '', {flag: 'wx'});
  const events = [];
  const emit = (type, data) => {const event = {at: new Date().toISOString(), phase: phase(), type, data};
    events.push(event); appendFileSync(file, JSON.stringify(event) + '\n');};
  const worker = value => {emit('worker-observed', {url: value.url()}); value.on('close', () => emit('worker-closed', {url: value.url()}));};
  context.on('serviceworker', worker); context.serviceWorkers().forEach(worker);
  context.on('response', response => {
    if (!new URL(response.url()).pathname.endsWith('/sw.js')) return;
    const observedPhase = phase();
    response.body().then(bytes => emit('worker-script-body', {url: response.url(), responsePhase: observedPhase,
      status: response.status(), fromServiceWorker: response.fromServiceWorker(), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')}), error => emit('worker-script-body-unavailable', {message: error.message}));
  });
  const session = await context.newCDPSession(page);
  for (const name of ['workerRegistrationUpdated', 'workerVersionUpdated', 'workerErrorReported'])
    session.on('ServiceWorker.' + name, data => emit('cdp-' + name, data));
  await session.send('ServiceWorker.enable');
  await context.exposeBinding('__tiltWorkerEvidence', (_, data) => emit('page-worker-lifecycle', data));
  await context.addInitScript(() => {
    if (!navigator.serviceWorker) return;
    const send = data => globalThis.__tiltWorkerEvidence(data).catch(() => {});
    const watch = (worker, role) => {
      if (!worker) return;
      const state = () => send({event: 'state', role, scriptURL: worker.scriptURL, state: worker.state});
      state(); worker.addEventListener('statechange', state);
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => watch(navigator.serviceWorker.controller, 'controller'));
    navigator.serviceWorker.getRegistration().then(registration => {
      send({event: 'registration', scope: registration?.scope || null, online: navigator.onLine});
      if (!registration) return;
      for (const role of ['installing', 'waiting', 'active']) watch(registration[role], role);
      registration.addEventListener('updatefound', () => {send({event: 'updatefound'}); watch(registration.installing, 'installing');});
    }).catch(error => send({event: 'observer-error', message: error.message}));
  });
  return {emit, session, events};
}
