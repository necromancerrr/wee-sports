// Production TV + browser controller: names, countdown timing, checkpoints and leave.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const base=process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5216';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[];
  const pass=text=>{checks.push(text);console.log('PASS:',text);};
  const shots=process.env.WEE_SMOKE_SCREENSHOTS;
  const capture=async(page,name)=>{if(shots){mkdirSync(shots,{recursive:true});await page.screenshot({path:join(shots,name+'.png'),animations:'disabled'});}};
  try {
    for(const sport of ['Tennis','Table Tennis','Bowling']) {
      if(process.env.WEE_SMOKE_SPORT && sport!==process.env.WEE_SMOKE_SPORT)continue;
      const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:'dark'});
      const phoneContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',isMobile:true,hasTouch:true});
      await context.addInitScript(()=>{
        window.__fullscreenRequests=0;window.__checkpoint=null;window.__gameState=null;
        const fullscreen=Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen=function(...args){window.__fullscreenRequests++;return fullscreen.apply(this,args);};
        window.addEventListener('message',event=>{
          if(event.origin!==location.origin)return;
          if(event.data?.type==='wee:game-checkpoint')window.__checkpoint=event.data;
          if(['wee:tennis-state','wee:table-tennis-state','wee:bowling-state'].includes(event.data?.type))window.__gameState=event.data;
        });
      });
      await phoneContext.addInitScript(()=>{
        Object.defineProperty(window,'DeviceMotionEvent',{value:undefined,configurable:true});
        Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});
      });
      const tv=await context.newPage(),phone=await phoneContext.newPage();
      for(const page of [tv,phone])page.on('pageerror',error=>errors.push(error.message));
      await tv.goto(base+'/home');await tv.getByRole('button',{name:`Play: ${sport}`,exact:true}).click();
      const code=await tv.getByTestId('lobby-code').innerText();
      assert.equal(await tv.evaluate(()=>window.__fullscreenRequests),0);
      await phone.goto(base+'/join?code='+code);
      await phone.getByRole('heading',{name:/Pick up.*Play\./}).waitFor();
      assert.equal(await phone.getByRole('button',{name:'Play',exact:true}).isDisabled(),true);
      await phone.getByLabel('Your playing name').fill('Alex');await capture(phone,'join-name');
      await phone.getByRole('button',{name:'Play',exact:true}).click();
      await phone.getByRole('button',{name:'Start game',exact:true}).click();
      assert.equal(await tv.evaluate(()=>window.__fullscreenRequests),0);
      await phone.getByRole('button',{name:'Start now',exact:true}).click();
      await tv.locator('.game-countdown').waitFor();
      await tv.waitForFunction(()=>window.__fullscreenRequests>0);
      assert.equal(await tv.locator('.game-countdown__tile').count(),0);
      await capture(tv,'countdown-number');
      await tv.locator(`iframe[title="${sport} game"]`).waitFor();
      await tv.waitForFunction(()=>window.__checkpoint?.payload);
      if(sport==='Table Tennis')await capture(tv,'table-tennis-island-court');
      assert.equal(await phone.getByText(/Watch the tutorial\?|Skipping the tutorial|You picked No/).count(),0);
      pass(`${sport}: scan asks for a name, lobby stays windowed, fullscreen starts at countdown and tutorials skip automatically`);

      const seed=await tv.evaluate(()=>structuredClone(window.__checkpoint));
      if(sport==='Tennis') seed.payload.score.points=[3,2];
      else if(sport==='Table Tennis') {seed.payload.rules.score=[5,3];seed.payload.rules.pointId=8;}
      else seed.payload.match.deliveries=[[1,2],[2]]; // Two settled rolls, nine points, a fresh rack.
      const expected=JSON.stringify(seed.payload);
      await tv.evaluate(message=>document.querySelector('iframe').contentWindow.postMessage({type:'wee:restore-checkpoint',gameId:message.gameId,payload:message.payload},location.origin),seed);
      await tv.waitForFunction(expected=>JSON.stringify(window.__checkpoint?.payload)===expected,expected);
      // Acknowledge publication before navigation; the round-trip is exercised by the real parent/server.
      await tv.waitForTimeout(500);
      await tv.goto(base+'/home');
      await phone.getByText('TV disconnected',{exact:true}).waitFor();
      assert.equal(await phone.locator('.phone-session--playing').count(),0,'a missing TV releases the phone play screen immediately');
      await tv.getByRole('link',{name:`Return to room ${code}`,exact:true}).click();
      await tv.getByRole('heading',{name:'Your game is still here'}).waitFor();
      await phone.getByText('Choose Continue game or New game on the TV.',{exact:true}).waitFor();
      assert.equal(await phone.locator('.phone-session--playing').count(),0);
      assert.equal(await tv.evaluate(()=>Boolean(document.fullscreenElement)),false);
      await capture(tv,sport.toLowerCase().replace(' ','-')+'-resume-choice');
      await tv.getByRole('button',{name:'Continue game',exact:true}).click();
      await tv.locator('.game-countdown').waitFor();
      await tv.waitForFunction(expected=>JSON.stringify(window.__checkpoint?.payload)===expected,expected,{timeout:20000});
      pass(`${sport}: leaving the TV returns the phone to the lobby; Continue restores the nonzero score with the original player`);

      await tv.reload();
      await tv.getByRole('heading',{name:'Your game is still here'}).waitFor();
      await tv.getByRole('button',{name:'New game',exact:true}).click();
      await phone.getByRole('button',{name:'Start game',exact:true}).click();
      await phone.getByRole('button',{name:'Start now',exact:true}).click();
      await tv.waitForFunction(()=>window.__checkpoint?.payload);
      const fresh=await tv.evaluate(()=>window.__checkpoint.payload);
      if(sport==='Tennis')assert.deepEqual(fresh.score.points,[0,0]);
      else if(sport==='Table Tennis')assert.deepEqual(fresh.rules.score,[0,0]);
      else assert.deepEqual(fresh.match.deliveries,[]);
      await tv.getByLabel('TV display controls').click();
      await tv.getByRole('button',{name:'Close lobby',exact:true}).click();
      await phone.getByText('Room closed. Scan the TV to play again.',{exact:true}).waitFor();
      assert.equal(await phone.locator('iframe').count(),0);
      pass(`${sport}: New game starts fresh; closing the room releases the controller`);
      await context.close();await phoneContext.close();
    }
    assert.deepEqual(errors,[]);
    const report={recordedAt:new Date().toISOString(),checks,errors,
      limitations:['Synthetic touch phone; nonzero stable checkpoints seeded through the trusted TV recovery bridge. Physical iPhone motion and wireless latency require device testing.']};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
  } catch(error) {
    for(const context of browser.contexts())for(const page of context.pages())console.error('PAGE_STATE',page.url(),await page.locator('body').innerText().catch(()=>''));
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
