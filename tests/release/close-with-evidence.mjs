import path from 'node:path';
import {closeAfterEvidence, closeDiagnostics, capturePolicy} from '../browser-failure-evidence.mjs';
import {writeEvidence, evidenceAttempt, ioError, stderrFallback} from './evidence-io.mjs';

export async function closeWithEvidence(resource, {out, label, close = closeAfterEvidence, write = writeEvidence, stderr = stderrFallback}) {
  let result, original;
  try {result = await close(resource);} catch (error) {original = error;}
  const diagnostic = {label, timeoutMs: capturePolicy.cleanupMs, result: result || null,
    error: original ? ioError(original) : null, operation: closeDiagnostics(resource)};
  try {
    const attempt = await evidenceAttempt('close-diagnostic-write', () => write(path.join(out, label + '-close-diagnostics.json'), JSON.stringify(diagnostic, null, 2)));
    const receipt = attempt.status === 'saved' ? attempt.value : attempt;
    if (receipt.status !== 'saved') throw Object.assign(Error('Close diagnostic receipt incomplete'), {receipt});
  } catch (error) {
    try {stderr('Close diagnostic write failure: ' + JSON.stringify({error: ioError(error), original: diagnostic}));} catch {}
    if (!original && result?.status !== 'failed') original = error;
  }
  if (original) throw original;
  return result;
}
