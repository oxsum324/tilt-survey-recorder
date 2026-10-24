import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {loadSites,siteServer,sha} from './site.mjs';
import {basicChecks} from './basic-checks.mjs';
import {loadLiveSites} from './live-site.mjs';
import {withFailureEvidence,closeAfterEvidence} from '../browser-failure-evidence.mjs';
const [out,channel,fault,liveHead]=process.argv.slice(2);await fs.mkdir(out,{recursive:true});
const sites=liveHead?await loadLiveSites(liveHead):await loadSites(),server=liveHead?{url:sites.url,close:async()=>{}}:await siteServer(sites),browser=await chromium.launch({channel,headless:true});
const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
if(fault==='initial-console')await context.addInitScript(()=>console.error('injected-first-navigation-console-error'));
try {
 await withFailureEvidence({context,page,root:path.join(out,'diagnostics'),name:'basic'},()=>basicChecks({page,out,channel,
  head:sites.manifest.commit,appHash:sha(sites.current.get('app.js')),site:server.url}));
}catch(error){console.error(error.stack);process.exitCode=1;}
finally{await context.setOffline(false).catch(()=>{});await closeAfterEvidence(context);await closeAfterEvidence(browser);await server.close();}
