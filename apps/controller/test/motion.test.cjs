const { test } = require('node:test');
const assert = require('node:assert/strict');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function sensor() {
  return { listeners: new Set(), requestPermissionsAsync: async () => ({ granted: true }),
    isAvailableAsync: async () => true, setUpdateInterval() {},
    addListener(fn) { this.listeners.add(fn); return { remove: () => this.listeners.delete(fn) }; } };
}
async function fixture() {
  const { MotionController } = await import('../src/motionCore.js');
  const sensors = { Gyroscope: sensor(), DeviceMotion: sensor() };
  const session = { seat: { sport: 'table-tennis' }, latest() {}, playing: () => true };
  return { sensors, controller: new MotionController({ session, sensors }) };
}

test('background while permission is pending cannot restart native sensors', async () => {
  const { sensors, controller } = await fixture();
  const permission = deferred();
  sensors.Gyroscope.requestPermissionsAsync = () => permission.promise;
  const pending = controller.calibrate();
  controller.stop(); permission.resolve({ granted: true }); await pending;
  assert.equal(controller.active, false);
  assert.equal(sensors.Gyroscope.listeners.size, 0);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
});

test('background during gravity availability cannot resurrect an old calibration', async () => {
  const { sensors, controller } = await fixture();
  const availability = deferred();
  sensors.DeviceMotion.isAvailableAsync = () => availability.promise;
  const pending = controller.calibrate();
  await new Promise(resolve => setImmediate(resolve));
  controller.stop(); availability.resolve(true); await pending;
  assert.equal(controller.active, false);
  assert.equal(sensors.Gyroscope.listeners.size, 0);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
});

test('a missing optional gravity sensor still allows gyro control and stop unsubscribes', async () => {
  const { sensors, controller } = await fixture();
  sensors.DeviceMotion.isAvailableAsync = async () => false;
  await controller.calibrate();
  assert.equal(sensors.Gyroscope.listeners.size, 1);
  assert.equal(sensors.DeviceMotion.listeners.size, 0);
  controller.stop();
  assert.equal(sensors.Gyroscope.listeners.size, 0);
});

test('native automatic setup accepts fresh moving samples but never streams before server setup', async () => {
  const {MotionController} = await import('../src/motionCore.js');
  let now = 1000;
  const statuses = [], poses = [];
  const session = {seat:{sport:'table-tennis',gameState:{phase:'rally'}},playing:()=>true,latest:(kind,value)=>poses.push({kind,value})};
  const sensors = {Gyroscope:sensor(),DeviceMotion:sensor()};
  const controller = new MotionController({session,sensors,now:()=>now,onStatus:value=>statuses.push(value)});
  await controller.calibrate();
  for (let index=0;index<5;index++) {controller.sample({x:1,y:.2,z:0}); now +=40;}
  assert.ok(statuses.some(value=>value.state === 'ready'),'motion need not be stationary to play');
  assert.equal(poses.length,0,'freshness alone is not server authorization');
  session.inputSetup = 'motion';
  controller.sample({x:1,y:.2,z:0});
  assert.equal(poses.length,1);
  controller.resetInput(); now +=40; controller.sample({x:1,y:.2,z:0});
  assert.equal(poses.length,2,'new input generation cancels movement without restarting setup in a loop');
  controller.stop();
});
