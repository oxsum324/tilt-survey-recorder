import path from 'node:path';
import {capturePolicy} from '../browser-failure-evidence.mjs';
import {cleanupProfile, applyCleanupResult} from './profile-cleanup.mjs';
import {writeEvidence, evidenceAttempt, ioError, stderrFallback, publicationPrefix} from './evidence-io.mjs';

export async function finalizeLiveUpgrade({record, out, profile, seed, context, gate, observer,
  cleanup = cleanupProfile, write = writeEvidence, stderr = stderrFallback,
  acknowledge = value => console.log(publicationPrefix + JSON.stringify(value))}) {
  const log = text => {try {stderr(text);} catch {}};
  const fail = (name, issue) => {
    (record.evidenceErrors ||= []).push({name, ...issue});
    if (record.status !== 'failed') {
      record.status = 'failed'; record.error = {name: 'EvidenceWriteError', message: name + ': evidence incomplete'};
    }
    log('Live evidence failure: ' + JSON.stringify({name, ...issue}));
  };
  // Always clean up before any fallible transport/observer/final receipt writes.
  try {
    const result = await cleanup({profile, seed, context, gate, closeOwnedBrowser: true, failed: record.status === 'failed'});
    if (applyCleanupResult(record, result)) log('Persistent profile cleanup failure: ' + record.profileCleanupError);
  } catch (error) {
    record.cleanup = {status: 'failed', error: ioError(error)};
    fail('cleanup', {status: 'failed', error: ioError(error)});
  }
  // All metadata shares the original total budget; each operation also retains
  // the original artifact limit. A broken injected writer cannot bypass it.
  const until = performance.now() + capturePolicy.totalMs;
  const remaining = () => Math.max(0, Math.min(capturePolicy.artifactMs, until - performance.now()));
  const publish = async (name, value) => {
    const result = await evidenceAttempt(name, () => write(path.join(out, name), JSON.stringify(value, null, 2), {timeoutMs: remaining()}), remaining());
    const receipt = result.status === 'saved' ? result.value : result;
    if (receipt?.status !== 'saved') fail(name, receipt || {status: 'failed', error: {message: 'Missing write receipt'}});
    return receipt;
  };
  if (observer) {
    const result = await evidenceAttempt('worker-observer-seal', () => observer.seal(remaining()), remaining());
    record.workerObserver = result.status === 'saved' ? result.value : {
      status: 'failed', events: structuredClone(observer.events || []),
      errors: [{stage: 'worker-observer-seal', error: result.error}],
      journal: {file: 'worker-lifecycle.jsonl', status: 'incomplete'}, sealAttempt: result,
    };
    if (result.status !== 'saved') log('Worker observer evidence failure: ' + JSON.stringify(record.workerObserver.errors));
    if (record.workerObserver.status !== 'completed') fail('worker-observer', record.workerObserver);
  }
  await Promise.all([
    gate ? publish('transport-events.json', gate.events) : Promise.resolve(),
    observer ? publish('worker-observer.json', record.workerObserver) : Promise.resolve(),
  ]);
  record.endedUtc = new Date().toISOString();
  const finalReceipt = await publish('results.json', record);
  if (record.status !== 'failed' && finalReceipt?.publication) {
    try {acknowledge(finalReceipt.publication);} catch (error) {fail('publication-acknowledgement', {status: 'failed', error: ioError(error)});}
  }
  if (record.status === 'failed') log('Live final fallback record: ' + JSON.stringify(record));
  return {failed: record.status === 'failed'};
}
