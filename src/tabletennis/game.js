import {TableTennisPhysics, TABLE, v3, add, scale, sub, length, unit, mix, clamp} from './physics.js';
import {TableTennisRules} from './rules.js';

const finite = value => Number.isFinite(value);
const quaternionNormal = q => {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(finite)) return v3(0, .45, -1);
  const [x, y, z, w] = q;
  return unit(v3(clamp(-2 * (x * z + w * y), -.5, .5), clamp(2 * (w * x - y * z) + .45, -.2, .8), -1));
};
const approach = (a, b, maxDistance) => {
  const difference = sub(b, a);
  return length(difference) <= maxDistance ? {...b} : add(a, scale(unit(difference), maxDistance));
};

/** Host-side, bounded virtual paddle. It does not integrate phone position. */
export class TableTennisGame {
  constructor({seed = 137, onEvent = () => {}} = {}) {
    this.physics = new TableTennisPhysics();
    this.rules = new TableTennisRules();
    this.settings = {assistance: 'friendly', sensitivity: 1};
    this.mode = 'practice';
    this.seed = seed >>> 0;
    this.practiceReturns = 0;
    this.bestRally = 0;
    this.rallyReturns = 0;
    this.paused = false;
    this.time = 0;
    this.nextFeed = 1;
    this.feedStyle = 'slow';
    this.input = {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3()};
    this.inputAt = -Infinity;
    this.remote = false;
    this.remoteStale = false;
    this.settling = false;
    this.settleUntil = 0;
    this.strokeUntil = 0;
    this.botStrokeUntil = 0;
    this.serveMotion = null;
    this.lastReason = 'Practice: receive the next feed';
    this.onEvent = onEvent;
    this.physics.onEvent = event => this.handleCollision(event);
  }

  random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  configure(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !['assistance', 'sensitivity'].includes(k)) ||
      (settings.assistance !== undefined && !['friendly', 'standard'].includes(settings.assistance)) ||
      (settings.sensitivity !== undefined && (!finite(settings.sensitivity) || settings.sensitivity < .25 || settings.sensitivity > 2))) return false;
    Object.assign(this.settings, settings);
    return true;
  }

  setInput(input, {remote = false} = {}) {
    if (!input || !Array.isArray(input.orientation) || input.orientation.length !== 4 ||
      !input.orientation.every(finite) || input.orientation.some(n => Math.abs(n) > 1.01) ||
      !input.angularVelocity || !['x', 'y', 'z'].every(k => finite(input.angularVelocity[k]) && Math.abs(input.angularVelocity[k]) <= 50) ||
      (input.reach && !['x', 'y'].every(k => finite(input.reach[k]) && Math.abs(input.reach[k]) <= 1))) return false;
    const norm = Math.hypot(...input.orientation);
    if (norm < .9 || norm > 1.1) return false;
    if (remote && (this.time - this.inputAt > .25 || input.calibrationRevision !== this.input.calibrationRevision)) {
      this.settling = true;
      this.settleUntil = this.time + .15;
    }
    this.input = {...input, orientation: input.orientation.map(n => n / norm), reach: input.reach || {x: 0, y: 0}};
    this.inputAt = this.time;
    this.remote = remote;
    this.remoteStale = false;
    return true;
  }

  recenter() {
    if (this.physics.ball.active) return false;
    this.input = {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3()};
    this.strokeUntil = 0;
    this.inputAt = this.time;
    this.settling = true;
    this.settleUntil = this.time + .15;
    return true;
  }

  stroke() {
    if (this.paused) return false;
    if (this.mode === 'bot' && !this.physics.ball.active && this.rules.phase !== 'complete') return this.serve();
    this.strokeUntil = this.time + .24;
    return true;
  }

  startPractice(style = 'slow') {
    this.mode = 'practice';
    this.feedStyle = ['slow', 'medium', 'left', 'right'].includes(style) ? style : 'slow';
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.practiceReturns = 0;
    this.rallyReturns = 0;
    this.rules = new TableTennisRules();
    this.nextFeed = this.time + .6;
    this.lastReason = 'Practice: receive the next feed';
    this.onEvent({type: 'state'});
  }

  startMatch() {
    this.mode = 'bot';
    this.rules = new TableTennisRules();
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.nextFeed = Infinity;
    this.lastReason = 'Assisted toss — tap Serve or press Space to strike';
    this.onEvent({type: 'state'});
  }

  feed() {
    if (this.paused || this.mode !== 'practice') return false;
    const lateral = this.feedStyle === 'left' ? -.42 : this.feedStyle === 'right' ? .42 : (this.random() - .5) * .25;
    const speed = this.feedStyle === 'medium' ? 3.35 : 2.75;
    this.physics.launch(v3(lateral, 1.25, -1.12), v3(-lateral * .12, .25, speed));
    this.rallyReturns = 0;
    this.lastReason = 'Receive after the bounce';
    this.nextFeed = Infinity;
    return true;
  }

  /** A repeatable assisted toss and player-requested kinematic strike.
   * First contact uses the same moving paddle collider as every rally hit. */
  serve() {
    if (this.paused || this.mode !== 'bot' || this.physics.ball.active || this.rules.phase === 'complete') return false;
    this.rules.beginPoint();
    const player = this.rules.server;
    const sign = player === 1 ? 1 : -1;
    const aim = player === 1 ? clamp(this.input.reach.x, -.7, .7) : (this.random() - .5) * .45;
    const paddle = this.physics.paddles[player - 1];
    this.physics.launch(v3(aim * .3, 1.02, sign * 1.1), v3(0, -.1, 0));
    paddle.position = v3(aim * .3, 1.02, sign * 1.2);
    paddle.previous = {...paddle.position};
    paddle.normal = paddle.previousNormal = unit(v3(aim * .1, -.3, -sign));
    this.serveMotion = {player, started: this.time, aim};
    this.lastReason = `Player ${player} serves · assisted toss`;
    this.onEvent({type: 'state'});
    return true;
  }

  update(seconds) {
    if (this.paused) return;
    this.physics.advance(seconds, dt => {
      this.time += dt;
      const stale = this.remote && this.time - this.inputAt > .25;
      this.remoteStale = stale;
      if (this.mode === 'practice' && !this.physics.ball.active && this.time >= this.nextFeed && !stale) this.feed();
      if (this.mode === 'bot' && !this.physics.ball.active && this.rules.server === 2 &&
        this.rules.phase === 'ready' && this.time >= this.nextFeed && !stale) this.serve();
      this.updatePaddles(dt, stale);
    });
  }

  updatePaddles(dt, stale) {
    const ball = this.physics.ball;
    const assist = this.settings.assistance === 'friendly' ? .86 : .38;
    const p1 = this.physics.paddles[0], p2 = this.physics.paddles[1];
    const flight = ball.active && ball.velocity.z > .1 ? clamp((1.12 - ball.position.z) / ball.velocity.z, 0, .6) : 0;
    const estimated = ball.active ? clamp(ball.position.x + ball.velocity.x * flight, -.75, .75) : 0;
    const reach = this.input.reach;
    const strokePhase = this.strokeUntil > this.time ? Math.sin((.24 - this.strokeUntil + this.time) / .24 * Math.PI) : 0;
    const compact = stale ? 0 : clamp(Math.abs(this.input.angularVelocity.x) / 12, 0, .75);
    const target = v3(clamp(estimated * assist + reach.x * .65 * this.settings.sensitivity, -.9, .9),
      clamp(.96 + reach.y * .32 * this.settings.sensitivity, .83, 1.42), 1.17 - Math.max(strokePhase, compact) * .25);
    if (!stale) p1.position = approach(p1.position, target, dt * 3.0);
    if (this.settling && this.time >= this.settleUntil && length(sub(target, p1.position)) < .025) this.settling = false;
    p1.enabled = !stale && !this.settling;
    p1.normal = unit(mix(p1.normal, quaternionNormal(this.input.orientation), 1 - Math.exp(-dt / .025)));
    const botFlight = ball.active && ball.velocity.z < -.1 ? clamp((-1.12 - ball.position.z) / ball.velocity.z, 0, .6) : 0;
    const botX = ball.active ? clamp(ball.position.x + ball.velocity.x * botFlight, -.77, .77) : 0;
    if (ball.active && ball.velocity.z < 0 && ball.position.z < -.8 && this.botStrokeUntil <= this.time - .2) this.botStrokeUntil = this.time + .24;
    const botStroke = this.botStrokeUntil > this.time ? Math.sin((.24 - this.botStrokeUntil + this.time) / .24 * Math.PI) : 0;
    // A cooperative opponent has finite reach/speed and hits with this same collider.
    p2.position = approach(p2.position, v3(botX, .94, -1.16 + botStroke * .2), dt * 2.6);
    p2.normal = unit(v3(-p2.position.x * .12, .55, 1));
    if (this.serveMotion) {
      const motion = this.serveMotion;
      const paddle = this.physics.paddles[motion.player - 1];
      const sign = motion.player === 1 ? 1 : -1;
      const elapsed = this.time - motion.started;
      if (elapsed > .16) this.serveMotion = null;
      else {
        paddle.position = v3(motion.aim * .3, 1.02, sign * (1.2 - elapsed * 1.9));
        paddle.normal = unit(v3(motion.aim * .1, -.3, -sign));
        paddle.enabled = motion.player === 2 || !stale;
      }
    }
  }

  handleCollision(event) {
    if (event.kind === 'hit') {
      if (this.serveMotion?.player === event.player) this.serveMotion = null;
      if (event.player === 1) this.practiceReturns++;
      this.rallyReturns++;
      this.bestRally = Math.max(this.bestRally, this.rallyReturns);
      this.onEvent({type: 'hit', player: event.player, id: event.id});
      this.lastReason = event.player === 1 ? 'Contact — nice return' : 'Bot returned';
    }
    if (this.mode === 'bot') {
      const result = this.rules.event(event.kind, event);
      if (result) {
        this.physics.ball.active = false;
        this.nextFeed = this.time + 1.4;
        this.lastReason = result.type === 'let' ? 'Let — repeat the serve' : this.rules.reason;
        this.onEvent({...result, type: result.type});
        this.onEvent({type: 'state'});
      }
    } else if (event.kind === 'out') {
      this.nextFeed = this.time + 1;
      this.lastReason = this.rallyReturns ? 'Next feed in a moment' : 'Missed return — use tilt or move the paddle';
      this.onEvent({type: 'state'});
    }
  }

  snapshot() {
    const state = this.rules.snapshot();
    return {...state, phase: this.mode === 'practice' ? this.physics.ball.active ? 'rally' : 'ready' : state.phase,
      practice: this.mode === 'practice', returns: this.practiceReturns, reason: this.lastReason,
      stale: this.remoteStale, settings: {...this.settings}};
  }

  checkpoint() {
    if (this.physics.ball.active) return null;
    const rules = this.rules.checkpoint();
    if (!rules) return null;
    return {version: 1, boundary: 'point', rules, mode: this.mode, settings: {...this.settings},
      seed: this.seed, practiceReturns: this.practiceReturns};
  }

  restore(payload) {
    if (!payload || payload.version !== 1 || payload.boundary !== 'point' ||
      !['practice', 'bot'].includes(payload.mode) || !Number.isInteger(payload.seed) || payload.seed < 0 || payload.seed > 0xffffffff ||
      !Number.isInteger(payload.practiceReturns) || payload.practiceReturns < 0 || payload.practiceReturns > 1000000 ||
      !payload.settings || !['friendly', 'standard'].includes(payload.settings.assistance) ||
      !finite(payload.settings.sensitivity)) return false;
    const rules = new TableTennisRules();
    if (!rules.restore(payload.rules) || !this.configure(payload.settings)) return false;
    this.rules = rules;
    this.mode = payload.mode;
    this.seed = payload.seed;
    this.practiceReturns = payload.practiceReturns;
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.recenter();
    this.nextFeed = this.time + 1.4;
    this.lastReason = 'Restored at the last completed point';
    this.onEvent({type: 'state'});
    return true;
  }
}
