// Run against a disposable production server. Camera frames are generated QR
// images, but decoding, routing and the room behind the QR are real.
const {chromium, devices} = require('playwright');
const qr = require('qrcode-generator');
const assert = require('node:assert/strict');
const {writeFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5198';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;

function installCamera({matrix}) {
  const state = window.__camera = {calls: 0, detected: 0, sensors: 0, mode: 'blank', tracks: []};
  Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true,
    value: class {static requestPermission() {state.sensors++; return Promise.resolve('granted');}}});
  Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true,
    value: class {static requestPermission() {state.sensors++; return Promise.resolve('granted');}}});
  Object.defineProperty(window, 'BarcodeDetector', {configurable: true, value: class {
    async detect() {
      state.detected++;
      if (state.mode === 'qr') throw new Error('Video decoding unsupported; exercise jsQR fallback');
      return state.mode === 'invalid' ? [{rawValue: 'https://example.com/unrelated'}] : [];
    }
  }});
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable: true, value: async () => {
    state.calls++;
    if (state.mode === 'denied') throw new DOMException('Denied by user', 'NotAllowedError');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 512, 512);
    if (state.mode === 'qr') {
      ctx.fillStyle = 'black';
      const cell = Math.floor(448 / matrix.length), offset = Math.floor((512 - matrix.length * cell) / 2);
      matrix.forEach((row, y) => row.forEach((dark, x) => {
        if (dark) ctx.fillRect(offset + x * cell, offset + y * cell, cell, cell);
      }));
    }
    const stream = canvas.captureStream(10);
    state.tracks.push(...stream.getTracks());
    // Keep a source frame available after the video element starts playback.
    const redraw = setInterval(() => {ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1);}, 100);
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => {clearInterval(redraw); stop();};
    }
    if (state.mode === 'pending') return new Promise(resolve => {state.release = () => resolve(stream);});
    return stream;
  }});
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const checks = [], errors = [];
  const pass = value => {checks.push(value); console.log('PASS:', value);};
  const screenshot = async (page, name) => {
    if (!shots) return;
    mkdirSync(shots, {recursive: true});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path: join(shots, name + '.png'), scale: 'css'});
  };
  const stopped = page => page.waitForFunction(() => window.__camera.tracks.every(track => track.readyState === 'ended'));
  try {
    const host = await browser.newPage({viewport: {width: 1672, height: 941}});
    host.on('pageerror', error => errors.push(error.message));
    await host.goto(base + '/home');
    await host.getByRole('button', {name: 'Play: Tennis', exact: true}).click();
    const code = await host.getByTestId('lobby-code').innerText();
    const encoded = qr(0, 'M'); encoded.addData(`${base}/join?code=${code}`); encoded.make();
    const matrix = Array.from({length: encoded.getModuleCount()}, (_, y) =>
      Array.from({length: encoded.getModuleCount()}, (_, x) => encoded.isDark(y, x)));

    for (const [name, config] of [
      ['iphone', devices['iPhone 13']], ['android', devices['Pixel 7']],
      ['ipad-desktop-agent', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        viewport: {width: 1024, height: 1366}, hasTouch: true}],
    ]) {
      const context = await browser.newContext({...config, colorScheme: 'light'});
      if (name === 'ipad-desktop-agent') await context.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', {configurable: true, value: 'MacIntel'});
        Object.defineProperty(navigator, 'maxTouchPoints', {configurable: true, value: 5});
      });
      await context.addInitScript(installCamera, {matrix});
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(name + ': ' + error.message));
      const assets = [], creates = [];
      page.on('request', request => {if (request.url().includes('/island/')) assets.push(request.url());});
      page.on('websocket', socket => socket.on('framesent', frame => {
        if (String(frame.payload).includes('host:create')) creates.push(frame.payload);
      }));
      for (const path of ['/', '/home']) {
        await page.goto(base + path);
        await page.getByRole('button', {name: 'Scan TV code', exact: true}).waitFor();
        assert.equal(await page.locator('.island-screen').count(), 0);
        assert.deepEqual(await page.evaluate(() => [window.__camera.calls, window.__camera.sensors]), [0, 0]);
      }
      assert.deepEqual(assets, [], 'phone entry must not download island artwork');
      assert.deepEqual(creates, [], 'phone entry must not create a room');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone layout fits');
      if (name === 'iphone') {
        await screenshot(page, 'phone-controller-home');
        await page.setViewportSize({width: 844, height: 390});
        await page.getByRole('button', {name: 'Scan TV code', exact: true}).waitFor();
        assert.equal(await page.locator('[data-display-role="remote"]').count(), 1);
        await screenshot(page, 'phone-controller-landscape');
      }
      await context.close();
    }
    pass('iPhone, Android and iPad open the controller hub at / and /home, including landscape, without island downloads or permissions');

    const context = await browser.newContext({...devices['iPhone 13'], colorScheme: 'light'});
    await context.addInitScript(installCamera, {matrix});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/');
    await page.getByRole('link', {name: 'Profile & history'}).click();
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await page.getByRole('link', {name: 'Back to controller', exact: true}).click();
    await page.getByRole('button', {name: 'Scan TV code', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Switch to dark mode'}).click();
    await screenshot(page, 'phone-controller-dark');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('button', {name: 'Switch to light mode'}).click();
    pass('Profile returns to the phone hub and appearance persists');

    await page.locator('.remote-manual > summary').click();
    await page.getByLabel('Lobby code', {exact: true}).fill(code.toLowerCase());
    await page.getByRole('button', {name: 'Join', exact: true}).click();
    await page.waitForURL(`**/join?code=${code}`);
    await page.getByRole('button', {name: 'Play', exact: true}).waitFor();
    await page.reload();
    await page.getByRole('button', {name: 'Play', exact: true}).waitFor();
    assert.equal(await page.locator('.remote-home').count(), 0);
    assert.deepEqual(await page.evaluate(() => [window.__camera.calls, window.__camera.sensors]), [0, 0]);
    pass('Manual entry and direct QR links reach the real controller Play screen and refresh without another entry screen');

    await page.goto(base + '/');
    const scan = page.getByRole('button', {name: 'Scan TV code', exact: true});
    await scan.click();
    await page.getByRole('status').filter({hasText: 'Point at the QR code on your TV.'}).waitFor();
    await page.keyboard.press('Escape');
    await stopped(page);
    assert.equal(await scan.evaluate(element => document.activeElement === element), true);
    pass('Escape closes the scanner, stops camera tracks and restores focus');

    await page.evaluate(() => {window.__camera.mode = 'pending';});
    await scan.click();
    await page.waitForFunction(() => !!window.__camera.release);
    await page.getByRole('button', {name: 'Close scanner', exact: true}).click();
    await page.getByRole('dialog').waitFor({state: 'hidden'});
    await page.evaluate(() => window.__camera.release());
    await stopped(page);
    pass('Closing while camera permission is pending also stops a stream granted afterwards');

    await page.evaluate(() => {window.__camera.mode = 'denied';});
    await scan.click();
    await page.getByRole('status').filter({hasText: 'Camera access is off.'}).waitFor();
    await page.getByRole('dialog').getByLabel('Lobby code', {exact: true}).waitFor();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await stopped(page);
    await page.getByRole('button', {name: 'Close scanner', exact: true}).click();
    pass('Denied camera permission keeps a manual code fallback in the scanner without navigation');

    await page.evaluate(() => {window.__camera.mode = 'invalid';});
    await scan.click();
    await page.getByRole('status').filter({hasText: 'Use the Wee Sports QR code on your TV.'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await stopped(page);
    await page.getByRole('dialog').waitFor({state: 'hidden'});
    await page.evaluate(() => {delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));});
    pass('Unrelated QR codes do not navigate; hiding the page shuts down scanning');

    await page.evaluate(() => {window.__camera.mode = 'qr';});
    await scan.click();
    await page.waitForURL(`**/join?code=${code}`);
    await page.getByRole('button', {name: 'Play', exact: true}).waitFor();
    await stopped(page);
    assert.ok(await page.evaluate(() => window.__camera.detected > 0));
    assert.equal(await page.evaluate(() => window.__camera.sensors), 0);
    pass('An actual QR image decodes through jsQR after native detection fails, opens the real room and releases the camera');

    await page.evaluate(() => {window.__camera.mode = 'blank';});
    assert.equal(await page.getByRole('button', {name: 'Scan TV code', exact: true}).count(), 0,
      'a recognized room keeps joining focused on the playing name; scanning another TV is available after joining');
    assert.equal(new URL(page.url()).searchParams.get('code'), code);
    await page.getByLabel('Your playing name', {exact: true}).fill('Player');
    await page.getByRole('button', {name: 'Play', exact: true}).click();
    await page.locator('.you').waitFor();
    const more = page.locator('.phone-session__options');
    if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click();
    const another = page.getByRole('button', {name: 'Scan another TV', exact: true});
    await another.click();
    await page.getByRole('status').filter({hasText: 'Point at the QR code on your TV.'}).waitFor();
    await page.getByRole('button', {name: 'Close scanner', exact: true}).click();
    await stopped(page);
    assert.equal(await host.locator('ul[aria-label="Joined players"] .ready-card').count(), 1);
    await page.evaluate(() => {window.__camera.mode = 'qr';});
    await another.click();
    await page.getByRole('dialog').waitFor({state: 'hidden'});
    await stopped(page);
    assert.equal(await host.locator('ul[aria-label="Joined players"] .ready-card').count(), 1);
    pass('Controller Tools expose scanning; canceling and scanning the current TV preserve the connected seat');

    const nextHost = await browser.newPage({viewport: {width: 960, height: 640}});
    await nextHost.goto(base + '/home');
    await nextHost.getByRole('button', {name: 'Play: Bowling', exact: true}).click();
    const nextCode = await nextHost.getByTestId('lobby-code').innerText();
    await page.evaluate(() => {window.__camera.mode = 'denied';});
    await another.click();
    const scanner = page.getByRole('dialog');
    await scanner.getByLabel('Lobby code', {exact: true}).fill(nextCode);
    await scanner.getByRole('button', {name: 'Use code', exact: true}).click();
    await scanner.getByRole('button', {name: 'Leave and join', exact: true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('code'), code);
    assert.equal(await host.locator('ul[aria-label="Joined players"] .ready-card').count(), 1);
    await scanner.getByRole('button', {name: 'Keep playing', exact: true}).click();
    assert.equal(await page.locator('.you').count(), 1);
    await another.click();
    await scanner.getByLabel('Lobby code', {exact: true}).fill(nextCode);
    await scanner.getByRole('button', {name: 'Use code', exact: true}).click();
    await scanner.getByRole('button', {name: 'Leave and join', exact: true}).click();
    await page.waitForURL(`**/join?code=${nextCode}`);
    await page.getByRole('button', {name: 'Play', exact: true}).waitFor();
    await host.locator('ul[aria-label="Joined players"]').waitFor({state: 'hidden'});
    await stopped(page);
    await nextHost.getByRole('button', {name: 'Close lobby', exact: true}).click();
    await nextHost.close();
    pass('Another room requires explicit Leave and join; cancellation keeps the current seat and acceptance releases it');

    // A read-only profile fixture exposes the saved-game controls without
    // fabricating a scored match in this camera/routing test.
    await page.route('**/api/profile**', route => {
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith('/recovery') ? {matches: [{matchId: 'saved-example', sport: 'bowling', playerName: 'Player', savedAt: Date.now()}]}
        : path.endsWith('/history') ? {history: []} : {profile: {username: 'remote_example', displayName: 'Player', avatar: 'ball', revision: 1,
          preferences: {hand: 'Right', sensitivity: 1, assistance: 'friendly', sound: true, haptics: true, reducedMotion: false, touchControls: false}}};
      return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
    });
    await page.goto(base + '/profile');
    await page.getByRole('heading', {name: 'Continue a solo game', exact: true}).waitFor();
    await page.getByLabel('Display name', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Continue on this screen', exact: true}).count(), 0);
    await page.getByRole('link', {name: 'Back to controller', exact: true}).click();
    await scan.waitFor();
    pass('Phone profiles keep preferences and saved-game information without offering a TV-host action');
    await context.close();
    await host.getByRole('button', {name: 'Close lobby', exact: true}).click();
    await host.close();
    assert.deepEqual(errors, []);
    pass('No uncaught browser errors');
    const report = {recordedAt: new Date().toISOString(), base, browser: browser.version(), checks, errors,
      limitations: ['Device user agents and camera frames are simulated in Chromium; physical Safari/Android camera permissions and focus require device testing.',
        'Room creation, join routing, portable QR decoding and camera-track cleanup execute the production app.',
        'The phone saved-game profile is a read-only API fixture; separate platform tests cover real profile persistence and TV recovery.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
