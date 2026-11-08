import {expect, test} from 'vitest';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {classifyStroke, createStrokeIntentDetector} from '../src/tabletennis/strokeIntent.js';
import {shotIntent} from '../src/tabletennis/shot.js';
import {createPaddleIntentController, normalizeNativeGyroscope, normalizeWebMotion} from '../shared/motion.js';

const pose = (angularVelocity = {x: 0, y: 0, z: 0}, hand = 'Right', aim = 0) => ({
  orientation: [0, 0, 0, 1], angularVelocity, hand, reach: {x: aim, y: 0}, calibrationRevision: 1,
});

test('an idle human paddle and target remain still while an incoming ball crosses the table', () => {
  for (const player of [1, 2]) {
    const game = new TableTennisGame(); game.startMatch({players: 2}); game.nextFeed = Infinity;
    for (let i = 0; i < 120; i++) {for (const p of [1, 2]) game.setInput(pose(), {player: p}); game.update(1 / 120);}
    const paddle = game.physics.paddles[player - 1];
    const initial = {position: {...paddle.position}, normal: {...paddle.normal}};
    const sign = player === 1 ? 1 : -1;
    game.rules.beginPoint();
    game.physics.launch({x: .25, y: 1.08, z: -.95 * sign}, {x: -.08, y: 1.2, z: 3.45 * sign});
    for (let frame = 0; frame < 120; frame++) {
      // Tiny hand tremor and orientation-estimate noise must not animate an
      // unswung paddle. Motion is too small to qualify as a real gesture.
      for (const p of [1, 2]) game.setInput(pose({x: .03, y: -.04, z: .02}, 'Right', .015 * Math.sin(frame)), {player: p});
      game.update(1 / 120);
      expect(paddle.position).toEqual(initial.position);
      expect(paddle.normal).toEqual(initial.normal);
      expect(paddle.enabled).toBe(false);
      expect(game.players[player - 1].aimTarget.x).toBe(0);
    }
  }
});

test('deliberate pointing moves a bounded ready pose without following the ball or triggering contact', () => {
  const game = new TableTennisGame(); game.nextFeed = Infinity;
  for (let frame = 0; frame < 90; frame++) {game.setInput(pose(undefined, 'Right', 1)); game.update(1 / 60);}
  expect(game.physics.paddles[0].position).toEqual({x: .2, y: 1.02, z: 1.45});
  expect(game.aimTarget.x).toBe(.55);
  expect(game.physics.paddles[0].enabled).toBe(false);
});

test('both players keep their selected hand through serve, pause and recenter boundaries', () => {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  for (const player of [1, 2]) game.setInput(pose(undefined, 'Left'), {player});
  expect(game.players.map(player => player.stroke.hand)).toEqual(['Left', 'Left']);
  game.serve();
  expect(game.players.map(player => player.stroke.hand)).toEqual(['Left', 'Left']);
  game.paused = true; game.update(.02);
  expect(game.players.map(player => player.stroke.hand)).toEqual(['Left', 'Left']);
  game.physics.ball.active = false;
  for (const player of [1, 2]) game.recenter(player);
  expect(game.players.map(player => player.stroke.hand)).toEqual(['Left', 'Left']);
});

test('forehand/backhand labels mirror hand preference while pitch remains a neutral drive', () => {
  for (const axis of ['y', 'z']) for (const hand of ['Right', 'Left']) {
    const forward = hand === 'Right' ? -3 : 3;
    expect(classifyStroke(pose({x: 0, y: 0, z: 0, [axis]: forward}, hand)))
      .toEqual({kind: 'forehand', direction: -1, hand});
    expect(classifyStroke(pose({x: 0, y: 0, z: 0, [axis]: -forward}, hand)))
      .toEqual({kind: 'backhand', direction: 1, hand});
    for (const pitch of [-5, 5]) expect(classifyStroke(pose({x: pitch, y: .2, z: .1}, hand)))
      .toEqual({kind: 'drive', direction: 0, hand});
  }
});

test('small cross-axis noise in a diagonal stroke cannot reverse its landing side', () => {
  for (const hand of ['Left', 'Right']) for (const sign of [-1, 1]) {
    for (const jitter of [-.02, -.01, 0, .01, .02]) {
      const input = pose({x: .1, y: sign * (2 + jitter), z: -sign * (2 - jitter)}, hand);
      const classification = classifyStroke(input);
      expect(classification).toEqual({kind: 'drive', direction: 0, hand});
      expect(shotIntent(input, 1, classification).target.x).toBe(0);
    }
  }
  expect(shotIntent(pose(undefined, 'Left')).hand).toBe('Left');
});

test('web/native device axes map the same screen-relative swing across every screen rotation', () => {
  for (const native of [false, true]) for (const screenAngle of [0, 90, 180, 270]) for (const hand of ['Left', 'Right']) {
    const paddle = createPaddleIntentController(), detector = createStrokeIntentDetector();
    const radians = screenAngle * Math.PI / 180;
    let stroke;
    for (let index = 0; index < 20; index++) {
      // Inverse screen rotation represents the same physical sideways action,
      // rather than incorrectly replaying unchanged device axes after rotation.
      const canonicalY = index > 2 ? hand === 'Right' ? -3 : 3 : 0;
      const device = {x: -Math.sin(radians) * canonicalY, y: Math.cos(radians) * canonicalY, z: 0};
      const options = {timeSeconds: index / 60, sequence: index, screenAngle};
      const normalized = native ? normalizeNativeGyroscope(device, options) : normalizeWebMotion({rotationRate: {
        alpha: device.x * 180 / Math.PI, beta: device.y * 180 / Math.PI, gamma: 0,
      }}, options);
      const intent = paddle.push(normalized);
      const gesture = detector.push({...intent, hand}, index / 60);
      if (gesture) stroke = gesture;
    }
    expect(stroke, `${native ? 'native' : 'web'} ${screenAngle} ${hand}`).toMatchObject({kind: 'forehand', direction: -1, hand});
  }
});

test('stroke direction is a tendency, with deliberate aim able to override either side', () => {
  for (const player of [1, 2]) for (const hand of ['Left', 'Right']) {
    const forehand = {kind: 'forehand', direction: -1, hand}, backhand = {kind: 'backhand', direction: 1, hand};
    expect(shotIntent(pose(), player, forehand).target.x).toBe(-.2);
    expect(shotIntent(pose(), player, backhand).target.x).toBe(.2);
    expect(shotIntent(pose(undefined, hand, 1), player, forehand).target.x).toBeGreaterThan(.4);
    expect(shotIntent(pose(undefined, hand, -1), player, backhand).target.x).toBeLessThan(-.4);
    for (const aim of [-1, -.5, 0, .5, 1]) for (const stroke of [forehand, backhand]) {
      expect(Math.abs(shotIntent(pose(undefined, hand, aim), player, stroke).target.x)).toBeLessThanOrEqual(.58);
    }
  }
});
