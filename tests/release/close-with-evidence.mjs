import path from 'node:path';
import {closeAfterEvidence, closeDiagnostics, capturePolicy} from '../browser-failure-evidence.mjs';
import {writeEvidence, evidenceAttempt, ioError, stderrFallback} from './evidence-io.mjs';

export async function closeWithEvidence(resource, {out, label, close = closeAfterEvidence, write = writeEvidence, stderr = stderrFallback}) {
  let result, original;
  try {result = await close(resource);} catch (error) {original = error;}
  const diagnostic = {label, timeoutMs: capturePolicy.cleanupMs, result: result || null,
    error: original ? ioError(original) : null, operation: closeDiagnostics(resource)};
  let attempt, receipt;
  try {
    attempt = await evidenceAttempt('close-diagnostic-write', () => write(path.join(out, label + '-close-diagnostics.json'), JSON.stringify(diagnostic, null, 2)));
    receipt = attempt.status === 'saved' ? attempt.value : attempt;
    if (receipt.status !== 'saved') throw Object.assign(Error('Close diagnostic receipt incomplete'), {receipt});
  } catch (error) {
    try {stderr('Close diagnostic write failure: ' + JSON.stringify({error: ioError(error), receipt: receipt || error.receipt || null, attempt: attempt || null,
      underlyingError: receipt?.error || attempt?.error || ioError(error),
      timedOut: receipt?.status === 'timed-out' || attempt?.status === 'timed-out', original: diagnostic}));} catch {}
    if (!original && result?.status !== 'failed') original = error;
  }
  if (original) throw original;
  return result;
}
