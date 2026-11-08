import {expect, test} from 'vitest';
import {TableTennisGame} from '../src/tabletennis/game.js';

const pose = (aim, rate = 0) => ({orientation: [0, 0, 0, 1],
  reach: {x: aim, y: 0}, angularVelocity: {x: 0, y: rate, z: 0}});

test('the live aim marker accepts deliberate pointing without waiting for a physics tick', () => {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  for (const player of [1, 2]) {
    const sign = player === 1 ? 1 : -1;
    game.setInput(pose(.7), {player});
    expect(game.players[player - 1].aimTarget.x).toBeCloseTo(sign * .7 * .55);
    game.setInput(pose(.715), {player});
    expect(game.players[player - 1].aimTarget.x).toBeCloseTo(sign * .7 * .55);
    game.setInput(pose(-.7), {player});
    expect(game.players[player - 1].aimTarget.x).toBeCloseTo(-sign * .7 * .55);
    expect(game.physics.ball.active).toBe(false);
  }
});

test('gentle turning follows small aim steps instead of accumulating a resting deadband', () => {
  let now = 0;
  const game = new TableTennisGame({now: () => now}); game.startMatch({players: 2});
  for (const player of [1, 2]) {
    const sign = player === 1 ? 1 : -1;
    for (let index = 1; index <= 60; index++) {
      now += 1 / 60;
      const aim = index * .006;
      game.setInput(pose(aim, .35), {player});
      expect(game.players[player - 1].aimTarget.x).toBeCloseTo(sign * aim * .55);
      expect(game.players[player - 1].pendingStroke).toBeNull();
    }
  }
});

test('a newer deliberate swing replaces the waiting shot and cannot replay on the next receive', () => {
  for (const player of [1, 2]) {
    let now = 1;
    const game = new TableTennisGame({now: () => now}); game.startMatch({players: 2});
    const sign = player === 1 ? 1 : -1, controller = game.players[player - 1];
    game.nextFeed = Infinity;
    game.physics.launch({x: 0, y: 1.1, z: -.9 * sign}, {x: 0, y: 1, z: 3 * sign});
    const sample = (aim, rate) => {now += .01; game.setInput(pose(aim, rate), {player});};
    sample(-.7, 0);
    for (const rate of [-2, -4, -7]) sample(-.7, rate);
    game.update(.01);
    expect(controller.stroke.phase).toBe('queued');
    const firstId = controller.stroke.gestureId;
    expect(controller.aimTarget.x * sign).toBeLessThan(0);

    for (let i = 0; i < 7; i++) sample(.7, 0);
    for (const rate of [2, 4, 4]) sample(.7, rate);
    expect(controller.stroke.phase).toBe('queued');
    expect(controller.stroke.gestureId).toBeGreaterThan(firstId);
    expect(controller.aimTarget.x * sign).toBeGreaterThan(0);
    expect(controller.stroke.power).toBe(4);
    expect(controller.pendingStroke).toBeNull();

    // The next receive still needs a new gesture, even if the first shot was
    // replaced while waiting for the incoming ball to reach the paddle.
    controller.stroke.phase = 'ready';
    for (let i = 0; i < 7; i++) sample(.7, 0);
    game.update(.01);
    expect(controller.stroke.phase).toBe('ready');
    expect(controller.pendingStroke).toBeNull();
    expect(game.physics.paddles[player - 1].enabled).toBe(false);
  }
});

test('a forward stroke keeps its target and does not queue a second gesture from the same contact window', () => {
  for (const player of [1, 2]) {
    let now = 1;
    const game = new TableTennisGame({now: () => now}); game.startMatch({players: 2});
    const sign = player === 1 ? 1 : -1, controller = game.players[player - 1];
    game.nextFeed = Infinity;
    game.physics.launch({x: 0, y: 1.1, z: -.9 * sign}, {x: 0, y: 1, z: 3 * sign});
    const sample = (aim, rate) => {now += .01; game.setInput(pose(aim, rate), {player});};
    sample(-.7, 0);
    for (const rate of [-2, -4, -7]) sample(-.7, rate);
    game.update(.01);
    game.physics.ball.position.z = 1.0 * sign;
    game.lastBounceSide = player;
    game.update(.01);
    expect(controller.stroke.phase).toBe('forward');
    const intent = structuredClone(controller.stroke.intent);
    for (let i = 0; i < 7; i++) sample(.7, 0);
    for (const rate of [2, 4, 4]) sample(.7, rate);
    expect(controller.stroke.intent).toEqual(intent);
    expect(controller.aimTarget).toEqual(intent.target);
    expect(controller.pendingStroke).toBeNull();
  }
});
