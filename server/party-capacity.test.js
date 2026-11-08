import {expect, test} from 'vitest';
import {RoomStore} from './src/RoomStore.js';
import {PROTOCOL_VERSION as v, PHASES, isBowlingState, isGameHit, playerCapacity} from '../shared/protocol.js';
import {createControllerCapabilities} from '../shared/controllerCapabilities.js';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {ProfileStore} from './profiles/store.js';
import {validateSportState} from './profiles/roomPersistence.js';

function fixture(sport = 'bowling', count = 8) {
  let now = 1000;
  const store = new RoomStore({now: () => now});
  const capabilities = createControllerCapabilities();
  const host = store.createRoom('tv', {v, sport, capabilities});
  expect(store.setPlayerCount('tv', {count}).ok).toBe(true);
  const phones = Array.from({length: count}, (_, i) => store.join(`p${i + 1}`, {v, code: host.code, name: `Player ${i + 1}`, capabilities}));
  const ready = player => {store.setSetup(`p${player}`, {setup: 'buttons'}); return store.setReady(`p${player}`, {ready: true});};
  const start = () => {
    for (let i = 1; i <= count; i++) ready(i);
    now += 5000; store.finishCountdown(host.code);
    return store.lobby(host.code);
  };
  return {store, host, phones, ready, start, advance: ms => {now += ms;}};
}

test('eight bowling phones have unique seats, a ninth is rejected, and the last ready phone starts play', () => {
  const {store, host, phones, ready, advance} = fixture();
  expect(phones.map(phone => phone.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(store.join('p9', {v, code: host.code, name: 'Ninth'}).error).toBe('room-full');
  for (let i = 1; i <= 7; i++) expect(ready(i).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code).phase).toBe(PHASES.READY);
  expect(ready(8).countdownStarted).toBe(true);
  advance(5000); store.finishCountdown(host.code);
  expect(store.lobby(host.code).phase).toBe(PHASES.GAME);
  expect(store.lobby(host.code).expectedPlayers).toBe(8);
});

test('party target holds the first ready phone, can cancel a countdown, and never evicts joined players', () => {
  const {store, host, ready} = fixture('bowling', 1);
  expect(store.setPlayerCount('p1', {count: 8}).error).toBe('not-host');
  for (const count of [0, 9, -1, 2.5, '8', null]) expect(store.setPlayerCount('tv', {count}).error).toBe('bad-player-count');
  expect(store.setPlayerCount('tv', {count: 8}).ok).toBe(true);
  expect(ready(1).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code).countdown).toBeNull();
  expect(store.setPlayerCount('tv', {count: 1}).countdownStarted).toBe(true);
  expect(store.setPlayerCount('tv', {count: 2}).ok).toBe(true);
  expect(store.lobby(host.code).phase).toBe(PHASES.READY);
  expect(store.lobby(host.code).players[0].ready).toBe(true);
  expect(store.join('p2', {v, code: host.code, name: 'Friend'}).slot).toBe(1);
  expect(store.setPlayerCount('tv', {count: 1}).error).toBe('players-already-joined');
  expect(store.lobby(host.code).players).toHaveLength(2);
});

test('eighth bowler can aim at 60Hz, roll, reconnect into the same seat, and remain isolated from spoofed players', () => {
  const {store, host, phones, start, advance} = fixture();
  const state = start();
  expect(store.setGameState('tv', {gameId: state.gameId, phase: 'ready', currentPlayer: 8, frame: 1}).ok).toBe(true);
  const aim = {gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch, seq: 1, aim: .3, locked: false};
  expect(store.continuousTarget('p1', aim, 'aim').error).toBe('not-your-turn');
  expect(store.continuousTarget('p8', {...aim, player: 1}, 'aim').event.player).toBe(8);
  advance(17);
  expect(store.continuousTarget('p8', {...aim, seq: 2, aim: -.2}, 'aim').ok).toBe(true);
  expect(store.rollTarget('p8', {...aim, type: 'roll', id: 'eight-roll', power: .6, spin: .2, aim: -.2, player: 1}).event.player).toBe(8);
  store.disconnect('p8');
  expect(store.lobby(host.code).paused).toBe(true);
  expect(store.join('p9', {v, code: host.code, name: 'Ninth'}).error).toBe('room-full');
  const returned = store.resume('p8-back', {v, code: host.code, role: 'player', token: phones[7].token});
  expect(returned.slot).toBe(7);
  expect(returned.players).toHaveLength(8);
  expect(returned.paused).toBe(false);
  expect(store.resume('new-tv', {v, code: host.code, role: 'host', token: host.token}).expectedPlayers).toBe(8);
});

test('smaller sports reject an eight-player roster and safely reuse the room after extras leave', () => {
  const {store, host} = fixture();
  expect(store.switchSport('tv', {sport: 'table-tennis', gameId: null}).error).toBe('too-many-players');
  for (let i = 3; i <= 8; i++) store.remove(`p${i}`);
  expect(store.switchSport('tv', {sport: 'table-tennis', gameId: null}).ok).toBe(true);
  expect(store.lobby(host.code).expectedPlayers).toBe(2);
  expect(store.lobby(host.code).players.map(player => player.slot)).toEqual([0, 1]);
  expect(store.join('extra', {v, code: host.code, name: 'Extra'}).error).toBe('room-full');
});

test('two table-tennis phones have independent sequence streams and cannot enable solo practice', () => {
  const {store, host, start} = fixture('table-tennis', 2);
  const state = start();
  const pose = {gameId: state.gameId, generation: state.inputGeneration, hostEpoch: state.hostEpoch, seq: 1,
    orientation: [0, 0, 0, 1], angularVelocity: {x: 0, y: 0, z: 2}, calibrationRevision: 0};
  expect(store.continuousTarget('p1', {...pose, player: 2}, 'pose').event.player).toBe(1);
  expect(store.continuousTarget('p2', {...pose, player: 1}, 'pose').event.player).toBe(2);
  expect(store.setGameOptions('tv', {gameId: state.gameId, sport: 'table-tennis', settings: {assistance: 'friendly', sensitivity: 1}, practice: {active: false}}).ok).toBe(true);
  expect(store.lobby(host.code).gameOptions.humanOpponent).toBe(true);
  for (const action of ['practice-start', 'practice-stop', 'feed']) {
    expect(store.gameCommandTarget('p1', {gameId: state.gameId, id: action, action}).error).toBe('solo-only');
  }
  expect(isGameHit({id: 'p2-hit', gameId: state.gameId, player: 2}, 'table-tennis')).toBe(true);
});

test('turn, winner, profile and checkpoint capacities agree for all eight bowlers', () => {
  expect(playerCapacity('bowling')).toBe(8);
  expect(isBowlingState({phase: 'ready', frame: 1, currentPlayer: 8})).toBe(true);
  expect(isBowlingState({phase: 'ready', frame: 1, currentPlayer: 9})).toBe(false);
  expect(isBowlingState({phase: 'complete', frame: 10, currentPlayer: null, winners: [1, 2, 3, 4, 5, 6, 7, 8], winnerScore: 0})).toBe(true);
  const profiles = new ProfileStore();
  try {
    const participants = Array.from({length: 8}, (_, i) => ({memberId: `p${i + 1}`, name: `Player ${i + 1}`}));
    expect(profiles.createMatch({matchId: 'eight-bowlers', sport: 'bowling', hostMemberId: 'tv', participants}).revision).toBe(0);
    expect(() => profiles.createMatch({matchId: 'nine-bowlers', sport: 'bowling', hostMemberId: 'tv', participants: [...participants, {memberId: 'p9', name: 'Extra'}]})).toThrow('invalid-match');
    const payload = {version: 1, boundary: 'settled', match: {version: 1, players: participants.map((p, i) => ({player: i + 1, name: p.name})), deliveries: []},
      pins: Array.from({length: 10}, (_, i) => ({id: i + 1, standing: true, position: [0, .4, -9], quaternion: [0, 0, 0, 1]})), settings: {aim: 0}};
    expect(validateSportState({sport: 'bowling', players: participants.map((p, slot) => ({...p, slot}))}, payload)).toBeUndefined();
    expect(profiles.saveCheckpoint({matchId: 'eight-bowlers', hostMemberId: 'tv', hostEpoch: 1, expectedRevision: 0, state: payload}).saved).toBe(true);
  } finally {profiles.close();}
});


test('eight friends can scan and tap Play one at a time without unreadying earlier phones', () => {
  const capabilities = createControllerCapabilities();
  const store = new RoomStore();
  const host = store.createRoom('tv', {v, sport: 'bowling', capabilities});
  store.setPlayerCount('tv', {count: 8});
  for (let player = 1; player <= 8; player++) {
    expect(store.join(`p${player}`, {v, code: host.code, name: `Friend ${player}`, capabilities}).ok).toBe(true);
    expect(store.lobby(host.code).players.slice(0, -1).every(seat => seat.ready)).toBe(true);
    store.setSetup(`p${player}`, {setup: 'buttons'});
    const result = store.setReady(`p${player}`, {ready: true});
    expect(Boolean(result.countdownStarted)).toBe(player === 8);
  }
  expect(store.lobby(host.code).players.every(seat => seat.ready)).toBe(true);
});

test('table-tennis versus checkpoints validate both seats and derive each human result', () => {
  const game = new TableTennisGame(); game.startMatch({players: 2});
  const payload = game.checkpoint();
  const room = {sport: 'table-tennis', players: [{memberId: 'one', slot: 0}, {memberId: 'two', slot: 1}]};
  expect(validateSportState(room, payload)).toBeUndefined();
  expect(() => validateSportState({...room, players: room.players.slice(0, 1)}, payload)).toThrow('wrong-roster');
  expect(() => validateSportState(room, {...payload, mode: 'bot'})).toThrow('wrong-roster');
  payload.rules = {targetPoints: 12, firstServer: 1, score: [12, 8], pointId: 20, phase: 'complete', winner: 1};
  expect(validateSportState(room, payload)).toEqual([
    {memberId: 'one', score: 12, rank: 1, outcome: 'win'},
    {memberId: 'two', score: 8, rank: 2, outcome: 'loss'},
  ]);
});
