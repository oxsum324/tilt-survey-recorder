import assert from 'node:assert/strict';
import {poll} from './poll.mjs';

// Test-only observation; no application code or preference values are changed.
export async function installDisclosureProbe(page) {
  await page.addInitScript(() => {
    const preferenceKey = 'tilt-survey-disclosures';
    const journalKey = 'tilt-test-disclosure-journal';
    const nativeSet = Storage.prototype.setItem;
    let journal;
    try { journal = JSON.parse(sessionStorage.getItem(journalKey) || '[]'); } catch { journal = []; }
    if (!Array.isArray(journal)) journal = [];
    const mark = (type, target) => {
      try {
        const details = target?.closest?.('details[data-ui-disclosure]');
        journal.push({type, at: new Date().toISOString(), timeOrigin: performance.timeOrigin,
          elapsedMs: performance.now(), url: location.href, key: details?.dataset.uiDisclosure || null,
          open: details?.open ?? null, preferences: localStorage.getItem(preferenceKey)});
        journal = journal.slice(-500);
        nativeSet.call(sessionStorage, journalKey, JSON.stringify(journal));
        console.debug('TILT_DISCLOSURE ' + JSON.stringify(journal.at(-1)));
      } catch (error) { console.debug('TILT_DISCLOSURE probe-error ' + String(error)); }
    };
    window.__tiltDisclosureMark = mark;
    Storage.prototype.setItem = function(key, value) {
      const result = nativeSet.call(this, key, value);
      if (this === localStorage && key === preferenceKey) mark('preference-saved');
      return result;
    };
    document.addEventListener('click', event => {
      if (event.target.closest?.('details[data-ui-disclosure] > summary')) mark('click', event.target);
    }, true);
    document.addEventListener('toggle', event => {
      if (event.target.matches?.('details[data-ui-disclosure]')) mark('toggle', event.target);
    }, true);
    window.addEventListener('pagehide', () => mark('pagehide'));
    mark('document-start');
  });
}

export async function disclosureCheckpoint(page, label) {
  await page.evaluate(label => window.__tiltDisclosureMark?.(label), label);
}

// A click can finish before the queued toggle handler persists its preference.
// Keep the original 15s poll deadline; a shorter value is only used by injected regressions.
export async function waitForDisclosureSaved(page, locator, expected, timeout = 15000) {
  assert.equal(typeof expected, 'boolean');
  await poll(page, async () => {
    const state = await locator.evaluate(element => ({open: element.open,
      saved: JSON.parse(localStorage.getItem('tilt-survey-disclosures') || '{}')[element.dataset.uiDisclosure]}));
    assert.equal(state.open, expected, 'Disclosure DOM must reach the requested state');
    assert.equal(state.saved, expected, 'Disclosure preference must be saved before reload');
  }, timeout);
}

// Use the application's existing adoption path: it drains old saves and replaces
// both the stored project and live model before pagehide can save the old model.
// This is an in-memory synthetic backup, not a user case file.
export async function adoptSyntheticProject(page, project) {
  await page.locator('#importFile').setInputFiles({name:'disclosure-fixture.tiltsurvey',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({format:'tilt-survey-case.v1',project,media:[]}))});
  await page.locator('#actionDialog').getByRole('button',{name:'直接取代',exact:true}).click();
  await poll(page,async()=>assert.equal(await page.evaluate(async()=>{const {loadProject}=await import('./store.js');return(await loadProject()).id;}),project.id));
  await page.waitForFunction(()=>document.documentElement.dataset.saveState==='saved');
}
