import {describe, test, expect} from 'vitest';
import {TableTennisPhysics, TABLE, BALL, FIXED_STEP, v3, makePaddle, sweepPaddle, unit} from '../src/tabletennis/physics.js';
import {TableTennisRules} from '../src/tabletennis/rules.js';
import {TableTennisGame} from '../src/tabletennis/game.js';

const stepFor = (physics, seconds) => { for (let i = 0; i < seconds / FIXED_STEP; i++) physics.step(); };
const pose = overrides => ({orientation: [0, 0, 0, 1], angularVelocity: v3(), reach: {x: 0, y: 0}, calibrationRevision: 1, ...overrides});
const legalServe = rules => {
  rules.beginPoint(); rules.event('hit', {player: rules.server});
  rules.event('bounce', {side: rules.server}); rules.event('bounce', {side: 3 - rules.server});
};

describe('table-tennis flight and collision', () => {
  test('gravity and bounded drag act in SI units without hidden flight steering', () => {
    const physics = new TableTennisPhysics();
    physics.launch(v3(0, 2, 0), v3(2, 0, 0));
    physics.paddles.forEach(p => { p.enabled = false; });
    stepFor(physics, .1);
    expect(physics.ball.velocity.x).toBeLessThan(2);
    expect(physics.ball.velocity.y).toBeCloseTo(-.98, 1);
    expect(physics.ball.position.y).toBeLessThan(2);
    expect(physics.ball.velocity.z).toBe(0);
  });
  test('opposite spins produce mirrored Magnus deflection', () => {
    const result = spin => {
      const p = new TableTennisPhysics(); p.launch(v3(0, 2, 0), v3(0, 0, 3), v3(0, spin, 0));
      stepFor(p, .1); return p.ball.position.x;
    };
    expect(result(100)).toBeGreaterThan(0);
    expect(result(-100)).toBeCloseTo(-result(100), 8);
  });
  test('tabletop bounce includes its top edge but excludes the vertical side', () => {
    const bounce = x => {
      const p = new TableTennisPhysics(); const events = [];
      p.onEvent = event => events.push(event); p.launch(v3(x, .81, .4), v3(0, -3, 0));
      stepFor(p, .03); return {p, events};
    };
    expect(bounce(TABLE.width / 2).events.filter(e => e.kind === 'bounce')).toHaveLength(1);
    expect(bounce(TABLE.width / 2 + .05).events.some(e => e.kind === 'bounce')).toBe(false);
  });
  test('high-speed sweeps cannot tunnel through a finite moving paddle', () => {
    const paddle = makePaddle(1);
    paddle.previous = v3(0, 1, 1.25); paddle.position = v3(0, 1, 1.10);
    paddle.previousNormal = paddle.normal = v3(0, 0, -1);
    const hit = sweepPaddle(v3(0, 1, .98), v3(0, 1, 1.35), paddle);
    expect(hit?.t).toBeGreaterThan(0);
    expect(hit?.t).toBeLessThan(1);
    expect(sweepPaddle(v3(.5, 1, .98), v3(.5, 1, 1.35), paddle)).toBeNull();
  });
  test('a rotating face sweeps its contact plane and never uses infinite extent', () => {
    const paddle = makePaddle(1);
    paddle.previous = paddle.position = v3(0, 1, 1);
    paddle.previousNormal = v3(0, 0, -1); paddle.normal = unit(v3(.7, 0, -1));
    expect(sweepPaddle(v3(.06, 1, .93), v3(.06, 1, 1.1), paddle)).not.toBeNull();
    expect(sweepPaddle(v3(.9, 1, .93), v3(.9, 1, 1.1), paddle)).toBeNull();
  });
  test('a stationary block reflects once and a forward stroke adds contact speed', () => {
    const block = stroke => {
      const p = new TableTennisPhysics(), events = [];
      const paddle = p.paddles[0]; paddle.normal = paddle.previousNormal = v3(0, 0, -1);
      paddle.position = v3(0, 1, 1.1); paddle.previous = v3(0, 1, 1.1 + stroke);
      p.onEvent = e => events.push(e); p.launch(v3(0, 1, 1.06), v3(0, 0, 5)); p.step();
      stepFor(p, .02); return {p, events};
    };
    const still = block(0), moving = block(.015);
    expect(still.events.filter(e => e.kind === 'hit')).toHaveLength(1);
    expect(still.p.ball.velocity.z).toBeLessThan(0);
    expect(moving.p.ball.velocity.z).toBeLessThan(still.p.ball.velocity.z);
  });
  test('a low shot hits the finite net, while an around-net shot misses it', () => {
    const net = x => {
      const p = new TableTennisPhysics(), events = [];
      p.onEvent = e => events.push(e); p.launch(v3(x, .85, .05), v3(0, 0, -8)); p.step(); return events;
    };
    expect(net(0).some(e => e.kind === 'net')).toBe(true);
    expect(net(1).some(e => e.kind === 'net')).toBe(false);
  });
  test('catch-up is bounded and dropped time is measured', () => {
    const p = new TableTennisPhysics(); p.advance(1);
    expect(p.time).toBeLessThanOrEqual(.101);
    expect(p.droppedSeconds).toBeCloseTo(.9);
  });
});

describe('singles scoring', () => {
  test('a legal net serve is a let; an invalid net serve loses one point', () => {
    const r = new TableTennisRules(); r.beginPoint(); r.event('hit', {player: 1});
    r.event('bounce', {side: 1}); r.event('net');
    expect(r.event('bounce', {side: 2})?.type).toBe('let');
    expect(r.score).toEqual([0, 0]);
    r.beginPoint(); r.event('hit', {player: 1}); r.event('net'); r.event('out');
    expect(r.score).toEqual([0, 1]);
  });
  test('second bounce, volley, own-side return and duplicate event are explicit', () => {
    const r = new TableTennisRules(); legalServe(r);
    r.event('bounce', {side: 2, id: 'second'}); r.event('bounce', {side: 2, id: 'second'});
    expect(r.score).toEqual([1, 0]);
    r.beginPoint(); r.event('hit', {player: 1}); r.event('hit', {player: 2});
    expect(r.score).toEqual([2, 0]);
    legalServe(r); r.event('hit', {player: 1}); r.event('bounce', {side: 1});
    expect(r.score).toEqual([2, 1]);
  });
  test('service alternates every two points, then every point at deuce', () => {
    const r = new TableTennisRules();
    const point = winner => { r.beginPoint(); r.award(winner, 'test'); };
    point(1); expect(r.server).toBe(1); point(2); expect(r.server).toBe(2);
    for (let i = 0; i < 18; i++) point(i % 2 ? 2 : 1);
    expect(r.score).toEqual([10, 10]); expect(r.server).toBe(1);
    point(1); expect(r.phase).toBe('ready'); expect(r.server).toBe(2);
    point(2); expect(r.server).toBe(1); point(1); point(1);
    expect(r.score).toEqual([13, 11]); expect(r.winner).toBe(1);
    expect(r.beginPoint()).toBe(false); expect(r.award(2, 'duplicate')).toBeNull();
  });
  test('checkpoint parser rejects inconsistent completed scores and live points', () => {
    const r = new TableTennisRules();
    expect(r.restore({firstServer: 1, score: [11, 10], pointId: 21, phase: 'complete', winner: 1})).toBe(false);
    r.beginPoint(); expect(r.checkpoint()).toBeNull();
  });
});

describe('solo controls and persistence', () => {
  test('feed seeds and fixed stepping are deterministic', () => {
    const run = () => {
      const g = new TableTennisGame({seed: 42}); g.feed();
      for (let i = 0; i < 100; i++) g.update(FIXED_STEP);
      return g.physics.ball;
    };
    expect(run()).toEqual(run());
  });
  test('cooperative bot returns the serve using the physical paddle and legal opponent bounce', () => {
    const events = []; const g = new TableTennisGame({onEvent: e => events.push(e)});
    g.startMatch(); g.serve();
    for (let i = 0; i < 300; i++) g.update(FIXED_STEP);
    expect(events.some(e => e.type === 'hit' && e.player === 2)).toBe(true);
    expect(events.some(e => e.type === 'hit' && e.player === 1)).toBe(true);
  });
  test('one player can finish a scored bot game and checkpoint the final result', () => {
    const g = new TableTennisGame(); g.startMatch();
    for (let i = 0; i < 24000 && g.rules.phase !== 'complete'; i++) {
      if (!g.physics.ball.active && g.rules.server === 1) g.serve();
      g.update(FIXED_STEP);
    }
    expect(g.rules.phase).toBe('complete');
    expect(Math.max(...g.rules.score)).toBeGreaterThanOrEqual(11);
    expect(Math.abs(g.rules.score[0] - g.rules.score[1])).toBeGreaterThanOrEqual(2);
    expect(g.checkpoint().rules.winner).toBe(g.rules.winner);
  });
  test('stale remote poses disable contact and fresh input settles before enabling it', () => {
    const g = new TableTennisGame(); g.nextFeed = Infinity;
    g.setInput(pose(), {remote: true});
    for (let i = 0; i < 50; i++) g.update(FIXED_STEP);
    expect(g.physics.paddles[0].enabled).toBe(false);
    g.setInput(pose({reach: {x: 1, y: 0}, calibrationRevision: 2}), {remote: true}); g.update(FIXED_STEP);
    expect(g.physics.paddles[0].enabled).toBe(false);
    expect(g.settling).toBe(true);
  });
  test('recenter and checkpoints are unavailable in flight; pause freezes simulation', () => {
    const g = new TableTennisGame(); g.feed();
    expect(g.recenter()).toBe(false); expect(g.checkpoint()).toBeNull();
    g.paused = true; const position = {...g.physics.ball.position}; g.update(1);
    expect(g.physics.ball.position).toEqual(position);
  });
  test('stable checkpoints restore scores, settings and seed without restoring a flying ball', () => {
    const g = new TableTennisGame({seed: 8}); g.startMatch();
    g.rules.beginPoint(); g.rules.award(1, 'point');
    const checkpoint = g.checkpoint(); const restored = new TableTennisGame();
    expect(restored.restore(checkpoint)).toBe(true);
    expect(restored.rules.score).toEqual([1, 0]); expect(restored.seed).toBe(8);
    expect(restored.physics.ball.active).toBe(false);
    expect(restored.restore({...checkpoint, settings: {sensitivity: NaN}})).toBe(false);
  });
  test('missing or nonfinite pose fields never enter the simulation', () => {
    const g = new TableTennisGame();
    expect(g.setInput(pose({orientation: [0, 0, 0, 0]}))).toBe(false);
    expect(g.setInput(pose({angularVelocity: {x: Infinity, y: 0, z: 0}}))).toBe(false);
    expect(g.setInput(pose({reach: {x: 3, y: 0}}))).toBe(false);
  });
});
