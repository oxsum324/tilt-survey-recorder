import test from 'node:test';import assert from 'node:assert/strict';
import * as storage from './store.js';import {sampleProject} from './model.js';
test('verified import rejects attached digest mismatch before adoption',async()=>{const b=await storage.makeBackup(sampleProject());b.project.header.caseNumber='edited-with-old-digest';assert.equal(typeof storage.parseVerifiedBackup,'function');await assert.rejects(()=>storage.parseVerifiedBackup(JSON.stringify(b)),/指紋不一致/);});
test('verified import accepts matching and legacy unsigned backups',async()=>{assert.equal(typeof storage.parseVerifiedBackup,'function');const b=await storage.makeBackup(sampleProject());assert.ok((await storage.parseVerifiedBackup(JSON.stringify(b))).integrity);delete b.integrity;assert.equal((await storage.parseVerifiedBackup(JSON.stringify(b))).integrity,null);});

