// Island resize regression against an already running disposable production server.
// Requires environment-provided Playwright/Chromium; creates no rooms or profiles.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5198';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;
const sizes = [
  {name: 'wide', width: 1672, height: 941},
  {name: 'portrait', width: 600, height: 1000},
  {name: 'halfsize', width: 836, height: 470},
  {name: 'ultrawide', width: 2560, height: 720},
  {name: 'compact', width: 849, height: 650},
  {name: 'expanded', width: 851, height: 650},
  {name: 'square', width: 650, height: 650},
  {name: 'short', width: 900, height: 360},
  {name: 'restored', width: 1672, height: 941},
];

function instrumentResize() {
  const state = window.__islandResize = {layers: {}, callbacks: 0, failures: [], sample: null, request: null};
  const surfaces = new WeakMap();
  const track = canvas => {
    const layer = canvas.dataset.motionLayer;
    if (!layer) return null;
    let entry = surfaces.get(canvas);
    if (!entry) {
      entry = {layer, generation: 0, painted: -1, draws: 0, resizes: 0};
      surfaces.set(canvas, entry);
      state.layers[layer] = entry;
    }
    return entry;
  };
  for (const dimension of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension);
    Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, value);
        const entry = track(this);
        // Assigning even the same backing dimension clears the drawing buffer.
        if (entry) {entry.generation++; entry.resizes++;}
      },
    });
  }
  const draw = WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays = function (...args) {
    const result = draw.apply(this, args);
    const entry = track(this.canvas);
    if (!entry) return result;
    entry.draws++;
    entry.painted = entry.generation;
    const request = state.request;
    if (request && entry.layer === 'ocean') {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.round((request.left - rect.left) / rect.width * this.drawingBufferWidth);
      const y = Math.floor((1 - (request.y - rect.top) / rect.height) * this.drawingBufferHeight);
      const width = Math.max(1, Math.floor(request.width / rect.width * this.drawingBufferWidth));
      const bytes = new Uint8Array(width * 4);
      // Read at the actual draw because preserveDrawingBuffer is false.
      this.readPixels(x, y, width, 1, this.RGBA, this.UNSIGNED_BYTE, bytes);
      const colors = new Set();
      let min = 255, max = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
        min = Math.min(min, bytes[i], bytes[i + 1], bytes[i + 2]);
        max = Math.max(max, bytes[i], bytes[i + 1], bytes[i + 2]);
      }
      state.sample = {colors: colors.size, min, max, pixels: width, screenRow: request.y};
      state.request = null;
    }
    return result;
  };
  const audit = () => {
    if (document.hidden) return;
    for (const canvas of document.querySelectorAll('canvas[data-motion-layer]')) {
      const entry = surfaces.get(canvas);
      if (!entry || entry.generation === entry.painted) continue;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      let hidden = false;
      for (let element = canvas; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) hidden = true;
      }
      // A newly cleared alpha canvas reveals the original image. An opaque
      // cleared canvas must stay hidden or be painted before the callback ends.
      const transparent = canvas.getContext('webgl')?.getContextAttributes()?.alpha === true;
      if (!hidden && !transparent && state.failures.length < 30) {
        state.failures.push({layer: entry.layer, generation: entry.generation, painted: entry.painted,
          width: canvas.width, height: canvas.height, callback: state.callbacks});
      }
    }
  };
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback) {
      super((entries, observer) => {
        callback(entries, observer);
        state.callbacks++;
        audit();
      });
    }
  };
}

async function ready(page, previous = {}) {
  await page.waitForFunction(before => {
    const image = document.querySelector('[data-testid="island-background"]');
    const surfaces = [...document.querySelectorAll('canvas[data-motion-layer]')];
    return image?.complete && image.naturalWidth > 1000 && surfaces.length === 2 && surfaces.every(canvas => {
      const entry = window.__islandResize.layers[canvas.dataset.motionLayer];
      const ratio = Math.min(devicePixelRatio, 2);
      return canvas.dataset.ready === 'true' && canvas.width === Math.round(canvas.clientWidth * ratio) &&
        canvas.height === Math.round(canvas.clientHeight * ratio) && entry?.draws > (before[entry.layer] || 0) + 1 &&
        entry.painted === entry.generation;
    });
  }, previous, {timeout: 20000});
}

async function draws(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(window.__islandResize.layers).map(([key, value]) => [key, value.draws])));
}

async function geometry(page, route) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const result = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom};
    };
    const image = document.querySelector('[data-testid="island-background"]');
    return {screen: box('.island-screen'), scenery: box('.island-scenery'), ocean: box('.island-scenery__ocean'),
      image: box('[data-testid="island-background"]'), aspect: image.naturalWidth / image.naturalHeight,
      role: document.querySelector('.island-screen').dataset.displayRole,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      width: innerWidth, height: innerHeight,
      anchors: [...document.querySelectorAll('[data-venue-anchor]')].map(circle => {
        const svg = circle.ownerSVGElement;
        return {sport: circle.dataset.venueAnchor, x: circle.cx.baseVal.value / svg.width.baseVal.value,
          y: circle.cy.baseVal.value / svg.height.baseVal.value};
      }), failures: window.__islandResize.failures};
  });
  assert.equal(result.role, 'tv', 'resizing a desktop must preserve its display role');
  assert.ok(result.scrollWidth <= result.width + 1, 'no horizontal page overflow');
  assert.ok(result.ocean.x <= result.screen.x + 1 && result.ocean.right >= result.screen.right - 1, 'textured backdrop spans the screen width');
  assert.ok(result.ocean.y <= result.screen.y + 1 && result.ocean.bottom >= result.screen.bottom - 1, 'textured backdrop spans the full screen height');
  assert.ok(result.image.width > 0 && result.image.height > 0, 'island remains visible');
  assert.ok(Math.abs(result.image.width / result.image.height - result.aspect) < .005, 'island artwork retains its proportions');
  assert.ok(result.image.x >= result.scenery.x - 1 && result.image.right <= result.scenery.right + 1 &&
    result.image.y >= result.scenery.y - 1 && result.image.bottom <= result.scenery.bottom + 1, 'whole island stays inside its scenery frame');
  assert.deepEqual(result.failures, [], 'a ResizeObserver callback must not expose an unpainted opaque resized canvas');
  if (route === '/') assert.ok(result.scrollHeight <= result.height + 1, 'landing fits short windows without hiding Play below the fold');
  return result;
}

async function controls(page, route) {
  const targets = route === '/' ? [page.getByRole('link', {name: 'Play', exact: true})] :
    [page.getByRole('button', {name: 'Menu', exact: true}), ...['Tennis', 'Bowling', 'Table Tennis'].map(name =>
      page.getByRole('button', {name: `Play: ${name}`, exact: true}))];
  for (const control of targets) {
    await control.scrollIntoViewIfNeeded();
    const rect = await control.boundingBox();
    const size = page.viewportSize();
    assert.ok(rect && rect.width >= 44 && rect.height >= 44, 'controls retain usable touch targets');
    assert.ok(rect.x >= -1 && rect.x + rect.width <= size.width + 1 && rect.y >= -1 && rect.y + rect.height <= size.height + 1,
      'controls remain reachable within the viewport after scrolling');
    await control.focus();
    assert.equal(await control.evaluate(element => document.activeElement === element), true, 'controls remain keyboard reachable');
  }
  if (route === '/home') {
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    await page.getByRole('dialog', {name: 'Menu', exact: true}).waitFor();
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function staticScreenshot(page, name) {
  if (!shots) return;
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.waitForFunction(() => !document.querySelector('canvas[data-ready="true"]'));
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('.island-scenery img')].map(image => image.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  mkdirSync(shots, {recursive: true});
  await page.screenshot({path: join(shots, name + '.png'), animations: 'disabled', fullPage: true});
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await ready(page);
}

async function stopped(page) {
  await page.waitForFunction(() => !document.querySelector('canvas[data-ready="true"]'));
  const before = await draws(page);
  await page.waitForTimeout(180);
  assert.deepEqual(await draws(page), before, 'hidden/reduced-motion layers stop drawing');
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const checks = [], layouts = [], water = [], errors = [];
  const pass = message => {checks.push(message); console.log('PASS:', message);};
  try {
    for (const deviceScaleFactor of [1, 2]) {
      const context = await browser.newContext({viewport: {width: 1672, height: 941}, deviceScaleFactor, reducedMotion: 'no-preference'});
      await context.addInitScript(instrumentResize);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      for (const route of ['/', '/home']) {
        await page.goto(base + route);
        await ready(page);
        let anchors;
        for (const size of sizes) {
          const before = await draws(page);
          await page.setViewportSize({width: size.width, height: size.height});
          await ready(page, before);
          const measured = await geometry(page, route);
          if (anchors) for (const anchor of measured.anchors) {
            const original = anchors.find(value => value.sport === anchor.sport);
            assert.ok(Math.abs(anchor.x - original.x) < .0001 && Math.abs(anchor.y - original.y) < .0001,
              'venue markers stay anchored to the artwork after resizing');
          }
          anchors = measured.anchors;
          await controls(page, route);
          layouts.push({route, deviceScaleFactor, size: size.name, ...measured});
          if (size.name === 'portrait') {
            const y = Math.min(measured.screen.bottom, measured.height) - 24;
            assert.ok(y > measured.image.bottom + 12, 'portrait trial samples below the original contained artwork');
            await page.evaluate(request => {window.__islandResize.sample = null; window.__islandResize.request = request;},
              {left: measured.width * .15, width: measured.width * .7, y});
            await page.waitForFunction(() => window.__islandResize.sample);
            const sample = await page.evaluate(() => window.__islandResize.sample);
            assert.ok(sample.colors > 8 && sample.max > 20, 'below-art backdrop contains horizontal water texture, not a flat gradient or cleared buffer');
            water.push({route, deviceScaleFactor, ...sample});
          }
          if (deviceScaleFactor === 1 && ['wide', 'portrait', 'halfsize'].includes(size.name)) {
            await staticScreenshot(page, `island-resize-${route === '/' ? 'landing' : 'home'}-${size.name}`);
          }
        }
        await page.emulateMedia({reducedMotion: 'reduce'});
        await stopped(page);
        await page.setViewportSize({width: 600, height: 1000});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await geometry(page, route);
        await page.emulateMedia({reducedMotion: 'no-preference'});
        await ready(page);
        await page.evaluate(() => {Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange'));});
        await stopped(page);
        await page.setViewportSize({width: 851, height: 650});
        await page.evaluate(() => {delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
        await ready(page);
        await geometry(page, route);
        const instrumented = await page.evaluate(() => ({callbacks: window.__islandResize.callbacks, layers: window.__islandResize.layers}));
        assert.ok(instrumented.callbacks > sizes.length, 'ResizeObserver instrumentation exercised real resize callbacks');
        assert.ok(Object.values(instrumented.layers).every(layer => layer.resizes > 1 && layer.draws > 1), 'each renderer resized and resumed drawing');
        pass(`${route} at DPR ${deviceScaleFactor}: nine live sizes, full textured backdrop, stable anchors, controls, reduced motion and hidden-page recovery`);
      }
      await context.close();
    }
    assert.deepEqual(errors, [], 'no uncaught browser or ResizeObserver errors');
    const report = {passed: true, recordedAt: new Date().toISOString(), base, browser: browser.version(), checks, layouts, water, errors,
      limitations: ['Local Chromium software WebGL and simulated device scale/visibility; not physical device performance evidence.',
        'Water pixels are sampled from the rendered backdrop at screen coordinates below the contained artwork; screenshots retain static composite evidence.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('RESIZE_STATE', await page.evaluate(() => ({url: location.href,
        viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
        instrumentation: window.__islandResize,
        surfaces: [...document.querySelectorAll('canvas[data-motion-layer]')].map(canvas => ({
          layer: canvas.dataset.motionLayer, ready: canvas.dataset.ready,
          width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
        })),
      })).catch(() => ({url: page.url(), unavailable: true})));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
