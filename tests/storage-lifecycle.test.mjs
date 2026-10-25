import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {sampleProject,createProject} from '../model.js';
import {normalizeProject} from '../store.js';
const source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
const queue=source.slice(source.indexOf('function queueSave()'),source.indexOf('function dialog('));
const adopt=source.slice(source.indexOf('async function adopt('),source.indexOf('async function action('));
function harness(replaceProject){const current=sampleProject(),incoming=sampleProject();current.id='old-case';incoming.id='new-case';const writes=[];const context=vm.createContext({structuredClone,Date,project:current,incoming,replacing:false,saveTimer:null,saving:Promise.resolve(),storageBlocked:false,failedSave:false,reportKind:'all',selectedPair:null,selectedFacade:null,reportStale:false,workspace:{inert:false},desktopActions:{inert:false},document:{documentElement:{dataset:{}}},clearTimeout(){},setTimeout(){return 1;},invalidateShare(){},updateStatus(){},render(){},notice(){},async replaceProject(value,media,previous){assert.equal(previous.id,'old-case');await replaceProject(value);writes.push('replace:'+value.id);},async saveProject(value){writes.push('save:'+value.id);}});vm.runInContext(queue+'\n'+adopt,context);return {context,writes};}
test('adoption excludes debounced and pagehide-style queued writes until replacement completes',async()=>{let release,started=false;const gate=new Promise(resolve=>release=resolve);const {context,writes}=harness(async()=>{started=true;await gate;});const adopting=vm.runInContext('adopt(incoming)',context);for(let i=0;i<4;i++)await Promise.resolve();assert.equal(started,true);assert.equal(context.replacing,true);assert.equal(context.workspace.inert,true);assert.equal(context.document.documentElement.dataset.replacing,'true');await vm.runInContext('changed();queueSave()',context);release();await adopting;await vm.runInContext('saving',context);assert.deepEqual(writes,['replace:new-case']);assert.equal(context.project.id,'new-case');assert.equal(context.replacing,false);assert.equal(context.workspace.inert,false);});
test('failed conflicting adoption retains old draft and restores controls without enabling writes',async()=>{const {context}=harness(async()=>{const error=Error('newer stored case');error.name='StorageConflictError';throw error;});await assert.rejects(vm.runInContext('adopt(incoming)',context),/newer stored case/);assert.equal(context.project.id,'old-case');assert.equal(context.storageBlocked,true);assert.equal(context.failedSave,true);assert.equal(context.workspace.inert,false);assert.equal(context.replacing,false);await vm.runInContext('queueSave()',context);});


const startup=source.slice(source.lastIndexOf('try {\n  const saved = await loadProject();'),source.lastIndexOf('selectedPair = project.pairs[0]?.id;'));
async function start(saved){
 const writes=[],context=vm.createContext({project:undefined,failedSave:false,storageBlocked:false,async loadProject(){return saved;},normalizeProject,createProject,async saveProject(value){writes.push(structuredClone(value));},notice(){}});
 await vm.runInContext('(async()=>{'+startup+'})()',context);
 return {context,writes};
}
test('opening a legacy case preserves every persisted field while using migrated modes in memory',async()=>{
 const saved=sampleProject();saved.appVersion='0.1.0';
 for(const pair of saved.pairs)for(const axis of ['inPlane','outPlane'])pair[axis].mode='B';
 const before=structuredClone(saved),{context,writes}=await start(saved);
 assert.deepEqual(writes,[],'Opening a saved case must not persist normalization or version metadata');
 assert.deepEqual(saved,before);
 for(const pair of context.project.pairs)for(const axis of ['inPlane','outPlane'])assert.equal(pair[axis].mode,'A');
 assert.deepEqual(context.project.pairs.map(p=>p.confirmed),before.pairs.map(p=>p.confirmed));
 assert.equal(context.storageBlocked,false);
});
test('first launch still saves a newly created case',async()=>{
 const {context,writes}=await start(null);
 assert.equal(writes.length,1);assert.equal(writes[0].id,context.project.id);
 assert.equal(context.failedSave,false);
});

const pagehide=source.slice(source.indexOf('window.addEventListener("pagehide"'),source.indexOf('let swReload = false'));
function hide(state,replacing=false){
 const listeners={},writes=[],context=vm.createContext({window:{addEventListener(name,handler){listeners[name]=handler;}},project:sampleProject(),replacing,saveTimer:null,document:{documentElement:{dataset:{saveState:state}}},clearTimeout(){},queueSave(){writes.push('save');}});
 vm.runInContext(pagehide,context);listeners.pagehide();return writes;
}
test('leaving a read-only saved case performs no persistence write',()=>{assert.deepEqual(hide('saved'),[]);});
test('leaving with a pending edit flushes once while replacement still excludes writes',()=>{assert.deepEqual(hide('pending'),['save']);assert.deepEqual(hide('pending',true),[]);});
