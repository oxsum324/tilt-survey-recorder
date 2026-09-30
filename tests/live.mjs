import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const base=(process.env.TILT_URL||'https://oxsum324.github.io/tilt-survey-recorder/').replace(/\/?$/,'/');
const expected=JSON.parse(await fs.readFile(new URL('../_site/deploy-manifest.json',import.meta.url),'utf8'));
async function get(file){const response=await fetch(new URL(file+'?verify='+expected.commit,base),{signal:AbortSignal.timeout(20000),cache:'no-store'});assert.equal(response.status,200,file);return Buffer.from(await response.arrayBuffer());}
const live=JSON.parse((await get('deploy-manifest.json')).toString());assert.equal(live.commit,expected.commit);assert.equal(live.version,expected.version);
for(const file of expected.files){const bytes=await get(file.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
process.stdout.write(`PASS live V${live.version}; ${expected.files.length} files match ${live.commit}\n`);
