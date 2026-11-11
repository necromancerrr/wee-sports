import {expect, test} from 'vitest';
import {createStrokeIntentDetector} from '@wee/src/tabletennis/strokeIntent.js';

const input = (axis, rate, aim = 0) => ({angularVelocity: {x: 0, y: 0, z: 0, [axis]: rate}, reach: {x: aim, y: 0}});

test('a gentle aim change is current at the next swing without requiring a full stop', () => {
  for (const direction of [-1,1]) {
    const detector = createStrokeIntentDetector();
    detector.push(input('y',0,-direction*.7),0);
    for (let i=1;i<=30;i++) expect(detector.push(input('y',.8,direction*.7),i/60)).toBeNull();
    let gesture;
    for (let i=31;i<=35;i++) gesture = detector.push(input('y',direction*4,-direction*.9),i/60) || gesture;
    expect(gesture.aim.x).toBe(direction*.7);
  }
});

test('forehand and backhand bursts work in every phone axis at realistic sensor cadences', () => {
  for (const hz of [30, 60, 100]) for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
    const detector = createStrokeIntentDetector(), requests = [];
    detector.push(input(axis, 0, .4), 0);
    for (let index = 1; index <= hz; index++) {
      const time = index / hz, phase = (time - .15) / .24;
      const rate = phase >= 0 && phase <= 1 ? sign * 4 * Math.sin(phase * Math.PI) : 0;
      const request = detector.push(input(axis, rate, time > .18 ? -.8 : .4), time);
      if (request) requests.push(request);
    }
    expect(requests, `${hz} Hz ${sign} ${axis}`).toHaveLength(1);
    expect(requests[0].aim.x).toBe(.4);
  }
});

test('isolated tiny spikes, slow aiming, and stationary input cannot request contact', () => {
  const detector = createStrokeIntentDetector(), requests = [];
  for (let index = 0; index < 240; index++) {
    const rate = index === 40 ? 1.6 : index > 60 && index < 180 ? .8 : 0;
    const request = detector.push(input('y', rate), index / 60);
    if (request) requests.push(request);
  }
  expect(requests).toHaveLength(0);
});

test('gentle compact strokes still register when a low-rate sensor misses the exact peak', () => {
  for (const hz of [30, 60, 100]) {
    const detector = createStrokeIntentDetector(), requests = [];
    for (let index = 0; index <= hz; index++) {
      const time = index / hz, phase = (time - .151) / .24;
      const request = detector.push(input('z', phase >= 0 && phase <= 1 ? 1.2 * Math.sin(phase * Math.PI) : 0), time);
      if (request) requests.push(request);
    }
    expect(requests).toHaveLength(1);
  }
});

test('a held rate and reversed follow-through stay one burst until continuous quiet', () => {
  const detector = createStrokeIntentDetector(), requests = [];
  detector.push(input('x', 0), 0);
  for (let index = 1; index <= 120; index++) {
    const rate = index < 30 ? 4 : index < 60 ? -4 : index < 63 ? 0 : 4;
    const request = detector.push(input('x', rate), index / 60);
    if (request) requests.push(request);
  }
  // Only 50 ms of quiet is insufficient to turn the recoil into another hit.
  expect(requests).toHaveLength(1);
  for (let index = 121; index <= 125; index++) detector.push(input('x', 0), index / 60);
  for (let index = 126; index <= 130; index++) {
    const request = detector.push(input('z', 4), index / 60);
    if (request) requests.push(request);
  }
  expect(requests).toHaveLength(2);
});

test('gaps and explicit interruption discard partially accumulated motion', () => {
  const detector = createStrokeIntentDetector();
  detector.push(input('x', 0), 0);
  expect(detector.push(input('x', 3), .02)).toBeNull();
  expect(detector.push(input('x', 0), .4)).toBeNull();
  expect(detector.active).toBeNull();
  expect(detector.push(input('x', 3), .42)).toBeNull();
  detector.reset();
  expect(detector.push(input('x', 3), .44)).toBeNull();
  expect(detector.active).toBeNull();
});

test('sensor jitter and duplicate timestamps do not create extra strokes or mutate intent', () => {
  const detector = createStrokeIntentDetector(), requests = [];
  detector.push(input('y', 0, -.5), 0);
  let now = 0;
  for (let index = 1; index <= 40; index++) {
    now += index % 2 ? .012 : .021;
    const request = detector.push(input('y', index < 16 ? 3 : 0, .9), now);
    if (request) requests.push(request);
    expect(detector.push(input('x', 20, 1), now)).toBeNull();
  }
  expect(requests).toHaveLength(1);
  expect(requests[0].aim.x).toBe(-.5);
  requests[0].aim.x = 1;
  expect(detector.active).toBeNull();
});

test('continuous casual wrist swings rearm at their valleys without requiring stillness', () => {
  for (const hz of [30, 60, 100]) for (const carry of [0, .6, .8]) {
    const detector = createStrokeIntentDetector(), requests = [];
    for (let index = 0; index < hz * 4; index++) {
      const time = index / hz;
      const sample = input('y', 3 * Math.sin(time * Math.PI * 2 / .7));
      sample.angularVelocity.z = carry;
      const gesture = detector.push(sample, time);
      if (gesture) requests.push(gesture);
    }
    expect(requests.length, `${hz}Hz with ${carry}rad/s wrist carry`).toBeGreaterThanOrEqual(10);
    expect(requests.length).toBeLessThanOrEqual(12);
  }
});

test('classification follows the accumulated swing rather than a reversed final sample', () => {
  for(const hand of ['Right','Left']) for(const direction of [-1,1]) {
    const detector=createStrokeIntentDetector();
    const factor=hand==='Right'?1:-1;
    detector.push({...input('y',0),hand},0);
    expect(detector.push({...input('y',direction*factor*2),hand},.02)).toBeNull();
    expect(detector.push({...input('y',direction*factor*2),hand},.035)).toBeNull();
    const swing=detector.push({...input('y',-direction*factor),hand},.045);
    expect(swing).toMatchObject({kind:direction===-1?'forehand':'backhand',direction,hand});
    expect(Math.sign(swing.spin.y)).toBe(direction*factor);
  }
});
