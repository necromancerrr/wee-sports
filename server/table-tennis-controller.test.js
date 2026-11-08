import {expect, test} from 'vitest';
import {createTableTennisControllerSession} from '../src/tabletennis/controllerSession.js';

const sample = (time, sequence, velocity = {x: 0, y: 0, z: 0}) => ({schemaVersion: 1,
  timeSeconds: time, sequence, calibrationRevision: 0, screenAngle: 0,
  orientation: {x: 0, y: 0, z: 0, w: 1}, angularVelocity: velocity});
function create() {
  const messages = [];
  const session = createTableTennisControllerSession({send: message => messages.push(message)});
  session.lobby({connected: true, playing: false, paused: true, gameId: null, generation: 0});
  const lastSetup = () => messages.filter(message => message.type === 'wee:controller-setup').at(-1);
  const acknowledge = () => session.acknowledge(lastSetup().requestId, {ok: true});
  const warm = (start = 0, sequence = 0) => {
    for (let step = 0; step <= 10; step++) session.sample(sample(start + step * .02, sequence + step, {x: 2, y: 0, z: 0}));
  };
  return {session, messages, lastSetup, acknowledge, warm};
}

test('motion startup needs continuous live samples and a matching server acknowledgement', () => {
  const f = create();
  f.session.select('motion');
  expect(f.lastSetup().setup).toBeNull();
  f.session.sample(sample(0, 0));
  expect(f.lastSetup().setup).toBeNull();
  f.warm(.02, 1);
  expect(f.lastSetup().setup).toBe('motion');
  expect(f.session.state.setup).toBeNull();
  f.acknowledge();
  expect(f.session.state.setup).toBe('motion');
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'first', generation: 1});
  expect(f.session.sample(sample(.24, 12, {x: 8, y: 0, z: 0})).angularVelocity).toEqual({x: 0, y: 0, z: 0});
  expect(f.session.sample(sample(.28, 13, {x: 8, y: 0, z: 0})).angularVelocity.x).toBeGreaterThan(0);
});

test('stale setup acknowledgement cannot authorize a different selected mode', () => {
  const f = create();
  f.session.select('touch');
  const touchRequest = f.lastSetup().requestId;
  f.session.select('motion'); f.warm();
  f.session.acknowledge(touchRequest, {ok: true});
  expect(f.session.state.setup).toBeNull();
  expect(f.session.state.pending).toBe(true);
  f.acknowledge();
  expect(f.session.state.setup).toBe('motion');
});

test('countdown and new generation do not revoke acknowledged setup or create a countdown loop', () => {
  const f = create();
  f.session.select('motion'); f.warm(); f.acknowledge();
  const requests = f.messages.filter(message => message.type === 'wee:controller-setup').length;
  f.session.lobby({connected: true, playing: false, paused: true, gameId: 'countdown', generation: 1});
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'countdown', generation: 2});
  expect(f.session.state.setup).toBe('motion');
  expect(f.messages.filter(message => message.type === 'wee:controller-setup')).toHaveLength(requests);
  expect(f.session.frame(.2)).toBeNull();
});

test('sensor silence revokes motion and resumed motion needs fresh coverage with a zero first pose', () => {
  const f = create();
  f.session.select('motion'); f.warm(); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  f.session.sample(sample(.22, 11, {x: 10, y: 0, z: 0}));
  expect(f.session.frame(.6)).toBeNull();
  expect(f.lastSetup().setup).toBeNull();
  f.session.sample(sample(.62, 12, {x: 10, y: 0, z: 0}));
  expect(f.session.frame(.62)).toBeNull();
  f.warm(.64, 13); f.acknowledge();
  expect(f.session.state.setup).toBe('motion');
  expect(f.session.frame(.85).angularVelocity).toEqual({x: 0, y: 0, z: 0});
});

test('background cancels touch strokes and resumes the selected mode without another mode selection', () => {
  const f = create();
  f.session.select('touch'); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  f.session.stroke(1);
  expect(f.session.frame(1.1).angularVelocity.x).toBeGreaterThan(0);
  f.session.suspend();
  expect(f.session.frame(1.14)).toBeNull();
  const hiddenRequest = f.lastSetup().requestId;
  f.session.resume();
  expect(f.lastSetup().setup).toBe('buttons');
  f.session.acknowledge(hiddenRequest, {ok: true});
  expect(f.session.frame(1.18)).toBeNull();
  f.acknowledge();
  expect(f.session.frame(1.2).angularVelocity).toEqual({x: 0, y: 0, z: 0});
});

test('touch input stays bounded and paused or disconnected sessions cannot emit a stroke', () => {
  const f = create();
  f.session.select('touch'); f.acknowledge();
  f.session.move(5, -10);
  f.session.stroke(1);
  expect(f.session.frame(1.1)).toBeNull();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  expect(f.session.frame(1.2)).toMatchObject({reach: {x: 1, y: -1}, angularVelocity: {x: 0, y: 0, z: 0}});
  f.session.lobby({connected: false, playing: true, paused: false, gameId: 'game', generation: 1});
  f.session.stroke(2);
  expect(f.session.frame(2.1)).toBeNull();
});

test('fresh motion reaches the bridge at sensor cadence even while display frames are delayed', () => {
  const f = create();
  f.session.select('motion'); f.warm(); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  f.session.sample(sample(.22, 11));
  const before = f.messages.filter(message => message.type === 'wee:player-pose').length;
  // A full second of 60 Hz sensor input, without any animation-frame callback.
  for (let step = 1; step <= 60; step++) {
    const now = .22 + step / 60;
    const pose = f.session.sample(sample(now, 11 + step, {x: 2 + step / 100, y: 0, z: 0}));
    expect(pose?.angularVelocity.x).toBeCloseTo(2 + step / 100);
    expect(f.session.frame(now + .001)).toBeNull();
  }
  const sent = f.messages.filter(message => message.type === 'wee:player-pose').slice(before);
  expect(sent).toHaveLength(60);
  expect(new Set(sent.map(message => message.event.seq)).size).toBe(60);
  // No duplicate heartbeat of the last sample is sent after rendering resumes.
  expect(f.session.frame(1.25)).toBeNull();
});

test('high-rate sensor bursts coalesce to the newest pose and never replay skipped samples', () => {
  const f = create();
  f.session.select('motion'); f.warm(); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  f.session.sample(sample(.22, 11));
  const before = f.messages.filter(message => message.type === 'wee:player-pose').length;
  for (let step = 1; step <= 10; step++) {
    expect(f.session.sample(sample(.22 + step / 1000, 11 + step, {x: step, y: 0, z: 0}))).toBeNull();
  }
  expect(f.messages.filter(message => message.type === 'wee:player-pose')).toHaveLength(before);
  expect(f.session.frame(.237).angularVelocity.x).toBe(10);
  expect(f.session.frame(.26)).toBeNull();
  expect(f.messages.filter(message => message.type === 'wee:player-pose')).toHaveLength(before + 1);
});


test.each(['touch', 'motion'])('returning to the lobby clears the completed %s match and preserves verified controls', mode => {
  const f = create();
  f.session.select(mode);
  if (mode === 'motion') f.warm();
  f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'first', generation: 1});
  f.session.setPhase('complete');
  const setupRequests = f.messages.filter(message => message.type === 'wee:controller-setup').length;
  f.session.lobby({connected: true, playing: false, paused: true, gameId: null, generation: 2});
  expect(f.session.state).toMatchObject({phase: 'ready', connected: true, playing: false, setup: mode === 'motion' ? 'motion' : 'buttons'});
  expect(f.session.canSend).toBe(false);
  expect(f.messages.filter(message => message.type === 'wee:controller-setup')).toHaveLength(setupRequests);
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'next', generation: 3});
  const pose = mode === 'motion' ? f.session.sample(sample(.22, 11, {x: 12, y: 0, z: 0})) : f.session.frame(.22);
  expect(pose.angularVelocity).toEqual({x: 0, y: 0, z: 0});
});

test('the selected hand stays attached to touch and motion poses across mode changes', () => {
  const f = create();
  f.session.configure({hand: 'Left'});
  f.session.select('touch'); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  expect(f.session.frame(.02).hand).toBe('Left');
  f.session.select('motion'); f.warm(.04, 1); f.acknowledge();
  expect(f.session.sample(sample(.26, 12)).hand).toBe('Left');
  f.session.select('touch'); f.acknowledge();
  expect(f.session.frame(.28).hand).toBe('Left');
});


test('a profile arriving after motion intent updates hand without revoking ready controls', () => {
  const f = create();
  f.session.select('motion'); f.warm(); f.acknowledge();
  f.session.lobby({connected: true, playing: true, paused: false, gameId: 'game', generation: 1});
  const requests = f.messages.filter(message => message.type === 'wee:controller-setup').length;
  f.session.configure({hand: 'Left', sensitivity: 2});
  const pose = f.session.sample(sample(.22, 11));
  expect(pose.hand).toBe('Left');
  expect(f.session.state.setup).toBe('motion');
  expect(f.messages.filter(message => message.type === 'wee:controller-setup')).toHaveLength(requests);
});
