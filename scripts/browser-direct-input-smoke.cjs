// Real Chromium RTC peers and the actual authenticated Socket.IO broker.
// A controlled delay on the relay route demonstrates bypass, not WAN latency.
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {writeFileSync} = require('node:fs');
const {chromium} = require('playwright');

const pageHtml = `<!doctype html><title>Direct input verification</title>
<script src="/socket.io/socket.io.js"></script><script type="module">
import {createDirectInput} from '/client/src/lib/directInput.js';
const ActualPeer = window.RTCPeerConnection;
window.channels=[];window.peerConnections=[];window.received=[];window.feedback=[];window.counters={};window.rtts=[];window.iceEvents=[];
window.RTCPeerConnection = class extends ActualPeer {
 constructor(options) {super(options);window.peerConnections.push(this);this.addEventListener('datachannel',event=>window.channels.push(event.channel));this.addEventListener('icecandidate',event=>window.iceEvents.push({present:Boolean(event.candidate),json:typeof event.candidate?.toJSON,type:event.candidate?.type,protocol:event.candidate?.protocol}));}
 createDataChannel(...args) {const channel=super.createDataChannel(...args);window.channels.push(channel);return channel;}
};
window.socket=io({transports:['websocket'],reconnection:false});window.negotiation=[];
window.socket.onAny((name,payload)=>{if(name.startsWith('direct:'))window.negotiation.push({name,role:payload?.role,type:payload?.description?.type,reason:payload?.reason,candidate:Boolean(payload?.candidate?.candidate)});});
window.req=(event,payload)=>window.socket.timeout(3000).emitWithAck(event,payload);
const seen=new Set();
const accept=event=>{if(seen.has(event.id))return true;seen.add(event.id);window.received.push(event);return true;};
window.socket.on('game:swing',(event,ack)=>setTimeout(()=>ack({ok:accept(event)}),120));
window.socket.on('game:pose',event=>window.received.push(event));
window.make=context=>{window.context=context;window.direct=createDirectInput({socket:window.socket,context,
 onSwing:accept,onPose:event=>{window.received.push(event);return true;},onStrokeResult:event=>window.feedback.push(event),
 diagnostics:{count:name=>window.counters[name]=(window.counters[name]||0)+1,observe:(name,value)=>{if(name==='direct.roundTripMs')window.rtts.push(value);}}});};
window.swing=async event=>{const started=performance.now(),direct=window.direct.sendSwing(event);
 const result=direct===null?await window.req('player:swing',event):await direct;
 return {result,route:direct===null?'relay':'direct',elapsed:performance.now()-started};};
window.loaded=true;
</script>`;

(async()=>{
  const [{createServer},{createGameServer},{RoomStore},{EVENTS,PROTOCOL_VERSION:v},{createControllerCapabilities}]=await Promise.all([
    import('vite'),import('../server/src/app.js'),import('../server/src/RoomStore.js'),import('../shared/protocol.js'),import('../shared/controllerCapabilities.js')]);
  const vite=await createServer({root:process.cwd(),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  let clock=0;
  const store=new RoomStore({now:()=>clock});
  const server=createGameServer({store,requestHandler:(request,response)=>{
    if(request.url==='/__direct_test'){response.setHeader('Content-Type','text/html');response.end(pageHtml);return;}
    vite.middlewares(request,response,()=>{response.statusCode=404;response.end();});
  }});
  const relayCounts={swing:0,pose:0};
  server.io.on('connection',socket=>socket.onAny(event=>{
    if(event===EVENTS.PLAYER_SWING)relayCounts.swing++;
    if(event===EVENTS.PLAYER_POSE)relayCounts.pose++;
  }));
  server.http.listen(0,'127.0.0.1');await once(server.http,'listening');
  const base='http://127.0.0.1:'+server.http.address().port;
  const browser=await chromium.launch({executablePath:process.env.WEE_SMOKE_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const checks=[],errors=[],timings={},expectNoIce=process.env.WEE_SMOKE_EXPECT_NO_ICE==='1';
  const pass=value=>{checks.push(value);console.log('PASS',value);};
  const request=(page,event,payload)=>page.evaluate(([event,payload])=>window.req(event,payload),[event,payload]);
  try {
    for(const sport of ['tennis','table-tennis']){
      const hostContext=await browser.newContext(),phoneContext=await browser.newContext();
      const host=await hostContext.newPage(),phone=await phoneContext.newPage();
      for(const page of [host,phone]){page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/__direct_test');await page.waitForFunction(()=>window.loaded&&window.socket.connected);}
      const capabilities=createControllerCapabilities({buttons:true});
      const room=await request(host,EVENTS.HOST_CREATE,{v,sport,capabilities});assert.equal(room.ok,true);
      assert.equal((await request(phone,EVENTS.PLAYER_JOIN,{v,code:room.code,name:'Player',capabilities})).ok,true);
      await request(phone,EVENTS.PLAYER_SETUP,{setup:'buttons'});await request(phone,EVENTS.PLAYER_READY,{ready:true});
      assert.equal((await request(phone,EVENTS.PLAYER_START,{})).ok,true);
      clock+=5000;store.finishCountdown(room.code);
      if(store.lobby(room.code).phase==='vote')await request(phone,EVENTS.TUTORIAL_VOTE,{watch:false});
      const lobby=store.lobby(room.code);assert.equal(lobby.phase,'game');
      const scope={gameId:lobby.gameId,generation:lobby.inputGeneration,hostEpoch:lobby.hostEpoch};
      await host.evaluate(context=>window.make(context),{...scope,role:'host',sport,code:room.code});
      await phone.evaluate(context=>window.make(context),{...scope,role:'player',sport,code:room.code,player:1});
      if(expectNoIce){
        for(const page of [host,phone])await page.waitForFunction(()=>window.peerConnections.some(peer=>peer.localDescription&&peer.remoteDescription&&peer.iceGatheringState==='complete'),{},{timeout:10000});
        for(const page of [host,phone]){
          const state=await page.evaluate(async()=>{
            const peer=window.peerConnections[0],stats=await peer.getStats();let candidates=0;
            stats.forEach(report=>{if(report.type==='local-candidate')candidates++;});
            return {candidates,signaledCandidates:window.negotiation.filter(value=>value.candidate).length,offerOrAnswer:peer.localDescription.type,ice:peer.iceConnectionState,opened:window.counters['direct.opened']||0};
          });
          assert.equal(state.signaledCandidates,0);assert.equal(state.opened,0);assert.equal(state.ice,'new');
        }
        if(sport==='tennis'){
          const before=relayCounts.swing;
          const relayed=await phone.evaluate(event=>window.swing(event),{...scope,type:'swing',id:'policy-fallback',label:'Forehand',hand:'Right',power:.5});
          assert.equal(relayed.route,'relay');assert.equal(relayed.result.ok,true);assert.equal(relayCounts.swing,before+1);
          assert.equal(await host.evaluate(()=>window.received.filter(event=>event.id==='policy-fallback').length),1);
        }else{
          const pose={...scope,seq:1,orientation:[0,0,0,1],angularVelocity:{x:0,y:0,z:0},calibrationRevision:1,sourceTime:123.45,reach:{x:.4,y:0}};
          const before=relayCounts.pose;
          assert.equal(await phone.evaluate(event=>window.direct.sendPose(event),pose),false);
          await phone.evaluate(event=>window.socket.volatile.emit('player:pose',event),pose);
          await host.waitForFunction(()=>window.received.length===1);
          assert.equal((await host.evaluate(()=>window.received[0])).sourceTime,123.45);assert.equal(relayCounts.pose,before+1);
        }
        pass(sport+': real SDP offer/answer completes with zero signaled ICE candidates under browser policy; existing relay delivers the unsent input once');
        assert.equal((await request(host,EVENTS.HOST_PAUSE,{gameId:scope.gameId,paused:true})).ok,true);
        await phone.waitForFunction(()=>window.peerConnections.every(peer=>peer.connectionState==='closed'));
        pass(sport+': server pause revokes the negotiating peer even when direct connectivity is unavailable');
        await request(host,EVENTS.HOST_CLOSE,{code:room.code,token:room.token});
        await hostContext.close();await phoneContext.close();continue;
      }
      for(const page of [host,phone])await page.waitForFunction(()=>window.rtts.length>0&&window.channels.some(channel=>channel.readyState==='open'),{},{timeout:15000});
      await phone.waitForTimeout(600);
      const peerInfo=await phone.evaluate(async()=>{
        const reports=await window.peerConnections[0].getStats();let selected;
        reports.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded')selected=report;});
        return {rttSamples:window.rtts.length,candidate:selected?{state:selected.state,nominated:selected.nominated}:null};
      });
      assert.ok(peerInfo.rttSamples>0);assert.equal(peerInfo.candidate?.state,'succeeded');
      if(sport==='tennis'){
        const stroke=id=>({...scope,type:'swing',id,label:'Forehand',hand:'Right',power:.5,aim:.4,depth:0});
        const before=relayCounts.swing;
        const direct=await phone.evaluate(event=>window.swing(event),stroke('direct-one'));
        assert.equal(direct.route,'direct');assert.equal(direct.result.ok,true);assert.equal(relayCounts.swing,before);
        await host.waitForFunction(()=>window.received.some(event=>event.id==='direct-one'));
        const feedback={gameId:scope.gameId,id:'direct-one',player:1,result:'hit',reason:'Good contact',receivedToContactMs:20};
        assert.equal(await host.evaluate(event=>window.direct.sendStrokeResult(event),feedback),true);
        await phone.waitForFunction(()=>window.feedback.length===1);
        pass('Actual Chromium peers deliver and acknowledge tennis input directly with correlated contact feedback');
        await phone.evaluate(()=>Object.defineProperty(window.channels[0],'bufferedAmount',{configurable:true,get:()=>100}));
        const relayed=await phone.evaluate(event=>window.swing(event),stroke('busy-fallback'));
        assert.equal(relayed.route,'relay');assert.equal(relayed.result.ok,true);assert.equal(relayCounts.swing,before+1);
        await phone.evaluate(()=>delete window.channels[0].bufferedAmount);
        timings.tennis={directRoundTripMs:direct.elapsed,relayWithInjected120msDelay:relayed.elapsed};
        assert.ok(relayed.elapsed>=110);
        assert.ok(direct.elapsed<relayed.elapsed,'the ready peer bypasses the delayed server route');
        pass('A congested direct channel uses the existing relay exactly once; direct input bypasses an injected120ms relay delay');
        await host.evaluate(()=>{const channel=window.channels[0],original=channel.send.bind(channel);channel.send=value=>{if(JSON.parse(value).kind!=='ack')original(value);};});
        const unknown=await phone.evaluate(event=>window.swing(event),stroke('lost-ack'));
        assert.equal(unknown.route,'direct');assert.equal(unknown.result.error,'outcome-unknown');assert.equal(relayCounts.swing,before+1);
        assert.equal(await host.evaluate(()=>window.received.filter(event=>event.id==='lost-ack').length),1);
        pass('A sent swing with a lost acknowledgement stays uncertain and never retries through the relay');
      }else{
        const pose={...scope,seq:1,orientation:[0,0,0,1],angularVelocity:{x:0,y:.3,z:0},calibrationRevision:1,sourceTime:123.45,reach:{x:.4,y:0}};
        const before=relayCounts.pose;
        assert.equal(await phone.evaluate(event=>window.direct.sendPose(event),pose),true);
        await host.waitForFunction(()=>window.received.length>0);
        const received=await host.evaluate(()=>window.received[0]);assert.equal(received.sourceTime,pose.sourceTime);assert.equal(received.player,1);assert.equal(relayCounts.pose,before);
        pass('Actual direct table-tennis poses preserve the sensor sample clock and authoritative player identity');
      }
      assert.equal((await request(host,EVENTS.HOST_PAUSE,{gameId:scope.gameId,paused:true})).ok,true);
      await phone.waitForFunction(()=>window.channels.every(channel=>channel.readyState==='closed'));
      const blocked=await phone.evaluate(scope=>window.direct.sendPose({...scope,seq:99,orientation:[0,0,0,1],angularVelocity:{x:0,y:0,z:0},calibrationRevision:1}),scope);
      assert.equal(blocked,false);
      pass(sport+': authoritative pause closes the actual peer channel and prevents stale local input');
      await request(host,EVENTS.HOST_CLOSE,{code:room.code,token:room.token});
      await hostContext.close();await phoneContext.close();
    }
    assert.deepEqual(errors,[]);
    const report={recordedAt:new Date().toISOString(),mode:expectNoIce?'expected-no-ice-fallback':'direct-delivery',checks,errors,timings,limitations:[
      ...(expectNoIce?['Direct data-channel delivery, RTT and route-bypass speed were NOT verified: managed Chromium disables non-proxied UDP; offer/answer completes but no usable ICE candidates are signaled.']:[
        'Real LAN-style host ICE candidates in two local Chromium contexts; not physical iPhone/TV or Seattle-to-Railway latency.',
        'The relay comparison injects120ms in the test receiver; it is controlled evidence of route bypass, not a measured deployment improvement.']),
      'The managed-policy mode verifies fallback only; the default mode requires successful direct delivery.']};
    if(process.env.WEE_SMOKE_REPORT)writeFileSync(process.env.WEE_SMOKE_REPORT,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  }catch(error){
    for(const context of browser.contexts())for(const page of context.pages())console.error('PEER_STATE',await page.evaluate(()=>({connected:window.socket?.connected,counters:window.counters,negotiation:window.negotiation,iceEvents:window.iceEvents,
      peers:window.peerConnections?.map(peer=>({connection:peer.connectionState,ice:peer.iceConnectionState,signaling:peer.signalingState})),
      channels:window.channels?.map(channel=>({state:channel.readyState,buffered:channel.bufferedAmount})),rtts:window.rtts})).catch(()=>null));
    throw error;
  }finally{await browser.close();await server.close();await vite.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
