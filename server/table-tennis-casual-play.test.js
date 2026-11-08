import {expect, test} from 'vitest';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {createTableTennisControllerSession} from '../src/tabletennis/controllerSession.js';
import {normalizeWebMotion, normalizeNativeGyroscope} from '../shared/motion.js';

/** Two phones keep swinging at their own pace, without consulting ball position,
 * bounce/contact events, game phase or the other player's motion. Both real
 * normalization paths, setup acknowledgements, relay delay and 30Hz TV frames
 * are exercised. The slower secondary-axis movement represents wrist carry;
 * it deliberately prevents the artificial full stops used by timed hit tests. */
function casualMatch({periods = [.7, .9], carry = .7, hz = 60, delay = .04, seconds = 16} = {}) {
  let now = 0;
  const game = new TableTennisGame({now: () => now});
  const packets = [], events = [];
  const phones = [1, 2].map(player => {
    let sequence = 0, setup;
    const session = createTableTennisControllerSession({send: message => {
      if (message.type === 'wee:controller-setup') setup = message;
      if (message.type === 'wee:player-pose') packets.push({at: now + delay, player, event: message.event});
    }});
    session.lobby({connected: true, playing: false, paused: true, gameId: 'casual', generation: 0});
    session.select('motion');
    return {session, sample(playing) {
      const phase = (now - 1 + (player === 2 ? .137 : 0)) * 2 * Math.PI / periods[player - 1];
      const rate = {x: playing ? 3 * Math.sin(phase) : 0, y: 0, z: playing ? carry : 0};
      const options = {timeSeconds: now, sequence: sequence++, screenAngle: player === 1 ? 0 : 90};
      const sample = player === 1 ? normalizeWebMotion({rotationRate: {
        alpha: rate.x * 180 / Math.PI, beta: rate.y * 180 / Math.PI, gamma: rate.z * 180 / Math.PI,
      }}, options) : normalizeNativeGyroscope(rate, options);
      session.sample(sample);
      if (setup) session.acknowledge(setup.requestId, {ok: true});
    }};
  });
  for (let step = 0; step < hz; step++) {now = step / hz; for (const phone of phones) phone.sample(false);}
  game.startMatch({players: 2});
  for (const phone of phones) phone.session.lobby({connected: true, playing: true, paused: false, gameId: 'casual', generation: 1});
  const collision = game.physics.onEvent;
  game.physics.onEvent = event => {events.push({...event, serve: Boolean(game.serveMotion)}); collision(event);};
  let nextSensor = 1, nextFrame = 1, previousFrame = 1;
  for (let step = 0; step < seconds * 600; step++) {
    now = 1 + step / 600;
    if (now + 1e-9 >= nextSensor) {
      for (const phone of phones) {phone.session.setPhase(game.snapshot().phase); phone.sample(true);}
      nextSensor += 1 / hz;
    }
    while (packets.length && packets[0].at <= now) {
      const packet = packets.shift();
      game.setInput(packet.event, {player: packet.player, remote: true});
    }
    if (now + 1e-9 >= nextFrame) {
      game.update(now - previousFrame); previousFrame = now; nextFrame = now + 1 / 30;
    }
  }
  const returns = events.filter(event => event.kind === 'hit' && !event.serve);
  return {game, events, returns};
}

test('two independently moving phones can rally without stopping between strokes or timing a collider', () => {
  for (const periods of [[.7, .9], [.4, .6], [1.2, 1.6]]) {
    const result = casualMatch({periods});
    expect(result.returns.length, `periods ${periods}`).toBeGreaterThanOrEqual(12);
    for (const player of [1, 2]) expect(result.returns.filter(hit => hit.player === player).length).toBeGreaterThanOrEqual(5);
    expect(result.returns.every(hit => hit.assisted)).toBe(true);
  }
});

test('a lower-rate sensor and slower relay still accept continuously moving hands', () => {
  const result = casualMatch({hz: 30, delay: .08, carry: .8});
  expect(result.returns.length).toBeGreaterThanOrEqual(12);
  expect(result.game.snapshot().stale).toBe(false);
});
