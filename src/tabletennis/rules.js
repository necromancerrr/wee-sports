export const TABLE_TENNIS_TARGET_POINTS = 12;

/** Singles rules. The host owns these scores; collision reports are deduplicated. */
export class TableTennisRules {
  constructor({firstServer = 1, targetPoints = TABLE_TENNIS_TARGET_POINTS} = {}) {
    this.firstServer = firstServer === 2 ? 2 : 1;
    this.targetPoints = targetPoints === 11 ? 11 : TABLE_TENNIS_TARGET_POINTS;
    this.score = [0, 0];
    this.pointId = 0;
    this.phase = 'ready';
    this.winner = null;
    this.reason = 'Ready to serve';
    this.events = new Set();
    this.resetPoint();
  }

  get server() {
    const points = this.score[0] + this.score[1];
    const deuceTotal = 2 * (this.targetPoints - 1);
    const turns = Math.min(this.targetPoints - 1, Math.floor(points / 2)) + Math.max(0, points - deuceTotal);
    return turns % 2 ? 3 - this.firstServer : this.firstServer;
  }

  resetPoint() {
    this.lastHitter = null;
    this.bounces = 0;
    this.serveBounces = 0;
    this.netTouched = false;
    this.serving = true;
    this.events.clear();
  }

  beginPoint() {
    if (this.phase === 'complete') return false;
    this.pointId++;
    this.resetPoint();
    this.phase = 'serve';
    this.reason = `Player ${this.server} serves`;
    return true;
  }

  event(kind, {player, side, id} = {}) {
    if (!['serve', 'rally'].includes(this.phase)) return null;
    if (id !== undefined) {
      if (this.events.has(id)) return null;
      this.events.add(id);
    }
    if (kind === 'net') {
      this.netTouched = true;
      return null;
    }
    if (kind === 'hit') {
      if (![1, 2].includes(player)) return null;
      if (this.lastHitter === null) {
        if (player !== this.server) return this.award(this.server, 'Receiver struck before the serve');
        this.lastHitter = player;
        this.bounces = 0;
        return null;
      }
      if (this.lastHitter === player) return this.award(3 - player, 'Double hit');
      if (this.serving || this.bounces !== 1) return this.award(3 - player, 'Return before a legal bounce');
      this.lastHitter = player;
      this.bounces = 0;
      this.phase = 'rally';
      return null;
    }
    if (kind === 'bounce') {
      if (![1, 2].includes(side)) return null;
      if (this.lastHitter === null) return this.award(3 - this.server, 'Serve was not struck');
      if (this.serving) {
        const expected = this.serveBounces === 0 ? this.server : 3 - this.server;
        if (side !== expected) return this.award(3 - this.server, 'Serve bounced on the wrong side');
        this.serveBounces++;
        if (this.serveBounces === 2) {
          if (this.netTouched) {
            this.phase = 'ready';
            this.reason = 'Let — serve again';
            return {type: 'let', pointId: this.pointId};
          }
          this.serving = false;
          this.bounces = 1;
          this.phase = 'rally';
        }
        return null;
      }
      if (side === this.lastHitter) return this.award(3 - this.lastHitter, 'Return bounced on own side');
      this.bounces++;
      if (this.bounces > 1) return this.award(this.lastHitter, 'Second bounce');
      return null;
    }
    if (kind === 'out') {
      if (this.lastHitter === null) return this.award(3 - this.server, 'Serve missed');
      const winner = !this.serving && this.bounces === 1 ? this.lastHitter : 3 - this.lastHitter;
      return this.award(winner, !this.serving && this.bounces === 1 ? 'No return' : 'Ball missed the table');
    }
    return null;
  }

  award(winner, reason) {
    if (!['serve', 'rally'].includes(this.phase) || ![1, 2].includes(winner)) return null;
    this.score[winner - 1]++;
    this.reason = reason;
    const [a, b] = this.score;
    this.winner = Math.max(a, b) >= this.targetPoints && Math.abs(a - b) >= 2 ? winner : null;
    this.phase = this.winner ? 'complete' : 'ready';
    return {type: 'point', winner, reason, pointId: this.pointId, score: [...this.score]};
  }

  snapshot() {
    const [a, b] = this.score;
    const deuce = !this.winner && a === b && a >= this.targetPoints - 1;
    const gamePoint = this.winner || a === b || Math.max(a, b) < this.targetPoints - 1
      ? null : a > b ? 1 : 2;
    return {phase: this.phase, score: [...this.score], server: this.server,
      winner: this.winner, pointId: this.pointId, reason: this.reason,
      targetPoints: this.targetPoints, deuce, gamePoint};
  }

  /** Only points/lets between flights can be restored. */
  checkpoint() {
    if (!['ready', 'complete'].includes(this.phase)) return null;
    return {firstServer: this.firstServer, score: [...this.score], pointId: this.pointId,
      phase: this.phase, winner: this.winner, targetPoints: this.targetPoints};
  }

  restore(value) {
    if (!value || ![1, 2].includes(value.firstServer) || !Array.isArray(value.score) ||
      value.score.length !== 2 || !value.score.every(n => Number.isInteger(n) && n >= 0 && n <= 999) ||
      !Number.isInteger(value.pointId) || value.pointId < 0 || value.pointId > 10000 ||
      !['ready', 'complete'].includes(value.phase) ||
      (value.targetPoints !== undefined && ![11, TABLE_TENNIS_TARGET_POINTS].includes(value.targetPoints))) return false;
    // Saves written before the 12-point rule retain their original 11-point game.
    const targetPoints = value.targetPoints ?? 11;
    const [a, b] = value.score;
    const winner = Math.max(a, b) >= targetPoints && Math.abs(a - b) >= 2 ? a > b ? 1 : 2 : null;
    if (value.winner !== winner || (value.phase === 'complete') !== Boolean(winner)) return false;
    // A completed score must be reachable on its final point. Play cannot carry
    // on after 12–0 (or, for an older save, 11–0) and later claim a new result.
    if (winner) {
      const high = Math.max(a, b), low = Math.min(a, b);
      if (high !== Math.max(targetPoints, low + 2)) return false;
    }
    this.firstServer = value.firstServer;
    this.targetPoints = targetPoints;
    this.score = [...value.score];
    this.pointId = value.pointId;
    this.phase = value.phase;
    this.winner = winner;
    this.reason = 'Restored between points';
    this.resetPoint();
    return true;
  }
}
