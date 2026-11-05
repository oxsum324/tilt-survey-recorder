import {chromium, webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../serve.mjs';
import {poll, reportReady} from './poll.mjs';

const parent = path.resolve('output/playwright/report-preview');
await fs.mkdir(parent, {recursive:true});
const out = await fs.mkdtemp(path.join(parent, 'run-'));
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const result = {status:'running', checks:[], errors:[], out};
let browser, page, activeContext;
const pass = name => { result.checks.push(name); console.log(`PASS ${name}`); };
const geometry = locator => locator.evaluate(e => {
  const r = e.getBoundingClientRect();
  return {top:r.top, bottom:r.bottom, height:innerHeight};
});

try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    if (name === 'chromium') browser = await engine.launch({headless:true, ...(process.platform==='win32'?{channel:'chrome'}:{})});
    for (const viewport of [{width:375,height:667}, {width:390,height:844}, {width:1280,height:900}]) {
      const mobile = viewport.width < 640;
      // Windows WebKit needs an ASCII persistent profile to store original media Blobs.
      const profile = name === 'webkit' ? await fs.mkdtemp(path.join(os.tmpdir(), 'tilt-report-preview-')) : null;
      const options = {viewport, isMobile:mobile, hasTouch:mobile, serviceWorkers:'block'};
      const context = profile
        ? await engine.launchPersistentContext(profile, {headless:true, ...options})
        : await browser.newContext(options);
      activeContext = context;
      page = await context.newPage();
      const label = `${name}-${viewport.width}`;
      page.on('pageerror', e => result.errors.push({label,message:e.message}));
      await page.goto(base);
      await page.locator('[data-action="sample"]').click();
      await page.locator('#actionDialog').getByRole('button', {name:'直接取代',exact:true}).click();
      await page.locator('[data-tab="reports"]').click();
      await reportReady(page);
      const before = await page.evaluate(async () => (await import('./store.js')).loadProject());

      await page.locator('[data-action="build-report"]').click();
      await reportReady(page);
      if (mobile) {
        await poll(page, async () => {
          const box = await geometry(page.locator('.result-sheet').first());
          assert.ok(box.top >= 0 && box.top < box.height / 2, JSON.stringify(box));
        });
      } else {
        assert.equal(await page.evaluate(() => scrollY), 0, '桌機更新預覽維持原捲動位置');
      }
      assert.match(await page.locator('#reportStatus').innerText(), /預覽已完成.*3 頁/);
      assert.equal(await page.locator('#reportPreviewLink').isVisible(), true);
      assert.match(await page.locator('.result-sheet').first().innerText(), /1／212/);
      await page.screenshot({path:path.join(out, `${label}-preview.png`)});
      pass(`${label}：預覽狀態、頁數與查看入口，手機更新後直接顯示報告`);

      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('#reportPreviewLink').click();
      await poll(page, async () => {
        const box = await geometry(page.locator('.result-sheet').first());
        assert.ok(box.top >= 0 && box.top < box.height / 2, JSON.stringify(box));
      });
      pass(`${label}：查看預覽連結可直接定位成果表`);

      await page.locator('[data-tab="reports"]').click();
      await reportReady(page);
      await page.evaluate(() => {
        window.originalDigest = crypto.subtle.digest;
        crypto.subtle.digest = async () => { throw Error('合成測試：指紋計算失敗'); };
      });
      await page.locator('[data-action="build-report"]').click();
      await page.locator('#reportWarnings').getByText('附件預覽未完成：合成測試：指紋計算失敗', {exact:true}).waitFor({timeout:3000});
      await reportReady(page);
      assert.equal(await page.locator('#reportWarnings').isVisible(), true);
      assert.equal(await page.locator('#reportRoot .sheet').count(), 0);
      assert.equal(await page.locator('#reportPreviewLink').isVisible(), false);
      assert.equal(await page.locator('#reportRoot').getAttribute('aria-busy'), 'false');
      if (mobile) {
        const box = await geometry(page.locator('#reportWarnings'));
        assert.ok(box.top >= 0 && box.top < box.height, JSON.stringify(box));
        assert.equal(await page.locator('#statusPanel').getAttribute('open'), null);
      }
      await page.screenshot({path:path.join(out, `${label}-error.png`)});
      pass(`${label}：失敗原因在成果頁可見，預覽結束且不保留舊報告`);

      await page.evaluate(() => { crypto.subtle.digest = window.originalDigest; });
      await page.locator('[data-action="build-report"]').click();
      await reportReady(page);
      assert.equal(await page.locator('#reportRoot .sheet').count(), 3);
      assert.equal(await page.locator('#reportWarnings').innerText(), '');
      const after = await page.evaluate(async () => (await import('./store.js')).loadProject());
      assert.deepEqual(after, before, '預覽與錯誤恢復不改寫案件');
      pass(`${label}：失敗後可重新預覽，案件與確認紀錄不變`);

      if (viewport.width === 390) {
        const imagePath = path.join(out, `${name}-synthetic.png`);
        const image = await page.evaluate(() => {
          const c = document.createElement('canvas');
          c.width = 480; c.height = 320;
          const x = c.getContext('2d');
          x.fillStyle = '#e7ecea'; x.fillRect(0, 0, 480, 320);
          x.fillStyle = '#173c40'; x.fillRect(150, 70, 180, 180);
          x.font = '20px sans-serif'; x.fillText('SYNTHETIC TEST ONLY', 20, 30);
          return c.toDataURL('image/png').split(',')[1];
        });
        await fs.writeFile(imagePath, Buffer.from(image, 'base64'));
        await page.locator('[data-tab="photos"]').click();
        await page.locator('#photoImport').setInputFiles(imagePath);
        await page.locator('#annotationStage img').waitFor();
        await page.locator('[data-tab="map"]').click();
        await page.locator('#mapImport').setInputFiles(imagePath);
        await page.locator('#planStage svg').waitFor();
        await page.locator('[data-field="map.source"]').fill('合成佈設圖（非真實案件）');
        await page.locator('[data-field="map.capturedOn"]').fill('2026-11-05');
        await page.locator('#planStage svg image').click();
        await poll(page, async () => assert.match(await page.locator('#mapCount').innerText(), /1／2 組已標位置/));
        await page.waitForFunction(() => document.documentElement.dataset.saveState === 'saved');
        await page.locator('[data-tab="reports"]').click();
        await reportReady(page);
        assert.equal(await page.locator('#reportRoot .sheet').count(), 5);
        assert.equal(await page.locator('#reportRoot img').evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0)), true);
        for (const [kind, selector] of [['photos','.photo-sheet'], ['map','.map-sheet'], ['results','.result-sheet']]) {
          await page.locator('#reportKind').selectOption(kind);
          await reportReady(page);
          assert.ok(await page.locator(selector).count() > 0);
          assert.equal(await page.locator('#reportWarnings').innerText(), '');
        }
        pass(`${label}：完整附件五頁與獨立照片、佈設圖、成果表皆可預覽`);
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('.report-controls').isVisible(), false);
        assert.equal(await page.locator('.result-sheet').first().isVisible(), true);
        await page.emulateMedia({media:'screen'});
        pass(`${label}：列印保留報告並隱藏預覽操作與狀態`);
      }
      await context.close();
      activeContext = null;
      if (profile) {
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(profile).startsWith('tilt-report-preview-'));
        await fs.rm(profile, {recursive:true});
      }
    }
    if (browser) await browser.close();
    browser = null;
  }
  assert.deepEqual(result.errors, []);
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = {message:error.message, stack:error.stack};
  result.page = await page?.evaluate(() => ({url:location.href, notice:document.querySelector('#notice')?.textContent, warnings:document.querySelector('#reportWarnings')?.textContent})).catch(() => null);
  await page?.screenshot({path:path.join(out, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  if (activeContext) await activeContext.close();
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  console.log(`Evidence: ${out}`);
}
