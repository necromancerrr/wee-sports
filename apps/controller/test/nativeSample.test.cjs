const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Expo iOS and Android gravity-down fixtures produce the same screen-up bowling aim', async () => {
  const { nativeDeviceMotionFields, nativeBowlingSupportVector } = await import('../src/nativeSample.js');
  const { normalizeWebMotion } = await import('../../../shared/motion.js');
  const { bowlingTiltAim } = await import('../../../src/controller/motionGestures.js');
  const g = 9.80665;
  for (const degrees of [-25, 0, 25]) {
    const support = { x: Math.sin(degrees * Math.PI / 180) * g, y: 0, z: Math.cos(degrees * Math.PI / 180) * g };
    const linear = { x: .25, y: -.4, z: .1 };
    // Exact formulas from installed expo-sensors 58.0.4 native sources.
    const ios = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, linear[axis] - support[axis]]));
    const android = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (linear[axis] + support[axis]) - 2 * support[axis]]));
    const browser = normalizeWebMotion({ acceleration: linear,
      accelerationIncludingGravity: Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, linear[axis] + support[axis]])) }, {timeSeconds:1,sequence:1});
    for (const total of [ios, android]) {
      const sample = nativeDeviceMotionFields({acceleration:linear,accelerationIncludingGravity:total});
      assert.ok(sample.gravity.z < 0, 'canonical native gravity remains physical down');
      const aim = bowlingTiltAim(nativeBowlingSupportVector(sample.gravity), 0);
      assert.ok(Math.abs(aim - bowlingTiltAim(browser.gravity, 0)) < 1e-12);
      if (degrees) assert.notEqual(aim, 0, 'left/right tilt must change aim');
    }
  }
});

test('native gravity requires real linear and total acceleration and strips timestamp metadata', async () => {
  const { nativeDeviceMotionFields, nativeBowlingSupportVector } = await import('../src/nativeSample.js');
  assert.equal(nativeDeviceMotionFields({accelerationIncludingGravity:{x:0,y:0,z:-9.8}}).gravity, undefined);
  assert.equal(nativeDeviceMotionFields({acceleration:{x:0,y:null,z:0},accelerationIncludingGravity:{x:0,y:0,z:-9.8}}).gravity, undefined);
  assert.deepEqual(nativeDeviceMotionFields({acceleration:{x:1,y:2,z:3,timestamp:999}}), {acceleration:{x:1,y:2,z:3}});
  assert.equal(nativeBowlingSupportVector(undefined), undefined);
});
