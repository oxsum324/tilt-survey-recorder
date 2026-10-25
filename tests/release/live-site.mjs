import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadSites, sha} from './site.mjs';

export const liveUrl = 'https://oxsum324.github.io/tilt-survey-recorder/';
export async function loadLiveSites(expectedHead) {
  assert.match(expectedHead, /^[a-f0-9]{40}$/);
  const sites = await loadSites();
  const response = await fetch(liveUrl + 'deploy-manifest.json?svg-evidence=' + Date.now());
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.commit, expectedHead); assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.files.length, 27);
  const current = new Map();
  for (const file of manifest.files) {
    const response = await fetch(liveUrl + file.path + '?svg-evidence=' + Date.now());
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
    current.set(file.path, bytes);
  }
  const runtimeVersion=current.get('model.js').toString().match(/VERSION=['"]([0-9.]+)['"]/);
  assert.ok(runtimeVersion,'Published model must declare a version');assert.equal(manifest.version,runtimeVersion[1]);
  return {...sites, current, manifest, url: liveUrl};
}

// Only the seeding browser session uses fixture responses. It is closed before verification.
export async function routeOldFixture(context, sites, out) {
  const routed = [];
  const handler = async route => {
    const name = new URL(route.request().url()).pathname.slice(new URL(liveUrl).pathname.length) || 'index.html';
    const body = sites.old.get(name);
    if (!body) return route.continue();
    routed.push({file: name, sha256: sha(body), worker: Boolean(route.request().serviceWorker())});
    const ext = path.extname(name);
    const types = {'.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
    await route.fulfill({body, contentType: types[ext] || 'application/octet-stream'});
  };
  await context.route(liveUrl + '**', handler);
  return async () => {
    assert.ok(routed.some(request => request.file === 'sw.js'), 'Old worker must actually be served from pinned fixture');
    await fs.writeFile(path.join(out, 'old-fixture-routing.json'), JSON.stringify({routed,
      runtimeCommit: sites.manifest.commit,
      scope: 'seeding session only; verification must reopen the same profile with zero routing'}, null, 2));
    await fs.writeFile(path.join(out, 'live-manifest.json'), JSON.stringify(sites.manifest, null, 2));
  };
}
