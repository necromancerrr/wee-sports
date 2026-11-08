// Decorative WebGL motion against a disposable production server. Requires Playwright.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {writeFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5198';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;

function instrument() {
  window.__islandMotionCheck = {draws: {}, samples: {}, request: null};
  const original = WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays = function (...args) {
    const result = original.apply(this, args);
    const key = this.canvas.dataset.motionLayer, state = window.__islandMotionCheck;
    if (!key) return result;
    state.draws[key] = (state.draws[key] || 0) + 1;
    if (state.request?.key === key) {
      const {label, regions} = state.request, samples = {};
      for (const [name, [x, y, width, height]] of Object.entries(regions)) {
        const w = Math.max(1, Math.floor(width * this.drawingBufferWidth));
        const h = Math.max(1, Math.floor(height * this.drawingBufferHeight));
        const pixels = new Uint8Array(w * h * 4);
        // Capture immediately after the actual draw: preserveDrawingBuffer is false.
        this.readPixels(Math.floor(x * this.drawingBufferWidth),
          this.drawingBufferHeight - Math.floor(y * this.drawingBufferHeight) - h,
          w, h, this.RGBA, this.UNSIGNED_BYTE, pixels);
        samples[name] = Array.from(pixels);
      }
      state.samples[label] = samples;
      state.request = null;
    }
    return result;
  };
}
async function ready(page, key) {
  await page.locator(`canvas[data-motion-layer="${key}"][data-ready="true"]`).waitFor({state: 'visible'});
  assert.equal(await page.getByTestId('island-background').evaluate(image => image.complete && image.naturalWidth > 1000), true);
}
async function capture(page, key, label, regions) {
  await page.evaluate(request => {window.__islandMotionCheck.request = request;}, {key, label, regions});
  await page.waitForFunction(label => Boolean(window.__islandMotionCheck.samples[label]), label);
}
async function stopped(page, key) {
  // Media events can follow an in-flight software-rendered frame. Observe the
  // actual stopped state before checking for any later draws; fixed sleeps
  // can count that last active frame as a shutdown failure.
  await page.waitForFunction(key => {
    const canvas = document.querySelector(`canvas[data-motion-layer="${key}"]`);
    return !canvas || canvas.dataset.ready === 'false';
  }, key);
  const before = await page.evaluate(key => window.__islandMotionCheck.draws[key] || 0, key);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(key => window.__islandMotionCheck.draws[key] || 0, key), before);
}
async function resumed(page, key) {
  const before = await page.evaluate(key => window.__islandMotionCheck.draws[key] || 0, key);
  await ready(page, key);
  await page.waitForFunction(({key, before}) => window.__islandMotionCheck.draws[key] > before + 2, {key, before});
}
async function screenshot(page, name) {
  if (shots) {mkdirSync(shots, {recursive: true}); await page.screenshot({path: join(shots, name + '.png')});}
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const checks = [], errors = [], pixels = {};
  const pass = value => {checks.push(value); console.log('PASS:', value);};
  try {
    // Inspect motion at a modest viewport on the software GPU. Large-screen
    // budgets and slow-renderer fallback have their own TV performance check.
    const context = await browser.newContext({viewport: {width: 960, height: 540}, reducedMotion: 'no-preference'});
    await context.addInitScript(instrument);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const key of ['shore', 'bay']) {
      await page.goto(base + (key === 'shore' ? '/' : '/home'));
      await ready(page, key); await ready(page, 'ocean');
      const geometry = () => page.locator('.island-scenery__plane, .island-map-venues, .island-connectors').evaluateAll(elements =>
        elements.map(element => {const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, getComputedStyle(element).transform];}));
      const stationary = await geometry();
      await page.mouse.move(25, 420); await page.waitForTimeout(1100);
      await page.mouse.move(1640, 890); await page.waitForTimeout(1100);
      assert.deepEqual(await geometry(), stationary, 'pointer movement must not move the camera or venue anchors');
      assert.equal(stationary[0][4], 'none', 'the world must not have a camera transform');
      const regions = key === 'shore' ? {
        cloud: [.10, .17, .045, .04], water: [.53, .70, .035, .03],
        boat: [.700, .621, .038, .065], distantBoat: [.199, .457, .020, .036],
        waterfall: [.447, .477, .013, .024], bowling: [.66, .53, .025, .02],
        tennis: [.31, .60, .025, .02], foregroundPlants: [.155, .75, .025, .04],
      } : {
        cloud: [.09, .12, .045, .04], water: [.55, .64, .035, .03],
        boat: [.685, .645, .053, .095], distantBoat: [.206, .327, .025, .051],
        waterfall: [.438, .365, .013, .029], bowling: [.67, .47, .025, .02], tennis: [.32, .64, .025, .02],
      };
      await page.waitForTimeout(1500);
      await capture(page, key, 'before', regions);
      await page.waitForTimeout(3500);
      await capture(page, key, 'after', regions);
      pixels[key] = await page.evaluate(() => {
        const {before, after} = window.__islandMotionCheck.samples;
        return Object.fromEntries(Object.keys(before).map(name => [name,
          before[name].reduce((sum, channel, index) => sum + (channel !== after[name][index] ? 1 : 0), 0)]));
      });
      for (const name of ['cloud', 'water', 'boat', 'distantBoat', 'waterfall']) assert.ok(pixels[key][name] > 10, `${key} ${name} must visibly change`);
      for (const name of ['bowling', 'tennis', ...(key === 'shore' ? ['foregroundPlants'] : [])]) assert.equal(pixels[key][name], 0, `${key} ${name} must remain still`);
      await screenshot(page, `island-motion-${key}`);
      pass(`${key}: camera stays fixed under pointer movement; cloud, water, boats and waterfall move while venues stay still`);
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    await stopped(page, 'bay'); await stopped(page, 'ocean');
    assert.equal(await page.locator('canvas[data-ready="true"]').count(), 0);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await resumed(page, 'bay'); await resumed(page, 'ocean');
    pass('System reduced motion stops rendering and restoring the preference resumes it');
    await page.evaluate(() => {Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));});
    await stopped(page, 'bay'); await stopped(page, 'ocean');
    await page.evaluate(() => {delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
    await resumed(page, 'bay'); await resumed(page, 'ocean');
    pass('Hidden-document visibility events stop rendering and returning resumes it');
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    await page.getByRole('link', {name: 'Profile & history', exact: true}).click();
    await page.waitForURL('**/profile');
    // React Router can update history before committing the new route.
    await page.waitForFunction(() => document.querySelectorAll('canvas[data-motion-layer]').length === 0);
    assert.equal(await page.locator('canvas[data-motion-layer]').count(), 0);
    await stopped(page, 'bay'); await stopped(page, 'ocean');
    pass('Leaving the island releases both animation loops');
    await page.goto(base + '/home'); await ready(page, 'bay');
    assert.equal(await page.evaluate(() => {
      const gl = document.querySelector('[data-motion-layer="bay"]').getContext('webgl');
      const extension = gl.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      extension.loseContext(); return true;
    }), true, 'software WebGL must support the context-loss test');
    await page.waitForFunction(() => document.querySelector('[data-motion-layer="bay"]').dataset.ready === 'false');
    await stopped(page, 'bay');
    assert.equal(await page.getByTestId('island-background').isVisible(), true);
    pass('WebGL context loss stops the affected renderer and reveals the original artwork');
    const fallback = await browser.newContext({viewport: {width: 1672, height: 941}, reducedMotion: 'no-preference'});
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : original.call(this, type, ...args);
      };
    });
    const still = await fallback.newPage(); still.on('pageerror', error => errors.push(error.message));
    for (const route of ['/', '/home']) {
      await still.goto(base + route);
      await still.waitForFunction(() => {const image = document.querySelector('[data-testid="island-background"]'); return image?.complete && image.naturalWidth > 1000;});
      await still.waitForTimeout(500);
      assert.equal(await still.getByTestId('island-background').isVisible(), true);
      assert.equal(await still.locator('canvas[data-ready="true"]').count(), 0);
    }
    pass('Both pages retain static artwork when WebGL is unavailable');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    const report = {passed: true, checks, pixels, errors, note: 'Software-rendered browser regression; not physical TV performance evidence.'};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
