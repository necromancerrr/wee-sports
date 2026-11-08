// Real browser controller -> room socket -> rendered Table Tennis game.
// Generated sensor input verifies software behavior, not physical-device feel.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {writeFileSync} = require('node:fs');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5196';

async function sensorContext(browser) {
  const context = await browser.newContext({viewport: {width: 430, height: 900}});
  await context.addInitScript(() => {
    window.__sensor = {running: true, pattern: null, started: 0, angle: {alpha: 0, beta: 0, gamma: 0}};
    window.__bridge = []; window.__permissionCalls = [];
    const permission = name => {window.__permissionCalls.push({name, active: navigator.userActivation.isActive}); return Promise.resolve('granted');};
    Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: class {static requestPermission() {return permission('motion');}}});
    Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: class {static requestPermission() {return permission('orientation');}}});
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.type?.startsWith('wee:')) {
        window.__bridge.push({...event.data, receivedAt: performance.now()});
        if (window.__bridge.length > 6000) window.__bridge.shift();
      }
    });
    let previous = performance.now();
    setInterval(() => {
      const now = performance.now(), dt = Math.min((now - previous) / 1000, .05); previous = now;
      if (!window.__sensor.running) return;
      const rate = {alpha: 0, beta: 0, gamma: 0};
      if (window.__sensor.pattern) {
        const elapsed = (now - window.__sensor.started) / 1000;
        // Keep moving between strokes. The old detector silently stopped
        // recognizing gestures unless the phone rested for at least 60 ms.
        const value = 3 * Math.sin(elapsed * 2 * Math.PI / .7);
        rate[window.__sensor.pattern] = value * 180 / Math.PI;
        const orientationAxis = {alpha: 'beta', beta: 'gamma', gamma: 'alpha'}[window.__sensor.pattern];
        window.__sensor.angle[orientationAxis] += rate[window.__sensor.pattern] * dt;
      }
      const motion = new Event('devicemotion');
      Object.assign(motion, {rotationRate: rate, acceleration: {x: 0, y: 0, z: 0},
        accelerationIncludingGravity: {x: 0, y: 0, z: 9.80665}, interval: 16});
      window.dispatchEvent(motion);
      const orientation = new Event('deviceorientation');
      Object.assign(orientation, window.__sensor.angle); window.dispatchEvent(orientation);
    }, 16);
  });
  return context;
}
async function setPattern(frame, axis = null) {
  await frame.evaluate(axis => {window.__sensor.pattern = axis; window.__sensor.started = performance.now();}, axis);
}
async function visibility(frame, hidden) {
  await frame.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: hidden});
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: hidden ? 'hidden' : 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [], checks = [], axisResults = [];
  const pass = value => {checks.push(value); console.log('PASS:', value);};
  try {
    const hostContext = await browser.newContext({viewport: {width: 960, height: 640}});
    await hostContext.addInitScript(() => {
      window.__gameFeedback = [];
      window.addEventListener('message', event => {
        if (event.origin === location.origin && ['wee:game-hit', 'wee:table-tennis-state'].includes(event.data?.type)) {
          window.__gameFeedback.push({...event.data, receivedAt: performance.now()});
        }
      });
    });
    const phoneContext = await sensorContext(browser);
    const host = await hostContext.newPage(), phone = await phoneContext.newPage();
    host.on('pageerror', error => errors.push('host: ' + error.message));
    phone.on('pageerror', error => errors.push('phone: ' + error.message));
    await host.goto(base + '/home'); await host.getByRole('button', {name: 'Play: Table Tennis', exact: true}).click();
    const code = await host.getByTestId('lobby-code').innerText();
    await phone.goto(`${base}/join?code=${code}`); await phone.getByRole('button', {name: 'Play', exact: true}).click();
    await phone.getByRole('button', {name: 'Start game', exact: true}).click();
    await phone.getByRole('button', {name:'Start now', exact:true}).click();
    await host.locator('iframe[title="Table Tennis game"]').waitFor({timeout: 20000});
    const controller = phone.frames().find(frame => frame.url().includes('/table-tennis-controller.html'));
    const game = host.frames().find(frame => frame.url().includes('/table-tennis.html'));
    assert.ok(controller && game);
    await phone.waitForFunction(() => window.__bridge.some(message => message.type === 'wee:player-pose'));
    const permission = await phone.evaluate(() => window.__permissionCalls);
    assert.equal(permission.length, 2); assert.ok(permission.every(call => call.active));
    assert.deepEqual(await controller.evaluate(() => window.__permissionCalls), []);
    assert.equal(await phone.getByRole('button', {name: 'Ready', exact: true}).count(), 0);
    await game.getByText('First to 12 · win by 2', {exact: true}).waitFor();
    pass('Play joins and the leader starts a scored table-tennis motion game without a calibration checklist');
    await controller.locator('details summary').click();
    await controller.locator('#tt-practice-phone').click();
    await game.getByText('Friendly practice', {exact: true}).waitFor();

    const playerHits = () => host.evaluate(() => window.__gameFeedback.filter(message => message.type === 'wee:game-hit' && message.player === 1).length);
    await phone.waitForTimeout(4500);
    assert.equal(await playerHits(), 0, 'an idle phone must not generate passive player contacts');
    assert.equal(await game.locator('#tt-you').innerText(), '0');
    pass('An idle motion controller produces no automatic player hit or credited return');

    async function practice() {
      await setPattern(controller);
      await controller.locator('#tt-practice-phone').click();
      await game.waitForFunction(() => document.getElementById('tt-you').textContent === '0');
      await phone.waitForTimeout(350);
    }
    for (const [axis, name] of [['beta', 'Y sideways'], ['gamma', 'Z screen-up']]) {
      await practice();
      const beforeHits = await playerHits();
      const started = Date.now();
      await setPattern(controller, axis);
      await game.waitForFunction(() => Number(document.getElementById('tt-you').textContent) >= 3, null, {timeout: 45000});
      await setPattern(controller);
      const afterHits = await playerHits();
      assert.ok(afterHits - beforeHits >= 3, 'successive legal returns must follow real host contacts');
      axisResults.push({axis: name, hostHits: afterHits - beforeHits, legalReturns: Number(await game.locator('#tt-you').innerText()), elapsedMs: Date.now() - started});
      pass(`${name} continuous swings make at least three real contacts and legal opponent-table returns without a still-hand reset`);
    }

    const poseCount = () => phone.evaluate(() => window.__bridge.filter(message => message.type === 'wee:player-pose').length);
    await setPattern(controller); await visibility(controller, true); await phone.waitForTimeout(100);
    const hiddenCount = await poseCount(); await phone.waitForTimeout(300);
    assert.equal(await poseCount(), hiddenCount);
    await visibility(controller, false);
    await phone.waitForFunction(count => window.__bridge.filter(message => message.type === 'wee:player-pose').length > count, hiddenCount);
    pass('Hidden controller stops pose delivery and foreground resumes only with fresh input');

    await controller.evaluate(() => {window.__sensor.running = false;});
    await phone.waitForTimeout(650); const stopped = await poseCount(); await phone.waitForTimeout(250);
    assert.equal(await poseCount(), stopped);
    await controller.evaluate(() => {window.__sensor.running = true;});
    await phone.waitForFunction(count => window.__bridge.filter(message => message.type === 'wee:player-pose').length > count, stopped);
    pass('Sensor silence cancels delivery and fresh neutral samples recover without another permission prompt');

    await controller.locator('#tt-match-phone').click();
    await game.getByText('First to 12 · win by 2', {exact: true}).waitFor();
    pass('The same controller can enter the twelve-point bot game');
    assert.deepEqual(errors, []); pass('No uncaught browser errors');
    if (process.env.WEE_SMOKE_SCREENSHOT) await host.screenshot({path: process.env.WEE_SMOKE_SCREENSHOT});
    const report = {recordedAt: new Date().toISOString(), base, runtime: process.version, browser: browser.version(),
      rendering: 'headless Chromium software WebGL; 960x640 functional viewport',
      sensorSource: 'Generated DeviceMotion and matching DeviceOrientation at 16 ms; continuous 3 rad/s sine gestures with a 700 ms period and no rest interval',
      checks, axisResults, errors,
      limitations: ['Continuous generated gestures validate software routing/contact/return; they are not a physical recognition-accuracy or latency benchmark.',
        'No physical phone sensors, permission dialogs, grip comfort, haptics or full bot match are established.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
      for (const frame of page.frames().slice(1)) console.error('FRAME_STATE', frame.url(), await frame.locator('body').innerText().catch(() => 'unavailable'));
      console.error('RECENT_FEEDBACK', await page.evaluate(() => (window.__gameFeedback || window.__bridge || []).slice(-12)).catch(() => []));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
