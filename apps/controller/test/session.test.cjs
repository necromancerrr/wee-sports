const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function fixture() {
  const { ControllerSession } = await import('../src/session.js');
  const { EVENTS } = await import('../../../shared/protocol.js');
  class Socket extends EventEmitter {
    connected = true;
    sendBuffer = [];
    io = { engine: { transport: { writable: true } } };
    sent = [];
    responses = new Map();
    volatile = { emit: (event, payload) => this.sent.push({ event, payload, volatile: true }) };
    timeout() { return { emit: (event, payload, ack) => { this.sent.push({ event, payload }); const response = this.responses.get(event); ack(response === 'timeout' ? new Error('timeout') : null, response === 'timeout' ? undefined : response || { ok: true }); } }; }
    connect() { this.connected = true; super.emit('connect'); }
    disconnect() { this.connected = false; super.emit('disconnect'); }
  }
  const socket = new Socket();
  const feedback = [];
  let now = 1000;
  const session = new ControllerSession('https://game.example', { makeSocket: () => socket, now: () => now, feedback: event => feedback.push(event) });
  session.seat = { code: 'K7PM', slot: 0, phase: 'game', gameId: 'game-a', inputGeneration: 3, hostEpoch: 2, sport: 'table-tennis', paused: false };
  return { session, socket, feedback, EVENTS, advance: ms => { now += ms; } };
}

test('only public HTTPS join links are accepted by the scanner', async () => {
  const { parseRoomLink, serverOrigin } = await import('../src/session.js');
  assert.deepEqual(parseRoomLink('https://game.example/join?code=K7PM'), { origin: 'https://game.example', code: 'K7PM' });
  for (const link of ['http://game.example/join?code=K7PM', 'https://u:p@game.example/join?code=K7PM',
    'https://game.example/host/K7PM', 'https://game.example/join?code=K7PM&token=private',
    'https://game.example/join?code=K7PM&code=2222', 'https://game.example/join?code=K7PM#token',
    'https://game.example/join?code=OOOO']) assert.throws(() => parseRoomLink(link));
  assert.equal(serverOrigin('http://10.0.2.2:5173', true), 'http://10.0.2.2:5173');
  assert.throws(() => serverOrigin('http://10.0.2.2:5173'));
  assert.throws(() => serverOrigin('https://game.example/private'));
});

test('latest pose is bounded and stamped from the active session, never client identity', async () => {
  const { session, socket, advance, EVENTS } = await fixture();
  assert.equal(session.latest('pose', { gameId: 'spoof', seq: 900, orientation: [0, 0, 0, 1] }), true);
  assert.equal(socket.sent[0].event, EVENTS.PLAYER_POSE);
  assert.equal(socket.sent[0].payload.gameId, 'game-a');
  assert.equal(socket.sent[0].payload.generation, 3);
  assert.equal(socket.sent[0].payload.hostEpoch, 2);
  assert.equal(socket.sent[0].payload.generation, 3);
  assert.equal(socket.sent[0].payload.hostEpoch, 2);
  assert.equal(socket.sent[0].payload.seq, 0);
  assert.equal(socket.sent[0].volatile, true);
  assert.equal(session.latest('pose', {}), false);
  advance(34);
  assert.equal(session.latest('pose', {}), true);
  assert.equal(socket.sent[1].payload.seq, 1);
  advance(34); socket.io.engine.transport.writable = false;
  assert.equal(session.latest('pose', {}), false);
  session.dispose();
});

test('backgrounding cancels buffered input and cannot emit gameplay while suspended', async () => {
  const { session, socket, EVENTS } = await fixture();
  socket.sendBuffer.push({ old: true });
  session.background();
  assert.deepEqual(socket.sendBuffer, []);
  assert.equal(session.latest('pose', {}), false);
  assert.deepEqual(await session.action(EVENTS.PLAYER_ROLL, { type: 'roll' }), { ok: false, error: 'not-playing' });
  session.dispose();
});

test('native table-tennis poses preserve 60 Hz samples and drop congestion without a replay queue', async () => {
  const {session, socket, advance, EVENTS} = await fixture();
  for (let index = 0; index < 60; index++) {
    assert.equal(session.latest('pose', {reach: {x: index / 60, y: 0}}), true);
    assert.equal(session.latest('pose', {reach: {x: -1, y: 0}}), false, 'a same-tick burst is bounded');
    advance(index % 2 ? 17 : 16);
  }
  assert.equal(socket.sent.length, 60);
  socket.io.engine.transport.writable = false;
  for (let index = 0; index < 6; index++) {
    advance(17);
    assert.equal(session.latest('pose', {reach: {x: -.5, y: 0}}), false);
  }
  assert.deepEqual(socket.sendBuffer, []);
  socket.io.engine.transport.writable = true;
  assert.equal(session.latest('pose', {reach: {x: .8, y: 0}}), true);
  assert.equal(socket.sent.length, 61);
  assert.equal(socket.sent.at(-1).event, EVENTS.PLAYER_POSE);
  assert.equal(socket.sent.at(-1).payload.reach.x, .8);
  assert.equal(socket.sent.at(-1).payload.seq, 60);
  session.dispose();
});

test('bowling aim keeps 60 Hz fresh updates while rejecting same-tick bursts', async () => {
  const {session, socket, advance} = await fixture();
  for (let index = 0; index < 60; index++) {
    assert.equal(session.latest('aim', {aim: index / 60}), true);
    assert.equal(session.latest('aim', {aim: -1}), false);
    advance(index % 2 ? 18 : 15);
  }
  assert.equal(socket.sent.length, 60);
  session.dispose();
});

test('personalized lobby updates move a remaining native player into the new leader seat', async () => {
  const {session,socket,EVENTS}=await fixture();
  session.seat.slot=1;
  session.token='private-reconnect-token';
  socket.emit(EVENTS.LOBBY_UPDATE,{code:'K7PM',slot:0,name:'Riley',leaderSlot:0,canStart:true,phase:'ready',
    gameId:null,inputGeneration:4,players:[{slot:0,name:'Riley',setup:'motion',ready:true}]});
  assert.equal(session.seat.slot,0);
  assert.equal(session.seat.leaderSlot,session.seat.slot);
  assert.equal(session.seat.canStart,true);
  assert.equal(session.token,'private-reconnect-token','a personalized snapshot does not replace the private room token');
  assert.equal(session.playing(),false);
  session.dispose();
});

test('temporary native inactivity suppresses input without disconnecting, pausing or replaying old sequence IDs', async () => {
  const {session, socket, EVENTS, advance, feedback} = await fixture();
  session.token = 'reconnect-token';
  session.latest('pose', {reach:{x:0,y:0}});
  const sequence = socket.sent[0].payload.seq;
  const hit = {id:'once',gameId:'game-a',generation:3,hostEpoch:2};
  session.onFeedback(hit);
  session.inactive();
  assert.equal(socket.connected, true);
  assert.equal(session.latest('pose', {}), false);
  assert.equal((await session.action(EVENTS.PLAYER_SWING, {})).ok, false);
  session.foreground(); advance(17);
  assert.equal(session.latest('pose', {reach:{x:.2,y:0}}), true);
  assert.equal(socket.sent.at(-1).payload.seq, sequence + 1);
  session.onFeedback(hit);
  assert.equal(feedback.length,1);
  assert.equal(socket.sent.some(item => [EVENTS.SESSION_AWAY, EVENTS.SESSION_RESUME].includes(item.event)), false);
  session.dispose();
});

test('timed out deliberate action has one stable id and is never automatically resent', async () => {
  const { session, socket, EVENTS } = await fixture();
  socket.responses.set(EVENTS.PLAYER_ROLL, 'timeout');
  const response = await session.action(EVENTS.PLAYER_ROLL, { type: 'roll', aim: 0, power: .5, spin: 0 });
  assert.equal(response.error, 'outcome-unknown');
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].payload.id, response.id);
  assert.equal(socket.sent[0].payload.gameId, 'game-a');
  assert.deepEqual(socket.sendBuffer, []);
  session.dispose();
});

test('feedback is scoped to the live match/generation and deduplicated', async () => {
  const { session, feedback } = await fixture();
  const event = { id: 'hit-a', gameId: 'game-a', generation: 3, hostEpoch: 2 };
  session.onFeedback({ ...event, generation: 2 });
  session.onFeedback({ ...event, gameId: 'game-old' });
  session.onFeedback(event); session.onFeedback(event);
  assert.equal(feedback.length, 1);
  session.background(); session.onFeedback({ ...event, id: 'hit-b' });
  assert.equal(feedback.length, 1);
  session.dispose();
});

test('resume revalidates setup instead of replaying pre-interruption input', async () => {
  const { session, socket, EVENTS } = await fixture();
  session.token = 'private-reconnect-token';
  socket.responses.set(EVENTS.SESSION_RESUME, { ok: true, ...session.seat, inputGeneration: 4, token: session.token });
  socket.sendBuffer.push({ old: true });
  session.background(); session.foreground();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.seat.inputGeneration, 4);
  assert.deepEqual(socket.sendBuffer, []);
  assert.ok(socket.sent.some(item => item.event === EVENTS.PLAYER_SETUP && item.payload.setup === null));
  assert.equal(socket.sent.filter(item => item.event === EVENTS.PLAYER_POSE).length, 0);
  session.dispose();
});

test('bowling delivery latch advances only for an authoritative delivery or match boundary', async () => {
  const {session} = await fixture();
  session.seat = {...session.seat,sport:'bowling',gameState:{phase:'ready',frame:1,currentPlayer:1}};
  session.observeBowlingTurn(); const first = session.bowlingTurnKey;
  session.seat.paused = true; session.seat.inputGeneration++; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first,'pause does not authorize another roll');
  session.seat.paused = false; session.seat.inputGeneration++; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first,'resume does not authorize another roll');
  session.seat.gameState.phase='rolling'; session.observeBowlingTurn();
  assert.equal(session.bowlingTurnKey,first);
  session.seat.gameState.phase='ready'; session.observeBowlingTurn();
  assert.notEqual(session.bowlingTurnKey,first,'next ball with same player and frame is a new delivery');
  session.dispose();
});

test('late resume acknowledgements cannot reactivate a backgrounded controller', async () => {
  const {session,socket,EVENTS} = await fixture();
  const changes = [];
  session.changed = (seat,state) => changes.push(state);
  session.token = 'private-reconnect-token';
  let resume;
  socket.timeout = () => ({emit(event,payload,ack) {
    socket.sent.push({event,payload});
    if(event === EVENTS.SESSION_RESUME) resume = ack;
    else ack(null,{ok:true});
  }});
  const pending = session.onConnect();
  session.background();
  resume(null,{ok:true,...session.seat,inputGeneration:4});
  await pending;
  assert.equal(changes.includes('online'),false);
  assert.equal(socket.sent.some(value=>value.event === EVENTS.PLAYER_SETUP),false);
  assert.equal(session.seat.inputGeneration,3);
  session.dispose();
});
