import {describe, test, expect} from 'vitest';
import {TableTennisPhysics, TABLE, BALL, FIXED_STEP, v3, makePaddle, sweepPaddle, unit} from '@wee/src/tabletennis/physics.js';
import {TableTennisRules} from '@wee/src/tabletennis/rules.js';
import {TableTennisGame, advanceStroke, receivePlane} from '@wee/src/tabletennis/game.js';

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
  test('table friction reduces surface slip instead of spinning the ball against its travel', () => {
    const p = new TableTennisPhysics(); p.paddles.forEach(paddle => {paddle.enabled = false;});
    let slip;
    p.onEvent = e => {if (e.kind === 'bounce') slip = p.ball.velocity.z - p.ball.spin.x * BALL.radius;};
    p.launch(v3(0, .781, .4), v3(0, -1, 2)); p.step();
    expect(p.ball.spin.x).toBeGreaterThan(0);
    expect(Math.abs(slip)).toBeLessThan(2);
  });
  test('a paddle brush applies the contact torque in the friction direction', () => {
    const p = new TableTennisPhysics(), paddle = p.paddles[0];
    paddle.normal = paddle.previousNormal = v3(0, 0, -1);
    paddle.position = paddle.previous = v3(0, 1, 1.1);
    p.launch(v3(0, 1, 1.06), v3(1, 0, 5)); p.step();
    expect(p.ball.spin.y).toBeLessThan(0);
    expect(p.ball.velocity.x).toBeLessThan(1);
  });
  test('a resting ball terminates once instead of looping on the contact epsilon', () => {
    const p = new TableTennisPhysics(), events = [];
    p.paddles.forEach(paddle => {paddle.enabled = false;});
    p.onEvent = e => events.push(e);
    p.launch(v3(0, .781, .4), v3(0, -.1, 0)); stepFor(p, 5);
    expect(p.ball.active).toBe(false);
    expect(p.ball.velocity).toEqual(v3());
    expect(events.filter(e => e.kind === 'bounce')).toHaveLength(1);
    expect(events.filter(e => e.kind === 'out')).toHaveLength(1);
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
    for (let i = 0; i < 20; i++) point(i % 2 ? 2 : 1);
    expect(r.score).toEqual([11, 11]); expect(r.server).toBe(2);
    point(1); expect(r.phase).toBe('ready'); expect(r.server).toBe(1);
    point(2); expect(r.server).toBe(2); point(1); point(1);
    expect(r.score).toEqual([14, 12]); expect(r.winner).toBe(1);
    expect(r.beginPoint()).toBe(false); expect(r.award(2, 'duplicate')).toBeNull();
  });
  test('checkpoint parser rejects inconsistent completed scores and live points', () => {
    const r = new TableTennisRules();
    expect(r.restore({firstServer: 1, score: [11, 10], pointId: 21, phase: 'complete', winner: 1})).toBe(false);
    r.beginPoint(); expect(r.checkpoint()).toBeNull();
  });
});

describe('solo controls and persistence', () => {
  test('angular deceleration never reverses a forward stroke; recovery is a separate phase', () => {
    const stroke = {phase: 'ready', offset: 0, speed: 0, power: 0, started: 0,
      until: 0, rearmed: true, lowFor: 0};
    advanceStroke(stroke, {rate: 4, dt: FIXED_STEP, time: 0, nearBall: true});
    const first = stroke.offset;
    for (let i = 1; i < 15; i++) {
      const previous = stroke.offset;
      advanceStroke(stroke, {rate: 0, dt: FIXED_STEP, time: i * FIXED_STEP, nearBall: true});
      expect(stroke.offset).toBeGreaterThanOrEqual(previous);
    }
    expect(stroke.offset).toBeGreaterThan(first);
    for (let i = 15; i < 30; i++) advanceStroke(stroke, {rate: 0, dt: FIXED_STEP, time: i * FIXED_STEP, nearBall: true});
    expect(stroke.phase).toBe('recovery');
  });
  test('short incoming balls select bounded forward reach before the second bounce', () => {
    const ball = {active: true, position: v3(0, .8, .35), velocity: v3(0, 1.2, 1.5)};
    const plane = receivePlane(ball, 1, true);
    expect(plane).toBeGreaterThanOrEqual(.56);
    expect(plane).toBeLessThan(.8);
    expect(receivePlane({...ball, position: v3(0, .8, -.35), velocity: v3(0, 1.2, -1.5)}, 2, true)).toBeCloseTo(-plane);
  });
  test('Friendly produces legal returns across compact-stroke timing, speed and duration', () => {
    let successful = 0;
    for (const amplitude of [1.5, 2, 4, 6, 8, 12]) for (const atZ of [.3, .5, .65, .8, .9, 1]) for (const duration of [.12, .24, .36]) {
      const g = new TableTennisGame(); g.feed(); let started = null;
      for (let i = 0; i < 600 && g.physics.ball.active; i++) {
        if (started === null && g.physics.ball.velocity.z > 0 && g.physics.ball.position.z >= atZ) started = g.time;
        const phase = started === null ? -1 : (g.time - started) / duration;
        const x = phase >= 0 && phase <= 1 ? amplitude * Math.sin(phase * Math.PI) : 0;
        g.setInput(pose({angularVelocity: v3(x, 0, 0)})); g.update(FIXED_STEP);
      }
      if (g.practiceReturns > 0) successful++;
    }
    // 108 deterministic inputs, counting an opponent-table bounce, not contact.
    expect(successful).toBeGreaterThanOrEqual(100);
  });
  test('both compact stroke directions can return a feed without double-hit counts', () => {
    for (const sign of [-1, 1]) {
      const g = new TableTennisGame(); g.feed(); let started = null;
      for (let i = 0; i < 500 && g.physics.ball.active; i++) {
        if (started === null && g.physics.ball.position.z > .5) started = g.time;
        const phase = started === null ? -1 : (g.time - started) / .24;
        g.setInput(pose({angularVelocity: v3(phase >= 0 && phase <= 1 ? sign * 4 * Math.sin(phase * Math.PI) : 0, 0, 0)}));
        g.update(FIXED_STEP);
      }
      expect(g.practiceReturns).toBeGreaterThan(0);
    }
  });
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
      g.update(FIXED_STEP);
    }
    expect(g.rules.phase).toBe('complete');
    expect(Math.max(...g.rules.score)).toBeGreaterThanOrEqual(12);
    expect(Math.abs(g.rules.score[0] - g.rules.score[1])).toBeGreaterThanOrEqual(2);
    expect(g.checkpoint().rules.winner).toBe(g.rules.winner);
  });
  test('compact strokes with deliberate wide placement produce rallies and points against the physical bot', () => {
    const g = new TableTennisGame(); g.startMatch(); let started = null, incoming = false, returns = 0, lastHitter = 0, hits = 0;
    const collision = g.physics.onEvent;
    g.physics.onEvent = event => {
      if (event.kind === 'hit') {lastHitter = event.player; if (event.player === 1) hits++;}
      if (event.kind === 'bounce' && event.side === 2 && lastHitter === 1) returns++;
      collision(event);
    };
    for (let i = 0; i < 24000 && g.rules.phase !== 'complete'; i++) {
      const ball = g.physics.ball;
      if (!ball.active || ball.velocity.z < 0) {started = null; incoming = false;}
      if (!incoming && ball.active && ball.velocity.z > 0 && ball.position.z > .5) {started = g.time; incoming = true;}
      const phase = started === null ? -1 : (g.time - started) / .24;
      g.setInput(pose({reach: {x: hits % 2 ? 1 : -1, y: 0},
        angularVelocity: v3(phase >= 0 && phase <= 1 ? 4 * Math.sin(phase * Math.PI) : 0, 0, 0)}));
      g.update(FIXED_STEP);
    }
    expect(g.rules.phase).toBe('complete');
    expect(g.rules.score[0]).toBeGreaterThanOrEqual(3);
    expect(returns).toBeGreaterThan(20);
  });
  test('automatic serves wait for fresh remote control and stale input freezes the ball', () => {
    const g = new TableTennisGame(); g.remote = true; g.startMatch();
    for (let i = 0; i < 200; i++) g.update(FIXED_STEP);
    expect(g.physics.ball.active).toBe(false);
    for (let i = 0; i < 60; i++) {g.setInput(pose(), {remote: true}); g.update(FIXED_STEP);}
    expect(g.rules.pointId).toBeGreaterThan(0);
    for (let i = 0; i < 70; i++) g.update(FIXED_STEP);
    const frozen = {...g.physics.ball.position};
    for (let i = 0; i < 120; i++) g.update(FIXED_STEP);
    expect(g.physics.ball.position).toEqual(frozen);
    expect(g.remoteStale).toBe(true);
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
