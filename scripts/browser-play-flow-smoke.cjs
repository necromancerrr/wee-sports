// Production UI: confirmations, fullscreen fallback, camera mode, persistent TV result.
// Winning checkpoint injection exercises the existing trusted parent recovery path.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const base=process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5215';
const shots=process.env.WEE_SMOKE_SCREENSHOTS;
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[];const pass=value=>{checks.push(value);console.log('PASS:',value);};
  const capture=async(page,name)=>{if(shots){mkdirSync(shots,{recursive:true});await page.waitForTimeout(250);await page.screenshot({path:join(shots,name+'.png'),animations:'disabled'});}};
  try {
    for(const sport of ['Bowling','Tennis','Table Tennis']) {
      if(process.env.WEE_SMOKE_SPORT && process.env.WEE_SMOKE_SPORT!==sport)continue;
      const tvContext=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'dark'});
      const phoneContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'});
      await phoneContext.addInitScript(()=>{
        Object.defineProperty(window,'DeviceMotionEvent',{value:undefined,configurable:true});
        Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});
      });
      await tvContext.addInitScript(deny=>{
        if(deny)Element.prototype.requestFullscreen=async()=>{throw new Error('Fullscreen denied by browser');};
        window.__latestTable=null;
        window.addEventListener('message',e=>{if(e.origin===location.origin && e.data?.type==='wee:table-tennis-state')window.__latestTable=e.data;});
      },sport==='Bowling');
      const tv=await tvContext.newPage(),phone=await phoneContext.newPage();
      for(const page of [tv,phone])page.on('pageerror',error=>errors.push(error.message));
      await tv.goto(base+'/home');await tv.getByRole('button',{name:`Play: ${sport}`,exact:true}).click();
      const code=await tv.getByTestId('lobby-code').innerText();
      assert.equal(await tv.evaluate(()=>Boolean(document.fullscreenElement)),false,'opening the lobby stays windowed');
      await phone.goto(base+'/join?code='+code);await phone.getByLabel('Your playing name').fill('Alex');await phone.getByRole('button',{name:'Play',exact:true}).click();
      const start=phone.getByRole('button',{name:'Start game',exact:true});await start.click();
      await phone.getByRole('dialog',{name:`Start ${sport}?`}).waitFor();
      assert.equal(await phone.getByLabel('Next sport',{exact:true}).isVisible(),false,'sport picker is outside the main lobby');
      await capture(phone,sport.toLowerCase().replace(' ','-')+'-start-confirmation');
      await phone.getByRole('button',{name:'Keep waiting',exact:true}).click();
      await tv.waitForTimeout(5200);assert.equal(await tv.locator('iframe').count(),0,'cancel leaves the lobby open');
      await start.click();await phone.getByRole('button',{name:'Start now',exact:true}).click();
      await tv.locator('.game-countdown').waitFor();
      const layout=await tv.locator('.game-countdown').evaluate(node=>{
        const box=node.getBoundingClientRect(),number=node.querySelector('.game-countdown__number').getBoundingClientRect();
        return {x:box.x,y:box.y,w:box.width,h:box.height,vw:innerWidth,vh:innerHeight,number:number.height};
      });
      assert.equal(layout.x,0);assert.equal(layout.y,0);assert.equal(layout.w,layout.vw);assert.equal(layout.h,layout.vh);
      assert.ok(layout.number>=Math.min(layout.vw,layout.vh)*.35,'countdown is TV sized');
      if(sport==='Bowling')assert.equal(await tv.locator('.game-countdown__view').isVisible(),true,'denied fullscreen offers a TV button without blocking countdown');
      assert.equal(await tv.locator('.host-lobby__backdrop').getAttribute('aria-hidden'),'true');
      assert.equal(await tv.locator('.host-lobby__mark').count(),6);
      assert.equal(await tv.locator('.game-countdown__tile').count(),0,'the countdown number has no colored box');
      await capture(tv,sport.toLowerCase().replace(' ','-')+'-countdown');
      await tv.locator(`iframe[title="${sport} game"]`).waitFor({timeout:20000});
      const game=tv.frameLocator(`iframe[title="${sport} game"]`);
      if(sport==='Tennis')await game.locator('html[data-views="1"]').waitFor();
      if(sport==='Table Tennis') {
        await game.locator('#table-court[data-views="1"]').waitFor();
        assert.equal(await game.locator('#tt-result').isVisible(),false,'result is hidden during active play');
        const {TableTennisGame}=await import(pathToFileURL(resolve(__dirname,'../src/tabletennis/game.js')).href);
        const match=new TableTennisGame();match.startMatch();
        for(let i=0;i<10;i++)for(const player of [1,2]){match.rules.beginPoint();match.rules.award(player,'No return');}
        for(let i=0;i<2;i++){match.rules.beginPoint();match.rules.award(1,'No return');}
        const checkpoint=match.checkpoint();assert.ok(checkpoint);
        await tv.waitForFunction(()=>window.__latestTable?.gameId);
        await tv.evaluate(payload=>document.querySelector('iframe').contentWindow.postMessage({type:'wee:restore-checkpoint',gameId:window.__latestTable.gameId,payload},location.origin),checkpoint);
        await game.locator('#tt-result').waitFor();
        assert.equal(await game.locator('#tt-final-score').innerText(),'12 – 10');
        await phone.waitForTimeout(8000);
        assert.equal(await phone.getByRole('dialog').count(),0,'completion does not force a phone modal');
        assert.equal(await game.locator('#tt-result').isVisible(),true,'winner persists after the old seven-second announcement window');
        assert.notEqual(await game.locator('#tt-status').innerText(),'Waiting for your controller');
        await capture(tv,'table-tennis-tv-winner');
        await phone.close();await tv.waitForTimeout(1200);
        assert.equal(await tv.locator('.game-frame__pause').count(),0,'disconnect cannot cover the final result');
        assert.equal(await game.locator('#tt-result').isVisible(),true);
        pass('Table Tennis restores a 12–10 winner on the TV, retains it through sensor silence and phone disconnect, and does not force a phone result modal');
      }
      pass(`${sport}: confirmation/cancel, viewport-sized 5–1 countdown, and correct solo camera`);
      await tvContext.close();await phoneContext.close();
    }
    assert.deepEqual(errors,[]);pass('No uncaught browser errors');
    const report={recordedAt:new Date().toISOString(),base,checks,errors,limitations:['Synthetic touch phones and software WebGL; result seeded through the existing checkpoint recovery path. Does not measure physical iPhone motion or wireless latency.']};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
  }catch(error){for(const context of browser.contexts())for(const page of context.pages())console.error('PAGE_STATE',page.url(),await page.locator('body').innerText().catch(()=>''));throw error;}
  finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
