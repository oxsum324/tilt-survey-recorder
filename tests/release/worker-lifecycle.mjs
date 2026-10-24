import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkerJournal, evidenceAttempt} from './evidence-io.mjs';
import {capturePolicy} from '../browser-failure-evidence.mjs';

export async function observeWorkers(context, page, out, phase, options = {}) {
  const file = path.join(out, 'worker-lifecycle.jsonl');
  const journal = createWorkerJournal(file, options), {events} = journal, removers = [], pending = new Set();
  let stopped = false;
  const emit = (type, data) => {
    if (stopped) return;
    try {journal.emit({at: new Date().toISOString(), phase: phase(), type, data});}
    catch (error) {journal.fail('event', error);}
  };
  const on = (target, name, callback) => {
    const safe = value => {try {callback(value);} catch (error) {journal.fail(name, error);}};
    target.on(name, safe); removers.push(() => target.off(name, safe));
  };
  const worker = value => {emit('worker-observed', {url: value.url()}); on(value, 'close', () => emit('worker-closed', {url: value.url()}));};
  on(context, 'serviceworker', worker); context.serviceWorkers().forEach(worker);
  on(context, 'response', response => {
    if (!new URL(response.url()).pathname.endsWith('/sw.js')) return;
    const observedPhase = phase();
    const task = Promise.resolve().then(() => response.body()).then(bytes => emit('worker-script-body', {url: response.url(), responsePhase: observedPhase,
      status: response.status(), fromServiceWorker: response.fromServiceWorker(), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')}), error => emit('worker-script-body-unavailable', {message: error.message}))
      .catch(error => journal.fail('worker-response', error));
    pending.add(task); task.then(() => pending.delete(task));
  });
  const session = await context.newCDPSession(page);
  for (const name of ['workerRegistrationUpdated', 'workerVersionUpdated', 'workerErrorReported'])
    on(session, 'ServiceWorker.' + name, data => emit('cdp-' + name, data));
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
  const seal = async (timeoutMs = capturePolicy.artifactMs) => {
    for (const remove of removers) {try {remove();} catch (error) {journal.fail('detach', error);}}
    const until = performance.now() + timeoutMs;
    const result = await evidenceAttempt('worker-response-drain', () => Promise.all([...pending]), timeoutMs);
    if (result.status !== 'saved') journal.fail('worker-response-drain', result.error);
    stopped = true;
    return journal.seal(Math.max(0, until - performance.now()));
  };
  return {emit, session, events, seal};
}
