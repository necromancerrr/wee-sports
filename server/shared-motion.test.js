import {describe, expect, test, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DEG_TO_RAD, normalizeWebMotion, normalizeNativeGyroscope, toLegacyMotionSample,
  createTimeConstantFilter, createMotionCalibration, applyMotionCalibration, createPaddleIntentController,
  createMotionRecorder, rotateVectorToScreen, orientationFromWebEvent, isMotionSample} from '../shared/motion.js';
import {createWebMotionAdapter, readLegacyWebMotion} from '../src/controller/webMotionAdapter.js';
import {createSwingStream} from '../src/controller/swingStream.js';
import {createBowlingMotionDetector} from '../src/controller/motionGestures.js';
import {createControllerCapabilities, negotiateControllerCapabilities, supportsSport} from '../shared/controllerCapabilities.js';

const options = (timeSeconds = 0, sequence = Math.round(timeSeconds * 1000)) => ({timeSeconds, sequence});
const native = (time, reading = {x: 0, y: 0, z: 0}, more = {}) => normalizeNativeGyroscope(reading, {...options(time), ...more});

test('browser/native gyro units and all three axes agree without changing legacy rates', () => {
  const web = normalizeWebMotion({rotationRate: {alpha: 180, beta: 90, gamma: -45}}, options(1));
  const app = native(1, {x: Math.PI / 2, y: -Math.PI / 4, z: Math.PI});
  expect(web).toEqual(app);
  expect(toLegacyMotionSample(web)).toEqual({timeMs: 1000, rotationAlpha: 180, rotationBeta: 90, rotationGamma: -45});
  expect(readLegacyWebMotion({rotationRate: {alpha: 180, beta: 90, gamma: -45}},
    {timeMs: 1000, timeOriginMs: 500, bias: {alpha: 1, beta: 2, gamma: 3}}).legacy)
    .toEqual({timeMs: 500, rotationAlpha: 179, rotationBeta: 88, rotationGamma: -48});
});

test('missing sensor measurements remain absent and gravity is not confused with linear acceleration', () => {
  expect(normalizeWebMotion({rotationRate: {alpha: null, beta: 0, gamma: 0}}, options())).toBeNull();
  const totalOnly = normalizeWebMotion({accelerationIncludingGravity: {x: 1, y: 2, z: 9.8}}, options());
  expect(totalOnly.angularVelocity).toBeUndefined();
  expect(totalOnly.acceleration).toBeUndefined();
  expect(totalOnly.gravity).toBeUndefined();
  expect(toLegacyMotionSample(totalOnly)).toBeNull();
  const both = normalizeWebMotion({accelerationIncludingGravity: {x: 1, y: 2, z: 10.8}, acceleration: {x: 1, y: 2, z: 1}}, options());
  expect(both.gravity).toEqual({x: 0, y: 0, z: 9.8});
  expect(normalizeNativeGyroscope({x: Infinity, y: 0, z: 0}, options())).toBeNull();
  expect(isMotionSample({...native(0), orientation: {x: 0, y: 0, z: 0, w: 9}})).toBe(false);
});

for (const [fixture, hand] of [['two-forehands-one-backhand', 'Right'], ['four-backhands', 'Right'],
  ['left-mixed', 'Left'], ['left-four-backhands-new', 'Left'], ['left-four-forehands', 'Left']]) {
  test(`normalized recording retains every tennis label and peak: ${fixture}`, () => {
    const data = JSON.parse(readFileSync(new URL(`./fixtures/team-motion/${fixture}.json`, import.meta.url)));
    const samples = data.samples ?? data;
    const original = createSwingStream(hand, {fast: true}), canonical = createSwingStream(hand, {fast: true});
    const before = [], after = [];
    samples.forEach((sample, sequence) => {
      original.push(sample);
      const normalized = normalizeWebMotion({rotationRate: {alpha: sample.rotationAlpha, beta: sample.rotationBeta, gamma: sample.rotationGamma}},
        {timeSeconds: sample.timeMs / 1000, sequence});
      canonical.push(toLegacyMotionSample(normalized));
      before.push(...original.analyze()); after.push(...canonical.analyze());
    });
    expect(after.map(event => event.label)).toEqual(before.map(event => event.label));
    expect(after.length).toBeGreaterThan(0);
    after.forEach((event, i) => expect(event.peakTimeMs).toBeCloseTo(before[i].peakTimeMs, 8));
  });
}

test('native/browser equivalent bowling traces reject backswing and preserve forward release power', () => {
  const webDetector = createBowlingMotionDetector(), appDetector = createBowlingMotionDetector();
  const webResults = [], appResults = [];
  for (let ms = 0; ms <= 1000; ms += 20) {
    const alpha = ms < 200 ? -500 : ms < 400 ? 0 : ms < 700 ? 300 : 0;
    const web = normalizeWebMotion({rotationRate: {alpha, beta: 0, gamma: 0}}, options(ms / 1000));
    const app = native(ms / 1000, {x: 0, y: 0, z: alpha * DEG_TO_RAD});
    const a = webDetector.push(toLegacyMotionSample(web)), b = appDetector.push(toLegacyMotionSample(app));
    if (a) webResults.push({ms, ...a}); if (b) appResults.push({ms, ...b});
  }
  expect(webResults).toEqual(appResults);
  expect(webResults).toHaveLength(1);
  expect(webResults[0].ms).toBeGreaterThanOrEqual(700);
});

test('time-constant filtering reaches the same response at 30, 60 and 100Hz', () => {
  const results = [30, 60, 100].map(hz => {
    const filter = createTimeConstantFilter({timeConstantSeconds: .084}); filter.reset(0, 0);
    for (let i = 1; i <= hz; i++) filter.push(1, i / hz);
    return filter.value;
  });
  expect(results[0]).toBeCloseTo(results[1], 12); expect(results[1]).toBeCloseTo(results[2], 12);
  const filter = createTimeConstantFilter(); filter.reset(0, 0); filter.push(1, .1);
  const value = filter.value;
  expect(filter.push(-1, .09)).toBe(value); expect(filter.push(-1, .1)).toBe(value);
  expect(filter.push(-1, 1)).toBe(-1);
});

test('calibration needs continuous stillness; moving, missing and rotated samples cannot qualify', () => {
  const calibration = createMotionCalibration({durationSeconds: 1, revision: 4});
  let result;
  for (let i = 0; i <= 60; i++) result = calibration.push(native(i / 60, {x: .01, y: 0, z: 0}));
  expect(result.state).toBe('done');
  const corrected = applyMotionCalibration(native(2, {x: .11, y: 0, z: 0}), result.calibration);
  expect(corrected.angularVelocity.x).toBeCloseTo(.1);
  expect(corrected.calibrationRevision).toBe(4);
  expect(applyMotionCalibration(native(2, {x: 0, y: 0, z: 0}, {screenAngle: 90}), result.calibration)).toBeNull();
  calibration.reset();
  for (let i = 0; i <= 60; i++) result = calibration.push(native(i / 60, {x: i % 2 ? 1 : -1, y: 0, z: 0}));
  expect(result.state).toBe('moving');
  calibration.reset();
  for (let i = 0; i < 30; i++) calibration.push(native(i / 60));
  expect(calibration.push(native(3)).progress).toBe(0);
});

test('screen rotation and handedness are explicit; paddle gaps and recenter never create a stroke', () => {
  const rotated = rotateVectorToScreen({x: 1, y: 0, z: 0}, 90);
  expect(rotated.x).toBeCloseTo(0); expect(rotated.y).toBeCloseTo(-1);
  const right = createPaddleIntentController(), left = createPaddleIntentController({hand: 'Left'});
  const first = native(0, {x: 0, y: 5, z: 0});
  expect(right.push(first).angularVelocity).toEqual({x: 0, y: 0, z: 0}); left.push(first);
  const second = native(.01, {x: 0, y: 5, z: 0});
  expect(right.push(second).reach.x).toBeCloseTo(-left.push(second).reach.x);
  expect(right.push(second)).toBeNull();
  expect(right.push(native(1, {x: 0, y: 5, z: 0})).angularVelocity).toEqual({x: 0, y: 0, z: 0});
  right.recenter();
  expect(right.push(native(1.01, {x: 0, y: 5, z: 0})).orientation).toEqual([0, 0, 0, 1]);
  expect(right.push(native(1.02, {x: 0, y: 5, z: 0}, {calibrationRevision: 1})).angularVelocity).toEqual({x: 0, y: 0, z: 0});
});

test('relative orientation crosses 360 degrees without an Euler discontinuity', () => {
  const controller = createPaddleIntentController();
  controller.push(native(0, {x: 0, y: 0, z: 1}, {orientation: orientationFromWebEvent({alpha: 359, beta: 0, gamma: 0})}));
  const pose = controller.push(native(.01, {x: 0, y: 0, z: 1}, {orientation: orientationFromWebEvent({alpha: 1, beta: 0, gamma: 0})}));
  expect(Math.abs(pose.orientation[2])).toBeLessThan(.02);
  expect(Math.abs(pose.orientation[3])).toBeGreaterThan(.99);
});

test('bounded opt-in traces contain only motion fields and cannot retain tokens', () => {
  const recorder = createMotionRecorder({maxSamples: 2});
  for (let i = 0; i < 3; i++) recorder.record({...native(i), token: 'private', angularVelocity: {x: 0, y: 0, z: 0, token: 'private'}});
  const trace = recorder.export();
  expect(trace.samples).toHaveLength(2); expect(trace.samples[0].sequence).toBe(1000);
  expect(JSON.stringify(trace)).not.toContain('private');
  trace.samples.length = 0; expect(recorder.export().samples).toHaveLength(2);
});

describe('browser adapter', () => {
  function fixture() {
    let time = 0;
    const target = new EventTarget(), document = new EventTarget();
    Object.assign(target, {isSecureContext: true, DeviceMotionEvent: {}, screen: {orientation: {angle: 0}}});
    document.hidden = false;
    const samples = [], resets = [];
    const adapter = createWebMotionAdapter({target, document, clock: () => time, onSample: s => samples.push(s), onReset: r => resets.push(r)});
    const emit = () => {time += .02; target.dispatchEvent(Object.assign(new Event('devicemotion'), {rotationRate: {alpha: 0, beta: 1, gamma: 2}}));};
    return {target, document, samples, resets, adapter, emit};
  }
  test('listeners suspend on background/pagehide and are removed on dispose', async () => {
    const f = fixture(); await f.adapter.start(); f.emit(); expect(f.samples).toHaveLength(1);
    f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); f.emit(); expect(f.samples).toHaveLength(1);
    f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); f.emit(); expect(f.samples).toHaveLength(2);
    f.target.dispatchEvent(new Event('pagehide')); f.emit(); expect(f.samples).toHaveLength(2);
    f.target.dispatchEvent(new Event('pageshow')); f.emit(); expect(f.samples).toHaveLength(3);
    f.target.screen.orientation.angle = 90; f.emit(); expect(f.resets).toContain('screen-rotation');
    f.adapter.dispose(); f.emit(); expect(f.samples).toHaveLength(4);
    await expect(f.adapter.start()).rejects.toThrow('disposed');
  });
  test('cancelled permission cannot revive a stopped adapter; denial leaves touch available', async () => {
    const f = fixture(); let grant;
    f.target.DeviceMotionEvent = {requestPermission: () => new Promise(resolve => {grant = resolve;})};
    const pending = f.adapter.start(); f.adapter.stop(); grant('granted'); await pending;
    f.emit(); expect(f.samples).toHaveLength(0); expect(f.adapter.active).toBe(false);
    f.target.DeviceMotionEvent.requestPermission = vi.fn(async () => 'denied');
    await expect(f.adapter.start()).rejects.toThrow('Touch controls');
    expect(f.adapter.active).toBe(false);
  });
});

test('capability negotiation keeps legacy clients on supported sports and haptics optional', () => {
  const legacy = negotiateControllerCapabilities();
  expect(supportsSport(legacy.capabilities, 'bowling')).toBe(true);
  expect(supportsSport(legacy.capabilities, 'table-tennis')).toBe(false);
  const offer = createControllerCapabilities({haptics: false});
  const negotiated = negotiateControllerCapabilities({...offer, privateToken: 'not-retained'});
  expect(negotiated.ok).toBe(true); expect(supportsSport(negotiated.capabilities, 'table-tennis')).toBe(true);
  expect(negotiated.capabilities.haptics).toBe(false); expect(negotiated.capabilities.privateToken).toBeUndefined();
  expect(negotiateControllerCapabilities({...offer, protocol: {major: 100, minor: 0}}).ok).toBe(false);
  expect(negotiateControllerCapabilities({...offer, sports: {'future-game': 1}}).error).toBe('unsupported-sport');
  expect(negotiateControllerCapabilities({...offer, sports: {'table-tennis': 0}}).ok).toBe(false);
});
