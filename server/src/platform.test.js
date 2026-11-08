import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {EVENTS, PHASES, PROTOCOL_VERSION as v} from '../../shared/protocol.js';
import {createControllerCapabilities} from '../../shared/controllerCapabilities.js';
import {RoomStore} from './RoomStore.js';
const capabilities = createControllerCapabilities();
import {createGameServer} from './app.js';
import {TableTennisGame} from '../../src/tabletennis/game.js';

function fixture(sport = 'table-tennis', {count = 1, setup = 'motion', playing = true} = {}) {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const room = store.createRoom('tv', {v, sport, capabilities});
  assert.equal(room.ok, true);
  const seats = Array.from({length: count}, (_, index) => {
    const socket = `p${index + 1}`;
    const seat = store.join(socket, {v, code: room.code, name: `Player ${index + 1}`, capabilities});
    assert.equal(seat.ok, true);
    assert.equal(store.setSetup(socket, {setup}).ok, true);
    return seat;
  });
  const view = () => store.lobby(room.code);
  const start = () => {
    for (let index = 0; index < count; index++) assert.equal(store.setReady(`p${index + 1}`, {ready: true}).ok, true);
    store.startGame('p1');
    now += 5000;
    store.finishCountdown(room.code);
    assert.equal(view().phase, PHASES.GAME);
    const state = view().sport === 'bowling' ? {phase: 'ready', currentPlayer: 1, frame: 1}
      : {phase: 'ready', score: [0, 0], server: 1, winner: null, practice: false};
    assert.equal(store.setGameState('tv', {gameId: view().gameId, ...state}).ok, true);
  };
  const envelope = seq => ({gameId: view().gameId, generation: view().inputGeneration, hostEpoch: view().hostEpoch, seq});
  const pose = (seq = 1) => ({...envelope(seq), orientation: [0, 0, 0, 1], angularVelocity: {x: 1, y: 2, z: 3}, calibrationRevision: 1, reach: {x: .2, y: -.1}});
  const aim = (seq = 1) => ({...envelope(seq), aim: .3, locked: false});
  const roll = id => ({type: 'roll', id, gameId: view().gameId, generation: view().inputGeneration,
    hostEpoch: view().hostEpoch, aim: 0, power: .5, spin: 0});
  if (playing) start();
  return {store, room, seats, start, view, pose, aim, roll, advance: (ms = 50) => { now += ms; }};
}

test('legacy clients retain their sports but must opt in before table tennis is offered', () => {
  const store = new RoomStore();
  assert.equal(store.createRoom('legacy-tv', {v, sport: 'table-tennis'}).error, 'unsupported-sport');
  const legacyRoom = store.createRoom('legacy-tv', {v, sport: 'bowling'});
  assert.equal(legacyRoom.ok, true);
  assert.equal(store.join('modern-phone', {v, code: legacyRoom.code, name: 'Player', capabilities}).ok, true);
  assert.equal(store.switchSport('legacy-tv', {gameId: null, sport: 'table-tennis'}).error, 'unsupported-sport');
  const modernRoom = store.createRoom('modern-tv', {v, sport: 'table-tennis', capabilities});
  assert.equal(store.join('legacy-phone', {v, code: modernRoom.code, name: 'Legacy'}).error, 'unsupported-sport');
  // Sensors and haptics are optional; the negotiated touch controller is complete.
  assert.equal(store.join('touch-phone', {v, code: modernRoom.code, name: 'Touch',
    capabilities: createControllerCapabilities({motion: false, orientation: false, haptics: false})}).ok, true);
});

test('pose routing derives the room, target and player from the authenticated connection', () => {
  const f = fixture();
  const other = f.store.createRoom('other-tv', {v, sport: 'table-tennis', capabilities});
  f.store.join('other-phone', {v, code: other.code, name: 'Other', capabilities});
  f.store.setSetup('other-phone', {setup: 'buttons'});
  const event = {...f.pose(), code: other.code, player: 4, hostSocketId: 'other-tv', memberId: 'forged', token: 'not-a-token',
    angularVelocity: {...f.pose().angularVelocity, arbitrary: 'must not be forwarded'}};
  const result = f.store.continuousTarget('p1', event, 'pose');
  assert.equal(result.ok, true);
  assert.equal(result.code, f.room.code);
  assert.equal(result.hostSocketId, 'tv');
  assert.deepEqual(result.event, {...f.pose(), player: 1});
  for (const socket of ['tv', 'outsider']) assert.equal(f.store.continuousTarget(socket, event, 'pose').error, 'not-controller');
  assert.equal(f.store.continuousTarget('other-phone', event, 'pose').ok, false);
  assert.equal(JSON.stringify(f.view()).includes(f.seats[0].token), false);
  assert.equal(JSON.stringify(f.view()).includes(f.room.token), false);
});

test('pose validation rejects invalid input before it can poison the latest accepted sequence', () => {
  const f = fixture();
  const corruptions = [
    {orientation: [0, 0, 0, 0]}, {orientation: [0, 0, 0, NaN]},
    {orientation: [0, 0, 0, 2]}, {angularVelocity: {x: Infinity, y: 0, z: 0}},
    {angularVelocity: {x: 0, y: 101, z: 0}}, {reach: {x: 2, y: 0}},
    {calibrationRevision: -1}, {seq: -1}, {seq: 1.5}, {hostEpoch: 0},
    {hand: 'Both'}, {hand: 1},
    ...[null, NaN, Infinity, -.01, '1', 1e9 + 1].map(sourceTime => ({sourceTime})),
  ];
  for (const corruption of corruptions) {
    assert.equal(f.store.continuousTarget('p1', {...f.pose(999), ...corruption}, 'pose').error, 'bad-input');
  }
  assert.equal(f.store.continuousTarget('p1', f.pose(1), 'pose').ok, true);
});

test('pose routing preserves a validated hand preference and keeps legacy poses compatible', () => {
  const f = fixture();
  const left = f.store.continuousTarget('p1', {...f.pose(1), hand: 'Left'}, 'pose');
  assert.equal(left.ok, true);
  assert.equal(left.event.hand, 'Left');
  f.advance();
  const legacy = f.store.continuousTarget('p1', f.pose(2), 'pose');
  assert.equal(legacy.ok, true);
  assert.equal(legacy.event.hand, undefined);
});

test('pose routing preserves the phone sample clock without translating it to server time', () => {
  const f = fixture();
  for (const [index, sourceTime] of [0, 120.125, 1e9].entries()) {
    f.advance(16);
    const result = f.store.continuousTarget('p1', {...f.pose(index + 1), sourceTime}, 'pose');
    assert.equal(result.ok, true);
    assert.equal(result.event.sourceTime, sourceTime);
  }
  f.advance();
  const legacy = f.store.continuousTarget('p1', f.pose(4), 'pose');
  assert.equal(legacy.ok, true);
  assert.equal(Object.hasOwn(legacy.event, 'sourceTime'), false);
});

test('continuous streams keep the latest sequence, discard burst samples and never replay a backlog', () => {
  const f = fixture();
  assert.equal(f.store.continuousTarget('p1', f.pose(10), 'pose').ok, true);
  assert.equal(f.store.continuousTarget('p1', f.pose(10), 'pose').error, 'stale-sequence');
  assert.equal(f.store.continuousTarget('p1', f.pose(9), 'pose').error, 'stale-sequence');
  assert.equal(f.store.continuousTarget('p1', f.pose(12), 'pose').error, 'rate-limited');
  f.advance();
  assert.equal(f.store.continuousTarget('p1', f.pose(11), 'pose').error, 'stale-sequence');
  const next = f.store.continuousTarget('p1', f.pose(13), 'pose');
  assert.equal(next.ok, true);
  assert.equal(next.event.seq, 13);
});

test('the pose relay admits 60 Hz input with jitter and still rejects bursts without a queue', () => {
  const f = fixture();
  for (let seq = 0; seq < 60; seq++) {
    if (seq) f.advance(seq % 2 ? 15 : 18);
    assert.equal(f.store.continuousTarget('p1', f.pose(seq), 'pose').ok, true);
  }
  f.advance(1);
  assert.equal(f.store.continuousTarget('p1', f.pose(60), 'pose').error, 'rate-limited');
  f.advance(14);
  // The rejected sample is still obsolete; retrying it cannot replay it later.
  assert.equal(f.store.continuousTarget('p1', f.pose(60), 'pose').error, 'stale-sequence');
  assert.equal(f.store.continuousTarget('p1', f.pose(61), 'pose').ok, true);
  const bowling = fixture('bowling');
  assert.equal(bowling.store.continuousTarget('p1', bowling.aim(0), 'aim').ok, true);
  bowling.advance(18);
  assert.equal(bowling.store.continuousTarget('p1', bowling.aim(1), 'aim').ok, true);
  bowling.advance(1);
  assert.equal(bowling.store.continuousTarget('p1', bowling.aim(2), 'aim').error, 'rate-limited');
});

test('pause cancels old-generation pose, and resume requires a fresh envelope', () => {
  const f = fixture();
  const before = f.pose();
  assert.equal(f.store.continuousTarget('p1', before, 'pose').ok, true);
  assert.equal(f.store.setPaused('p1', {gameId: before.gameId, paused: true}, 'player').ok, true);
  assert.equal(f.store.continuousTarget('p1', {...before, seq: 2}, 'pose').error, 'paused');
  assert.equal(f.store.setPaused('p1', {gameId: before.gameId, paused: false}, 'player').ok, true);
  assert.ok(f.view().inputGeneration > before.generation);
  assert.equal(f.store.continuousTarget('p1', {...before, seq: 3}, 'pose').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', f.pose(0), 'pose').ok, true);
});

test('timestamped poses admit six batched samples with bounded server-clock credit and no replay', () => {
  const f = fixture();
  const pose = seq => ({...f.pose(seq), sourceTime:100 + seq / 60});
  for(let seq=0;seq<6;seq++) assert.equal(f.store.continuousTarget('p1', pose(seq), 'pose').ok,true);
  assert.equal(f.store.continuousTarget('p1', pose(6), 'pose').error,'rate-limited');
  f.advance(100);
  assert.equal(f.store.continuousTarget('p1', pose(6), 'pose').error,'stale-sequence');
  for(let seq=7;seq<13;seq++) assert.equal(f.store.continuousTarget('p1', pose(seq), 'pose').ok,true);
  assert.equal(f.store.continuousTarget('p1', pose(13), 'pose').error,'rate-limited');
  f.advance(16);
  assert.equal(f.store.continuousTarget('p1', pose(14), 'pose').error,'rate-limited');
  f.advance(1);
  assert.equal(f.store.continuousTarget('p1', pose(15), 'pose').ok,true);
});

test('phone source-clock jumps or rewinds cannot create relay capacity or reorder a gesture', () => {
  const f=fixture();
  for(let seq=0;seq<6;seq++) assert.equal(f.store.continuousTarget('p1',{...f.pose(seq),sourceTime:100+seq/60},'pose').ok,true);
  assert.equal(f.store.continuousTarget('p1',{...f.pose(100),sourceTime:99},'pose').error,'stale-source-time');
  assert.equal(f.store.continuousTarget('p1',{...f.pose(6),sourceTime:1e8},'pose').error,'rate-limited');
  assert.equal(f.store.continuousTarget('p1',{...f.pose(7),sourceTime:1e8+1},'pose').error,'rate-limited');
  // Rewinding the server clock also cannot refill or double-count elapsed time.
  f.advance(-100);
  assert.equal(f.store.continuousTarget('p1',{...f.pose(8),sourceTime:1e8+2},'pose').error,'rate-limited');
  f.advance(100);
  assert.equal(f.store.continuousTarget('p1',{...f.pose(9),sourceTime:1e8+3},'pose').error,'rate-limited');
  f.advance(17);
  assert.equal(f.store.continuousTarget('p1',{...f.pose(10),sourceTime:1e8+4},'pose').ok,true);
});

test('omitting sourceTime cannot reset an exhausted timestamped-pose bucket', () => {
  const f=fixture();
  for(let seq=0;seq<6;seq++) assert.equal(f.store.continuousTarget('p1',{...f.pose(seq),sourceTime:seq/60},'pose').ok,true);
  f.advance(12);
  assert.equal(f.store.continuousTarget('p1',f.pose(6),'pose').ok,true,'legacy cadence remains compatible');
  assert.equal(f.store.continuousTarget('p1',{...f.pose(7),sourceTime:1},'pose').error,'rate-limited');
});

test('a new input generation resets pose sequence, source clock and bounded burst budget', () => {
  const f=fixture();
  const old=f.pose(0);
  for(let seq=0;seq<6;seq++) assert.equal(f.store.continuousTarget('p1',{...f.pose(seq),sourceTime:100+seq/60},'pose').ok,true);
  assert.equal(f.store.setPaused('p1',{gameId:old.gameId,paused:true},'player').ok,true);
  assert.equal(f.store.setPaused('p1',{gameId:old.gameId,paused:false},'player').ok,true);
  assert.equal(f.store.continuousTarget('p1',{...old,seq:10,sourceTime:101},'pose').error,'wrong-generation');
  for(let seq=0;seq<6;seq++) assert.equal(f.store.continuousTarget('p1',{...f.pose(seq),sourceTime:seq/60},'pose').ok,true);
  assert.equal(f.store.continuousTarget('p1',{...f.pose(6),sourceTime:.1},'pose').error,'rate-limited');
});

test('host replacement advances the epoch and routes only new-generation input to the replacement', () => {
  const f = fixture();
  const before = f.pose();
  const resumed = f.store.resume('new-tv', {v, code: f.room.code, role: 'host', token: f.room.token});
  assert.equal(resumed.ok, true);
  assert.equal(resumed.hostEpoch, before.hostEpoch + 1);
  assert.equal(f.store.continuousTarget('p1', {...f.pose(), hostEpoch: before.hostEpoch}, 'pose').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', before, 'pose').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('p1', f.pose(), 'pose').hostSocketId, 'new-tv');
  assert.equal(f.store.setGameState('tv', {gameId: f.view().gameId, phase: 'complete', score: [11, 0], server: 1, winner: 1, practice: false}).error, 'not-host');
});

test('phone replacement cannot retain a stale socket or replay its earlier stream', () => {
  const f = fixture();
  const before = f.pose();
  const resumed = f.store.resume('new-phone', {v, code: f.room.code, role: 'player', token: f.seats[0].token});
  assert.equal(resumed.slot, 0);
  assert.equal(resumed.name, 'Player 1');
  assert.equal(f.view().players.length, 1);
  assert.equal(f.store.continuousTarget('p1', f.pose(), 'pose').error, 'not-controller');
  assert.equal(f.store.continuousTarget('new-phone', before, 'pose').error, 'wrong-generation');
  assert.equal(f.store.continuousTarget('new-phone', f.pose(), 'pose').ok, true);
});

test('bowling preview is only from the current player in the ready phase and cannot authorize a roll', () => {
  const f = fixture('bowling', {count: 2});
  assert.equal(f.store.continuousTarget('p2', {...f.aim(), player: 1}, 'aim').error, 'not-your-turn');
  assert.equal(f.store.continuousTarget('p1', {...f.aim(), locked: true}, 'aim').ok, true);
  assert.equal(f.store.actionStatus('p1', {gameId: f.view().gameId, id: 'preview'}).error, 'unknown-action');
  assert.equal(f.view().gameState.phase, 'ready');
  f.store.setGameState('tv', {gameId: f.view().gameId, phase: 'rolling', currentPlayer: 1, frame: 1});
  f.advance();
  assert.equal(f.store.continuousTarget('p1', f.aim(2), 'aim').error, 'not-your-turn');
  assert.equal(f.store.continuousTarget('p1', f.pose(2), 'pose').error, 'not-controller');
});

test('table tennis has two seats; same-room switching preserves credentials and rechecks motion setup', () => {
  const f = fixture('bowling', {playing: false});
  const before = f.view();
  assert.equal(f.store.switchSport('tv', {sport: 'table-tennis', gameId: null}).ok, true);
  const after = f.view();
  assert.equal(after.code, f.room.code);
  assert.equal(after.sport, 'table-tennis');
  assert.equal(after.players[0].name, before.players[0].name);
  assert.equal(after.players[0].slot, 0);
  assert.equal(after.players[0].setup, null);
  assert.equal(after.players[0].ready, false);
  assert.ok(after.inputGeneration > before.inputGeneration);
  assert.equal(f.store.join('second', {v, code: f.room.code, name: 'Friend', capabilities}).slot, 1);
  assert.equal(f.store.join('third', {v, code: f.room.code, name: 'Extra', capabilities}).error, 'room-full');
  assert.equal(f.store.setReady('p1', {ready: true}).error, 'setup-required');
  assert.equal(f.store.resume('new-phone', {v, code: f.room.code, role: 'player', token: f.seats[0].token}).ok, true);
  assert.equal(f.store.resume('new-tv', {v, code: f.room.code, role: 'host', token: f.room.token}).ok, true);
  assert.equal(f.view().players.length, 2);
});

test('sport switching keeps touch setup, refuses extra seats, and requires authenticated P1 or host', () => {
  const f = fixture('bowling', {playing: false, count: 3, setup: 'buttons'});
  const change = {sport: 'table-tennis', gameId: null};
  for (const [socket, role] of [['p1', 'host'], ['p2', 'player'], ['outsider', 'host']]) {
    assert.equal(f.store.switchSport(socket, change, role).error, 'not-game-leader');
  }
  assert.equal(f.store.switchSport('p1', change, 'player').error, 'too-many-players');
  f.store.remove('p3');
  assert.equal(f.store.switchSport('p1', change, 'player').ok, true);
  assert.equal(f.view().players[0].setup, 'buttons');
  assert.equal(f.store.setReady('p1', {ready: true}).ok, true);
});

test('a running match cannot switch sports until returned; its game ID cannot cancel the next lobby', () => {
  const f = fixture('bowling', {setup: 'buttons'});
  const oldGameId = f.view().gameId;
  assert.equal(f.store.switchSport('tv', {sport: 'table-tennis', gameId: oldGameId}).error, 'return-to-lobby-first');
  assert.equal(f.store.returnToLobby('tv', {gameId: oldGameId}).ok, true);
  assert.equal(f.store.switchSport('tv', {sport: 'table-tennis', gameId: oldGameId}).error, 'not-playing');
  assert.equal(f.store.switchSport('tv', {sport: 'table-tennis', gameId: null}).ok, true);
  assert.equal(f.store.continuousTarget('p1', {...f.pose(), gameId: oldGameId}, 'pose').error, 'not-playing');
});

test('roll status belongs to its authenticated player, survives reconnect, and never authorizes retry', () => {
  const f = fixture('bowling', {count: 2});
  const roll = f.roll('once-only');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
  const query = {id: roll.id, gameId: roll.gameId};
  assert.equal(f.store.actionStatus('p1', query).status, 'pending');
  for (const socket of ['p2', 'tv', 'unknown']) assert.equal(f.store.actionStatus(socket, query).error, 'unknown-action');
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, {ok: false, error: 'outcome-unknown'});
  assert.equal(f.store.actionStatus('p1', query).status, 'unknown');
  assert.equal(f.store.rollTarget('p1', roll).error, 'duplicate-roll');
  f.store.resume('back', {v, code: f.room.code, role: 'player', token: f.seats[0].token});
  assert.equal(f.store.actionStatus('p1', query).error, 'unknown-action');
  assert.equal(f.store.actionStatus('back', query).status, 'unknown');
  assert.equal(f.store.actionStatus('back', {...query, gameId: 'old-game'}).error, 'unknown-action');
});

test('negotiated modern rolls cannot omit their game, input generation or host epoch', () => {
  const f = fixture('bowling');
  const roll = f.roll('current-release');
  for (const omitted of ['gameId', 'generation', 'hostEpoch']) {
    const event = {...roll}; delete event[omitted];
    assert.equal(f.store.rollTarget('p1', event).error, 'wrong-generation');
  }
  assert.equal(f.store.rollTarget('p1', {...roll, generation: roll.generation - 1}).error, 'wrong-generation');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
});

test('negotiated modern tennis swings cannot bypass generation checks with a legacy-shaped action', () => {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const room = store.createRoom('tv', {v, sport: 'tennis', capabilities});
  store.join('phone', {v, code: room.code, name: 'Player', capabilities});
  store.setSetup('phone', {setup: 'buttons'});
  store.setReady('phone', {ready: true}); store.startGame('phone');
  now = 5000; store.finishCountdown(room.code);
  store.vote('phone', {watch: false});
  const state = store.lobby(room.code);
  assert.equal(state.phase, PHASES.GAME);
  const swing = {type: 'swing', id: 'current-swing', label: 'Forehand', hand: 'Right',
    gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch};
  for (const omitted of ['gameId', 'generation', 'hostEpoch']) {
    const event = {...swing}; delete event[omitted];
    assert.equal(store.swingTarget('phone', event).error, 'wrong-generation');
  }
  assert.equal(store.swingTarget('phone', swing).ok, true);
});

test('settled roll status is idempotent and disappears when a new game replaces its owner game', () => {
  const f = fixture('bowling');
  const roll = f.roll('accepted-roll');
  assert.equal(f.store.rollTarget('p1', roll).ok, true);
  const outcome = {ok: true, id: roll.id, receivers: 1};
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, outcome);
  f.store.finishRollDelivery(f.room.code, roll.id, roll.gameId, {ok: false, error: 'late-error'});
  assert.deepEqual(f.store.actionStatus('p1', {id: roll.id, gameId: roll.gameId}), {ok: true, id: roll.id, status: 'accepted', result: outcome});
  assert.equal(f.store.returnToLobby('tv', {gameId: roll.gameId}).ok, true);
  assert.equal(f.store.actionStatus('p1', {id: roll.id, gameId: roll.gameId}).error, 'unknown-action');
});

test('stable checkpoints authorize the current host, use revisions, and expose only acknowledged saved status', () => {
  const f = fixture();
  const state = new TableTennisGame().checkpoint();
  const event = {gameId: f.view().gameId, generation: f.view().inputGeneration, hostEpoch: f.view().hostEpoch,
    sport: 'table-tennis', rulesVersion: 1, checkpointVersion: 1, expectedRevision: 0, payload: state};
  for (const socket of ['p1', 'unknown']) assert.equal(f.store.saveCheckpoint(socket, event).error, 'not-host');
  assert.equal(f.store.saveCheckpoint('tv', {...event, generation: event.generation - 1}).error, 'wrong-generation');
  const first = f.store.saveCheckpoint('tv', event);
  assert.equal(first.ok, true);
  assert.equal(first.checkpoint.revision, 1);
  assert.equal(first.checkpoint.saved, false);
  assert.equal(f.view().recovery.saved, false);
  assert.equal(f.store.saveCheckpoint('tv', event).duplicate, true);
  const secondEvent = {...event, payload: {...state, seed: state.seed + 1}};
  assert.equal(f.store.saveCheckpoint('tv', secondEvent).error, 'revision-conflict');
  const second = f.store.saveCheckpoint('tv', {...secondEvent, expectedRevision: 1});
  assert.equal(second.checkpoint.revision, 2);
  f.store.checkpointStatus(f.room.code, 1, {saved: true});
  assert.equal(f.view().recovery.saved, false, 'an earlier write acknowledgement cannot mark a later boundary durable');
  f.store.checkpointStatus(f.room.code, 2, {saved: true});
  assert.equal(f.view().recovery.saved, true);
  const query = {gameId: event.gameId, hostEpoch: event.hostEpoch};
  assert.equal(f.store.recovery('p1', query).error, 'not-host');
  const recovered = f.store.recovery('tv', query);
  assert.equal(recovered.checkpoint.revision, 2);
  assert.deepEqual(recovered.checkpoint.payload, secondEvent.payload);
});

test('host recovery rejects an old host and epoch and never checkpoints an active rally', () => {
  const f = fixture();
  const payload = new TableTennisGame().checkpoint();
  const event = {gameId: f.view().gameId, generation: f.view().inputGeneration, hostEpoch: f.view().hostEpoch,
    sport: 'table-tennis', rulesVersion: 1, checkpointVersion: 1, expectedRevision: 0, payload};
  assert.equal(f.store.saveCheckpoint('tv', event).ok, true);
  const resumed = f.store.resume('new-tv', {v, code: f.room.code, role: 'host', token: f.room.token});
  assert.equal(f.store.saveCheckpoint('tv', event).error, 'not-host');
  assert.equal(f.store.saveCheckpoint('new-tv', event).error, 'wrong-generation');
  assert.equal(f.store.recovery('new-tv', {gameId: event.gameId, hostEpoch: event.hostEpoch}).error, 'not-playing');
  assert.equal(f.store.recovery('new-tv', {gameId: event.gameId, hostEpoch: resumed.hostEpoch}).checkpoint.revision, 1);
  f.store.setGameState('new-tv', {gameId: event.gameId, phase: 'rally', score: [0, 0], server: 1, winner: null, practice: true});
  assert.equal(f.store.saveCheckpoint('new-tv', {...event, generation: resumed.inputGeneration,
    hostEpoch: resumed.hostEpoch, expectedRevision: 1, payload: {...payload, seed: payload.seed + 1}}).error, 'unstable-checkpoint');
});

const send = (socket, event, payload = {}) => socket.timeout(4000).emitWithAck(event, payload);
async function networkFixture(t) {
  let now = 0;
  const store = new RoomStore({now: () => now});
  const app = createGameServer({store, tickMs: 10});
  const clients = [];
  t.after(async () => { for (const client of clients) client.disconnect(); await app.close(); });
  app.http.listen(0, '127.0.0.1');
  await once(app.http, 'listening');
  return {store, advance: () => {now += 5000;}, client: async () => {
    const socket = io(`http://127.0.0.1:${app.http.address().port}`, {transports: ['websocket'], reconnection: false});
    clients.push(socket);
    await once(socket, 'connect', {signal: AbortSignal.timeout(2000)});
    return socket;
  }};
}

test('real sockets deliver sanitized pose to one room, drop replay, and publish fresh host epochs', async t => {
  const f = await networkFixture(t);
  const tv = await f.client(), phone = await f.client(), otherTv = await f.client(), outsider = await f.client();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'table-tennis', capabilities});
  const other = await send(otherTv, EVENTS.HOST_CREATE, {v, sport: 'table-tennis', capabilities});
  await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Player', capabilities});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  f.advance(); f.store.finishCountdown(room.code);
  const state = f.store.lobby(room.code);
  const pose = {gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch, seq: 1,
    orientation: [0, 0, 0, 1], angularVelocity: {x: 0, y: 1, z: 0}, calibrationRevision: 0,
    code: other.code, player: 4, hostSocketId: otherTv.id};
  const received = [], otherReceived = [];
  tv.on(EVENTS.GAME_POSE, event => received.push(event));
  otherTv.on(EVENTS.GAME_POSE, event => otherReceived.push(event));
  outsider.emit(EVENTS.PLAYER_POSE, pose);
  await send(outsider, EVENTS.PLAYER_ACTION_STATUS, {id: 'barrier', gameId: state.gameId});
  const first = once(tv, EVENTS.GAME_POSE, {signal: AbortSignal.timeout(2000)});
  phone.emit(EVENTS.PLAYER_POSE, pose);
  await first;
  assert.equal(received.length, 1);
  assert.equal(received[0].player, 1);
  assert.equal(received[0].code, undefined);
  assert.equal(received[0].hostSocketId, undefined);
  phone.emit(EVENTS.PLAYER_POSE, pose);
  await send(phone, EVENTS.PLAYER_ACTION_STATUS, {id: 'barrier', gameId: state.gameId});
  assert.equal(received.length, 1);
  assert.equal(otherReceived.length, 0);
  const newTv = await f.client();
  const resumed = await send(newTv, EVENTS.SESSION_RESUME, {v, code: room.code, token: room.token, role: 'host'});
  assert.equal(resumed.hostEpoch, state.hostEpoch + 1);
  const next = once(newTv, EVENTS.GAME_POSE, {signal: AbortSignal.timeout(2000)});
  phone.emit(EVENTS.PLAYER_POSE, {...pose, seq: 0, generation: resumed.inputGeneration, hostEpoch: resumed.hostEpoch});
  await next;
  assert.equal(received.length, 1, 'old TV cannot receive fresh input');
});

test('real sockets retain an unknown lost acknowledgement outcome and never replay its roll ID', async t => {
  const f = await networkFixture(t);
  const tv = await f.client(), phone = await f.client();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling'});
  await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Player', capabilities});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  f.advance(); f.store.finishCountdown(room.code);
  const state = f.store.lobby(room.code);
  await send(tv, EVENTS.HOST_GAME_STATE, {gameId: state.gameId, phase: 'ready', currentPlayer: 1, frame: 1});
  const rolls = [];
  tv.on(EVENTS.GAME_ROLL, event => { rolls.push(event); }); // Host received it, reply was lost.
  const roll = {type: 'roll', id: 'lost-reply', gameId: state.gameId, generation: state.inputGeneration,
    hostEpoch: state.hostEpoch, power: .5, aim: 0, spin: 0};
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll)).error, 'outcome-unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ACTION_STATUS, {id: roll.id, gameId: state.gameId})).status, 'unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ROLL, roll)).error, 'duplicate-roll');
  assert.equal(rolls.length, 1);
});

test('real sockets cannot accept a late roll reply from a replaced host epoch', async t => {
  const f = await networkFixture(t);
  const tv = await f.client(), phone = await f.client();
  const room = await send(tv, EVENTS.HOST_CREATE, {v, sport: 'bowling'});
  await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: 'Player', capabilities});
  await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
  await send(phone, EVENTS.PLAYER_READY, {ready: true});
  await send(phone, EVENTS.PLAYER_START, {});
  f.advance(); f.store.finishCountdown(room.code);
  const state = f.store.lobby(room.code);
  await send(tv, EVENTS.HOST_GAME_STATE, {gameId: state.gameId, phase: 'ready', currentPlayer: 1, frame: 1});
  const roll = {type: 'roll', id: 'old-host-reply', gameId: state.gameId, generation: state.inputGeneration,
    hostEpoch: state.hostEpoch, power: .5, aim: 0, spin: 0};
  const receipt = once(tv, EVENTS.GAME_ROLL, {signal: AbortSignal.timeout(2000)});
  const pending = send(phone, EVENTS.PLAYER_ROLL, roll);
  const [, reply] = await receipt;
  const replacement = await f.client();
  assert.equal((await send(replacement, EVENTS.SESSION_RESUME, {v, code: room.code, token: room.token, role: 'host'})).ok, true);
  reply({ok: true});
  assert.equal((await pending).error, 'outcome-unknown');
  assert.equal((await send(phone, EVENTS.PLAYER_ACTION_STATUS, {id: roll.id, gameId: state.gameId})).status, 'unknown');
});
