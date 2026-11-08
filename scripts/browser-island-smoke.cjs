// Production island UI, routing and real room creation. Requires a disposable
// server, Playwright and Chromium. One rejected ack is simulated at the wire.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {writeFileSync, mkdirSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5198';
const shots = process.env.WEE_SMOKE_SCREENSHOTS;
const sports = ['Tennis', 'Bowling', 'Table Tennis'];
const ids = {'Tennis': 'tennis', 'Bowling': 'bowling', 'Table Tennis': 'table-tennis'};

function eventFrame(message) {
  const match = String(message).match(/^42(\d*)(\[.*)$/s);
  if (!match) return null;
  try {return {ack: match[1], event: JSON.parse(match[2])};} catch {return null;}
}
function observeRoomRequests(page) {
  const requests = [];
  page.on('websocket', ws => ws.on('framesent', frame => {
    const packet = eventFrame(frame.payload);
    if (packet?.event[0] === 'host:create') requests.push(packet.event[1]);
  }));
  return requests;
}
async function loadedArt(page) {
  await page.getByTestId('island-background').waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="island-background"]');
    return image?.complete && image.naturalWidth > 1000 && image.getBoundingClientRect().width > 0 &&
      image.closest('[data-image-state]')?.dataset.imageState === 'ready' && Number(getComputedStyle(image).opacity) === 1;
  });
}
async function screenshot(page, name) {
  if (!shots) return;
  mkdirSync(shots, {recursive: true});
  await page.screenshot({path: join(shots, name + '.png'), animations: 'disabled'});
}
async function enabledSport(page, name) {
  const button = page.getByRole('button', {name: `Play: ${name}`, exact: true});
  await button.waitFor();
  await page.waitForFunction(name => [...document.querySelectorAll('button')]
    .some(button => button.getAttribute('aria-label') === `Play: ${name}` && !button.disabled), name);
  return button;
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page must not overflow horizontally');
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const checks = [], errors = [], layouts = [];
  const pass = value => {checks.push(value); console.log('PASS:', value);};
  try {
    const context = await browser.newContext({viewport: {width: 1672, height: 941}, colorScheme: 'light'});
    await context.addInitScript(() => {
      window.__entryEffects = {permission: 0, fullscreen: 0};
      const permission = () => {window.__entryEffects.permission++; return Promise.resolve('granted');};
      Object.defineProperty(window, 'DeviceMotionEvent', {configurable: true, value: class {static requestPermission() {return permission();}}});
      Object.defineProperty(window, 'DeviceOrientationEvent', {configurable: true, value: class {static requestPermission() {return permission();}}});
      Element.prototype.requestFullscreen = async () => {window.__entryEffects.fullscreen++;};
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const creates = observeRoomRequests(page);
    let response = await page.goto(base + '/');
    assert.equal(response.status(), 200);
    await loadedArt(page);
    assert.equal(await page.getByRole('heading', {name: 'Wee Sports', exact: true}).count(), 1);
    assert.equal(await page.getByRole('button', {name: /^Play:/}).count(), 0);
    await screenshot(page, 'island-landing-1672');
    await page.getByRole('link', {name: 'Play', exact: true}).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/home');
    await loadedArt(page);
    await enabledSport(page, 'Tennis');
    assert.equal(creates.length, 0, 'landing and map navigation must not create a lobby');
    assert.deepEqual(await page.evaluate(() => window.__entryEffects), {permission: 0, fullscreen: 0});
    pass('Landing Play supports keyboard navigation and opens the island without room creation, sensors or fullscreen');
    await page.reload(); await loadedArt(page); await enabledSport(page, 'Tennis');
    assert.equal(new URL(page.url()).pathname, '/home');
    pass('Production /home opens and refreshes directly');

    const golf = page.getByText('Coming soon', {exact: true});
    assert.ok(await golf.count() >= 1);
    const beforeGolf = creates.length;
    await golf.first().click();
    assert.equal(creates.length, beforeGolf);
    assert.equal(new URL(page.url()).pathname, '/home');
    pass('Golf remains informational and does not request a room');

    for (const viewport of [{width: 1672, height: 941}, {width: 3840, height: 2160},
      {width: 2560, height: 1080}, {width: 3840, height: 1080}, {width: 1024, height: 768}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await noOverflow(page);
      const scenery = await page.getByTestId('island-background').boundingBox();
      const view = await page.locator('.island-scenery').boundingBox();
      assert.ok(scenery.x >= view.x - 5 && scenery.x + scenery.width <= view.x + view.width + 5, 'whole island fits horizontally');
      assert.ok(scenery.y >= view.y - 5 && scenery.y + scenery.height <= view.y + view.height + 5, 'whole island fits vertically');
      const ocean = await page.locator('.island-scenery__ocean').boundingBox();
      assert.ok(ocean.x <= 0 && ocean.x + ocean.width >= viewport.width, 'ocean reaches both display edges');
      const bounds = [];
      for (const name of sports) {
        const button = await enabledSport(page, name);
        const box = await button.boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44, `${name} must have a readable touch target`);
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `${name} remains within the viewport`);
        bounds.push({name, ...box});
      }
      for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i], b = bounds[j];
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
        assert.equal(overlap, false, `${a.name} and ${b.name} labels must not overlap`);
      }
      await page.getByRole('button', {name: 'Menu', exact: true}).click();
      await page.getByRole('dialog', {name: 'Menu', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Close menu', exact: true}).click();
      layouts.push({viewport, targets: bounds});
      if ([1672, 2560, 390].includes(viewport.width)) await screenshot(page, `island-home-${viewport.width}`);
    }
    pass('The island remains uncropped and ocean spans the width through 32:9; desktop controls also adapt to narrow windows');
    await page.setViewportSize({width: 1672, height: 941});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const baselineFont = await page.getByRole('button', {name: 'Play: Tennis', exact: true})
      .locator('.island-venue__name').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const fontSession = await context.newCDPSession(page);
    await fontSession.send('Page.enable');
    await fontSession.send('Page.setFontSizes', {fontSizes: {standard: 32, fixed: 26}});
    await page.reload(); await loadedArt(page);
    const enlargedFont = await page.getByRole('button', {name: 'Play: Tennis', exact: true})
      .locator('.island-venue__name').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(enlargedFont > baselineFont, 'browser font preference must actually enlarge the labels');
    for (const viewport of [{width: 1672, height: 941}, {width: 1920, height: 1080}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await noOverflow(page);
      for (const name of sports) {
        const button = await enabledSport(page, name);
        assert.ok(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), `${name} text remains unclipped when enlarged`);
      }
      await screenshot(page, `island-text-enlarged-${viewport.width}`);
      await page.getByRole('button', {name: 'Menu', exact: true}).click();
      await page.getByRole('dialog', {name: 'Menu', exact: true}).waitFor();
      await noOverflow(page);
      await page.getByRole('button', {name: 'Close menu', exact: true}).click();
      const games = page.getByRole('button', {name: 'Games', exact: true});
      if (await games.isVisible()) {
        await games.click();
        const dialog = page.getByRole('dialog', {name: 'Games', exact: true});
        await dialog.waitFor();
        for (const name of sports) {
          const button = dialog.getByRole('button', {name: `Play: ${name}`, exact: true});
          assert.ok(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'enlarged Games entries remain unclipped');
        }
        await screenshot(page, `island-games-enlarged-${viewport.width}`);
        await page.keyboard.press('Escape');
      }
    }
    await fontSession.send('Page.setFontSizes', {fontSizes: {standard: 16, fixed: 13}});
    await fontSession.detach();
    await page.setViewportSize({width: 1672, height: 941});
    await page.reload(); await loadedArt(page);
    pass('A 32px browser default-font preference enlarges labels and remains usable on desktop and portrait');

    // A native dialog supplies a second, linear route through the same games.
    await page.getByRole('button', {name: 'Games', exact: true}).click();
    const gamesDialog = page.getByRole('dialog');
    await gamesDialog.waitFor();
    for (const name of sports) await gamesDialog.getByRole('button', {name: `Play: ${name}`, exact: true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', {name: 'Games', exact: true}).evaluate(el => el === document.activeElement), true);
    pass('The Games list exposes every playable sport and restores focus after Escape');

    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    const menu = page.getByRole('dialog');
    await menu.waitFor();
    await menu.getByRole('button', {name: 'How to play', exact: true}).click();
    await page.getByRole('dialog', {name: 'How to play', exact: true}).getByText('Tap Play and start moving', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Back to menu', exact: true}).click();
    await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.getByTestId('island-background').evaluate(image => getComputedStyle(image).filter), 'none');
    const motionSwitch = page.getByRole('switch', {name: 'Motion', exact: true});
    await motionSwitch.click();
    assert.equal(await motionSwitch.getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => localStorage.getItem('wee:island-motion')), 'off');
    await screenshot(page, 'island-dark-menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', {name: 'Menu', exact: true}).evaluate(el => el === document.activeElement), true);
    await page.reload(); await loadedArt(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    assert.equal(await motionSwitch.getAttribute('aria-checked'), 'false');
    await page.getByRole('button', {name: 'Switch to light mode', exact: true}).click();
    await motionSwitch.click();
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Motion"]')?.disabled);
    assert.equal(await motionSwitch.isDisabled(), true);
    assert.equal(await motionSwitch.getAttribute('aria-checked'), 'false');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-motion]')].some(el => el.dataset.motion === 'false'));
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.getByRole('button', {name: 'Menu', exact: true}).click();
    await page.keyboard.press('Tab');
    assert.equal(await menu.evaluate(dialog => dialog.contains(document.activeElement)), true);
    pass('Menu supports keyboard focus, help, persisted theme/motion preferences and system reduced motion without darkening the art');
    await menu.getByRole('link', {name: 'Profile & history', exact: true}).click();
    await page.waitForURL('**/profile');
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await page.reload();
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
    await page.getByRole('link', {name: /Back to (games|sports)/i}).click();
    await page.waitForURL('**/home');
    pass('Optional profile access and its return path work without replaying the landing screen');

    // Real requests and real acknowledgements; the first sport is activated
    // twice in the same task to catch duplicate create requests before React paints.
    for (const name of sports) {
      const button = await enabledSport(page, name);
      const before = creates.length;
      if (name === 'Tennis') await button.evaluate(el => {el.click(); el.click();});
      else await button.click();
      await page.locator('.host-lobby').getByRole('heading', {name, exact: true}).waitFor();
      const code = await page.getByTestId('lobby-code').innerText();
      assert.equal(creates.length, before + 1, 'one activation opens exactly one room');
      assert.equal(creates.at(-1).sport, ids[name]);
      assert.ok(creates.at(-1).capabilities, 'room creation preserves negotiated host capabilities');
      assert.match(new URL(page.url()).pathname, new RegExp(`/host/${code}$`));
      await page.reload();
      await page.locator('.host-lobby').getByRole('heading', {name, exact: true}).waitFor();
      assert.equal(await page.getByTestId('lobby-code').innerText(), code);
      assert.equal(creates.length, before + 1, 'refresh resumes the existing room');
      if (name === 'Tennis') {
        const phone = await context.newPage();
        phone.on('pageerror', error => errors.push('join: ' + error.message));
        await phone.goto(base + '/home'); await loadedArt(phone);
        await phone.getByRole('button', {name: 'Menu', exact: true}).click();
        await phone.getByRole('dialog').getByRole('button', {name: 'Join a game', exact: true}).click();
        await phone.getByRole('dialog').getByLabel('Lobby code', {exact: true}).fill(code.toLowerCase());
        await phone.getByRole('dialog').getByRole('button', {name: 'Join', exact: true}).click();
        await phone.waitForURL(`**/join?code=${code}`);
        await phone.getByRole('button', {name: 'Play', exact: true}).waitFor();
        await phone.reload();
        await phone.getByRole('button', {name: 'Play', exact: true}).waitFor();
        await phone.close();
        pass('Manual joining normalizes lowercase codes and direct /join refresh bypasses the landing screen');
      }
      await page.getByRole('button', {name: 'Close lobby', exact: true}).click();
      await page.waitForURL('**/home');
    }
    pass('Every playable venue creates its correct authenticated lobby once, resumes on refresh and closes back to the island');

    // Offline state must not buffer a host request that replays on reconnect.
    await context.setOffline(true);
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .filter(button => button.getAttribute('aria-label')?.startsWith('Play:')).every(button => button.disabled));
    const beforeOffline = creates.length;
    assert.equal(new URL(page.url()).pathname, '/home');
    await loadedArt(page);
    await context.setOffline(false);
    await enabledSport(page, 'Tennis');
    assert.equal(creates.length, beforeOffline);
    pass('Offline play is unavailable while scenery remains visible; reconnect does not replay a room request');

    // One explicit server-busy rejection tests the failure UI without creating
    // an unwanted orphan room. All later packets use the real room service.
    const retryContext = await browser.newContext({viewport: {width: 1672, height: 941}});
    const retry = await retryContext.newPage();
    retry.on('pageerror', error => errors.push('retry: ' + error.message));
    let rejected = 0, forwarded = 0;
    await retry.routeWebSocket('**/socket.io/**', ws => {
      const server = ws.connectToServer();
      ws.onMessage(message => {
        const packet = eventFrame(message);
        if (packet?.event[0] === 'host:create') {
          if (rejected === 0) {
            rejected++;
            ws.send(`43${packet.ack}${JSON.stringify([{ok: false, error: 'server-busy'}])}`);
            return;
          }
          forwarded++;
        }
        server.send(message);
      });
      server.onMessage(message => ws.send(message));
    });
    await retry.goto(base + '/home');
    await (await enabledSport(retry, 'Bowling')).click();
    await retry.getByRole('status').filter({hasText: 'The server is busy. Try again in a moment.'}).first().waitFor();
    assert.equal(new URL(retry.url()).pathname, '/home');
    await retry.getByRole('button', {name: 'Try again: Bowling', exact: true}).click();
    await retry.locator('.host-lobby').getByRole('heading', {name: 'Bowling', exact: true}).waitFor();
    assert.equal(rejected, 1); assert.equal(forwarded, 1);
    await retry.getByRole('button', {name: 'Close lobby', exact: true}).click();
    await retryContext.close();
    pass('A rejected host request displays its reason and a deliberate retry opens the correct real lobby');

    assert.deepEqual(errors, []);
    pass('No uncaught browser errors');
    const report = {recordedAt: new Date().toISOString(), base, runtime: process.version, browser: browser.version(),
      checks, layouts, errors, limitations: ['Synthetic browser controls and local HTTP; no physical phone or hardware latency measurement.',
        'One host:create rejection is simulated at the WebSocket boundary; successful rooms use the real server.',
        'Visual screenshots require human comparison with the supplied concepts; automated geometry checks do not judge art fidelity.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
