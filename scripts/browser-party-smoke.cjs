// Real production rooms, TV renderer and controller frames. Synthetic controllers
// exercise routing and capacity; this is not a hardware-latency benchmark.
const {chromium} = require('playwright');
const {io} = require('socket.io-client');
const assert = require('node:assert/strict');
const {writeFileSync} = require('node:fs');
const base = process.env.WEE_SMOKE_URL || 'http://127.0.0.1:5201';
const sockets = [];
const request = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, value) => error ? reject(error) : resolve(value)));
async function client() {
  const socket = io(base, {transports:['websocket'],forceNew:true}); sockets.push(socket);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  return socket;
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const checks=[],errors=[]; const pass=text=>{checks.push(text);console.log('PASS:',text);};
 try {
  const host=await browser.newPage({viewport:{width:1280,height:800}});
  host.on('pageerror',error=>errors.push(error.message));
  await host.addInitScript(()=>{window.__party=[];window.addEventListener('message',e=>{
    if(e.origin!==location.origin)return;
    if(e.data?.type==='wee:table-tennis-state')window.__ttPhase=e.data.phase;
    if(['wee:game-hit','wee:table-tennis-state'].includes(e.data?.type))window.__party.push({...e.data,duringPhase:window.__ttPhase});
  });});
  await host.goto(base+'/home'); await host.getByRole('button',{name:'Play: Bowling',exact:true}).click();
  await host.getByLabel('Players in this game',{exact:true}).selectOption('8');
  let code=await host.getByTestId('lobby-code').innerText();
  const members=[];
  for(let index=0;index<8;index++) {
   const socket=await client(); const joined=await request(socket,'player:join',{v:4,code,name:'Friend '+(index+1)});assert.equal(joined.ok,true);assert.equal(joined.slot,index);members.push({socket,...joined});
   assert.equal((await request(socket,'player:setup',{setup:'buttons'})).ok,true);
   assert.equal((await request(socket,'player:ready',{ready:true})).ok,true);
   if(index===0){await host.waitForTimeout(5500);assert.equal(await host.locator('iframe[title="Bowling game"]').count(),0,'first phone must wait for the rest of the party');}
  }
  const ninth=await client();assert.equal((await request(ninth,'player:join',{v:4,code,name:'Ninth'})).ok,false);
  await host.locator('iframe[title="Bowling game"]').waitFor({timeout:20000});
  const bowling=host.frames().find(f=>f.url().includes('/bowling.html')); assert.ok(bowling);
  await bowling.locator('.bowling-standings__name').filter({hasText:'Friend 8'}).waitFor();
  assert.equal(await bowling.locator('.bowling-standings__name').count(),8);
  const hud=await bowling.locator('.bowling-hud').boundingBox();
  assert.ok(hud.x+hud.width<1280*.35,'score strip leaves the central lane visible');
  await bowling.locator('#open-scorecard').click();await bowling.getByRole('dialog').waitFor();
  assert.equal(await bowling.locator('#score-body tr').count(),8);
  await bowling.locator('#close-scorecard').click();
  assert.ok(await bowling.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  pass('Eight ready controllers join their chosen party, the first waits for friends, and a ninth is rejected');
  pass('The real bowling renderer shows all eight names without horizontal page overflow');
  if(process.env.WEE_PARTY_SCREENSHOT)await host.screenshot({path:process.env.WEE_PARTY_SCREENSHOT});
  members[7].socket.disconnect();
  await host.getByText(/Waiting for Friend 8 to reconnect/).waitFor();
  const replacement=await client();
  const resumed=await request(replacement,'session:resume',{v:4,code,role:'player',token:members[7].token});
  assert.equal(resumed.ok,true);assert.equal(resumed.slot,7);
  await request(replacement,'player:setup',{setup:'buttons'});
  await host.getByText(/Waiting for Friend 8 to reconnect/).waitFor({state:'hidden'});
  pass('Player eight reconnects into the original seat and the bowling game resumes');
  await host.getByLabel('TV display controls').click();await host.getByRole('button',{name:'Close lobby',exact:true}).click();
  await host.waitForURL('**/home');
  for(const socket of sockets)socket.disconnect();
  await host.getByRole('button',{name:'Play: Table Tennis',exact:true}).click();
  await host.getByLabel('Players in this game',{exact:true}).selectOption('2');
  code=await host.getByTestId('lobby-code').innerText();
  const phones=[];
  for(let i=0;i<2;i++) {
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.addInitScript(()=>{Object.defineProperty(window,'DeviceMotionEvent',{value:undefined,configurable:true});Object.defineProperty(window,'DeviceOrientationEvent',{value:undefined,configurable:true});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/join?code='+code);await page.getByRole('button',{name:'Play',exact:true}).click();phones.push(page);
  }
  await host.locator('iframe[title="Table Tennis game"]').waitFor({timeout:20000});
  const game=host.frameLocator('iframe[title="Table Tennis game"]');
  await game.getByText('First to 12 · win by 2',{exact:true}).waitFor();
  const controls=phones.map(p=>p.frameLocator('iframe[title="Table Tennis phone controller"]'));
  for(const frame of controls){await frame.locator('#tt-touch-stroke').waitFor();assert.equal(await frame.locator('#tt-practice-phone').isVisible(),false);}
  pass('Two phones start a scored table-tennis match with independent touch controls and no solo practice actions');
  // Exercise both controllers through actual button input; contacts are reported
  // by the game after swept paddle/ball contact. Exclude assisted serves:
  // each human must return a ball after it has legally bounced on their side.
  const until=Date.now()+60000;
  while(Date.now()<until) {
    for(const frame of controls)if(await frame.locator('#tt-touch-stroke').isEnabled())await frame.locator('#tt-touch-stroke').click();
    if(await host.evaluate(()=>[1,2].every(player=>window.__party.some(e=>e.type==='wee:game-hit'&&e.player===player&&e.duringPhase==='rally'))))break;
    await host.waitForTimeout(350);
  }
  assert.ok(await host.evaluate(()=>[1,2].every(player=>window.__party.some(e=>e.type==='wee:game-hit'&&e.player===player&&e.duringPhase==='rally'))),'each human controller must produce a real rally contact, excluding assisted serves');
  pass('Both human table-tennis players produce real rally contacts through their own controller, excluding assisted serves');
  await phones[0].evaluate(()=>{dispatchEvent(new Event('blur'));dispatchEvent(new Event('scroll'));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));});
  await host.waitForTimeout(500);
  assert.equal(await host.getByText(/Waiting for .* reconnect|finish controller setup/).count(),0);
  pass('Ordinary scroll, blur and duplicate pageshow do not pause the room');
  assert.deepEqual(errors,[]);pass('No uncaught browser errors');
  const report={recordedAt:new Date().toISOString(),base,checks,errors,limitations:['Generated browser/button input and software WebGL; not physical phone comfort or end-to-end latency measurements.']};
  if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
 }catch(error){for(const c of browser.contexts())for(const p of c.pages())console.error('PAGE_STATE',p.url(),await p.locator('body').innerText().catch(()=>''));throw error;}
 finally{for(const s of sockets)s.disconnect();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
