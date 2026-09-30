import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {VERSION} from './model.js';
const root=fileURLToPath(new URL('./',import.meta.url)),out=path.join(root,'_site');
const files=['index.html','app.js','model.js','calc.js','sketch.js','report.js','store.js','style.css','sw.js','manifest.webmanifest','icon.svg','.nojekyll'];
// No recursive copy: raw case packages, screenshots, references, and tests cannot enter Pages.
await fs.mkdir(out,{recursive:true});
const extra=await fs.readdir(out);for(const name of extra)if(!files.includes(name)&&name!=='deploy-manifest.json')throw Error(`Unexpected staged file: ${name}`);
const manifest={version:VERSION,commit:process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:[]};
for(const file of files){const data=await fs.readFile(path.join(root,file));if(/(?:[A-Za-z]:[\\/]+Users[\\/]|(?:114-292|曹技師|弘一工程顧問有限公司))/.test(data.toString('utf8')))throw Error(`Private content found: ${file}`);await fs.writeFile(path.join(out,file),data);manifest.files.push({path:file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
await fs.writeFile(path.join(out,'deploy-manifest.json'),JSON.stringify(manifest,null,2));process.stdout.write(`PASS staged V${VERSION}: ${files.length} runtime files only\n`);
