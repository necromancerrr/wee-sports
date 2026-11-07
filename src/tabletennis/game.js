import {TableTennisPhysics, TABLE, v3, add, scale, sub, length, unit, mix, clamp} from './physics.js';
import {TableTennisRules} from './rules.js';
import {shotIntent, planFriendlyReturn} from './shot.js';
import {createStrokeIntentDetector} from './strokeIntent.js';

const finite = value => Number.isFinite(value);
const approach = (a, b, maxDistance) => {
  const difference = sub(b, a);
  return length(difference) <= maxDistance ? {...b} : add(a, scale(unit(difference), maxDistance));
};
const newStroke = () => ({phase: 'ready', offset: 0, speed: 0, power: 0, started: 0,
  until: 0, rearmed: true, lowFor: 0, intent: null});

/** Predict bounded reach, including one future table bounce. This moves the
 * paddle before contact; it never redirects a ball already in flight. */
export function predictInterception(ball, z) {
  const t = Math.abs(ball.velocity.z) > .1 ? clamp((z - ball.position.z) / ball.velocity.z, 0, .65) : 0;
  let y = ball.position.y + ball.velocity.y * t - 4.905 * t * t;
  const top = TABLE.height + .02;
  const discriminant = ball.velocity.y ** 2 + 19.62 * (ball.position.y - top);
  if (discriminant >= 0) {
    const bounceTime = (ball.velocity.y + Math.sqrt(discriminant)) / 9.81;
    if (bounceTime > 0 && bounceTime < t && Math.abs(ball.position.z + ball.velocity.z * bounceTime) < TABLE.length / 2) {
      const bounceSpeed = -(ball.velocity.y - 9.81 * bounceTime) * .88;
      const remaining = t - bounceTime;
      y = top + bounceSpeed * remaining - 4.905 * remaining * remaining;
    }
  }
  return v3(clamp(ball.position.x + ball.velocity.x * t, -.85, .85), clamp(y, .9, 1.4), z);
}

/** Short returns need reach over the table. A phone is not a position tracker;
 * choose a bounded reachable plane before the projected second bounce. */
export function receivePlane(ball, player, alreadyBounced) {
  const sign = player === 1 ? 1 : -1;
  if (!ball.active || ball.velocity.z * sign <= .1) return sign * 1.35;
  const top = TABLE.height + .02;
  const d = ball.velocity.y ** 2 + 19.62 * (ball.position.y - top);
  if (d < 0) return sign * 1.35;
  const t = (ball.velocity.y + Math.sqrt(d)) / 9.81;
  let end = ball.position.z + ball.velocity.z * t;
  if (!alreadyBounced && end * sign > 0 && Math.abs(end) <= TABLE.length / 2) {
    const bounceSpeed = Math.max(0, -(ball.velocity.y - 9.81 * t) * .88);
    end += ball.velocity.z * .88 * 2 * bounceSpeed / 9.81;
  }
  // Receive ordinary deep balls at the table end, rather than forcing an
  // early contact well over the table. Short balls still get bounded reach.
  return sign * clamp(end * sign - .18, .56, 1.35);
}

/** Angular rate requests forward velocity in a short virtual workspace.
 * Deceleration never pulls the active paddle backwards. Recovery has no
 * collision, and a quiet interval is required before a new burst can arm. */
export function advanceStroke(stroke, {rate = 0, dt, time, trigger = false, nearBall = false, friendly = true, allowRateTrigger = true}) {
  const previousOffset = stroke.offset;
  const magnitude = Math.abs(rate);
  stroke.lowFor = magnitude < .65 ? stroke.lowFor + dt : 0;
  if (stroke.lowFor >= .04) stroke.rearmed = true;
  if (stroke.phase === 'ready' && (trigger || allowRateTrigger && stroke.rearmed && magnitude >= 1.1)) {
    stroke.phase = 'queued'; stroke.power = clamp(magnitude, 1.5, 9); stroke.until = time + (friendly ? .45 : .18);
    stroke.rearmed = false;
  }
  if (stroke.phase === 'queued') {
    stroke.power = Math.max(stroke.power, Math.min(magnitude, 9));
    if (nearBall) {
      stroke.phase = 'forward'; stroke.started = time;
      stroke.speed = clamp(.9 + stroke.power * .10, 1.05, 1.8);
    } else if (time > stroke.until) stroke.phase = 'ready';
  }
  if (stroke.phase === 'forward') {
    stroke.offset = Math.min(.22, stroke.offset + stroke.speed * dt);
    if (time - stroke.started >= .22) stroke.phase = 'recovery';
  }
  if (stroke.phase === 'recovery') {
    stroke.offset = Math.max(0, stroke.offset - dt * .85);
    if (!stroke.offset) { stroke.phase = 'ready'; stroke.speed = 0; }
  }
  stroke.velocity = stroke.phase === 'forward' ? Math.max(0, (stroke.offset - previousOffset) / dt) : 0;
  return stroke;
}

function stabilizedNormal(ball, player, strokeSpeed, orientation, friendly, sensitivity = 1) {
  const sign = player === 1 ? -1 : 1;
  const [x, y, z, w] = orientation;
  const pitch = 2 * (w * x - y * z), yaw = -2 * (x * z + w * y);
  const incoming = Math.max(.8, Math.abs(ball.velocity.z) + strokeSpeed);
  // Friendly stabilizes the face toward a modest rising return, with bounded
  // player angle influence. Standard gives the player more face control.
  const loft = clamp((1.9 - .88 * ball.velocity.y) / (1.8 * incoming), .015, .6);
  return unit(v3(clamp(yaw * (friendly ? .24 : .4) * sensitivity, -.3, .3),
    clamp(loft + pitch * (friendly ? .13 : .35) * sensitivity, -.15, .7), sign));
}

/** Host-side, bounded virtual paddle. It does not integrate phone position. */
export class TableTennisGame {
  constructor({seed = 137, onEvent = () => {}, now = null} = {}) {
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
    this.wallTime = 0;
    this.now = typeof now === 'function' ? now : () => this.wallTime;
    this.strokeDetector = createStrokeIntentDetector();
    this.pendingStroke = null;
    this.nextFeed = 1;
    this.feedStyle = 'slow';
    this.input = {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3()};
    this.aimTarget = shotIntent(this.input).target;
    this.lastContact = null;
    this.inputAt = -Infinity;
    this.remote = false;
    this.remoteStale = false;
    this.settling = false;
    this.settleUntil = 0;
    this.strokeUntil = 0;
    this.botStrokeUntil = 0;
    this.serveMotion = null;
    this.playerStroke = newStroke();
    this.botStroke = newStroke();
    this.botReactAt = 0;
    this.localStrokeRequested = false;
    this.lastBounceSide = null;
    this.practiceLastHitter = 2;
    this.practiceBounces = 0;
    this.practiceHasContact = false;
    this.lastReason = 'Practice: receive the next feed';
    this.onEvent = onEvent;
    this.physics.onEvent = event => this.handleCollision(event);
    this.physics.resolvePaddleContact = contact => this.resolveContact(contact);
  }

  random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  clearStrokeInput() {
    this.strokeDetector.reset();
    this.pendingStroke = null;
    this.localStrokeRequested = false;
    this.playerStroke = newStroke();
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
    const now = this.now();
    if (!finite(now)) return false;
    if (remote && (now - this.inputAt > .25 || input.calibrationRevision !== this.input.calibrationRevision)) {
      this.settling = true;
      this.settleUntil = this.time + .15;
      this.clearStrokeInput();
    }
    this.input = {...input, orientation: input.orientation.map(n => n / norm), reach: input.reach || {x: 0, y: 0}};
    this.inputAt = now;
    this.remote = remote;
    this.remoteStale = false;
    // Recognition runs once per received sample, independently of the TV's
    // animation frames. A short swing followed by rest cannot disappear.
    const gesture = this.strokeDetector.push(this.input, now);
    const active = this.strokeDetector.active;
    // Preserve the peak even if the entire burst and quiet rearm occur before
    // the next render frame. The request stays one-shot and keeps its aim.
    if (active && this.pendingStroke?.id === active.id) {
      this.pendingStroke.strength = Math.max(this.pendingStroke.strength, active.strength);
    }
    if (active && this.playerStroke.gestureId === active.id && ['queued', 'forward'].includes(this.playerStroke.phase)) {
      this.playerStroke.power = Math.max(this.playerStroke.power, Math.min(active.strength, 9));
    }
    if (gesture && !this.paused && !this.settling && this.physics.ball.active &&
      this.physics.ball.velocity.z > .1 && !this.serveMotion && this.playerStroke.phase === 'ready') {
      this.pendingStroke = {...gesture, receivedAt: now,
        intent: shotIntent({reach: gesture.aim, angularVelocity: gesture.spin})};
    }
    return true;
  }

  recenter() {
    if (this.physics.ball.active) return false;
    this.input = {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3()};
    this.strokeUntil = 0;
    this.clearStrokeInput();
    this.inputAt = this.now();
    this.settling = true;
    this.settleUntil = this.time + .15;
    return true;
  }

  stroke() {
    if (this.paused) return false;
    if (this.mode === 'bot' && !this.physics.ball.active && this.rules.phase !== 'complete') return this.serve();
    this.localStrokeRequested = true;
    return true;
  }

  startPractice(style = 'slow') {
    this.mode = 'practice';
    this.feedStyle = ['slow', 'medium', 'left', 'right'].includes(style) ? style : 'slow';
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.clearStrokeInput(); this.botStroke = newStroke();
    this.practiceReturns = 0;
    this.rallyReturns = 0;
    this.bestRally = 0;
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
    this.clearStrokeInput(); this.botStroke = newStroke();
    this.nextFeed = this.time + 1.2;
    this.lastReason = 'Get ready — an assisted serve is coming';
    this.onEvent({type: 'state'});
  }

  feed() {
    if (this.paused || this.mode !== 'practice') return false;
    // Ordinary feeds repeat the same line. Directional drills are explicit.
    const lateral = this.feedStyle === 'left' ? -.42 : this.feedStyle === 'right' ? .42 : 0;
    const speed = this.feedStyle === 'medium' ? 4.0 : 3.45;
    this.physics.launch(v3(lateral, 1.08, -.95), v3(-lateral * .12, 1.2, speed));
    this.practiceLastHitter = 2; this.practiceBounces = 0; this.practiceHasContact = false; this.lastBounceSide = null;
    this.clearStrokeInput(); this.botStroke = newStroke();
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
    this.lastBounceSide = null;
    this.clearStrokeInput(); this.botStroke = newStroke();
    const player = this.rules.server;
    const sign = player === 1 ? 1 : -1;
    const aim = player === 1 ? clamp(this.input.reach.x, -.7, .7) : 0;
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
    if (!finite(seconds) || seconds <= 0) return;
    this.wallTime += seconds;
    if (this.paused) {
      this.clearStrokeInput(); this.botStroke = newStroke();
      this.settling = true; this.settleUntil = this.time + .15;
      return;
    }
    const stale = this.remote && this.now() - this.inputAt > .25;
    this.remoteStale = stale;
    if (stale) this.clearStrokeInput();
    if (this.pendingStroke && this.now() - this.pendingStroke.receivedAt > .5) this.pendingStroke = null;
    if (this.playerStroke.receivedAt !== undefined && this.now() - this.playerStroke.receivedAt > .65) this.playerStroke = newStroke();
    this.physics.advance(seconds, dt => {
      this.time += dt;
      if (this.mode === 'practice' && !this.physics.ball.active && this.time >= this.nextFeed && !stale && !this.settling) this.feed();
      if (this.mode === 'bot' && !this.physics.ball.active && this.rules.phase === 'ready' &&
        this.time >= this.nextFeed && !stale && !this.settling) this.serve();
      this.updatePaddles(dt, stale);
      return !stale && !this.settling;
    });
  }

  updatePaddles(dt, stale) {
    const ball = this.physics.ball;
    const friendly = this.settings.assistance === 'friendly';
    const assist = friendly ? .97 : .65;
    const p1 = this.physics.paddles[0], p2 = this.physics.paddles[1];
    const plane = friendly ? receivePlane(ball, 1, this.lastBounceSide === 1) : 1.1;
    const baseZ = plane + .1;
    const intercept = ball.active ? predictInterception(ball, plane) : v3(0, 1.02, 1.1);
    const reach = this.input.reach;
    if (stale) this.playerStroke = newStroke();
    const wasReady = this.playerStroke.phase === 'ready';
    const request = this.pendingStroke;
    const active = this.strokeDetector.active;
    const strength = request ? Math.max(request.strength, active?.id === request.id ? active.strength : 0)
      : active && active.id === this.playerStroke.gestureId ? active.strength : 0;
    advanceStroke(this.playerStroke, {rate: stale ? 0 : strength, dt, time: this.time,
      trigger: this.localStrokeRequested || Boolean(request), friendly, allowRateTrigger: false,
      nearBall: ball.active && ball.velocity.z > .1 && this.lastBounceSide === 1 &&
        (baseZ - ball.position.z) / (ball.velocity.z + 1.3) <= .14});
    if (wasReady && this.playerStroke.phase !== 'ready') {
      this.playerStroke.intent = request?.intent || shotIntent(this.input);
      this.playerStroke.receivedAt = request?.receivedAt ?? this.now();
      this.playerStroke.gestureId = request?.id;
    }
    this.pendingStroke = null;
    this.aimTarget = {...(this.playerStroke.intent && ['queued', 'forward'].includes(this.playerStroke.phase)
      ? this.playerStroke.intent.target : shotIntent(this.input).target)};
    this.localStrokeRequested = false;
    // Friendly separates where the paddle receives from where the shot aims.
    // Aiming right must not pull the receiving paddle off an incoming ball.
    const target = v3(clamp(intercept.x * assist + (friendly ? 0 : reach.x * .4), -.9, .9),
      clamp(intercept.y + (friendly ? 0 : reach.y * .18), .9, 1.42), baseZ - this.playerStroke.offset);
    if (!stale) p1.position = approach(p1.position, target, dt * 3.0);
    if (this.settling && this.time >= this.settleUntil && length(sub(target, p1.position)) < .025) this.settling = false;
    p1.enabled = !stale && !this.settling && (friendly ? this.playerStroke.phase === 'forward' : this.playerStroke.phase !== 'recovery') &&
      (!friendly || this.lastBounceSide === 1);
    const face = stabilizedNormal(ball, 1, this.playerStroke.velocity || 0,
      friendly ? [0, 0, 0, 1] : this.input.orientation, friendly, this.settings.sensitivity);
    p1.normal = unit(mix(p1.normal, face, 1 - Math.exp(-dt / .025)));
    const botPlane = receivePlane(ball, 2, this.lastBounceSide === 2);
    const botBaseZ = botPlane - .1;
    const botIntercept = ball.active ? predictInterception(ball, botPlane) : v3(0, 1.02, -1.1);
    const botReceiving = ball.active && ball.velocity.z < -.1 && this.time >= this.botReactAt;
    const botNear = botReceiving && this.lastBounceSide === 2 &&
      (ball.position.z - botBaseZ) / (-ball.velocity.z + 1.3) <= .14;
    advanceStroke(this.botStroke, {rate: botNear ? 4 : 0, dt, time: this.time, nearBall: botNear, friendly: true});
    // A cooperative opponent has finite reach/speed and hits with this same collider.
    if (botReceiving) p2.position = approach(p2.position,
      v3(clamp(botIntercept.x, -.77, .77), botIntercept.y, botBaseZ + this.botStroke.offset), dt * 1.55);
    else if (!ball.active) p2.position = approach(p2.position, v3(0, 1.02, -1.2), dt * 1.55);
    p2.enabled = this.botStroke.phase === 'forward' && this.lastBounceSide === 2;
    p2.normal = stabilizedNormal(ball, 2, this.botStroke.velocity || 0,
      [0, -p2.position.x * .03, 0, Math.sqrt(1 - (p2.position.x * .03) ** 2)], true);
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

  resolveContact(contact) {
    if (this.serveMotion || this.settings.assistance !== 'friendly') return null;
    const stroke = contact.player === 1 ? this.playerStroke : this.botStroke;
    // Friendly contacts exist only during a deliberate stroke. Auto-positioning
    // alone cannot hit a ball using a different, unexpected response model.
    if (stroke.phase !== 'forward') return null;
    const intent = contact.player === 1 ? stroke.intent || shotIntent(this.input)
      : shotIntent({reach: {x: 0}, angularVelocity: v3()}, 2);
    return planFriendlyReturn(contact.position, intent, stroke.power);
  }

  handleCollision(event) {
    if (event.kind === 'bounce') this.lastBounceSide = event.side;
    if (event.kind === 'hit') {
      if (event.player === 1) this.botReactAt = this.time + .10;
      this.lastContact = {player: event.player, position: {...event.position},
        target: event.assisted ? {...(event.player === 1 ? this.aimTarget : shotIntent({reach: {x: 0}}, 2).target)} : null,
        speed: length(event.velocity || this.physics.ball.velocity), assisted: event.assisted, id: event.id};
      if (this.serveMotion?.player === event.player) this.serveMotion = null;
      const stroke = event.player === 1 ? this.playerStroke : this.botStroke;
      stroke.phase = 'recovery'; stroke.offset = Math.max(stroke.offset, .12);
      this.physics.paddles[event.player - 1].enabled = false;
      this.onEvent({type: 'hit', player: event.player, id: event.id});
      this.lastReason = event.player === 1 ? 'Contact' : 'Bot returned';
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
    } else {
      const finish = reason => {
        this.physics.ball.active = false;
        this.nextFeed = this.time + .9;
        this.lastReason = reason;
        this.onEvent({type: 'state'});
      };
      if (event.kind === 'hit') {
        if (event.player === this.practiceLastHitter) { finish('Double contact — next ball coming'); return; }
        if (this.practiceBounces !== 1) { finish('Let it bounce first — next ball coming'); return; }
        this.practiceLastHitter = event.player;
        this.practiceBounces = 0;
        this.practiceHasContact = true;
        this.lastBounceSide = null;
      } else if (event.kind === 'bounce') {
        if (event.side === this.practiceLastHitter) { finish('Aim over the net — next ball coming'); return; }
        this.practiceBounces++;
        if (this.practiceBounces > 1) { finish('Missed return — next ball coming'); return; }
        if (this.practiceHasContact) {
          if (this.practiceLastHitter === 1) this.practiceReturns++;
          this.rallyReturns++;
          this.bestRally = Math.max(this.bestRally, this.rallyReturns);
          this.lastReason = 'Good return';
          this.onEvent({type: 'state'});
        }
      } else if (event.kind === 'out') finish(this.rallyReturns ? 'Next ball coming' : 'Missed return — next ball coming');
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
