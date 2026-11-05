import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPublishedManifest} from './live-site.mjs';

const head = 'a'.repeat(40);
const manifest = () => ({commit:head, version:'0.6.1', files:[
  ...Array.from({length:27}, (_,i) => ({path:`fixture-${i}.js`})),
  {path:'sketch-editor.js'},
]});

test('V0.6 runtime inventory includes the added schematic editor as file 28', () => {
  assert.doesNotThrow(() => assertPublishedManifest(manifest(), head));
});
test('the old 27-file inventory cannot verify a V0.6 deployment', () => {
  const old = manifest(); old.files.pop();
  assert.throws(() => assertPublishedManifest(old, head));
});
test('28 entries cannot hide a duplicate or missing schematic editor', () => {
  const duplicate = manifest(); duplicate.files[0] = duplicate.files[1];
  assert.throws(() => assertPublishedManifest(duplicate, head));
  const missing = manifest(); missing.files.at(-1).path = 'unexpected.js';
  assert.throws(() => assertPublishedManifest(missing, head), /schematic editor/);
});
test('published commit and version checks remain mandatory', () => {
  assert.throws(() => assertPublishedManifest(manifest(), 'b'.repeat(40)));
  assert.throws(() => assertPublishedManifest({...manifest(), version:'unknown'}, head));
});
