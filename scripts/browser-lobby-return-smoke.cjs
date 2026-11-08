// Phone-led startup, returning, leaving and rejoining through production UI.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5206';
const games = ['Bowling', 'Table Tennis', 'Tennis'];
const ids = {'Bowling':'bowling', 'Table Tennis':'table-tennis', 'Tennis':'tennis'};

async function phoneContext(browser) {
  const context = await browser.newContext({viewport:{width:390,height:844}, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', isMobile:true, hasTouch:true});
  await context.addInitScript(() => {
    Object.defineProperty(window, 'DeviceMotionEvent', {value:undefined, configurable:true});
    Object.defineProperty(window, 'DeviceOrientationEvent', {value:undefined, configurable:true});
  });
  return context;
}
async function joinPhone(page, code, name) {
  await page.goto(base + '/join?code=' + code);
  await page.getByLabel('Your playing name', {exact:true}).fill(name);
  await page.getByRole('button', {name:'Play', exact:true}).click();
}
async function returnFromPhone(phone, host) {
  await phone.getByRole('button', {name:'Game options', exact:true}).click();
  await phone.getByRole('button', {name:'Return to lobby', exact:true}).click();
  await phone.getByRole('button', {name:'Save and return', exact:true}).click();
  await phone.getByRole('dialog').waitFor({state:'hidden'});
  // The phone acknowledgement can precede the TV's room broadcast. Inspect
  // recovery choices only after the actual display has entered the lobby.
  await host.locator('.host-lobby').getByRole('button', {name:'Close lobby', exact:true}).waitFor();
}
async function leavePhone(phone) {
  const more = phone.locator('.phone-session__options');
  if (!await more.evaluate(node => node.open)) await more.locator(':scope > summary').click();
  await phone.getByRole('button', {name:'Leave lobby', exact:true}).click();
  await phone.getByRole('heading', {name:'Ready to play?', exact:true}).waitFor();
}
async function controllerReady(phone, sport) {
  const frame = phone.frameLocator(`iframe[title="${sport} phone controller"]`);
  const control = frame.locator(sport === 'Bowling' ? '#roll' : sport === 'Tennis' ? '#forehand' : '#tt-touch-stroke');
  await control.waitFor();
  await control.click({trial:true});
}

(async () => {
  const browser = await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium', headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks = [], errors = [];
  const pass = message => {checks.push(message); console.log('PASS:', message);};
  try {
    for (const sport of games) {
      if (process.env.WEE_SMOKE_SPORT && process.env.WEE_SMOKE_SPORT!==sport) continue;
      const host = await browser.newPage({viewport:{width:1280,height:800}});
      const context = await phoneContext(browser), secondContext = await phoneContext(browser);
      const phone = await context.newPage(), second = await secondContext.newPage();
      for (const page of [host, phone, second]) page.on('pageerror', error => errors.push(error.message));
      await host.goto(base + '/home');
      await host.getByRole('button', {name:`Play: ${sport}`, exact:true}).click();
      const code = await host.getByTestId('lobby-code').innerText();
      assert.equal(await host.getByLabel('Next sport', {exact:true}).count(), 0);
      assert.equal(await host.getByLabel('Players in this game', {exact:true}).count(), 0);
      assert.equal(await host.getByText('Join to play', {exact:true}).count(), 0);
      assert.equal(await host.getByText(/^Players 0\//).count(), 0);
      if (process.env.WEE_SMOKE_SCREENSHOTS) {
        mkdirSync(process.env.WEE_SMOKE_SCREENSHOTS, {recursive:true});
        await host.screenshot({path:join(process.env.WEE_SMOKE_SCREENSHOTS, ids[sport] + '-empty.png')});
      }
      await joinPhone(phone, code, 'Alex');
      const start = phone.getByRole('button', {name:'Start game', exact:true});
      await start.waitFor();
      await phone.waitForTimeout(5500);
      assert.equal(await host.locator('iframe').count(), 0, 'one joined player must choose when to start');
      if (await host.getByRole('button', {name:'New game', exact:true}).isVisible()) await host.getByRole('button', {name:'New game', exact:true}).click();
      await start.click();
      await phone.getByRole('button', {name:'Start now', exact:true}).click();
      await host.locator(`iframe[title="${sport} game"]`).waitFor();
      await controllerReady(phone, sport);
      await returnFromPhone(phone, host);
      await host.locator('.host-lobby').getByRole('heading', {name:sport, exact:true}).waitFor();
      if (await host.getByRole('button', {name:'New game', exact:true}).isVisible()) await host.getByRole('button', {name:'New game', exact:true}).click();
      await start.click();
      await phone.getByRole('button', {name:'Start now', exact:true}).click();
      await host.locator(`iframe[title="${sport} game"]`).waitFor();
      await controllerReady(phone, sport);
      pass(`${sport}: solo starts from the phone and its controller works after return and restart`);

      await returnFromPhone(phone, host);
      await joinPhone(second, code, 'Sam');
      // A room returned from a match remains in the lobby until the leader starts.
      await second.waitForTimeout(1000);
      assert.equal(await second.getByRole('button', {name:'Start game', exact:true}).count(), 0);
      if (await host.getByRole('button', {name:'New game', exact:true}).isVisible()) await host.getByRole('button', {name:'New game', exact:true}).click();
      await start.click();
      await phone.getByRole('button', {name:'Start now', exact:true}).click();
      await host.locator(`iframe[title="${sport} game"]`).waitFor();
      if (sport==='Table Tennis') {
        await host.frameLocator('iframe[title="Table Tennis game"]').locator('#table-court[data-views="2"]').waitFor();
        await controllerReady(phone, sport);
        await controllerReady(second, sport);
        if (process.env.WEE_SMOKE_SCREENSHOTS) {await host.waitForTimeout(250);await host.screenshot({path:join(process.env.WEE_SMOKE_SCREENSHOTS,'table-tennis-split.png')});}
      }
      if (sport==='Tennis') await host.frameLocator('iframe[title="Tennis game"]').locator('html[data-views="2"]').waitFor();
      await leavePhone(phone);
      await host.locator('.host-lobby').getByRole('heading', {name:sport, exact:true}).waitFor();
      await second.getByRole('button', {name:'Start game', exact:true}).click();
      await second.getByRole('button', {name:'Start now', exact:true}).click();
      await host.locator(`iframe[title="${sport} game"]`).waitFor();
      await controllerReady(second, sport);
      assert.match(await second.locator('.you .seat__badge').innerText(), /P1/);
      pass(`${sport}: leaving during play promotes the remaining phone, which can start and control a new game`);

      await returnFromPhone(second, host);
      if (await host.getByRole('button', {name:'New game', exact:true}).isVisible()) await host.getByRole('button', {name:'New game', exact:true}).click();
      const next = sport === 'Bowling' ? 'table-tennis' : 'bowling';
      if (!await second.locator('.phone-session__options').evaluate(node=>node.open)) await second.locator('.phone-session__options > summary').click();
      if (!await second.getByLabel('Next sport',{exact:true}).isVisible()) await second.getByText('Change sport',{exact:true}).click();
      await second.getByLabel('Next sport', {exact:true}).selectOption(next);
      await host.locator('.host-lobby').getByRole('heading', {name:next === 'bowling' ? 'Bowling' : 'Table Tennis', exact:true}).waitFor();
      assert.equal(await host.getByLabel('Next sport', {exact:true}).count(), 0);
      await host.getByRole('button', {name:'Close lobby', exact:true}).click();
      await second.getByText('Room closed. Scan the TV to play again.', {exact:true}).waitFor();
      assert.equal(await second.locator('iframe').count(), 0);
      pass(`${sport}: sport selection stays on the phone; closing the room releases the controller`);
      await context.close(); await secondContext.close(); await host.close();
    }
    assert.deepEqual(errors, []);
    pass('No uncaught browser errors');
    const report = {recordedAt:new Date().toISOString(), base, checks, errors,
      limitations:['Touch controls in generated browser contexts; does not measure physical phone motion or latency.']};
    if (process.env.WEE_SMOKE_REPORT) writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report,null,2)+'\n', {flag:'wx'});
    console.log(JSON.stringify(report));
  } catch (error) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('PAGE_STATE', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
      for (const frame of page.frames().slice(1)) console.error('FRAME_STATE', frame.url(), await frame.locator('body').innerText().catch(() => 'unavailable'));
    }
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
