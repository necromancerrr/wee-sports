const {test} = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const {TouchPaddleStream} = await import('../src/touchPaddle.js');
  let now = 1000, active = true, nextId = 1;
  const timers = new Map(), sent = [];
  const stream = new TouchPaddleStream({send:pose=>sent.push({time:now,...pose}),playing:()=>active,now:()=>now,
    schedule:fn=>{const id=nextId++;timers.set(id,fn);return id;},cancel:id=>timers.delete(id)});
  return {stream,sent,timers,tick(ms=17){now+=ms;for(const fn of timers.values()) fn();},active(value){active=value;}};
}

test('an idle native touch paddle stays fresh before the first drag and after finger release', async () => {
  const {stream,sent,tick,timers} = await fixture();
  stream.start();stream.start();
  assert.equal(timers.size,1);
  for(let i=0;i<90;i++) tick();
  assert.equal(sent.length,91);
  assert.ok(sent.every(pose=>pose.angularVelocity.x===0 && pose.angularVelocity.y===0));
  assert.deepEqual(sent.at(-1).reach,{x:0,y:0});
  stream.move({x:.4,y:-.2},true);tick();stream.release();
  for(let i=0;i<60;i++) tick();
  assert.deepEqual(sent.at(-1).reach,{x:.4,y:-.2},'lifting a finger holds the paddle in place');
  for(let i=1;i<sent.length;i++) assert.ok(sent[i].time-sent[i-1].time<500,'host never marks an idle touch paddle stale');
  stream.stop();
});

test('touch stroke velocity expires and does not repeat after release or a new touch', async () => {
  const {stream,sent,tick} = await fixture();
  stream.start();stream.move({x:0,y:0},true);tick();stream.move({x:.3,y:.2});
  assert.ok(sent.at(-1).angularVelocity.x>0 && sent.at(-1).angularVelocity.y>0);
  tick(71);
  assert.deepEqual(sent.at(-1).angularVelocity,{x:0,y:0,z:0});
  stream.release();tick();
  assert.deepEqual(sent.at(-1).angularVelocity,{x:0,y:0,z:0});
  stream.move({x:-.8,y:.8},true);
  assert.deepEqual(sent.at(-1).angularVelocity,{x:0,y:0,z:0},'touch-down never teleports with swing velocity');
  stream.stop();
});

test('paused, inactive and disconnected touch input cannot send or replay a pending stroke', async () => {
  const {stream,sent,tick,active} = await fixture();
  stream.start();stream.move({x:0,y:0},true);tick();stream.move({x:.3,y:.2});
  active(false);const before=sent.length;
  for(let i=0;i<60;i++) tick();
  stream.move({x:-1,y:1});stream.release();
  assert.equal(sent.length,before);
  active(true);tick();
  assert.deepEqual(sent.at(-1).angularVelocity,{x:0,y:0,z:0});
  assert.deepEqual(sent.at(-1).reach,{x:.3,y:.2},'inactive movement is discarded');
  stream.stop();
});

test('leaving touch mode stops its heartbeat and a new match resets paddle position', async () => {
  const {stream,sent,tick,timers} = await fixture();
  stream.start();stream.move({x:.7,y:.6},true);stream.stop();
  const before=sent.length;tick(1000);stream.move({x:-1,y:-1});stream.release();
  assert.equal(sent.length,before);assert.equal(timers.size,0);
  stream.reset();stream.start();
  assert.deepEqual(sent.at(-1).reach,{x:0,y:0});
  assert.deepEqual(sent.at(-1).angularVelocity,{x:0,y:0,z:0});
  assert.equal(timers.size,1);stream.stop();
});

test('a touch drag plus a long idle heartbeat produces only one TV stroke', async () => {
  const {createStrokeIntentDetector} = await import('../../../src/tabletennis/strokeIntent.js');
  const {stream,sent,tick} = await fixture();
  stream.start();tick();stream.move({x:0,y:0},true);tick();
  stream.move({x:.3,y:.2});tick();tick();stream.release();
  for(let i=0;i<120;i++) tick();
  const detector = createStrokeIntentDetector(), strokes = [];
  for(const pose of sent) {
    const stroke = detector.push(pose,pose.time/1000);
    if(stroke) strokes.push(stroke);
  }
  assert.equal(strokes.length,1,'neutral freshness frames must not become extra serves or returns');
  stream.stop();
});
