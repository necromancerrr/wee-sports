import {createRoomPersistence} from '../profiles/roomPersistence.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ERRORS, EVENTS } from '../../shared/protocol.js';
import { RoomStore } from './RoomStore.js';
import { waitForSwingTransport } from '../../src/network/swingRequest.js';

/** Importable server for tests. index.js owns the listening port. */
export function createGameServer({ store = new RoomStore(), origins = [], tickMs = 250, requestHandler, profiles } = {}) {
  const persistence = profiles ? createRoomPersistence(profiles) : null;
  const http = createServer(async (request, response) => {
    if (profiles && await profiles.handle(request, response)) return;
    if (!profiles && request.url?.startsWith('/api/profile')) {
      response.writeHead(503, {'content-type':'application/json', 'cache-control':'no-store'});
      response.end(JSON.stringify({error:'profile-storage-unavailable'})); return;
    }
    if (request.url !== '/health' && requestHandler) return requestHandler(request, response);
    response.writeHead(request.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' });
    response.end(request.url === '/health' ? 'ok' : 'Not found');
  });
  const io = new Server(http, {
    cors: { origin: origins.length ? origins : true },
    pingInterval: 5000,
    pingTimeout: 5000,
    maxHttpBufferSize: 8192,
  });
  const authenticateSocket = socket => {
    try {
    if (!profiles) return null;
    if (typeof socket.handshake.auth?.profileToken === 'string') return profiles.store.authenticate(socket.handshake.auth.profileToken);
    // WebSocket handshakes are not protected by fetch CORS. Never bind
    // browser account cookies sent by an untrusted same-site origin.
    const origin = socket.request.headers.origin;
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || (url.host !== socket.request.headers.host && !origins.includes(url.origin))) return null;
    } catch {return null;}
    return profiles.authenticateRequest(socket.request);
    } catch {return null;}
  };
  const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };
  const broadcast = code => {
    const lobby = store.lobby(code);
    if (lobby) for (const socketId of io.sockets.adapter.rooms.get(code) ?? []) {
      io.to(socketId).emit(EVENTS.LOBBY_UPDATE, store.lobbyForSocket(socketId, lobby));
    }
  };
  function publish(result) {
    if (!result) return;
    if (result.closed) {
      if (result.recoverySource && profiles) {
        try {profiles.store.releaseRecovery(result.recoverySource.matchId,result.recoverySource.claimId);} catch { /* lease expiration handles a storage outage */ }
      }
      io.to(result.code).emit(EVENTS.ROOM_CLOSED, { code: result.code });
      io.in(result.code).socketsLeave(result.code);
    } else broadcast(result.code);
  }
  io.on('connection', socket => {
    let swingWaiting = false;
    persistence?.attach(socket, io, store);
    for (const [event, method] of [[EVENTS.HOST_CREATE, 'createRoom'], [EVENTS.PLAYER_JOIN, 'join'], [EVENTS.SESSION_RESUME, 'resume']]) {
      socket.on(event, (payload, ack) => {
        const profile = authenticateSocket(socket);
        const result = store[method](socket.id, payload, profile?.id);
        if (result.ok) {
          store.bindProfile(socket.id, profile?.id);
          if (result.replacedSocketId) {
            const old = io.sockets.sockets.get(result.replacedSocketId);
            old?.leave(result.code);
            old?.emit(EVENTS.SESSION_REPLACED);
          }
          socket.join(result.code);
        }
        const { replacedSocketId, ...response } = result;
        reply(ack, response);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_SWITCH_SPORT, 'host'], [EVENTS.PLAYER_SWITCH_SPORT, 'player']]) {
      socket.on(event, (payload, ack) => {
        const context = store.sessionContext(socket.id);
        const result = store.switchSport(socket.id, payload, role);
        if (result.ok && context.room.sport !== payload.sport && context.room.recoverySource && profiles) {
          try {profiles.store.releaseRecovery(context.room.recoverySource.matchId,context.room.recoverySource.claimId);} catch {}
        }
        reply(ack, result); if (result.ok) broadcast(result.code);
      });
    }
    let lastInputNotice = 0;
    for (const [event, kind, outbound] of [[EVENTS.PLAYER_POSE, 'pose', EVENTS.GAME_POSE], [EVENTS.PLAYER_AIM, 'aim', EVENTS.GAME_AIM]]) {
      socket.on(event, payload => {
        const result = store.continuousTarget(socket.id, payload, kind);
        if (!result.ok) {
          if (Date.now() - lastInputNotice > 1000 && result.error !== 'rate-limited') {
            lastInputNotice = Date.now(); socket.volatile.emit(EVENTS.INPUT_STATUS, {kind, error: result.error});
          }
          return;
        }
        const host = io.sockets.sockets.get(result.hostSocketId);
        if (host?.connected && host.conn.transport.writable) host.volatile.emit(outbound, result.event);
      });
    }
    socket.on(EVENTS.PLAYER_ACTION_STATUS, (payload, ack) => reply(ack, store.actionStatus(socket.id, payload)));
    socket.on(EVENTS.HOST_RESTORE, (payload, ack) => {
      try {
        const profile = authenticateSocket(socket);
        if (!profile) return reply(ack, {ok:false,error:'not-signed-in'});
        const source = profiles.store.recoverySource(profile.id, payload?.matchId);
        const existing = store.sessionContext(socket.id);
        const result = store.createRecovery(socket.id, payload, source);
        if (result.ok) {
          const context = store.sessionContext(socket.id);
          try {profiles.store.reserveRecovery(profile.id,payload.matchId,context.memberId);}
          catch (error) {if (!existing) store.remove(socket.id); throw error;}
          socket.join(result.code); broadcast(result.code);
        }
        reply(ack, result);
      } catch (error) {reply(ack, {ok:false,error:error.code || 'recovery-unavailable'});}
    });
    socket.on(EVENTS.HOST_CHECKPOINT, (payload, ack) => {
      const result = store.saveCheckpoint(socket.id, payload);
      if (!result.ok) return reply(ack, result);
      let status = {saved: false, error: 'profile-storage-unavailable'};
      if (persistence && (!result.duplicate || !result.checkpoint.saved)) {
        try {status = persistence.save(store.sessionContext(socket.id), {payload: result.checkpoint.payload});}
        catch (error) {status = {saved:false,error:error.code || 'profile-storage-unavailable'};}
        store.checkpointStatus(result.code, result.checkpoint.revision, status);
      } else if (result.duplicate) status = {saved:result.checkpoint.saved, error: result.checkpoint.saveError};
      reply(ack, {ok:true, revision:result.checkpoint.revision, saved:status.saved, error:status.error});
      broadcast(result.code);
    });
    socket.on(EVENTS.HOST_RECOVERY, (payload, ack) => {
      const result = store.recovery(socket.id, payload);
      if (!result.ok) return reply(ack, result);
      const context = store.sessionContext(socket.id);
      if (context?.room.recoverySource && profiles) {
        try {profiles.store.reserveRecovery(context.profileId,context.room.recoverySource.matchId,context.room.recoverySource.claimId);}
        catch (error) {return reply(ack,{ok:false,error:error.code || 'recovery-unavailable'});}
      }
      // Rotation of the durable host lease makes older TV callbacks stale too.
      if (persistence) {
        try {persistence.restore(store.sessionContext(socket.id));} catch { /* live in-memory checkpoint remains usable */ }
      }
      reply(ack, result);
    });
    socket.on(EVENTS.LOBBY_GET, (payload, ack) => {
      const code = payload?.code;
      reply(ack, code && store.hostedBy(socket.id) === code ? { ok: true, ...store.lobby(code) } : { ok: false, error: ERRORS.NO_ROOM });
    });
    socket.on(EVENTS.PLAYER_START, (_payload, ack) => {
      const result = store.startGame(socket.id);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_READY, (payload, ack) => {
      const result = store.setReady(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_SETUP, (payload, ack) => {
      const result = store.setSetup(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    // Phones drive the vote and the tutorial; everyone sees each vote and check mark.
    for (const [event, method] of [[EVENTS.TUTORIAL_VOTE, 'vote'], [EVENTS.TUTORIAL_MOVE, 'tutorialMove']]) {
      socket.on(event, (payload, ack) => {
        const result = store[method](socket.id, payload);
        reply(ack, result.ok ? { ok: true } : result);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_RETURN_TO_LOBBY, 'host'], [EVENTS.PLAYER_RETURN_TO_LOBBY, 'player']]) {
      socket.on(event, (payload, ack) => {
        const result = store.returnToLobby(socket.id, payload, role);
        reply(ack, result);
        if (result.ok) broadcast(result.code);
      });
    }
    for (const [event, role] of [[EVENTS.HOST_PAUSE, 'host'], [EVENTS.PLAYER_PAUSE, 'player']]) {
      socket.on(event, (payload, ack) => {
        const result = store.setPaused(socket.id, payload, role);
        reply(ack, result);
        if (result.ok && result.changed) broadcast(result.code);
      });
    }
    socket.on(EVENTS.HOST_RESOLVE_MATCH, (payload, ack) => {
      const result = store.resolveMatch(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.SOUND_SET, (payload, ack) => {
      const result = store.setSound(socket.id, payload);
      reply(ack, result);
      if (result.ok && result.changed) broadcast(result.code);
    });
    socket.on(EVENTS.HOST_GAME_OPTIONS, (payload, ack) => {
      const result = store.setGameOptions(socket.id, payload);
      reply(ack, result);
      if (result.ok && result.changed) broadcast(result.code);
    });
    socket.on(EVENTS.PLAYER_GAME_COMMAND, (event, ack) => {
      const result = store.gameCommandTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host?.connected) {
        store.finishGameCommand(result.code, result.event.id, result.event.gameId);
        return reply(ack, { ok: false, error: 'disconnected' });
      }
      if (['new-match', 'practice-start', 'practice-stop'].includes(event.action)) broadcast(result.code);
      // The phone waits for the game to apply the change, not just relay delivery.
      host.timeout(2500).emit(EVENTS.GAME_COMMAND, result.event, (error, received) => {
        store.finishGameCommand(result.code, result.event.id, result.event.gameId);
        if (store.lobby(result.code)?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        reply(ack, !error && received?.ok === true ? { ok: true, id: result.event.id }
          : { ok: false, error: !error && typeof received?.error === 'string' && received.error.length <= 160
            ? received.error : 'game-loading' });
      });
    });
    socket.on(EVENTS.HOST_GAME_STATE, (payload, ack) => {
      const result = store.setGameState(socket.id, payload);
      reply(ack, result);
      if (result.ok) broadcast(result.code);
    });
    socket.on(EVENTS.HOST_GAME_HIT, (event, ack) => {
      const result = store.hitTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const phone = io.sockets.sockets.get(result.phoneSocketId);
      if (!phone?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      // A missed tactile cue is preferable to replaying an old hit on reconnect.
      phone.volatile.emit(EVENTS.GAME_HIT, result.event);
      reply(ack, { ok: true });
    });
    socket.on(EVENTS.PLAYER_ROLL, (event, ack) => {
      const result = store.rollTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host) {
        store.finishRollDelivery(result.code, result.event.id, result.event.gameId);
        return reply(ack, { ok: false, error: 'disconnected' });
      }
      // Acknowledge the actual game result; never buffer or retry a release.
      host.timeout(2500).emit(EVENTS.GAME_ROLL, result.event, (error, received) => {
        const current = store.lobby(result.code);
        if (current?.hostEpoch !== result.hostEpoch || current?.inputGeneration !== result.inputGeneration) {
          store.finishRollDelivery(result.code, result.event.id, result.event.gameId, {ok:false,error:'outcome-unknown'});
          return reply(ack, {ok:false,error:'outcome-unknown',id:result.event.id});
        }
        const outcome = !error && received?.ok ? {ok: true, id: result.event.id, receivers: 1}
          : {ok: false, id: result.event.id, error: error ? 'outcome-unknown' : received?.error || 'game-loading'};
        store.finishRollDelivery(result.code, result.event.id, result.event.gameId, outcome);
        if (store.lobby(result.code)?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        reply(ack, outcome);
      });
    });
    socket.on(EVENTS.HOST_STROKE_RESULT, (event, ack) => {
      const result = store.strokeResultTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const phone = io.sockets.sockets.get(result.phoneSocketId);
      if (!phone?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      phone.volatile.emit(EVENTS.GAME_STROKE_RESULT, result.event);
      reply(ack, { ok: true });
    });
    socket.on(EVENTS.PLAYER_SWING, async (event, ack) => {
      if (swingWaiting) return reply(ack, { ok: false, error: 'network-busy' });
      const result = store.swingTarget(socket.id, event);
      if (!result.ok) return reply(ack, result);
      const host = io.sockets.sockets.get(result.hostSocketId);
      if (!host?.connected) return reply(ack, { ok: false, error: 'disconnected' });
      swingWaiting = true;
      const available = await waitForSwingTransport(() => host.conn.transport.writable, () => host.connected);
      swingWaiting = false;
      if (available !== 'ready') return reply(ack, { ok: false, error: available });
      // Recheck both authenticated sockets and the match after waiting: resume
      // may replace a still-connected phone/TV; pause/replay also invalidates input.
      const current = store.swingTarget(socket.id, event);
      if (!current.ok) return reply(ack, current);
      if (current.hostSocketId !== result.hostSocketId || current.inputGeneration !== result.inputGeneration) {
        return reply(ack, { ok: false, error: 'not-playing' });
      }
      // Once emitted there is no automatic retry or reconnect-buffered delivery.
      host.volatile.timeout(1500).emit(EVENTS.GAME_SWING, result.event, (error, received) => {
        if (store.lobby(result.code)?.gameId !== result.event.gameId) return reply(ack, { ok: false, error: 'not-playing' });
        reply(ack, !error && received?.ok
          ? { ok: true, id: result.event.id, receivers: 1 }
          : { ok: false, error: 'game-loading' });
      });
    });
    for (const [event, role] of [[EVENTS.PLAYER_LEAVE, 'player'], [EVENTS.HOST_CLOSE, 'host']]) socket.on(event, (payload, ack) => {
      const result = store.leaveSession(socket.id, payload, role);
      if (result.ok) socket.leave(result.code ?? '');
      reply(ack, {ok:result.ok, ...(result.error ? {error:result.error} : {})});
      if (result.ok && result.code) publish(result);
    });
    socket.on(EVENTS.SESSION_AWAY, payload => {
      const result = store.disconnect(socket.id, payload?.code);
      if (result) socket.leave(result.code);
      publish(result);
    });
    socket.on('disconnect', () => publish(store.disconnect(socket.id)));
  });
  const timer = setInterval(() => {
    for (const result of store.expireDisconnected()) publish(result);
    for (const code of store.countdownCodes) { if (store.finishCountdown(code)) broadcast(code); }
    for (const code of store.voteCodes) { if (store.expireVote(code)) broadcast(code); }
    for (const code of store.reconnectingCodes) broadcast(code);
  }, tickMs);
  timer.unref();
  return { http, io, store, close: () => new Promise(resolve => { clearInterval(timer); io.close(resolve); }) };
}
