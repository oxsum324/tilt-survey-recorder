import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {loadSites,siteServer,sha} from './site.mjs';
import {basicChecks} from './basic-checks.mjs';
import {loadLiveSites} from './live-site.mjs';
import {withFailureEvidence} from '../browser-failure-evidence.mjs';
import {finalizeStaged} from './staged-finalize.mjs';
import {closeWithEvidence} from './close-with-evidence.mjs';
const [out,channel,fault,liveHead]=process.argv.slice(2);await fs.mkdir(out,{recursive:true});
const sites=liveHead?await loadLiveSites(liveHead):await loadSites(),server=liveHead?{url:sites.url,close:async()=>{}}:await siteServer(sites),browser=await chromium.launch({channel,headless:true});
const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
if(fault==='initial-console')await context.addInitScript(()=>console.error('injected-first-navigation-console-error'));
const record={status:'running',checks:[]};let originalError;
try {
 await withFailureEvidence({context,page,root:path.join(out,'diagnostics'),name:'basic'},()=>basicChecks({page,out,channel,
  result:record,version:sites.manifest.version,head:sites.manifest.commit,appHash:sha(sites.current.get('app.js')),site:server.url}));
}catch(error){originalError=error;console.error(error.stack);process.exitCode=1;}
// This child owns the browser. Close it directly within the original budget;
// context protocol disposal and network restoration cannot block browser cleanup.
finally{
 const final=await finalizeStaged({record,originalError,browser,server,out,
  close:resource=>closeWithEvidence(resource,{out,label:'basic-browser'})});
 if(final.failed)process.exitCode=1;
}
