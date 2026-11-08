// Real phone/TV UI, GameFrame bridge and native WebRTC data channels.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const base=process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5280';
// Only use this mode after independently confirming a browser/network policy
// that prevents local ICE candidates. An unexpected direct failure stays red.
const expectBlockedRtc=process.env.WEE_SMOKE_EXPECT_BLOCKED_RTC==='1';
const scope=(side,sport)=>`bridge.${side}.${sport}`;
const counters=(page,name)=>page.evaluate(name=>window.__weeDiagnostics?.snapshot().scopes[name]?.counters || {},name);

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  const checks=[],errors=[],measurements={};
  const pass=value=>{checks.push(value);console.log('PASS:',value);};
  try {
    for(const [name,sport] of [['Tennis','tennis'],['Table Tennis','table-tennis']]) {
      const tvContext=await browser.newContext({viewport:{width:960,height:640}});
      const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
        userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
      for(const context of [tvContext,phoneContext]) await context.addInitScript(()=>{
        window.__smokePeers=[];window.__smokeSwingInputs=[];window.__smokePoseInputs=[];
        const Native=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends Native {constructor(...args){super(...args);this.__smokeCandidates=0;
          this.addEventListener('icecandidate',event=>{if(event.candidate)this.__smokeCandidates++;});window.__smokePeers.push(this);}};
        // Observe the actual messages delivered to each game/controller frame.
        window.addEventListener('message',event=>{
          if(event.origin!==location.origin)return;
          if(event.data?.type==='wee:game-swing')window.__smokeSwingInputs.push(event.data.event);
          if(event.data?.type==='wee:table-tennis-pose') {
            window.__smokePoseInputs.push(event.data.event || event.data.pose);
            if(window.__smokePoseInputs.length>120)window.__smokePoseInputs.shift();
          }
        });
      });
      await phoneContext.addInitScript(()=>{
        Object.defineProperty(window,'DeviceMotionEvent',{value:undefined,configurable:true});
        Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});
      });
      const tv=await tvContext.newPage(),phone=await phoneContext.newPage();
      for(const page of [tv,phone])page.on('pageerror',error=>errors.push(error.message));
      await tv.goto(base+'/home');await tv.getByRole('button',{name:`Play: ${name}`,exact:true}).click();
      const code=await tv.getByTestId('lobby-code').innerText();
      await tv.goto(base+`/host/${code}?diagnostics=1`);
      await tv.getByTestId('lobby-code').waitFor();
      await phone.goto(base+`/join?code=${code}&diagnostics=1`);
      await phone.getByLabel('Your playing name',{exact:true}).fill('Alex');
      await phone.getByRole('button',{name:'Play',exact:true}).click();
      await phone.getByRole('button',{name:'Start game',exact:true}).click();
      await phone.getByRole('button',{name:'Start now',exact:true}).click();
      await tv.locator(`iframe[title="${name} game"]`).waitFor();
      const controller=phone.frameLocator(`iframe[title="${name} phone controller"]`);
      const gameLocator=tv.locator(`iframe[title="${name} game"]`);
      const game=await (await gameLocator.elementHandle()).contentFrame();
      const button=controller.locator(sport==='tennis'?'#forehand':'#tt-touch-stroke');
      await button.waitFor();await button.click({trial:true});
      if(expectBlockedRtc) {
        for(const page of [tv,phone]) {
          await page.waitForFunction(()=>window.__smokePeers.some(peer=>peer.localDescription && peer.remoteDescription && peer.iceGatheringState==='complete'),null,{timeout:15000});
          const peers=await page.evaluate(()=>window.__smokePeers.map(peer=>({candidates:peer.__smokeCandidates,connection:peer.connectionState})));
          assert.ok(peers.length>0);assert.ok(peers.every(peer=>peer.candidates===0 && peer.connection!=='connected'));
        }
      } else {
        await phone.waitForFunction(name=>{
          const report=window.__weeDiagnostics?.snapshot().scopes[name];
          return report?.counters['direct.opened']>0 && report?.timings['direct.roundTripMs']?.count>=2;
        },scope('phone',sport),{timeout:25000});
        await tv.waitForFunction(()=>window.__smokePeers.some(peer=>peer.connectionState==='connected'),null,{timeout:15000});
      }
      const route=expectBlockedRtc?'server':'direct',otherRoute=expectBlockedRtc?'direct':'server';
      const beforePhone=await counters(phone,scope('phone',sport)),beforeTv=await counters(tv,scope('tv',sport));

      if(sport==='tennis') {
        await game.evaluate(()=>{window.__smokeSwingInputs=[];});
        await button.click();
        await game.waitForFunction(()=>window.__smokeSwingInputs.length===1);
        await phone.waitForFunction(name=>(window.__weeDiagnostics?.snapshot().scopes[name]?.counters.swingDelivered || 0)>0,scope('phone',sport));
        await phone.waitForTimeout(150);
        const afterPhone=await counters(phone,scope('phone',sport)),afterTv=await counters(tv,scope('tv',sport));
        assert.equal((afterPhone['swingRoute.'+route]||0)-(beforePhone['swingRoute.'+route]||0),1);
        assert.equal((afterPhone['swingRoute.'+otherRoute]||0)-(beforePhone['swingRoute.'+otherRoute]||0),0);
        assert.equal((afterTv.swingsReceived||0)-(beforeTv.swingsReceived||0),1);
        assert.equal(await game.evaluate(()=>window.__smokeSwingInputs.length),1);
        pass(`Tennis: real phone Forehand uses ${route} delivery and reaches the TV game exactly once`);
      } else {
        await button.click();
        await phone.waitForFunction(({name,route})=>(window.__weeDiagnostics?.snapshot().scopes[name]?.counters['poseRoute.'+route]||0)>0,{name:scope('phone',sport),route});
        await game.waitForFunction(()=>window.__smokePoseInputs.some(event=>Number.isFinite(event?.sourceTime)));
        const afterPhone=await counters(phone,scope('phone',sport)),afterTv=await counters(tv,scope('tv',sport));
        assert.ok((afterPhone['poseRoute.'+route]||0)>(beforePhone['poseRoute.'+route]||0));
        assert.ok((afterTv.posesReceived||0)>(beforeTv.posesReceived||0));
        const poses=await game.evaluate(()=>window.__smokePoseInputs.filter(event=>Number.isFinite(event?.sourceTime)));
        assert.ok(poses.length>1);assert.ok(poses.every(event=>event.player===1));
        for(let index=1;index<poses.length;index++)assert.ok(poses[index].sourceTime>poses[index-1].sourceTime);
        pass(`Table Tennis: real touch controller streams ${route} poses to the TV with increasing source timestamps`);
        if(process.env.WEE_SMOKE_SCREENSHOTS) {
          mkdirSync(process.env.WEE_SMOKE_SCREENSHOTS,{recursive:true});
          // Hide diagnostic presentation only for the arena image; input and
          // telemetry remain the real running game above.
          await game.evaluate(()=>document.body.classList.remove('tt-diagnostics'));
          await tv.screenshot({path:join(process.env.WEE_SMOKE_SCREENSHOTS,'table-tennis-arena.png')});
        }
      }
      measurements[sport]={route,directRoundTripMs:await phone.evaluate(name=>window.__weeDiagnostics.snapshot().scopes[name].timings['direct.roundTripMs'],scope('phone',sport))};
      await phone.getByRole('link',{name:'Go home',exact:true}).click();
      await phone.getByRole('heading',{name:'Ready to play?',exact:true}).waitFor();
      assert.equal(await phone.locator('iframe').count(),0);
      await phone.waitForFunction(()=>window.__smokePeers.every(peer=>peer.connectionState==='closed'));
      await tv.waitForFunction(()=>window.__smokePeers.every(peer=>peer.connectionState==='closed'));
      const stopped=await counters(tv,scope('tv',sport));
      await tv.waitForTimeout(300);
      const quiet=await counters(tv,scope('tv',sport));
      assert.equal(quiet.swingsReceived||0,stopped.swingsReceived||0);
      assert.equal(quiet.posesReceived||0,stopped.posesReceived||0);
      pass(`${name}: Go home unmounts the controller, closes both peers and stops input`);
      await tvContext.close();await phoneContext.close();
    }
    assert.deepEqual(errors,[]);
    const report={recordedAt:new Date().toISOString(),checks,errors,measurements,directStatus:expectBlockedRtc?'Blocked by confirmed browser ICE policy; server fallback verified':'Real direct delivery verified',limitations:[
      expectBlockedRtc ? 'Native offer/answer negotiation ran, but managed browser policy produced no local ICE candidates. No direct input delivery or direct RTT was measured.'
        : 'Connected native Chromium peer connections and production UI on one machine; local round trips are not Railway, Wi-Fi or physical motion-to-display measurements.',
      'Synthetic touch phone contexts; physical motion sensors and TV hardware are not exercised.'
    ]};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
  } catch(error) {
    for(const context of browser.contexts())for(const page of context.pages())console.error('PAGE_STATE',page.url(),JSON.stringify(
      await page.evaluate(()=>({text:document.body.innerText,diagnostics:window.__weeDiagnostics?.snapshot(),peers:window.__smokePeers?.map(peer=>({connection:peer.connectionState,
        ice:peer.iceConnectionState,gathering:peer.iceGatheringState,signaling:peer.signalingState,local:peer.localDescription?.type,remote:peer.remoteDescription?.type}))})).catch(()=>null)));
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
