import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Check the real SVG image and the browser's actual painted output, not an empty HTML img list.
export async function assertSvgMapVisible(page, out, expected) {
  const svg = page.locator('#planStage svg');
  await svg.waitFor({state: 'visible'});
  const image = svg.locator('image');
  assert.equal(await image.count(), 1, 'SVG map must contain exactly one image');
  await image.scrollIntoViewIfNeeded();
  const source = await image.evaluate(async (element, mediaId) => {
    const href = element.getAttribute('href') || element.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href) throw new Error('SVG map image href is empty');
    const decoded = new Image();
    decoded.src = href;
    try { await decoded.decode(); }
    catch (error) { throw new Error('SVG map source decode failed: ' + error.message); }
    // Read retained bytes directly: connect-src self intentionally forbids fetch(blob:).
    const {loadMedia} = await import('./store.js');
    const retained = await loadMedia(mediaId);
    if (!retained) throw new Error('Retained SVG map media is missing');
    const raw = await retained.arrayBuffer();
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const rect = element.getBoundingClientRect();
    let visible = true;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) visible = false;
    }
    const center = {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    const onScreen = center.x > 0 && center.y > 0 && center.x < innerWidth && center.y < innerHeight;
    const hit = onScreen && document.elementFromPoint(center.x, center.y) === element;
    const expectedUrl = URL.createObjectURL(retained), expectedImage = new Image();
    expectedImage.src = expectedUrl;
    try { await expectedImage.decode(); } finally { URL.revokeObjectURL(expectedUrl); }
    const canvas = document.createElement('canvas');
    canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(decoded, 0, 0);
    const fractions = [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]];
    const decodedPoints = fractions.map(([x, y]) => [...context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data]);
    const decodedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = expectedImage.naturalWidth; canvas.height = expectedImage.naturalHeight;
    context.drawImage(expectedImage, 0, 0);
    const retainedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    if (decodedPixels.length !== retainedPixels.length) throw new Error('Decoded SVG source dimensions differ from retained image');
    let maxDecodedDifference = 0;
    for (let i = 0; i < retainedPixels.length; i++) maxDecodedDifference = Math.max(maxDecodedDifference, Math.abs(decodedPixels[i] - retainedPixels[i]));
    const points = fractions.map(([x, y]) => ({x, y,
      rgba: [...context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data]}));
    return {sha256, bytes: raw.byteLength, width: decoded.naturalWidth, height: decoded.naturalHeight,
      visible, hit, rect: {width: rect.width, height: rect.height}, points, decodedPoints,
      pixelsCompared: retainedPixels.length / 4, maxDecodedDifference};
  }, expected.mediaId);
  assert.equal(source.sha256, expected.sha256, 'SVG source must match retained map bytes');
  assert.equal(source.width, expected.width); assert.equal(source.height, expected.height);
  assert.equal(source.pixelsCompared, expected.width * expected.height);
  assert.ok(source.maxDecodedDifference <= 4, 'Every decoded SVG source pixel must match retained map pixels');
  assert.ok(source.decodedPoints.every((point, index) => point.every((value, channel) => Math.abs(value - source.points[index].rgba[channel]) <= 4)),
    'Decoded SVG href pixels must match retained map pixels');
  assert.ok(source.visible && source.hit && source.rect.width > 0 && source.rect.height > 0,
    'SVG map image must be visible and unobscured on screen');
  assert.deepEqual(source.points.map(point => point.rgba),
    [[212, 60, 53, 255], [35, 134, 75, 255], [49, 91, 212, 255]],
    'SVG map must contain three distinct retained color features');

  const png = await svg.screenshot({path: path.join(out, 'svg-map-display.png')});
  const painted = await svg.evaluate(async (element, data) => {
    const screenshot = new Image(); screenshot.src = 'data:image/png;base64,' + data.png;
    await screenshot.decode();
    const canvas = document.createElement('canvas');
    canvas.width = screenshot.naturalWidth; canvas.height = screenshot.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(screenshot, 0, 0);
    const rect = element.getBoundingClientRect(), image = element.querySelector('image').getBoundingClientRect();
    return data.points.map(point => {
      const x = Math.floor((image.x - rect.x + point.x * image.width) / rect.width * canvas.width);
      const y = Math.floor((image.y - rect.y + point.y * image.height) / rect.height * canvas.height);
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) throw new Error('SVG screenshot sample outside image');
      return {x, y, rgba: [...context.getImageData(x, y, 1, 1).data]};
    });
  }, {png: png.toString('base64'), points: source.points});
  assert.equal(painted.length, 3);
  // Preserve the successful source checks and actual sample values even when paint fails.
  await fs.writeFile(path.join(out, 'svg-map-observation.json'), JSON.stringify({source, painted,
    screenshot: 'svg-map-display.png', status: 'observed-before-paint-assertion'}, null, 2));
  for (let index = 0; index < painted.length; index++) {
    assert.ok(painted[index].rgba.every((value, channel) => Math.abs(value - source.points[index].rgba[channel]) <= 4),
      'Actual SVG screenshot pixels must match decoded map pixels');
  }
  const proof = {source, painted, screenshot: 'svg-map-display.png', passed: true};
  await fs.writeFile(path.join(out, 'svg-map-display.json'), JSON.stringify(proof, null, 2));
  return proof;
}

export async function injectSvgMapFault(page, mode) {
  if (mode === 'map-missing') await page.locator('#planStage svg image').evaluate(element => element.remove());
  if (mode === 'map-corrupt') await page.locator('#planStage svg image').evaluate(element => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {type: 'image/png'});
    element.setAttribute('href', URL.createObjectURL(blob));
  });
  if (mode === 'map-occluded') await page.locator('#planStage svg image').evaluate(element => {
    // Cover only the first feature. The center remains unobscured and the href/raw
    // pixels stay correct, so only the actual painted-output assertion can reject it.
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const width = element.width.baseVal.value, height = element.height.baseVal.value;
    const x = element.x.baseVal.value + width * (0.3 - 20 / 320);
    const y = element.y.baseVal.value + height * (0.3 - 15 / 200);
    for (const [name, value] of Object.entries({x, y, width: width * 40 / 320, height: height * 30 / 200,
      fill: '#ffffff', 'pointer-events': 'none', 'data-test-occlusion': 'first-color-feature'})) rect.setAttribute(name, String(value));
    element.parentElement.append(rect);
  });
}
