import {expect, test} from 'vitest';
import {paddlePresentation} from '../src/tabletennis/paddlePresentation.js';

test('every enabled contact face remains exactly aligned to physics', () => {
  for (const phase of ['ready', 'queued', 'forward', 'recovery']) {
    for (const kind of ['forehand', 'backhand', 'drive']) {
      expect(paddlePresentation({phase, kind, elapsed: .12, enabled: true}))
        .toEqual({x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0});
    }
  }
});

test('forehand and backhand wind up on opposite sides, then follow through across them', () => {
  const forehand = paddlePresentation({phase: 'queued', kind: 'forehand', elapsed: .12});
  const backhand = paddlePresentation({phase: 'queued', kind: 'backhand', elapsed: .12});
  expect(forehand.x).toBeLessThan(0); expect(backhand.x).toBeGreaterThan(0);
  expect(paddlePresentation({phase: 'recovery', kind: 'forehand', elapsed: .1}).x).toBeGreaterThan(0);
  expect(paddlePresentation({phase: 'recovery', kind: 'backhand', elapsed: .1}).x).toBeLessThan(0);
  expect(paddlePresentation({phase: 'queued', kind: 'forehand', hand: 'Left', elapsed: .12}).x).toBe(-forehand.x);
  expect(paddlePresentation({phase: 'queued', kind: 'drive', elapsed: .12}).x).toBe(0);
  for (const player of [1, 2]) for (const direction of [-1, 1]) {
    const localXToScreen = player === 1 ? -1 : 1;
    const windup = paddlePresentation({phase: 'queued', direction, player, elapsed: .12});
    const finish = paddlePresentation({phase: 'recovery', direction, player, elapsed: .12});
    expect(Math.sign(windup.x * localXToScreen)).toBe(-direction);
    expect(Math.sign(finish.x * localXToScreen)).toBe(direction);
  }
});

test('the held paddle stays still and reduced motion removes decorative offsets', () => {
  expect(paddlePresentation({elapsed: 0})).toEqual(paddlePresentation({elapsed: 900}));
  for (const phase of ['ready', 'queued', 'forward', 'recovery']) {
    expect(paddlePresentation({phase, kind: 'forehand', elapsed: .1, reducedMotion: true}))
      .toEqual({x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0});
  }
});
