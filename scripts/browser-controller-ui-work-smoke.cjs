// Real DOM mutation regression. This measures redundant UI work, not phone FPS.
const assert = require('node:assert/strict');
const {writeFileSync} = require('node:fs');
const {chromium} = require('playwright');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5293';
const baseline = process.env.WEE_SMOKE_BASELINE_URL;

async function idleWork(page) {
  return page.evaluate(async () => {
    let mutations = 0;
    const targets = {};
    const observer = new MutationObserver(records => {
      mutations += records.length;
      for (const record of records) {
        const key = `${record.target.id || record.target.nodeName}:${record.attributeName || record.type}`;
        targets[key] = (targets[key] || 0) + 1;
      }
    });
    observer.observe(document.querySelector('main'), {subtree: true, attributes: true, childList: true, characterData: true});
    await new Promise(resolve => setTimeout(resolve, 2000));
    observer.disconnect();
    return {durationMs: 2000, mutations, targets};
  });
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const checks = [], errors = [], measurements = [];
  const pass = value => {checks.push(value); console.log('PASS:', value);};
  try {
    for (const [version, origin] of [...(baseline ? [['before', baseline]] : []), ['after', base]]) {
      const context = await browser.newContext({viewport: {width: 390, height: 844}});
      const page = await context.newPage(), swings = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framesent', frame => {
        try {const event = JSON.parse(frame.payload); if (event.type === 'swing') swings.push(event);} catch { /* Other protocol traffic. */ }
      }));
      for (const [sport, url, touch] of [
        ['tennis', '/controller.html?room=ui-work-check', '#use-buttons'],
        ['table-tennis', '/table-tennis-controller.html', '#tt-use-touch'],
      ]) {
        await page.goto(origin + url);
        await page.locator(touch).click();
        await page.waitForTimeout(500);
        const measurement = await idleWork(page);
        measurements.push({version, sport, ...measurement});
        if (version === 'before') continue;
        assert.equal(measurement.mutations, 0, `${sport}: unchanged play view should not mutate on freshness timers`);
        pass(`${sport}: unchanged play screen has zero DOM mutations across two seconds of live timers`);
        if (sport === 'tennis') {
          await page.locator('#toggle-settings').click();
          assert.equal(await page.locator('#setup-panel').isVisible(), true);
          assert.equal(await page.locator('#play-panel').isVisible(), false);
          await page.locator('#back-to-play').click();
          assert.equal(await page.locator('#play-panel').isVisible(), true);
          assert.equal(await page.locator('#setup-panel').isVisible(), false);
          await page.locator('#forehand').click();
          await page.locator('#backhand').click();
          await page.waitForTimeout(100);
          assert.deepEqual(swings.map(event => event.label), ['Forehand', 'Backhand']);
          pass('Tennis: Settings and Back to play update immediately; both touch shots still send exactly once');
        } else {
          await page.locator('#tt-touchpad').focus();
          await page.keyboard.press('ArrowRight');
          assert.equal(await page.locator('#tt-touchpad').getAttribute('aria-valuenow'), '10');
          assert.equal(await page.locator('#tt-touch-paddle').evaluate(element => element.style.left), '55%');
          assert.equal(await page.locator('#tt-touch-stroke').isEnabled(), true);
          pass('Table tennis: touch paddle and accessible value update on movement; Return remains enabled');
        }
      }
      await context.close();
      const motionContext = await browser.newContext({viewport: {width: 390, height: 844}});
      await motionContext.addInitScript(() => {
        window.__sensorCount = 0;
        Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: class {
          static requestPermission() {return Promise.resolve('granted');}
        }});
        Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: class {
          static requestPermission() {return Promise.resolve('granted');}
        }});
        setInterval(() => {
          window.__sensorCount++;
          const event = new Event('devicemotion');
          Object.assign(event, {rotationRate: {alpha: 0, beta: 0, gamma: 0}, acceleration: {x: 0, y: 0, z: 0},
            accelerationIncludingGravity: {x: 0, y: 0, z: 9.80665}, interval: 16});
          window.dispatchEvent(event);
        }, 16);
      });
      const motionPage = await motionContext.newPage();
      motionPage.on('pageerror', error => errors.push(error.message));
      await motionPage.goto(origin + '/controller.html?room=ui-motion-check');
      // A browser with an existing grant starts from real readings, without a
      // redundant permission tap. Our synthetic source models that path.
      await motionPage.waitForFunction(() => document.getElementById('play-status').textContent === 'Motion on');
      await motionPage.waitForTimeout(500);
      const samplesBefore = await motionPage.evaluate(() => window.__sensorCount);
      const motionWork = await idleWork(motionPage);
      const samples = await motionPage.evaluate(() => window.__sensorCount) - samplesBefore;
      measurements.push({version, sport: 'tennis', mode: 'quiet-motion', samples, ...motionWork});
      if (version === 'after') {
        assert.ok(samples >= 80, 'fresh motion samples must continue while UI writes are skipped');
        assert.equal(motionWork.mutations, 0, 'quiet motion should not continuously rebuild hidden diagnostic UI');
        pass('Tennis: quiet synthetic motion keeps arriving at sensor cadence without rewriting the unchanged play screen');
      }
      await motionContext.close();
    }
    assert.deepEqual(errors, []);
    const report = {recordedAt: new Date().toISOString(), checks, measurements, errors,
      limitations: ['Local Chromium DOM mutations with idle touch controls and synthetic quiet motion; not physical phone FPS, motion-to-contact latency or deployment network performance.',
        'Freshness polling, sensor recognition, input dispatch and visible feedback animation cadence are unchanged.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
