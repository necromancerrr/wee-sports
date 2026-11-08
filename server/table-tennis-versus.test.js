import {expect, test} from 'vitest';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {FIXED_STEP, v3} from '../src/tabletennis/physics.js';
import {tableTennisAnnouncement} from '../src/tabletennis/presentation.js';

const pose = (rate = 0, aim = 0) => ({orientation: [0, 0, 0, 1], angularVelocity: v3(0, rate, 0),
  reach: {x: aim, y: 0}, calibrationRevision: 1});

/** Two independent phones send compact pulses when the visible incoming ball
 * approaches their half. Flight, contact, net, scoring and serving stay real. */
function play({active = [true, true], maxSeconds = 70, stopAfter = Infinity} = {}) {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  const events = [], starts = [null, null]; let receiving = null;
  game.onEvent = event => events.push(event);
  for (let frame = 0; frame < maxSeconds / FIXED_STEP && !game.rules.winner; frame++) {
    const ball = game.physics.ball;
    const next = ball.active && !game.serveMotion ? ball.velocity.z > 0 ? 1 : 2 : null;
    if (next !== receiving) {starts.fill(null); receiving = next;}
    for (const player of [1, 2]) {
      const index = player - 1, sign = player === 1 ? 1 : -1;
      if (receiving === player && starts[index] === null && ball.position.z * sign > .45) starts[index] = game.time;
      const phase = starts[index] === null ? -1 : (game.time - starts[index]) / .24;
      const rate = active[index] && phase >= 0 && phase <= 1 ? 5 * Math.sin(phase * Math.PI) : 0;
      game.setInput(pose(rate), {player});
    }
    game.update(FIXED_STEP);
    if (events.filter(event => event.type === 'hit').length >= stopAfter) break;
  }
  return {game, events};
}

test('two human players can exchange a sustained legal rally with independent motion', () => {
  const {game, events} = play({stopAfter: 24});
  const hits = events.filter(event => event.type === 'hit');
  expect(hits.length).toBeGreaterThanOrEqual(24);
  expect(hits.filter(event => event.player === 1).length).toBeGreaterThanOrEqual(10);
  expect(hits.filter(event => event.player === 2).length).toBeGreaterThanOrEqual(10);
  expect(events.filter(event => event.type === 'point')).toHaveLength(0);
  expect(game.snapshot()).toMatchObject({mode: 'versus', players: 2, practice: false, score: [0, 0], targetPoints: 12});
});

test('either human can win a complete 12-point match; the idle opponent does not become a bot', () => {
  for (const player of [1, 2]) {
    const active = [false, false]; active[player - 1] = true;
    const {game, events} = play({active, maxSeconds: 100});
    expect(game.rules.winner, `Player ${player}`).toBe(player);
    expect(game.rules.score[player - 1]).toBe(12);
    expect(game.rules.score[2 - player]).toBe(0);
    expect(events.filter(event => event.type === 'point')).toHaveLength(12);
    expect(game.physics.ball.active).toBe(false);
    expect(game.checkpoint().mode).toBe('versus');
  }
});

test('input, aiming and gesture peaks from one player cannot overwrite the other player', () => {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  game.setInput(pose(0, -.7), {player: 1}); game.setInput(pose(0, .8), {player: 2});
  game.physics.launch(v3(0, 1, -.6), v3(0, 0, -3));
  game.rules.beginPoint(); game.lastBounceSide = 2;
  for (let i = 0; i < 8; i++) {
    game.setInput(pose(4, .8), {player: 2});
    game.setInput(pose(0, -.7), {player: 1}); game.update(.01);
  }
  expect(game.players[1].stroke.intent.target.x).toBeCloseTo(-.536);
  expect(game.players[1].stroke.kind).toBe('backhand');
  expect(game.players[1].stroke.intent.target.z).toBe(.9);
  expect(game.input.reach.x).toBe(-.7);
  expect(game.playerStroke.phase).toBe('ready');
  expect(game.players[1].stroke.power).toBe(4);
  expect(game.setInput(pose(), {player: 3})).toBe(false);
  const solo = new TableTennisGame(); expect(solo.setInput(pose(), {player: 2})).toBe(false);
});

test('a short network gap keeps flight moving, but a lost second controller freezes play safely', () => {
  let now = 1;
  const game = new TableTennisGame({now: () => now}); game.startMatch({players: 2});
  for (let i = 0; i < 40; i++) {
    now += FIXED_STEP;
    for (const player of [1, 2]) game.setInput(pose(), {player, remote: true});
    game.update(FIXED_STEP);
  }
  game.physics.launch(v3(0, 1.4, -.8), v3(0, 1.8, 1.5));
  const before = {...game.physics.ball.position};
  for (let i = 0; i < 40; i++) {
    now += FIXED_STEP; game.setInput(pose(), {player: 1, remote: true}); game.update(FIXED_STEP);
  }
  expect(game.snapshot().stale).toBe(false);
  expect(game.physics.ball.position).not.toEqual(before);
  for (let i = 0; i < 25; i++) {
    now += FIXED_STEP; game.setInput(pose(), {player: 1, remote: true}); game.update(FIXED_STEP);
  }
  expect(game.snapshot().stale).toBe(true);
  const frozen = {...game.physics.ball.position};
  for (let i = 0; i < 30; i++) {
    now += FIXED_STEP; game.setInput(pose(), {player: 1, remote: true}); game.update(FIXED_STEP);
  }
  expect(game.physics.ball.position).toEqual(frozen);
  expect(game.physics.paddles.every(paddle => !paddle.enabled)).toBe(true);
});

test('versus checkpoints restore score and player mode between points only', () => {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  game.rules.beginPoint(); game.rules.award(2, 'No return');
  const checkpoint = game.checkpoint();
  const restored = new TableTennisGame(); expect(restored.restore(checkpoint)).toBe(true);
  expect(restored.snapshot()).toMatchObject({mode: 'versus', players: 2, practice: false, score: [0, 1], targetPoints: 12});
  game.serve(); expect(game.checkpoint()).toBeNull();
});

test('two-player announcements use both player names, including the far-side winner', () => {
  expect(tableTennisAnnouncement({score: [10, 12], winner: 2}, {type: 'point', winner: 2}, 'Sam', 'Alex'))
    .toMatchObject({title: 'Alex wins', detail: '10 – 12 · Well played'});
  expect(tableTennisAnnouncement({score: [0, 0], server: 2}, {type: 'serve'}, 'Sam', 'Alex').title).toBe('Alex serves');
});
