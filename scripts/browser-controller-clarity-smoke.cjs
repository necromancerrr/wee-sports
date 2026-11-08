// Production browser checks for the visible TV menu, large phone return actions,
// restrained lobby decoration and short tennis scoring. Synthetic touch devices.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5210';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;

async function primaryTarget(locator) {
  await locator.waitFor();
  const page = locator.page(), height = page.viewportSize().height;
  let box, insideFrame = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    box = await locator.boundingBox();
    insideFrame = await locator.evaluate(node => {
      const frame = node.ownerDocument.defaultView.frameElement;
      if (!frame) return true;
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= frame.clientHeight;
    });
    if (box && box.y >= 0 && box.y + box.height <= height && insideFrame) break;
    await page.waitForTimeout(50);
  }
  assert.ok(box && box.height >= 52 && box.width >= 180,
    `Back to play should be a large primary action: ${JSON.stringify(box)}`);
  assert.ok(box.y >= 0 && box.y + box.height <= height,
    `Back to play should be on screen when settings open: ${JSON.stringify(box)}`);
  assert.ok(insideFrame, 'Back to play must fit inside the resized controller iframe without clipping');
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const checks = [], errors = [];
  const pass = message => {checks.push(message); console.log('PASS:', message);};
  async function capture(page, name) {
    if (!shots) return;
    mkdirSync(shots, {recursive: true});
    await page.evaluate(() => document.fonts.ready);
    // Let the browser repaint nested iframe tiles after parent scrolling.
    await page.waitForTimeout(250);
    await page.screenshot({path: join(shots, name + '.png')});
  }
  try {
    for (const [sport, id] of [['Bowling', 'bowling'], ['Table Tennis', 'table-tennis'], ['Tennis', 'tennis']]) {
      if (process.env.WEE_SMOKE_SPORT && process.env.WEE_SMOKE_SPORT !== id) continue;
      const context = await browser.newContext({viewport: {width: 1280, height: 800}, colorScheme: 'dark', reducedMotion: 'reduce'});
      const phoneContext = await browser.newContext({viewport: {width: 390, height: 844}, colorScheme: 'dark'});
      await phoneContext.addInitScript(() => {
        Object.defineProperty(window, 'DeviceMotionEvent', {value: undefined, configurable: true});
        Object.defineProperty(window, 'DeviceOrientationEvent', {value: undefined, configurable: true});
      });
      const host = await context.newPage(), phone = await phoneContext.newPage();
      for (const page of [host, phone]) page.on('pageerror', error => errors.push(error.message));
      // Show a readable QR in TV screenshots without redirecting the local test phone.
      await host.route('**/api/phone-link', route => route.fulfill({json: {origin: 'https://controller.example.test', status: 'ready'}}));
      await host.goto(base + '/home');
      await host.getByRole('button', {name: `Play: ${sport}`, exact: true}).click();
      const code = await host.getByTestId('lobby-code').innerText();
      const backdrop = host.locator('.host-lobby__backdrop');
      assert.equal(await backdrop.getAttribute('aria-hidden'), 'true');
      assert.equal(await backdrop.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
      for (const size of [{width: 1280, height: 800}, {width: 800, height: 600}]) {
        await host.setViewportSize(size);
        assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'lobby fits the display');
        await capture(host, `${id}-lobby-${size.width}`);
      }
      assert.ok(await host.locator('.host-lobby__mark').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none')));
      await host.setViewportSize({width: 1280, height: 800});
      await phone.goto(`${base}/join?code=${code}`);
      await phone.getByRole('button', {name: 'Scan TV code', exact: true}).waitFor();
      await phone.getByRole('button', {name: 'Play', exact: true}).click();
      await phone.getByRole('button', {name: 'Start game', exact: true}).click();
      await host.locator(`iframe[title="${sport} game"]`).waitFor({timeout: 20000});
      const controller = phone.frameLocator(`iframe[title="${sport} phone controller"]`);
      await controller.locator(id === 'bowling' ? '#roll' : id === 'tennis' ? '#forehand' : '#tt-touch-stroke').waitFor();
      await host.mouse.move(10, 790);
      const display = host.getByLabel('TV display controls', {exact: true});
      const menuStyle = await display.evaluate(node => ({opacity: getComputedStyle(node).opacity, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height}));
      assert.equal(Number(menuStyle.opacity), 1, 'TV menu is visible without hover');
      assert.ok(menuStyle.width >= 44 && menuStyle.height >= 44, 'TV menu has a large target');
      await display.click();
      await host.getByRole('button', {name: 'Pause game · P', exact: true}).click();
      await host.getByRole('button', {name: 'Resume game · P', exact: true}).click();
      await display.click();
      await phone.getByRole('button', {name: 'Game options', exact: true}).click();
      const done = phone.getByRole('dialog').getByRole('button', {name: 'Back to play', exact: true});
      await primaryTarget(done);
      await capture(phone, `${id}-phone-game-options`);
      await done.click();
      if (id !== 'table-tennis') {
        await controller.locator('#toggle-settings').click();
        const back = controller.getByRole('button', {name: 'Back to play', exact: true});
        await primaryTarget(back);
        await capture(phone, `${id}-phone-motion-settings`);
        await back.click();
      } else {
        await controller.locator('#tt-options summary').click();
        const back = controller.getByRole('button', {name: 'Back to play', exact: true});
        await primaryTarget(back);
        await capture(phone, 'table-tennis-phone-motion-settings');
        await back.click();
      }
      assert.equal(await host.getByText('Progress saved.', {exact: true}).count(), 0);
      if (id === 'tennis') {
        const game = host.frameLocator('iframe[title="Tennis game"]');
        await game.getByText('First to 7 · win by 2', {exact: true}).waitFor();
        assert.equal(await game.getByText(/^Games \d/).count(), 0);
      }
      await capture(host, `${id}-game`);
      await capture(phone, `${id}-phone-play`);
      pass(`${sport}: responsive decorated lobby, discoverable scanner, visible working TV menu and large phone return actions`);
      await phoneContext.close(); await context.close();
    }
    assert.deepEqual(errors, []);
    pass('No uncaught browser errors');
    const report = {recordedAt: new Date().toISOString(), base, checks, errors,
      limitations: ['Touch-mode browser contexts, not physical phones.', 'Only the host QR origin response is mocked for screenshots; room transport and gameplay use the real local server.', 'Set scoring and announcements are covered separately by game tests.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
      for (const frame of page.frames().slice(1)) console.error('FRAME_STATE', frame.url(), await frame.locator('body').innerText().catch(() => 'unavailable'));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
