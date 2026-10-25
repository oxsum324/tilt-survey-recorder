import path from 'node:path';
import {closeWithEvidence} from './close-with-evidence.mjs';
import {writeEvidence, evidenceAttempt, ioError, stderrFallback, publicationPrefix} from './evidence-io.mjs';

// Each operation settles independently within the unchanged per-operation budget.
// The action error has priority over teardown errors, which remain in the receipt.
export async function finalizeStaged({record, originalError, browser, server, out,
  close = resource => closeWithEvidence(resource, {out, label: 'staged-browser'}),
  write = writeEvidence, acknowledge = value => console.log(value), stderr = stderrFallback}) {
  let primary = originalError;
  const errors = record.teardownErrors = [], attempts = record.teardownAttempts = [];
  const fail = (stage, receipt) => {
    errors.push({stage, receipt});
    if (!primary) primary = Object.assign(Error(receipt.error?.message || stage + ' failed'),
      {name: receipt.error?.name || 'TeardownError', code: receipt.error?.code, receipt});
    record.status = 'failed'; record.error = ioError(primary);
  };
  // closeWithEvidence owns the existing 2 s browser close and 2 s diagnostic write.
  try {
    const value = await close(browser);
    attempts.push({name: 'browser-close', status: value?.status === 'failed' ? 'failed' : 'saved', value});
    if (value?.status === 'failed') fail('browser-close', {status: 'failed', error: value.error, value});
  } catch (error) {
    const receipt = {name: 'browser-close', status: 'failed', error: ioError(error)};
    attempts.push(receipt); if (!primary) primary = error; fail('browser-close', receipt);
  }
  const serverReceipt = await evidenceAttempt('server-close', () => server.close());
  attempts.push(serverReceipt); if (serverReceipt.status !== 'saved') fail('server-close', serverReceipt);
  if (primary) {record.status = 'failed'; record.error = ioError(primary);}
  record.endedUtc = new Date().toISOString();
  const attempt = await evidenceAttempt('staged-final-result', () => write(path.join(out, 'results.json'), JSON.stringify(record, null, 2)));
  const receipt = attempt.status === 'saved' ? attempt.value : attempt;
  if (receipt?.status !== 'saved') fail('staged-final-result', receipt || {status: 'failed', error: ioError(Error('Missing final receipt'))});
  if (!primary && record.status === 'passed' && receipt?.publication) {
    try {acknowledge(publicationPrefix + JSON.stringify(receipt.publication));}
    catch (error) {fail('publication-acknowledgement', {status: 'failed', error: ioError(error)});}
  }
  if (primary || record.status === 'failed') {
    try {stderr('Staged final fallback record: ' + JSON.stringify({record, receipt, originalError: primary ? ioError(primary) : null}));} catch {}
  }
  return {failed: !!primary || record.status === 'failed', error: primary, receipt};
}
