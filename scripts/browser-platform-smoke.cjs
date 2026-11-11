// Integration smoke against an already running disposable test server.
// Requires Playwright and Chromium; creates one synthetic profile per run.
// See docs/system-plan/README.md for commands and environment variables.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5180';
async function touchContext(browser) {
    const context = await browser.newContext({ viewport: { width: 430, height: 1000 } });
    // An absent sensor must choose touch automatically, without a setup checklist.
    await context.addInitScript(() => {
        Object.defineProperty(window, 'DeviceMotionEvent', { configurable: true, value: undefined });
        Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: undefined });
    });
    return context;
}
async function joinPhone(page, code, name = 'Player') {
    await page.goto(base + '/join?code=' + code);
    await page.getByLabel('Your playing name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Start game', exact: true }).click();
    await page.getByRole('button', {name:'Start now', exact:true}).click();
}

async function returnToLobby(host, {newGame = false} = {}) {
    await host.getByLabel('TV display controls').click();
    await host.getByRole('button', {name: 'Return to lobby', exact: true}).click();
    await host.getByRole('button', {name: 'Save and return', exact: true}).click();
    await host.locator('.host-lobby').getByRole('button', {name: 'Close lobby', exact: true}).waitFor();
    if (newGame) {
        // Changing sport explicitly resolves the unfinished match first.
        await host.getByRole('heading', {name: 'Your game is still here', exact: true}).waitFor();
        await host.getByRole('button', {name: 'New game', exact: true}).click();
        await host.getByRole('heading', {name: 'Your game is still here', exact: true}).waitFor({state: 'hidden'});
    }
}
// Read the server's acknowledged persistence state, independent of TV copy.
// Guest sessions have the same durable checkpoint status as profile sessions.
function observeHostProgress(page) {
    let latest = null;
    const receive = payload => {
        for (const packet of String(payload).split('\x1e')) {
            if (!packet.startsWith('42[')) continue;
            try {
                const [event, state] = JSON.parse(packet.slice(2));
                if (event === 'lobby:update' && state?.code) latest = state;
            } catch { /* Ignore unrelated transport frames. */ }
        }
    };
    page.on('websocket', connection => connection.on('framereceived', ({payload}) => receive(payload)));
    page.on('response', response => {
        if (response.url().includes('/socket.io/') && response.url().includes('transport=polling')) {
            response.text().then(receive).catch(() => {});
        }
    });
    return {
        reset() { latest = null; },
        async saved(code, afterRevision = 0) {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
                if (latest?.code === code && latest.recovery?.saved && latest.recovery.revision > afterRevision) return latest;
                await page.waitForTimeout(50);
            }
            assert.fail(`No persisted checkpoint for room ${code} after revision ${afterRevision}: ${JSON.stringify(latest?.recovery)}`);
        },
    };
}

async function waitForRoll(controller, host) {
    const frame = host.frames().find(frame => frame.url().includes('/bowling.html'));
    await frame.evaluate(() => {
        const probe = {started: performance.now(), frames: 0, active: true};
        window.__settlementProbe = probe;
        const tick = () => { if (probe.active) { probe.frames++; requestAnimationFrame(tick); } };
        requestAnimationFrame(tick);
    });
    try {
        // Software WebGL may render fewer than ten frames/second. The game caps
        // physics catch-up per frame; wait for the actual settled state instead
        // of treating this functional smoke as a real-device latency benchmark.
        await controller.getByRole('button', {name: 'Roll', exact: true}).waitFor({timeout: 60000});
    } finally {
        console.log('SETTLEMENT_RENDER', await frame.evaluate(() => {
            const probe = window.__settlementProbe; probe.active = false;
            return {frames: probe.frames, elapsedMs: Math.round(performance.now() - probe.started)};
        }));
    }
}

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const failures = [];
    const checks = [];
    const pass = text => { checks.push(text); console.log('PASS:', text); };
    try {
        const hc = await browser.newContext({ viewport: { width: 1280, height: 900 } }), pc = await touchContext(browser);
        const host = await hc.newPage(), phone = await pc.newPage();
        const progress = observeHostProgress(host);
        for (const [name, page] of [['host', host], ['phone', phone]])
            page.on('pageerror', e => failures.push(name + ': ' + e.message));
        await host.goto(base + '/home');
        await host.getByRole('button', { name: 'Play: Bowling', exact: true }).click();
        const code = await host.getByTestId('lobby-code').innerText();
        await joinPhone(phone, code);
        const bc = phone.frameLocator('iframe[title="Bowling phone controller"]');
        assert.equal(await phone.getByRole('button', { name: 'Ready', exact: true }).count(), 0);
        await host.getByRole('heading', { name: 'Bowling', exact: true }).waitFor({ timeout: 15000 });
        const display = host.getByLabel('TV display controls');
        await display.waitFor({state: 'visible', timeout: 15000});
        const displayBox = await display.boundingBox();
        assert.ok(displayBox.width >= 44 && displayBox.height >= 44, 'TV display control has a full-size target');
        assert.equal(await display.evaluate(element => getComputedStyle(element).opacity), '1', 'TV display control is visible before hover');
        assert.equal(await display.innerText(), 'Display');
        pass('TV display controls stay visible with a readable label and at least 44px target');
        const bg = host.frameLocator('iframe[title="Bowling game"]');
        await bc.getByRole('button', { name: 'Roll', exact: true }).waitFor({ timeout: 10000 });
        const bf = host.frames().find(f => f.url().includes('/bowling.html'));
        await bf.evaluate(() => { window.__aims = []; window.addEventListener('message', e => { if (e.data?.type === 'wee:game-aim')
            window.__aims.push(e.data.event); }); });
        await bc.locator('#aim').fill('0.5');
        await bc.locator('#aim').dispatchEvent('input');
        await bf.waitForFunction(() => window.__aims.some(e => e.aim === .5), null, { timeout: 8000 });
        pass('Bowling guest Play with a playing name, automatic touch readiness and authenticated live aim');
        const initialSave = await progress.saved(code);
        await bc.getByRole('button', { name: 'Roll', exact: true }).click();
        await bc.getByText('Watch the lane', { exact: true }).waitFor({ timeout: 5000 });
        await waitForRoll(bc, host);
        await progress.saved(code, initialSave.recovery.revision);
        assert.equal(await host.getByText('Progress saved.', { exact: true }).count(), 0);
        const before = await bg.locator('body').innerText();
        assert.match(before, /Ball 2|Frame 2/);
        const settledFrame = await bg.locator('#frame-label').innerText();
        pass('Bowling deliberate touch release settles once and saves a boundary');
        await host.getByLabel('TV display controls').click();
        await host.getByRole('button', { name: 'Pause game · P', exact: true }).click();
        await host.getByRole('button', { name: 'Resume game · P', exact: true }).waitFor();
        await host.getByRole('button', { name: 'Resume game · P', exact: true }).click();
        pass('Shared pause and resume');
        progress.reset();
        await host.reload();
        await host.getByRole('heading', {name: 'Your game is still here', exact: true}).waitFor({timeout: 10000});
        await phone.getByText('Choose Continue game or New game on the TV.', {exact: true}).waitFor();
        assert.equal(await host.locator('iframe[title="Bowling game"]').count(), 0);
        await host.getByRole('button', {name: 'Continue game', exact: true}).click();
        await host.locator('iframe[title="Bowling game"]').waitFor({timeout: 15000});
        await progress.saved(code);
        await bg.locator('body').getByText(/Frame 1 \/ 10 · Ball 2|Frame 2 \/ 10/).waitFor({ timeout: 15000 });
        assert.equal(await bg.locator('#frame-label').innerText(), settledFrame);
        pass('TV reload offers Continue game and restores the same settled bowling boundary after confirmation');
        await returnToLobby(host, {newGame: true});
        await host.locator('.host-lobby').getByRole('heading', { name: 'Bowling', exact: true }).waitFor();
        if (!await phone.locator('.phone-session__options').evaluate(node=>node.open)) await phone.locator('.phone-session__options > summary').click();
        if (!await phone.getByLabel('Next sport',{exact:true}).isVisible()) await phone.getByText('Change sport',{exact:true}).click();
        await phone.getByLabel('Next sport', { exact: true }).selectOption('table-tennis');
        await host.locator('.host-lobby').getByRole('heading', { name: 'Table Tennis', exact: true }).waitFor();
        assert.equal(await host.getByTestId('lobby-code').innerText(), code);
        await host.getByText('Player', { exact: true }).waitFor();
        const tc = phone.frameLocator('iframe[title="Table Tennis phone controller"]');
        await tc.locator('#tt-touchpad').waitFor();
        await phone.getByRole('button', { name: 'Start game', exact: true }).click();
        await phone.getByRole('button', {name:'Start now', exact:true}).click();
        await host.getByRole('heading', { name: 'Table Tennis', exact: true }).waitFor({ timeout: 15000 });
        const tg = host.frameLocator('iframe[title="Table Tennis game"]');
        await tg.locator('canvas').waitFor();
        await tg.locator('#table-tennis-app[data-mode="bot"],#table-tennis-app[data-mode="versus"]').waitFor();
        pass('Same-room switch retains identity and starts a scored solo Table Tennis game with touch controls');
        await tc.locator('#tt-touch-stroke').click();
        await tc.getByText('Options', { exact: true }).click();
        await tc.locator('#tt-practice-phone').click();
        await tg.locator('#table-tennis-app[data-mode="practice"]').waitFor();
        await tc.locator('#tt-match-phone').click();
        await tg.locator('#table-tennis-app[data-mode="bot"],#table-tennis-app[data-mode="versus"]').waitFor({ timeout: 6000 });
        pass('Table Tennis automatic touch setup, compact stroke and optional scored bot mode');
        if (process.env.WEE_SMOKE_SCREENSHOT)
            await host.screenshot({ path: process.env.WEE_SMOKE_SCREENSHOT });
        await returnToLobby(host, {newGame: true});
        if (!await phone.locator('.phone-session__options').evaluate(node=>node.open)) await phone.locator('.phone-session__options > summary').click();
        if (!await phone.getByLabel('Next sport',{exact:true}).isVisible()) await phone.getByText('Change sport',{exact:true}).click();
        await phone.getByLabel('Next sport', { exact: true }).selectOption('tennis');
        await host.locator('.host-lobby').getByRole('heading', { name: 'Tennis', exact: true }).waitFor();
        assert.equal(await host.getByTestId('lobby-code').innerText(), code);
        await host.getByText('Player', { exact: true }).waitFor();
        pass('Existing Tennis remains available in the same room');
        await phone.getByRole('button', {name: 'Start game', exact: true}).click();
        await phone.getByRole('button', {name: 'Start now', exact: true}).click();
        await host.getByRole('button', {name: 'Toggle swing diagnostics', exact: true}).click();
        const tennisController = phone.frameLocator('iframe[title="Tennis phone controller"]');
        await tennisController.getByRole('button', {name: 'Forehand', exact: true}).click();
        await host.locator('.tv-swing-debug').filter({hasText: 'P1 Forehand'}).waitFor();
        await host.locator('.tv-swing-debug').waitFor({state: 'hidden'});
        pass('Tennis input reaches TV diagnostics and the label expires without a page error');
        await returnToLobby(host);
        await host.getByRole('button', { name: 'Close lobby', exact: true }).click();
        await phone.waitForURL(base + '/home');
        await phone.getByRole('heading', {name: 'Choose a sport', exact: true}).waitFor();
        assert.equal(await phone.locator('iframe').count(), 0);
        pass('Room closure reaches the controller');
        await host.goto(base + '/profile');
        await host.getByRole('button', { name: 'Create a profile', exact: true }).click();
        const username = 'trial_' + Date.now();
        const password = 'synthetic test password ' + Date.now();
        await host.getByLabel('Username', { exact: true }).fill(username);
        await host.getByLabel('Display name', { exact: true }).fill('Browser Trial');
        await host.getByLabel('Password', { exact: true }).fill(password);
        await host.getByRole('button', { name: 'Create profile', exact: true }).click();
        await host.getByRole('heading', { name: 'Preferences', exact: true }).waitFor();
        await host.getByLabel('Playing hand', { exact: true }).selectOption('Left');
        await host.getByRole('button', { name: 'Save preferences', exact: true }).click();
        await host.getByText(/^Preferences saved/).waitFor();
        const profile = await host.evaluate(async () => await (await fetch('/api/profile')).json());
        assert.equal(profile.profile.preferences.hand, 'Left');
        const cas = await host.evaluate(async (revision) => {
            const options = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, displayName: 'Updated Trial' }) };
            return [(await fetch('/api/profile', options)).status, (await fetch('/api/profile', options)).status];
        }, profile.profile.revision);
        assert.deepEqual(cas, [200, 409]);
        assert.equal((await pc.request.get(base + '/api/profile/history')).status(), 401);
        pass('Optional profile registration/preferences, revision conflicts and unauthorized history access');
        await host.reload();
        await host.getByRole('button', { name: 'Sign out', exact: true }).click();
        await host.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await host.getByLabel('Username', { exact: true }).fill(username);
        await host.getByLabel('Password', { exact: true }).fill(password);
        await host.getByRole('button', { name: 'Sign in', exact: true }).click();
        await host.getByRole('heading', { name: 'Recent games', exact: true }).waitFor();
        assert.equal(await host.getByLabel('Playing hand', { exact: true }).inputValue(), 'Left');
        pass('Profile sign-out/sign-in retains preferences and renders history');
        const rc = await touchContext(browser);
        const resumePhone = await rc.newPage();
        resumePhone.on('pageerror', e => failures.push('recovery-phone: ' + e.message));
        await resumePhone.goto(base + '/profile');
        await resumePhone.getByLabel('Username', { exact: true }).fill(username);
        await resumePhone.getByLabel('Password', { exact: true }).fill(password);
        await resumePhone.getByRole('button', { name: 'Sign in', exact: true }).click();
        await resumePhone.getByRole('heading', { name: 'Recent games', exact: true }).waitFor();
        await host.goto(base + '/home');
        await host.getByRole('button', { name: 'Play: Bowling', exact: true }).click();
        const savedCode = await host.getByTestId('lobby-code').innerText();
        await joinPhone(resumePhone, savedCode, 'Saved Solo');
        const recoveryController = resumePhone.frameLocator('iframe[title="Bowling phone controller"]');
        assert.equal(await resumePhone.getByRole('button', { name: 'Ready', exact: true }).count(), 0);
        await host.getByRole('heading', { name: 'Bowling', exact: true }).waitFor({ timeout: 15000 });
        const initialProfileSave = await progress.saved(savedCode);
        await recoveryController.getByRole('button', { name: 'Roll', exact: true }).click();
        await recoveryController.getByText('Watch the lane', { exact: true }).waitFor();
        await waitForRoll(recoveryController, host);
        await progress.saved(savedCode, initialProfileSave.recovery.revision);
        const saved = await host.evaluate(async () => {
            const { history } = await (await fetch('/api/profile/history')).json();
            const source = history[0];
            return { source, checkpoint: await (await fetch('/api/profile/matches/' + source.matchId + '/checkpoint')).json() };
        });
        assert.equal(saved.source.sport, 'bowling');
        assert.equal(saved.source.saved, true);
        await returnToLobby(host);
        await host.getByRole('button', { name: 'Close lobby', exact: true }).click();
        await host.goto(base + '/profile');
        await host.getByRole('heading', { name: 'Continue a solo game', exact: true }).waitFor();
        await host.getByRole('button', { name: 'Continue on this screen', exact: true }).click();
        await host.locator('.host-lobby').getByRole('heading', { name: 'Bowling', exact: true }).waitFor();
        const restoredCode = await host.getByTestId('lobby-code').innerText();
        assert.notEqual(restoredCode, savedCode);
        await joinPhone(resumePhone, restoredCode, 'Changed Name');
        await host.getByRole('heading', { name: 'Bowling', exact: true }).waitFor({ timeout: 15000 });
        const restoredGame = host.frameLocator('iframe[title="Bowling game"]');
        // Starting has moved the roster from the lobby into the real game HUD.
        await restoredGame.locator('.bowling-standings__name').waitFor();
        assert.equal(await restoredGame.locator('.bowling-standings__name').innerText(), 'P1 · Saved Solo');
        assert.match(await resumePhone.locator('.phone-session__name').innerText(), /Saved Solo · Connected/);
        await restoredGame.locator('body').getByText(/Frame 1 \/ 10 · Ball 2|Frame 2 \/ 10/).waitFor({ timeout: 10000 });
        await progress.saved(restoredCode);
        const afterRestore = await host.evaluate(async () => {
            const { history } = await (await fetch('/api/profile/history')).json();
            return { history, checkpoints: await Promise.all(history.map(async (item) => [item.matchId, await (await fetch('/api/profile/matches/' + item.matchId + '/checkpoint')).json()])) };
        });
        const continued = afterRestore.history.find(item => item.matchId !== saved.source.matchId);
        assert.ok(continued, 'continued match has a new durable identity');
        assert.deepEqual(afterRestore.checkpoints.find(([id]) => id === saved.source.matchId)[1], saved.checkpoint, 'source checkpoint remains unchanged');
        assert.deepEqual(afterRestore.checkpoints.find(([id]) => id === continued.matchId)[1].checkpoint.state, saved.checkpoint.checkpoint.state, 'continued game restores complete saved state');
        pass('Profile Continue opens a fresh solo room, authenticates its owner and restores the exact saved bowling state');
        await returnToLobby(host);
        await host.getByRole('button', { name: 'Close lobby', exact: true }).click();
        assert.deepEqual(failures, []);
        pass('No uncaught page errors');
        const report = { recordedAt: new Date().toISOString(), base, runtime: process.version, browser: browser.version(), rendering: 'headless Chromium with software rendering', checks, errors: failures, limitations: ['Touch controls and local HTTP only; no physical motion, sensor permission, haptics or latency evidence.', 'No complete ten-frame bowling game or complete scored table-tennis bot game.', 'Continue UI verified after closing a live room; process restart is covered separately by server/tests/profileRecovery.test.js.'] };
        if (process.env.WEE_SMOKE_REPORT)
            writeFileSync(process.env.WEE_SMOKE_REPORT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
        console.log(JSON.stringify(report));
    }
    catch (error) {
        for (const [contextIndex, context] of browser.contexts().entries()) {
            for (const [pageIndex, page] of context.pages().entries()) {
                console.error('PAGE_STATE', contextIndex, pageIndex, page.url(), await page.locator('body').innerText().catch(() => 'unavailable'));
                for (const frame of page.frames().slice(1)) console.error('FRAME_STATE', frame.url(), await frame.locator('body').innerText().catch(() => 'unavailable'));
            }
        }
        throw error;
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
