import {expect, test} from 'vitest';
import {createTableTennisControllerSession} from '../src/tabletennis/controllerSession.js';
import {normalizeWebMotion, normalizeNativeGyroscope, identityQuaternion} from '../shared/motion.js';
import {TableTennisGame} from '../src/tabletennis/game.js';

/** Receives real adapter/session output, not idealized game-only X-rate input.
 * A deterministic wall clock drives sensor receipt independently of TV frames.
 */
function receive({axis = 'x', sign = 1, hz = 60, fps = 60, screenAngle = 0,
  native = false, peak = 4, idle = false, threshold = .5, jitter = false,
  renderStall = 0, pulseSeconds = .24, networkDelay = 0, onset = null} = {}) {
  let now = 0, sequence = 0, angle = 0, started = null, samples = 0, fedAt = null;
  const game = new TableTennisGame({now: () => now});
  const messages = [], events = [], packets = [], delivery = [];
  const session = createTableTennisControllerSession({send: message => {
    messages.push(message);
    if (message.type === 'wee:player-pose') {
      packets.push(message.event);
      delivery.push({at: now + networkDelay, input: message.event});
    }
  }});
  const sample = (rate = 0, dt = 1 / hz) => {
    angle += rate * dt;
    const velocity = {x: 0, y: 0, z: 0, [axis]: rate};
    const q = identityQuaternion(); q[axis] = Math.sin(angle / 2); q.w = Math.cos(angle / 2);
    const options = {timeSeconds: now, sequence: sequence++, screenAngle,
      ...(native ? {} : {orientation: q})};
    session.sample(native ? normalizeNativeGyroscope(velocity, options) : normalizeWebMotion({rotationRate: {
      alpha: velocity.x * 180 / Math.PI, beta: velocity.y * 180 / Math.PI, gamma: velocity.z * 180 / Math.PI,
    }}, options));
    const setup = messages.filter(message => message.type === 'wee:controller-setup').at(-1);
    session.acknowledge(setup.requestId, {ok: true});
  };
  session.lobby({connected: true, playing: false, paused: true, gameId: 'motion-path', generation: 0});
  session.select('motion');
  for (let step = 0; step < hz; step++) {now = step / hz; sample();}
  session.lobby({connected: true, playing: true, paused: false, gameId: 'motion-path', generation: 1});
  const collision = game.physics.onEvent;
  game.physics.onEvent = event => {events.push({...event, phase: game.playerStroke.phase}); collision(event);};
  game.nextFeed = Infinity;
  let nextSensor = now + 1 / hz, nextFrame = nextSensor, previousFrame = now;
  const start = nextSensor;
  for (let step = 0; step < 2400; step++) {
    now = start + step / 600;
    if (now + 1e-9 >= nextSensor) {
      session.setPhase(game.snapshot().phase);
      const ball = game.physics.ball;
      if (started === null && ball.active && ball.velocity.z > 0 &&
        (onset === null ? ball.position.z >= threshold : now >= fedAt + onset)) started = now;
      const phase = started === null ? -1 : (now - started) / pulseSeconds;
      const dt = (1 + (jitter ? samples % 2 ? -.16 : .16 : 0)) / hz;
      sample(!idle && phase >= 0 && phase <= 1 ? sign * peak * Math.sin(phase * Math.PI) : 0, dt);
      samples++; nextSensor += dt;
    }
    while (delivery.length && delivery[0].at <= now) game.setInput(delivery.shift().input, {remote: true});
    const stalled = started !== null && now >= started && now < started + renderStall;
    if (!stalled && now + 1e-9 >= nextFrame) {
      game.update(now - previousFrame);
      previousFrame = now; nextFrame = now + 1 / fps;
    }
    if (!game.physics.ball.active && game.time >= .3 && game.nextFeed === Infinity && !events.length) {game.feed(); fedAt = now;}
    const hit = events.find(event => event.kind === 'hit' && event.player === 1);
    if (hit && events.some(event => event.kind === 'bounce' && event.side === 2 && event.id > hit.id) ||
      game.lastReason.startsWith('Missed')) break;
  }
  const hits = events.filter(event => event.kind === 'hit' && event.player === 1);
  const landing = hits.length && events.find(event => event.kind === 'bounce' && event.side === 2 && event.id > hits[0].id);
  return {game, hits, landing, packets, events};
}

test('browser motion reaches a real legal contact for both stroke directions on every axis', () => {
  for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) for (const hz of [30, 60, 100]) {
    const result = receive({axis, sign, hz});
    expect(result.hits, `${axis}/${sign}/${hz}`).toHaveLength(1);
    expect(result.hits[0].assisted).toBe(true);
    expect(result.hits[0].phase).toBe('forward');
    expect(result.landing?.side).toBe(2);
    expect(Math.abs(result.landing.position.x)).toBeLessThan(.03);
  }
});

test('gyro-only native data and rotated screens preserve the same stroke meaning', () => {
  for (const native of [false, true]) for (const screenAngle of [0, 90, 180, 270]) {
    const result = receive({axis: 'y', screenAngle, native, hz: 60, fps: 30, jitter: true});
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].assisted).toBe(true);
    expect(result.landing?.side).toBe(2);
    expect(Math.abs(result.landing.position.x)).toBeLessThan(.03);
  }
});

test('an idle phone never causes the automatically positioned paddle to hit', () => {
  const result = receive({idle: true});
  expect(result.hits).toHaveLength(0);
  expect(result.game.lastReason).toMatch(/Missed/);
  expect(result.game.practiceReturns).toBe(0);
});

test('a short sensor burst survives a delayed display frame but an expired one cannot replay', () => {
  const delayed = receive({axis: 'z', hz: 100, fps: 30, peak: 5, pulseSeconds: .12, renderStall: .18});
  expect(delayed.hits).toHaveLength(1);
  expect(delayed.hits[0].assisted).toBe(true);
  expect(delayed.landing?.side).toBe(2);
  const expired = receive({axis: 'z', hz: 100, fps: 30, peak: 5, pulseSeconds: .12, renderStall: .8});
  expect(expired.hits).toHaveLength(0);
});

test('gentle timely strokes remain playable with 20 Hz rendering and sensor jitter', () => {
  for (const threshold of [.2, .5, .7]) {
    const result = receive({axis: 'y', hz: 30, fps: 20, peak: 1.5, threshold, jitter: true});
    expect(result.hits, `incoming z=${threshold}`).toHaveLength(1);
    expect(result.hits[0].assisted).toBe(true);
    expect(result.landing?.side).toBe(2);
  }
});

test('host freshness uses wall time even when simulation catch-up is clipped', () => {
  let now = 1;
  const game = new TableTennisGame({now: () => now});
  const pose = {orientation: [0, 0, 0, 1], angularVelocity: {x: 0, y: 0, z: 0}, reach: {x: 0, y: 0}, calibrationRevision: 1};
  game.setInput(pose, {remote: true});
  for (let step = 0; step < 30; step++) {now += 1 / 60; game.setInput(pose, {remote: true}); game.update(1 / 60);}
  game.feed();
  const position = {...game.physics.ball.position};
  now += 1;
  game.update(1);
  expect(game.snapshot().stale).toBe(true);
  expect(game.physics.ball.position).toEqual(position);
  expect(game.physics.paddles[0].enabled).toBe(false);
});

function pendingSwing() {
  let now = 1;
  const game = new TableTennisGame({now: () => now});
  game.feed(); game.physics.ball.position = {x: 0, y: 1, z: .7};
  const pose = rate => ({orientation: [0, 0, 0, 1], angularVelocity: {x: 0, y: rate, z: 0},
    reach: {x: .4, y: 0}, calibrationRevision: 1});
  const sample = rate => {now += .01; game.setInput(pose(rate));};
  sample(0);
  for (const rate of [1, 2, 4, 7, 7, 4, 2, 0, 0, 0, 0, 0, 0, 0]) sample(rate);
  return {game, pose, sample, advance: seconds => {now += seconds;}};
}

test('a complete swing between display frames retains its peak power and captured aim', () => {
  const {game} = pendingSwing();
  expect(game.strokeDetector.active).toBeNull();
  expect(game.pendingStroke.strength).toBe(7);
  expect(game.pendingStroke.intent.target.x).toBeCloseTo(.22);
  game.update(1 / 60);
  expect(game.playerStroke.power).toBe(7);
  expect(game.pendingStroke).toBeNull();
});

test('fresh quiet samples cannot keep an old stroke request alive for a later ball', () => {
  const {game, sample} = pendingSwing();
  for (let index = 0; index < 85; index++) sample(0);
  game.update(1 / 60);
  expect(game.pendingStroke).toBeNull();
  expect(game.playerStroke.phase).toBe('ready');
  expect(game.physics.paddles[0].enabled).toBe(false);
});

test('pause and new calibration each discard a pending gesture without replay', () => {
  for (const boundary of ['pause', 'calibration']) {
    const {game, pose} = pendingSwing();
    expect(game.pendingStroke).not.toBeNull();
    if (boundary === 'pause') {game.paused = true; game.update(.01); game.paused = false;}
    else game.setInput({...pose(0), calibrationRevision: 2}, {remote: true});
    expect(game.pendingStroke).toBeNull();
    game.update(1 / 60);
    expect(game.physics.paddles[0].enabled).toBe(false);
  }
});


test('gentle strokes survive realistic one-way input delay without moving their landing target', () => {
  for (const networkDelay of [0, .04, .08]) for (const axis of ['x', 'y', 'z']) {
    const result = receive({axis, hz: 60, fps: 30, peak: 1.2, threshold: .5, jitter: true, networkDelay});
    expect(result.hits, `${axis}, ${networkDelay * 1000}ms delay`).toHaveLength(1);
    expect(result.landing?.side).toBe(2);
    expect(Math.abs(result.landing.position.x)).toBeLessThan(.03);
  }
});

test('casual early and late reactions have a broad receive window, with no return after the ball is lost', () => {
  for (const native of [false, true]) for (const onset of [.1, .2, .3, .4, .5, .6, .7]) {
    const result = receive({native, onset, peak: 2, networkDelay: .04, fps: 30});
    expect(result.hits, `${native ? 'native' : 'web'} reaction at ${onset}s`).toHaveLength(1);
    expect(result.landing?.side).toBe(2);
  }
  expect(receive({onset: .8, peak: 2, networkDelay: .04}).hits).toHaveLength(0);
});

test('a fresh swing during paddle resynchronization is buffered until the legal receive', () => {
  let now = 1, bufferedWhileSettling = false;
  const game = new TableTennisGame({now: () => now}), events = [];
  const collision = game.physics.onEvent;
  game.physics.onEvent = event => {events.push(event); collision(event);};
  game.feed();
  for (let frame = 0; frame < 150; frame++) {
    now = 1 + frame / 60;
    const elapsed = frame / 60;
    game.setInput({orientation: [0, 0, 0, 1], reach: {x: 0, y: 0}, calibrationRevision: 3,
      angularVelocity: {x: elapsed < .24 ? 3 * Math.sin(elapsed / .24 * Math.PI) : 0, y: 0, z: 0}}, {remote: true});
    bufferedWhileSettling ||= game.settling && Boolean(game.pendingStroke);
    game.update(1 / 60);
    if (events.some(event => event.kind === 'hit' && event.player === 1)) break;
  }
  expect(bufferedWhileSettling).toBe(true);
  expect(events.filter(event => event.kind === 'hit' && event.player === 1)).toHaveLength(1);
});
