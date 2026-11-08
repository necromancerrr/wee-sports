// Production graphics integration checks. Software Chromium is not a TV benchmark.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5240';
const GAME_PIXEL_BUDGET = 1920 * 1080;
const ART_PIXEL_BUDGET = 1672 * 941;

function instrumentFrames() {
  // Advance only the animation callback clock to reproduce sustained slow
  // callbacks deterministically, without relying on the executor's GPU speed.
  const raf = window.requestAnimationFrame.bind(window);
  let last = -1, virtual = 0;
  window.__tvSlowFrames = false;
  window.requestAnimationFrame = callback => raf(time => {
    if (!window.__tvSlowFrames) {virtual = time; callback(time); return;}
    if (time !== last) {last = time; virtual += 100;}
    callback(virtual);
  });
}

async function canvasSize(page, selector) {
  return page.locator(selector).evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    return {width: canvas.width, height: canvas.height, pixels: canvas.width * canvas.height,
      cssWidth: rect.width, cssHeight: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight};
  });
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const checks = [], errors = [], measurements = [];
  const pass = message => {checks.push(message); console.log('PASS:', message);};
  try {
    const context = await browser.newContext({viewport: {width: 3840, height: 2160}, deviceScaleFactor: 1,
      reducedMotion: 'no-preference'});
    await context.addInitScript(instrumentFrames);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/', '/home']) {
      await page.goto(base + route);
      await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-motion-layer]')]
        .length === 2 && [...document.querySelectorAll('canvas[data-motion-layer]')].every(canvas => canvas.dataset.ready === 'true'));
      const sizes = await page.locator('canvas[data-motion-layer]').evaluateAll(canvases => canvases.map(canvas => ({
        layer: canvas.dataset.motionLayer, width: canvas.width, height: canvas.height,
        cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height,
      })));
      for (const size of sizes) {
        assert.ok(size.width * size.height <= ART_PIXEL_BUDGET, 'each decorative shader is bounded by its source detail');
        assert.ok(size.cssWidth > 3800, 'the artwork still fills the 4K display width');
      }
      assert.equal(await page.getByTestId('island-background').evaluate(image => image.complete && image.naturalWidth === 1672), true);
      measurements.push({route, dpr: 1, sizes});
      pass(`${route}: both 4K decorative layers keep full CSS framing with bounded backing buffers`);
    }
    await page.setViewportSize({width: 1280, height: 720});
    await page.waitForTimeout(200);
    await page.evaluate(() => {window.__tvSlowFrames = true;});
    await page.waitForFunction(() => [...document.querySelectorAll('canvas[data-motion-layer]')]
      .every(canvas => canvas.dataset.ready === 'false'), null, {timeout: 15000});
    assert.equal(await page.getByTestId('island-background').isVisible(), true);
    assert.equal(await page.locator('.island-scenery__ocean > img').isVisible(), true);
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    assert.equal(await page.getByRole('link', {name: 'Profile & history', exact: true}).isVisible(), true);
    if (process.env.WEE_SMOKE_SCREENSHOTS) {
      mkdirSync(process.env.WEE_SMOKE_SCREENSHOTS, {recursive: true});
      await page.screenshot({path: join(process.env.WEE_SMOKE_SCREENSHOTS, 'tv-static-fallback.png')});
    }
    pass('Sustained slow callbacks reveal the original island and ocean stills; navigation remains usable');
    await context.close();

    for (const deviceScaleFactor of [1, 2]) {
      const gameContext = await browser.newContext({viewport: {width: 3840, height: 2160}, deviceScaleFactor});
      const game = await gameContext.newPage();
      game.on('pageerror', error => errors.push(error.message));
      for (const [route, selector, hud] of [
        ['/game.html', '#scene-container canvas', '.tennis-scorestrip'],
        ['/table-tennis.html', '#table-court canvas', '.tt-score'],
        ['/bowling.html', '#lane canvas', '.bowling-hud'],
      ]) {
        await game.setViewportSize({width: 3840, height: 2160});
        await game.goto(base + route);
        await game.locator(selector).waitFor();
        await game.waitForFunction(({selector, budget}) => {
          const canvas = document.querySelector(selector);
          return canvas?.width > 100 && canvas.height > 100 && canvas.width * canvas.height <= budget;
        }, {selector, budget: GAME_PIXEL_BUDGET}, {timeout: 15000});
        const large = await canvasSize(game, selector);
        assert.ok(Math.abs(large.cssWidth - large.viewportWidth) <= 2, 'canvas CSS width still fills the viewport');
        assert.ok(Math.abs(large.cssHeight - large.viewportHeight) <= 2, 'canvas CSS height still fills the viewport');
        assert.equal(await game.locator(hud).isVisible(), true, 'score UI remains visible above the bounded scene');
        await game.setViewportSize({width: 1920, height: 1080});
        await game.waitForFunction(selector => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect && Math.abs(rect.width - innerWidth) <= 2 && Math.abs(rect.height - innerHeight) <= 2;
        }, selector);
        const small = await canvasSize(game, selector);
        assert.ok(small.pixels <= GAME_PIXEL_BUDGET, 'resizing preserves the pixel limit');
        measurements.push({route, dpr: deviceScaleFactor, large, small});
        pass(`${route}: 4K and resized viewport obey the scene budget at DPR ${deviceScaleFactor}, with the score visible`);
      }
      await gameContext.close();
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    const report = {recordedAt: new Date().toISOString(), passed: true, checks, measurements, errors,
      limitations: ['Software-rendered Chromium; no physical Toshiba TV, Railway RTT, or motion-to-screen timing was measured.',
        'Slow decorative callbacks were injected deterministically; these are regression checks, not a hardware benchmark.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
