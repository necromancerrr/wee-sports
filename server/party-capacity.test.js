import {expect, test} from 'vitest';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {createGameServer} from './src/app.js';
import {RoomStore} from './src/RoomStore.js';
import {PROTOCOL_VERSION as v, EVENTS, PHASES, VOTE_SECONDS, isBowlingState, isGameHit, playerCapacity} from '../shared/protocol.js';
import {createControllerCapabilities} from '../shared/controllerCapabilities.js';
import {TableTennisGame} from '../src/tabletennis/game.js';
import {ProfileStore} from './profiles/store.js';
import {validateSportState} from './profiles/roomPersistence.js';

function fixture(sport = 'bowling', count = 8) {
  let now = 1000;
  const store = new RoomStore({now: () => now});
  const capabilities = createControllerCapabilities();
  const host = store.createRoom('tv', {v, sport, capabilities});
  const phones = Array.from({length: count}, (_, i) => store.join(`p${i + 1}`, {v, code: host.code, name: `Player ${i + 1}`, capabilities}));
  const ready = player => {store.setSetup(`p${player}`, {setup: 'buttons'}); return store.setReady(`p${player}`, {ready: true});};
  const start = () => {
    for (let i = 1; i <= count; i++) ready(i);
    store.startGame('p1');
    now += 5000; store.finishCountdown(host.code);
    now += VOTE_SECONDS * 1000; store.expireVote(host.code);
    return store.lobby(host.code);
  };
  return {store, host, phones, ready, start, advance: ms => {now += ms;}};
}

test('eight bowling phones have unique seats, a ninth is rejected, and the leader confirms play', () => {
  const {store, host, phones, ready, advance} = fixture();
  expect(phones.map(phone => phone.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(store.join('p9', {v, code: host.code, name: 'Ninth'}).error).toBe('room-full');
  for (let i = 1; i <= 7; i++) expect(ready(i).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code).phase).toBe(PHASES.READY);
  expect(ready(8).countdownStarted).toBeUndefined();
  expect(store.startGame('p1').countdownStarted).toBe(true);
  advance(5000); store.finishCountdown(host.code);
  expect(store.lobby(host.code).phase).toBe(PHASES.GAME);
  expect(store.lobby(host.code).leaderSlot).toBe(0);
});

test('a smaller ready party waits for its leader to choose Start, without configuring the TV', () => {
  const {store, host, ready} = fixture('bowling', 2);
  expect(store.startGame('tv').error).toBe('not-game-leader');
  expect(store.startGame('p2').error).toBe('not-game-leader');
  expect(store.startGame('p1').error).toBe('players-not-ready');
  expect(ready(1).countdownStarted).toBeUndefined();
  expect(ready(2).countdownStarted).toBeUndefined();
  expect(store.lobby(host.code)).toMatchObject({phase: PHASES.READY, canStart: true, leaderSlot: 0});
  expect(store.startGame('p1').countdownStarted).toBe(true);
  expect(store.lobby(host.code).phase).toBe(PHASES.COUNTDOWN);
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
  expect(store.resume('new-tv', {v, code: host.code, role: 'host', token: host.token}).players).toHaveLength(8);
});

test('smaller sports reject an eight-player roster and safely reuse the room after extras leave', () => {
  const {store, host} = fixture();
  expect(store.switchSport('tv', {sport: 'table-tennis', gameId: null}).error).toBe('too-many-players');
  for (let i = 3; i <= 8; i++) store.remove(`p${i}`);
  expect(store.switchSport('tv', {sport: 'table-tennis', gameId: null}).ok).toBe(true);
  expect(store.lobby(host.code).players).toHaveLength(2);
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
  for (let player = 1; player <= 8; player++) {
    expect(store.join(`p${player}`, {v, code: host.code, name: `Friend ${player}`, capabilities}).ok).toBe(true);
    expect(store.lobby(host.code).players.slice(0, -1).every(seat => seat.ready)).toBe(true);
    store.setSetup(`p${player}`, {setup: 'buttons'});
    const result = store.setReady(`p${player}`, {ready: true});
    expect(result.countdownStarted).toBeUndefined();
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

for (const sport of ['tennis', 'table-tennis', 'bowling']) {
  test(`${sport}: solo waits for Start and can return, choose another sport and restart without stale input`, () => {
    const f = fixture(sport, 1);
    expect(f.ready(1).countdownStarted).toBeUndefined();
    expect(f.store.lobby(f.host.code)).toMatchObject({phase: PHASES.READY, canStart: true});
    const game = f.start();
    expect(game.phase).toBe(PHASES.GAME);
    expect(f.store.returnToLobby('p1', {gameId: game.gameId}, 'player').ok).toBe(true);
    expect(f.store.lobby(f.host.code).players[0]).toMatchObject({ready: false, setup: 'buttons'});
    expect(f.ready(1).countdownStarted).toBeUndefined();
    const nextSport = sport === 'bowling' ? 'tennis' : 'bowling';
    expect(f.store.switchSport('p1', {sport: nextSport, gameId: null}, 'player').ok).toBe(true);
    f.ready(1);
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
    const next = f.store.lobby(f.host.code);
    expect(next.gameId).not.toBe(game.gameId);
    expect(next.inputGeneration).toBeGreaterThan(game.inputGeneration);
    expect(f.store.returnToLobby('p1', {gameId: game.gameId}, 'player').error).toBe('not-playing');
  });
  test(`${sport}: a full roster waits for confirmation on initial play and on return`, () => {
    const f = fixture(sport, playerCapacity(sport));
    for (let i = 1; i < playerCapacity(sport); i++) expect(f.ready(i).countdownStarted).toBeUndefined();
    expect(f.ready(playerCapacity(sport)).countdownStarted).toBeUndefined();
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
    const gameId = f.store.lobby(f.host.code).gameId;
    expect(f.store.returnToLobby('p1', {gameId}, 'player').ok).toBe(true);
    for (let i = 1; i <= playerCapacity(sport); i++) expect(f.ready(i).countdownStarted).toBeUndefined();
    expect(f.store.lobby(f.host.code)).toMatchObject({phase: PHASES.READY, canStart: true});
    expect(f.store.startGame('p1').countdownStarted).toBe(true);
  });
  test(`${sport}: leaving leader releases P1 to the remaining phone and invalidates old input`, () => {
    const f = fixture(sport, 2);
    const game = f.start();
    expect(f.store.remove('p1').closed).toBe(false);
    const view = f.store.lobby(f.host.code);
    expect(view).toMatchObject({phase: PHASES.READY, gameId: null, leaderSlot: 0});
    expect(view.inputGeneration).toBeGreaterThan(game.inputGeneration);
    expect(view.players).toEqual([{slot: 0, name: 'Player 2', ready: false, setup: 'buttons'}]);
    expect(f.store.lobbyForSocket('p2', view)).toMatchObject({slot: 0, name: 'Player 2'});
    expect(f.store.resume('p2-back', {v, code: f.host.code, role: 'player', token: f.phones[1].token}).slot).toBe(0);
    expect(f.store.setReady('p2-back', {ready: true}).countdownStarted).toBeUndefined();
    expect(f.store.startGame('p2-back').countdownStarted).toBe(true);
  });
}


test('real sockets promote the remaining phone and let it restart without rejoining or leaking another seat', async () => {
  let now = 0;
  const store = new RoomStore({now: () => now}), app = createGameServer({store, tickMs: 10});
  const sockets = [];
  const send = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
  try {
    app.http.listen(0, '127.0.0.1'); await once(app.http, 'listening');
    const connect = async () => {
      const socket = io(`http://127.0.0.1:${app.http.address().port}`, {transports: ['websocket'], reconnection: false});
      sockets.push(socket); await once(socket, 'connect'); return socket;
    };
    const host = await connect(), p1 = await connect(), p2 = await connect();
    const capabilities = createControllerCapabilities();
    const room = await send(host, EVENTS.HOST_CREATE, {v, sport: 'table-tennis', capabilities});
    for (const [i, phone] of [p1, p2].entries()) {
      expect((await send(phone, EVENTS.PLAYER_JOIN, {v, code: room.code, name: `Friend ${i + 1}`, capabilities})).slot).toBe(i);
      await send(phone, EVENTS.PLAYER_SETUP, {setup: 'buttons'});
      await send(phone, EVENTS.PLAYER_READY, {ready: true});
    }
    expect((await send(p1, EVENTS.PLAYER_START)).countdownStarted).toBe(true);
    now += 5000; store.finishCountdown(room.code);
    const old = store.lobby(room.code);
    expect(old.phase).toBe(PHASES.GAME);
    const promoted = new Promise(resolve => {
      const update = view => {if (view.phase === PHASES.READY && view.slot === 0) {p2.off(EVENTS.LOBBY_UPDATE, update); resolve(view);}};
      p2.on(EVENTS.LOBBY_UPDATE, update);
    });
    expect((await send(p1, EVENTS.PLAYER_LEAVE)).ok).toBe(true);
    const next = await promoted;
    expect(next).toMatchObject({slot: 0, name: 'Friend 2', leaderSlot: 0, gameId: null});
    expect(next).not.toHaveProperty('token');
    expect(next.inputGeneration).toBeGreaterThan(old.inputGeneration);
    expect((await send(p2, EVENTS.PLAYER_READY, {ready: true})).countdownStarted).toBeUndefined();
    expect((await send(p2, EVENTS.PLAYER_START)).countdownStarted).toBe(true);
    expect(store.lobby(room.code).gameId).not.toBe(old.gameId);
  } finally {for (const socket of sockets) socket.disconnect(); await app.close();}
});
