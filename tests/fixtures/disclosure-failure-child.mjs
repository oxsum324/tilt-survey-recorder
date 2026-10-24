import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {startServer} from '../../serve.mjs';
import {withFailureEvidence,closeAfterEvidence} from '../browser-failure-evidence.mjs';
import {installDisclosureProbe,disclosureCheckpoint,waitForDisclosureSaved,adoptSyntheticProject} from '../disclosure-state.mjs';

const [root,channel] = process.argv.slice(2),name='disclosure-save-failure';
const server=await startServer(),browser=await chromium.launch({channel:channel==='chromium'?undefined:channel,headless:true});
const context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage();
let original;
try {
  await withFailureEvidence({context,page,root,name},async()=>{
    await installDisclosureProbe(page);
    // Fixture-only lost-write injection. The real app, original wait predicate and guard run unchanged.
    await page.addInitScript(()=>{
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(this===localStorage&&key==='tilt-survey-disclosures'&&window.holdDisclosureClose){
          const parsed=JSON.parse(value);
          if(parsed[window.holdDisclosureClose]===false){window.__tiltDisclosureMark?.('fixture-write-held');return;}
        }
        return set.call(this,key,value);
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-field="header.caseNumber"]').waitFor();
    const project=await page.evaluate(async()=>{const {sampleProject}=await import('./model.js');return sampleProject();});
    await adoptSyntheticProject(page,project);
    await page.reload();await page.locator('[data-tab="readings"]').click();
    const direction=page.locator('[data-reading-axis="inPlane"] .form-disclosure');
    await direction.locator('summary').click();await waitForDisclosureSaved(page,direction,true);
    await page.evaluate(()=>{window.holdDisclosureClose=document.querySelector('[data-reading-axis="inPlane"] .form-disclosure').dataset.uiDisclosure;});
    await disclosureCheckpoint(page,'before-collapse-click');await direction.locator('summary').click();
    await disclosureCheckpoint(page,'after-collapse-click');
    try {await waitForDisclosureSaved(page,direction,false,250);} catch(error){original=error;throw error;}
  });
} catch(error) {
  try {await fs.writeFile(path.join(root,name,'child-observation.json'),JSON.stringify({sameOriginalError:error===original,
    name:error.name,message:error.message,pageClosedAfterGuard:page.isClosed()},null,2));} catch(observationError){console.error(observationError);}
  throw error;
} finally {
  await closeAfterEvidence(context);await closeAfterEvidence(browser);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
