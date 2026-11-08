import {BowlingMatch} from '../../src/bowling/match.ts';
import {TableTennisGame} from '../../src/tabletennis/game.js';
import {ScoreSystem} from '../../src/Tennis/scoreSystem.ts';
import {checkpoint, fail, ProfileError} from './validation.js';

/** Derive casual results from the same validated stable state we commit. */
export function validateSportState(room, payload) {
  checkpoint(room.sport, payload);
  if (room.sport === 'tennis') {
    try {ScoreSystem.fromCheckpoint(payload.score);} catch {fail('invalid-checkpoint');}
    if (room.players.length !== (payload.humanOpponent ? 2 : 1)) fail('wrong-roster');
    return undefined; // Live room recovery; tennis profile history is separate.
  }
  if (room.sport === 'bowling') {
    let match;
    try { match = BowlingMatch.fromCheckpoint(payload.match); } catch { fail('invalid-checkpoint'); }
    const state = match.getState();
    if (payload.pins.length !== state.pinsStanding.length || payload.pins.some(pin => !pin.standing || !state.pinsStanding.includes(pin.id))) fail('invalid-rack');
    if (state.players.length !== room.players.length || state.players.some(player => !room.players.some(member => player.player === member.slot + 1))) fail('wrong-roster');
    if (!state.complete) return undefined;
    return room.players.map(member => {
      const result = state.ranking.find(player => player.player === member.slot + 1);
      const tied = state.ranking.filter(player => player.total === result.total).length > 1;
      return {memberId: member.memberId, score: result.total, rank: result.rank,
        outcome: room.players.length === 1 ? 'complete' : tied ? 'tie' : result.rank === 1 ? 'win' : 'loss'};
    });
  }
  const game = new TableTennisGame();
  if (!game.restore(payload)) fail('invalid-checkpoint');
  const state = game.rules.snapshot();
  if (payload.mode === 'versus') {
    if (room.players.length !== 2 || new Set(room.players.map(player => player.slot)).size !== 2 ||
        room.players.some(player => ![0, 1].includes(player.slot))) fail('wrong-roster');
    if (state.phase !== 'complete') return undefined;
    return room.players.map(player => ({memberId: player.memberId, score: state.score[player.slot],
      rank: state.winner === player.slot + 1 ? 1 : 2, outcome: state.winner === player.slot + 1 ? 'win' : 'loss'}));
  }
  if (room.players.length !== 1 || room.players[0].slot !== 0) fail('wrong-roster');
  if (payload.mode !== 'bot' || state.phase !== 'complete') return undefined;
  return [{memberId: room.players[0].memberId, score: state.score[0], rank: state.winner === 1 ? 1 : 2,
    outcome: state.winner === 1 ? 'win' : 'loss'}];
}

/** RoomStore remains the live authority; this adapter never accepts client IDs. */
export function createRoomPersistence(service) {
  const leases = new Map();
  const claims = new Map();
  const matchId = room => `${room.gameId}:round:${room.matchRound || 0}`;
  function ensure(context) {
    const room = context?.room;
    if (!room?.gameId || !room.players?.length || !['bowling', 'table-tennis'].includes(room.sport)) fail('no-persistent-game');
    const id = matchId(room);
    let meta = service.store.matchMetadata(id);
    if (!meta) {
      const created = service.store.createMatch({matchId: id, sport: room.sport, hostMemberId: room.hostMemberId,
        participants: room.players.map(player => ({memberId: player.memberId, name: player.name, profileId: player.profileId || null}))});
      for (const [memberId, claim] of Object.entries(created.guestClaims)) claims.set(`${id}:${memberId}`, claim);
      meta = service.store.matchMetadata(id);
    }
    if (meta.hostMemberId !== room.hostMemberId || meta.sport !== room.sport) fail('wrong-match', 403);
    const lease = leases.get(id);
    if (lease && room.hostEpoch < lease.roomEpoch) fail('stale-host', 409);
    if (lease && room.hostEpoch > lease.roomEpoch) {
      service.store.claimHost({matchId: id, hostMemberId: room.hostMemberId, expectedEpoch: meta.hostEpoch});
      meta = service.store.matchMetadata(id);
    }
    leases.set(id, {roomEpoch: room.hostEpoch, databaseEpoch: meta.hostEpoch});
    // Bound memory; completed records remain durable in SQLite.
    if (leases.size > 1000) { const oldest = leases.keys().next().value; leases.delete(oldest); for (const key of claims.keys()) if (key.startsWith(`${oldest}:`)) claims.delete(key); }
    return meta;
  }
  return {
    save(context, {payload, expectedRevision}) {
      if (context?.role !== 'host' || context.memberId !== context.room?.hostMemberId) fail('not-match-host', 403);
      const results = validateSportState(context.room, payload);
      const meta = ensure(context);
      const previous = service.store.readCheckpoint(meta.matchId);
      if (expectedRevision === undefined && previous && JSON.stringify(previous.state) === JSON.stringify(payload) && service.store.sameResults(meta.matchId, results)) {
        if (context.room.recoverySource) {
          return service.store.saveCheckpoint({matchId: meta.matchId, hostMemberId: context.memberId,
            hostEpoch: meta.hostEpoch, expectedRevision: meta.revision - 1, state: payload, results,
            recoverySource: context.room.recoverySource});
        }
        return {saved: true, revision: meta.revision, hostEpoch: meta.hostEpoch, duplicate: true};
      }
      return service.store.saveCheckpoint({matchId: meta.matchId, hostMemberId: context.memberId,
        hostEpoch: meta.hostEpoch, expectedRevision: expectedRevision ?? meta.revision, state: payload, results,
        recoverySource: context.room.recoverySource});
    },
    restore(context) {
      if (context?.role !== 'host' || context.memberId !== context.room?.hostMemberId) fail('not-match-host', 403);
      const meta = ensure(context);
      return {saved: meta.revision > 0, revision: meta.revision, hostEpoch: meta.hostEpoch,
        checkpoint: service.store.readCheckpoint(meta.matchId), recovery: 'last-saved-boundary'};
    },
    guestClaim(context) {
      if (context?.role !== 'player') fail('not-player', 403);
      const meta = ensure(context);
      if (!context.room.players.some(player => player.memberId === context.memberId)) fail('not-player', 403);
      const key = `${meta.matchId}:${context.memberId}`;
      if (!claims.has(key)) {
        const claim = service.store.issueGuestClaim(meta.matchId, context.memberId);
        if (claim) claims.set(key, claim);
      }
      return claims.get(key) || null;
    },
    attach(socket, _io, store) {
      socket.on('profile:claim-token', (_payload, ack) => {
        try { const claim = this.guestClaim(store.sessionContext(socket.id)); if (typeof ack === 'function') ack({ok: true, claim}); }
        catch (error) { if (typeof ack === 'function') ack({ok: false, error: error instanceof ProfileError ? error.code : 'profile-storage-unavailable'}); }
      });
    },
  };
}
