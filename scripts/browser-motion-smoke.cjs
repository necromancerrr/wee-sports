// Deterministic sensor events in real browser controllers and authenticated rooms.
// This validates software behavior, not phone hardware, permissions UI or latency.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5180';

async function sensorContext(browser, permission = 'granted', samples = true) {
  const context = await browser.newContext({ viewport: { width: 430, height: 1000 } });
  await context.addInitScript(({permission, samples}) => {
    window.__permissionCalls = [];
    window.__bridge = [];
    window.__sensor = {running: samples, hidden: false, rate: {alpha: 0, beta: 0, gamma: 0},
      orientation: {alpha: 0, beta: 0, gamma: 0}, gravity:{x:0,y:0,z:9.80665}, acceleration:{x:0,y:0,z:0}};
    window.__sensorSamples = [];
    const ask = name => {
      window.__permissionCalls.push({name, active: navigator.userActivation.isActive});
      return Promise.resolve(permission);
    };
    Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: class {
      static requestPermission() {return ask('motion');}
    }});
    Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: class {
      static requestPermission() {return ask('orientation');}
    }});
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => window.__sensor.hidden});
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => window.__sensor.hidden ? 'hidden' : 'visible'});
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.type?.startsWith('wee:')) {
        window.__bridge.push({...event.data, receivedAt: performance.now()});
        if (window.__bridge.length > 3000) window.__bridge.shift();
      }
    });
    setInterval(() => {
      if (permission !== 'granted' || !window.__sensor.running) return;
      window.__sensorSamples.push({at: performance.now(), hidden: document.hidden, ...window.__sensor.rate});
      if (window.__sensorSamples.length > 100) window.__sensorSamples.shift();
      const motion = new Event('devicemotion');
      const {gravity, acceleration} = window.__sensor;
      Object.assign(motion, {rotationRate: {...window.__sensor.rate}, acceleration:{...acceleration},
        accelerationIncludingGravity:{x:gravity.x+acceleration.x,y:gravity.y+acceleration.y,z:gravity.z+acceleration.z}, interval:16});
      window.dispatchEvent(motion);
      const orientation = new Event('deviceorientation');
      Object.assign(orientation, window.__sensor.orientation);
      window.dispatchEvent(orientation);
    }, 16);
  }, {permission, samples});
  return context;
}

async function setRate(frame, alpha = 0, beta = 0, gamma = 0) {
  await frame.evaluate(rate => {window.__sensor.rate = rate;}, {alpha, beta, gamma});
}
async function segment(page, frame, milliseconds, alpha = 0, beta = 0, gamma = 0) {
  await setRate(frame, alpha, beta, gamma);
  await page.waitForTimeout(milliseconds);
}
async function hidden(frame, value) {
  const applied = await frame.evaluate(value => {
    window.__sensor.hidden = value;
    // Make the simulated visibility state explicit on the current document.
    Object.defineProperty(document, 'hidden', {configurable: true, value});
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: value ? 'hidden' : 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
    return {requested: value, hidden: document.hidden, sensorHidden: window.__sensor.hidden, timeOrigin: performance.timeOrigin};
  }, value);
  assert.equal(applied.hidden, value, 'visibility test must change the current document');
}
const rolls = page => page.evaluate(() => window.__bridge.filter(message => message.type === 'wee:player-roll').map(message => message.event));
async function createGame(browser, permission, sport = 'Bowling', errors = [], samples = true, hold = false) {
  const hostContext = await browser.newContext({viewport: {width: 1280, height: 900}});
  const phoneContext = await sensorContext(browser, permission, samples);
  const host = await hostContext.newPage(), phone = await phoneContext.newPage();
  host.on('pageerror', error => errors.push('host: ' + error.message));
  phone.on('pageerror', error => errors.push('phone: ' + error.message));
  await host.goto(base + '/home');
  await host.getByRole('button', {name: `Play: ${sport}`, exact: true}).click();
  const code = await host.getByTestId('lobby-code').innerText();
  await phone.goto(`${base}/join?code=${code}`);
  await phone.getByRole('button', {name: 'Play', exact: true}).click();
  if (hold) {
    await phone.getByRole('button', {name: 'Start game', exact: true}).waitFor();
    await phone.waitForTimeout(5500);
    await host.locator('.host-lobby').getByRole('heading', {name: sport, exact: true}).waitFor();
  }
  await phone.getByRole('button', {name: 'Start game', exact: true}).click();
  await phone.getByRole('button', {name:'Start now', exact:true}).click();
  await host.locator(`iframe[title="${sport} game"]`).waitFor({timeout: 20000});
  const frame = phone.frames().find(frame => frame.url().includes(sport === 'Bowling' ? '/controller.html' : '/table-tennis-controller.html'));
  assert.ok(frame, 'controller iframe has loaded');
  return {hostContext, phoneContext, host, phone, frame, code};
}
async function returnToLobby(host) {
  await host.getByLabel('TV display controls').click();
  await host.getByRole('button', {name: 'Return to lobby', exact: true}).click();
  await host.getByRole('button', {name: 'End match and return', exact: true}).click();
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const errors = [], checks = [];
  const pass = text => {checks.push(text); console.log('PASS:', text);};
  try {
    const {host, phone, frame, code} = await createGame(browser, 'granted', 'Bowling', errors);
    const calls = await phone.evaluate(() => window.__permissionCalls);
    assert.deepEqual(calls.map(call => call.name), ['motion', 'orientation']);
    assert.ok(calls.every(call => call.active), 'permission requests run inside the Play gesture');
    assert.deepEqual(await frame.evaluate(() => window.__permissionCalls), [], 'iframe reuses granted access');
    assert.equal(await phone.getByRole('button', {name: 'Ready', exact: true}).count(), 0);
    await frame.getByText('Swing forward to bowl', {exact: true}).waitFor();
    pass('Play requests sensors during user activation, then the leader starts bowling without setup, Ready or Arm buttons');
    const game = host.frames().find(frame => frame.url().includes('/bowling.html'));
    await game.evaluate(() => {
      window.__rollInputs = [];
      window.addEventListener('message', event => {if (event.data?.type === 'wee:game-roll') window.__rollInputs.push(event.data.event);});
    });
    for (const direction of [1, -1]) {
      await frame.evaluate(direction => {
        window.__sensor.gravity = {x:-direction * 4.903325,y:0,z:8.492808};
        window.__sensor.acceleration = {x:8,y:0,z:0};
        window.__sensor.rate = {alpha:0,beta:direction*300,gamma:0};
      }, direction);
      await game.waitForFunction(direction => {
        const aim = Number(document.getElementById('aim').value);
        return aim * direction > .72 && document.getElementById('aim-state').textContent === 'Live';
      }, direction);
    }
    assert.equal((await rolls(phone)).length, 0, 'sideways aiming must not bowl');
    await frame.evaluate(() => {
      window.__sensor.gravity = {x:0,y:0,z:9.80665}; window.__sensor.acceleration = {x:0,y:0,z:0};
      window.__sensor.rate = {alpha:0,beta:0,gamma:0};
    });
    await game.waitForFunction(() => Math.abs(Number(document.getElementById('aim').value)) < .08);
    pass('Fast sideways aim reaches the real TV guide in both directions despite hand acceleration, without releasing a ball');
    await segment(phone, frame, 600);
    await segment(phone, frame, 160, 400, 150);
    await hidden(frame, true);
    assert.equal(await frame.evaluate(() => document.hidden), true);
    await segment(phone, frame, 180, 20, 150);
    assert.equal((await rolls(phone)).length, 0, 'initial hidden partial swing must be discarded');
    await setRate(frame);
    await hidden(frame, false);
    await segment(phone, frame, 650);
    await segment(phone, frame, 300, -400, 150);
    await segment(phone, frame, 300);
    assert.equal((await rolls(phone)).length, 0);
    pass('A backswing and return to rest do not release a bowling ball');
    await segment(phone, frame, 350, 400, 150);
    await segment(phone, frame, 160, 20, 150);
    await segment(phone, frame, 200);
    await phone.waitForFunction(() => window.__bridge.filter(message => message.type === 'wee:player-roll').length === 1);
    const first = (await rolls(phone))[0];
    assert.ok(first.spin > 0 && first.spin <= .55, 'deliberate positive wrist twist curves right');
    assert.ok(first.power > 0 && first.power <= 1, 'bounded game power');
    await game.waitForFunction(() => window.__rollInputs.length === 1);
    await segment(phone, frame, 300, 400, -150);
    await segment(phone, frame, 160, 20, -150);
    await segment(phone, frame, 200);
    assert.equal((await rolls(phone)).length, 1, 'one release remains latched while the ball is in flight');
    pass('A forward swing and wrist twist produce one bounded, authenticated roll; extra motion cannot duplicate it');
    // Software WebGL can advance the bounded physics clock slowly; this check
    // verifies a settled turn, not real-phone frame rate or latency.
    await frame.getByText('Swing forward to bowl', {exact: true}).waitFor({timeout: 60000});
    await segment(phone, frame, 600);
    await segment(phone, frame, 160, 400, 150);
    await hidden(frame, true);
    await segment(phone, frame, 180, 20, 150);
    assert.equal((await rolls(phone)).length, 1);
    await setRate(frame);
    await hidden(frame, false);
    await segment(phone, frame, 650);
    assert.equal((await rolls(phone)).length, 1, 'foreground does not finish the interrupted swing');
    pass('Backgrounding cancels an unfinished swing and foreground requires fresh motion, without another permission prompt');
    await segment(phone, frame, 180, 400, -150);
    await frame.evaluate(() => {window.__sensor.running = false;});
    await phone.waitForTimeout(450);
    await setRate(frame);
    await frame.evaluate(() => {window.__sensor.running = true;});
    await segment(phone, frame, 650);
    assert.equal((await rolls(phone)).length, 1, 'sensor silence cannot finish an old swing');
    await segment(phone, frame, 350, 400, -150);
    await segment(phone, frame, 160, 20, -150);
    await segment(phone, frame, 200);
    await phone.waitForFunction(() => window.__bridge.filter(message => message.type === 'wee:player-roll').length === 2);
    assert.ok((await rolls(phone))[1].spin < 0, 'opposite wrist twist curves left');
    pass('Sensor gaps discard partial deliveries; a fresh opposite wrist turn produces the opposite curve');
    await frame.getByText('Swing forward to bowl', {exact: true}).waitFor({timeout: 60000});
    await returnToLobby(host);
    if (!await phone.locator('.phone-session__options').evaluate(node=>node.open)) await phone.locator('.phone-session__options > summary').click();
    if (!await phone.getByLabel('Next sport',{exact:true}).isVisible()) await phone.getByText('Change sport',{exact:true}).click();
    await phone.getByLabel('Next sport', {exact: true}).selectOption('table-tennis');
    await phone.getByRole('button', {name: 'Start game', exact: true}).click();
    await phone.getByRole('button', {name:'Start now', exact:true}).click();
    await host.locator('iframe[title="Table Tennis game"]').waitFor({timeout: 20000});
    const paddle = phone.frames().find(frame => frame.url().includes('/table-tennis-controller.html'));
    assert.ok(paddle);
    await phone.waitForFunction(() => window.__bridge.some(message => message.type === 'wee:player-pose'));
    assert.deepEqual(await paddle.evaluate(() => window.__permissionCalls), [], 'sport switch reuses sensor permission');
    const poseCount = () => phone.evaluate(() => window.__bridge.filter(message => message.type === 'wee:player-pose').length);
    await hidden(paddle, true);
    await phone.waitForTimeout(100);
    const held = await poseCount();
    await phone.waitForTimeout(300);
    assert.equal(await poseCount(), held, 'hidden paddle sends no poses');
    await hidden(paddle, false);
    await phone.waitForFunction(count => window.__bridge.filter(message => message.type === 'wee:player-pose').length > count, held);
    pass('The phone switches sports, starts table tennis and routes fresh sensors across visibility changes');
    await paddle.locator('#tt-use-touch').click();
    await paddle.locator('#tt-touchpad').waitFor();
    await paddle.locator('#tt-touch-stroke').click();
    pass('Touch controls remain one tap away during motion play');
    if (process.env.WEE_SMOKE_SCREENSHOT) await phone.screenshot({path: process.env.WEE_SMOKE_SCREENSHOT});
    await returnToLobby(host);
    await host.getByRole('button', {name: 'Close lobby', exact: true}).click();
    await host.context().close();
    await phone.context().close();
    const denied = await createGame(browser, 'denied', 'Bowling', errors, true, true);
    await denied.frame.getByRole('button', {name: 'Roll', exact: true}).waitFor();
    assert.equal(await denied.phone.getByRole('button', {name: 'Ready', exact: true}).count(), 0);
    assert.equal((await denied.phone.evaluate(() => window.__permissionCalls)).length, 2);
    pass('Denied sensor access falls back automatically to playable touch controls');
    pass('The lobby waits for the first phone to choose Start game');
    await returnToLobby(denied.host);
    await denied.host.getByRole('button', {name: 'Close lobby', exact: true}).click();
    await denied.hostContext.close();
    await denied.phoneContext.close();
    const silent = await createGame(browser, 'granted', 'Bowling', errors, false);
    await silent.frame.getByRole('button', {name: 'Roll', exact: true}).waitFor();
    assert.equal(await silent.phone.evaluate(() => window.__bridge.some(message => message.type === 'wee:controller-setup' && message.setup === 'motion')), false,
      'permission alone must never claim working motion');
    pass('Granted permission without real gyro readings falls back to touch instead of leaving the player in setup');
    await returnToLobby(silent.host);
    await silent.host.getByRole('button', {name: 'Close lobby', exact: true}).click();
    assert.deepEqual(errors, []);
    pass('No uncaught page errors');
    const report = {recordedAt: new Date().toISOString(), base, runtime: process.version, browser: browser.version(),
      sensorSource: 'Deterministic synthetic DeviceMotion/DeviceOrientation events at 16 ms in browser pages', checks, errors,
      limitations: ['Sensor permission API is mocked; real iOS/Android permission dialogs are not tested.',
        'No physical phone axis/grip quality, haptics, motion-to-display timing or full game acceptance is established.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const [contextIndex, context] of browser.contexts().entries()) {
      for (const [pageIndex, page] of context.pages().entries()) {
        console.error('PAGE_STATE', contextIndex, pageIndex, page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
        for (const frame of page.frames().slice(1)) {
          console.error('FRAME_STATE', frame.url(), await frame.locator('body').innerText().catch(() => 'unavailable'));
          console.error('SENSOR_SAMPLES', await frame.evaluate(() => window.__sensorSamples).catch(() => []));
        }
        console.error('RECENT_BRIDGE', await page.evaluate(() => window.__bridge?.slice(-12)).catch(() => []));
      }
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
