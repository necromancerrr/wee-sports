import {TableTennisPhysics, TABLE, v3, add, scale, sub, length, unit, mix, clamp} from './physics.js';
import {TableTennisRules} from './rules.js';
import {shotIntent, planFriendlyReturn} from './shot.js';
import {createStrokeIntentDetector} from './strokeIntent.js';

const finite = value => Number.isFinite(value);
const approach = (a, b, maxDistance) => {
  const difference = sub(b, a);
  return length(difference) <= maxDistance ? {...b} : add(a, scale(unit(difference), maxDistance));
};
const newStroke = (hand = 'Right') => ({phase: 'ready', offset: 0, speed: 0, power: 0, started: 0,
  until: 0, rearmed: true, lowFor: 0, intent: null, kind: 'drive', direction: 0, hand: hand === 'Left' ? 'Left' : 'Right'});
const INPUT_GRACE = .5;
// Friendly play buffers one deliberate swing through a normal incoming flight.
// It is still consumed once, and wall-clock expiry prevents delayed replay.
const FRIENDLY_STROKE_BUFFER = .8;
const newPlayer = () => ({input: {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3()},
  inputAt: -Infinity, remote: false, remoteStale: false, settling: false, settleUntil: 0,
  strokeDetector: createStrokeIntentDetector(), pendingStroke: null, stroke: newStroke(),
  localStrokeRequested: false, aimTarget: null, idleReach: {x: 0, y: 0}});

function captureStrokeIntent(controller, player, request, now) {
  const stroke = controller.stroke;
  stroke.intent = request?.intent || shotIntent(controller.input, player);
  stroke.kind = stroke.intent.kind; stroke.hand = stroke.intent.hand; stroke.direction = stroke.intent.direction;
  stroke.receivedAt = request?.receivedAt ?? now; stroke.gestureId = request?.id;
  controller.pendingStroke = null;
}

function refreshAim(controller, player) {
  // Preserve a quiet resting racket, but don't make a deliberate turn collect
  // a large deadband before the visible target follows it.
  const turning = length(controller.input.angularVelocity) > .12;
  const deadband = turning ? .004 : .03;
  for (const axis of ['x', 'y']) {
    if (Math.abs(controller.input.reach[axis] - controller.idleReach[axis]) > deadband) controller.idleReach[axis] = controller.input.reach[axis];
  }
  controller.aimTarget = {...(controller.stroke.intent && ['queued', 'forward'].includes(controller.stroke.phase)
    ? controller.stroke.intent.target : shotIntent({...controller.input, reach: controller.idleReach}, player).target)};
}

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
  return v3(clamp(ball.position.x + ball.velocity.x * t, -.85, .85), clamp(y, .81, 1.4), z);
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
 * collision; the input detector supplies one-shot human stroke requests. */
export function advanceStroke(stroke, {rate = 0, dt, time, trigger = false, nearBall = false, friendly = true, allowRateTrigger = true}) {
  const previousOffset = stroke.offset;
  const magnitude = Math.abs(rate);
  stroke.lowFor = magnitude < .65 ? stroke.lowFor + dt : 0;
  if (stroke.lowFor >= .04) stroke.rearmed = true;
  if (stroke.phase === 'ready' && (trigger || allowRateTrigger && stroke.rearmed && magnitude >= 1.1)) {
    stroke.phase = 'queued'; stroke.power = clamp(magnitude, 1.5, 9); stroke.until = time + (friendly ? FRIENDLY_STROKE_BUFFER : .18);
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
  // Screen-relative pointing mirrors in world X at the far player's end.
  return unit(v3(-sign * clamp(yaw * (friendly ? .24 : .4) * sensitivity, -.3, .3),
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
    this.players = [newPlayer(), newPlayer()];
    // Keep the public near-player fields used by the renderer and diagnostics.
    // Both human players now have independent samples, strokes and aim.
    for (const [property, field] of Object.entries({input: 'input', inputAt: 'inputAt', remote: 'remote',
      remoteStale: 'remoteStale', settling: 'settling', settleUntil: 'settleUntil', strokeDetector: 'strokeDetector',
      pendingStroke: 'pendingStroke', playerStroke: 'stroke', localStrokeRequested: 'localStrokeRequested', aimTarget: 'aimTarget'})) {
      this.players[0][field] = this[property];
      Object.defineProperty(this, property, {get: () => this.players[0][field], set: value => {this.players[0][field] = value;}});
    }
    Object.defineProperty(this, 'botStroke', {get: () => this.players[1].stroke, set: value => {this.players[1].stroke = value;}});
    this.players[1].aimTarget = shotIntent(this.players[1].input, 2).target;
  }

  random() {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  clearStrokeInput(player = null) {
    for (const controller of player ? [this.players[player - 1]] : this.players) {
      controller.strokeDetector.reset();
      controller.pendingStroke = null;
      controller.localStrokeRequested = false;
      controller.stroke = newStroke(controller.input.hand);
    }
  }

  configure(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !['assistance', 'sensitivity'].includes(k)) ||
      (settings.assistance !== undefined && !['friendly', 'standard'].includes(settings.assistance)) ||
      (settings.sensitivity !== undefined && (!finite(settings.sensitivity) || settings.sensitivity < .25 || settings.sensitivity > 2))) return false;
    Object.assign(this.settings, settings);
    return true;
  }

  setInput(input, {remote = false, player = 1} = {}) {
    if (![1, 2].includes(player) || player === 2 && this.mode !== 'versus') return false;
    const controller = this.players[player - 1];
    if (!input || !Array.isArray(input.orientation) || input.orientation.length !== 4 ||
      !input.orientation.every(finite) || input.orientation.some(n => Math.abs(n) > 1.01) ||
      !input.angularVelocity || !['x', 'y', 'z'].every(k => finite(input.angularVelocity[k]) && Math.abs(input.angularVelocity[k]) <= 50) ||
      (input.hand !== undefined && !['Left', 'Right'].includes(input.hand)) ||
      (input.reach && !['x', 'y'].every(k => finite(input.reach[k]) && Math.abs(input.reach[k]) <= 1))) return false;
    const norm = Math.hypot(...input.orientation);
    if (norm < .9 || norm > 1.1) return false;
    const now = this.now();
    if (!finite(now)) return false;
    if (remote && (now - controller.inputAt > INPUT_GRACE || input.calibrationRevision !== controller.input.calibrationRevision)) {
      controller.settling = true;
      controller.settleUntil = this.time + .15;
      this.clearStrokeInput(player);
    }
    controller.input = {...input, orientation: input.orientation.map(n => n / norm), reach: input.reach || {x: 0, y: 0}};
    if (controller.stroke.phase === 'ready') controller.stroke.hand = input.hand === 'Left' ? 'Left' : 'Right';
    controller.inputAt = now;
    controller.remote = remote;
    controller.remoteStale = false;
    // Recognition runs once per received sample, independently of the TV's
    // animation frames. A short swing followed by rest cannot disappear.
    const gesture = controller.strokeDetector.push(controller.input, now);
    const active = controller.strokeDetector.active;
    // Preserve the peak even if the entire burst and quiet rearm occur before
    // the next render frame. The request stays one-shot and keeps its aim.
    if (active && controller.pendingStroke?.id === active.id) {
      controller.pendingStroke.strength = Math.max(controller.pendingStroke.strength, active.strength);
    }
    if (active && controller.stroke.gestureId === active.id && ['queued', 'forward'].includes(controller.stroke.phase)) {
      controller.stroke.power = Math.max(controller.stroke.power, Math.min(active.strength, 9));
    }
    if (gesture && !this.paused && this.physics.ball.active && this.serveMotion?.player !== player && controller.stroke.phase !== 'forward') {
      // A short swing may finish while the paddle is recovering, the input is
      // settling, or the opponent is making contact. Keep the latest action
      // until this player's next legal receive instead of silently losing it.
      controller.pendingStroke = {...gesture, receivedAt: now,
        intent: shotIntent({reach: gesture.aim, angularVelocity: gesture.spin}, player, gesture)};
      if (controller.stroke.phase === 'queued') {
        // Only the latest deliberate swing owns the upcoming receive. Keeping
        // an older queue made the target feel stuck and could replay the newer
        // gesture on a later ball. Once forward motion begins, intent is fixed.
        controller.stroke.power = clamp(gesture.strength, 1.5, 9);
        controller.stroke.until = this.time + (this.settings.assistance === 'friendly' ? FRIENDLY_STROKE_BUFFER : .18);
        captureStrokeIntent(controller, player, controller.pendingStroke, now);
      }
    }
    // Presentation can use the newest accepted pointing sample even if no
    // fixed physics step is due on this display frame.
    refreshAim(controller, player);
    return true;
  }

  recenter(player = 1) {
    if (![1, 2].includes(player)) return false;
    const controller = this.players[player - 1];
    if (this.physics.ball.active) return false;
    controller.input = {reach: {x: 0, y: 0}, orientation: [0, 0, 0, 1], angularVelocity: v3(), hand: controller.input.hand};
    controller.idleReach = {x: 0, y: 0};
    controller.strokeUntil = 0;
    this.clearStrokeInput(player);
    controller.inputAt = this.now();
    controller.settling = true;
    controller.settleUntil = this.time + .15;
    return true;
  }

  stroke(player = 1) {
    if (![1, 2].includes(player) || player === 2 && this.mode !== 'versus') return false;
    const controller = this.players[player - 1];
    if (this.paused) return false;
    if (this.mode !== 'practice' && !this.physics.ball.active && this.rules.phase !== 'complete') return this.serve();
    controller.localStrokeRequested = true;
    return true;
  }

  startPractice(style = 'slow') {
    this.mode = 'practice';
    this.feedStyle = ['slow', 'medium', 'left', 'right'].includes(style) ? style : 'slow';
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.clearStrokeInput();
    this.practiceReturns = 0;
    this.rallyReturns = 0;
    this.bestRally = 0;
    this.rules = new TableTennisRules();
    this.nextFeed = this.time + .6;
    this.lastReason = 'Practice: receive the next feed';
    this.onEvent({type: 'state'});
  }

  startMatch({players = this.mode === 'versus' ? 2 : 1} = {}) {
    this.mode = players === 2 ? 'versus' : 'bot';
    this.rules = new TableTennisRules();
    this.physics.ball.active = false;
    this.serveMotion = null;
    this.clearStrokeInput();
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
    this.clearStrokeInput();
    this.rallyReturns = 0;
    this.lastReason = 'Receive after the bounce';
    this.nextFeed = Infinity;
    return true;
  }

  /** A repeatable assisted toss and player-requested kinematic strike.
   * First contact uses the same moving paddle collider as every rally hit. */
  serve() {
    if (this.paused || this.mode === 'practice' || this.physics.ball.active || this.rules.phase === 'complete') return false;
    this.rules.beginPoint();
    this.lastBounceSide = null;
    this.clearStrokeInput();
    const player = this.rules.server;
    const sign = player === 1 ? 1 : -1;
    const aim = player === 1 || this.mode === 'versus' ? sign * clamp(this.players[player - 1].input.reach.x, -.7, .7) : 0;
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
    const humans = this.mode === 'versus' ? this.players : [this.players[0]];
    // Finished matches need no controller heartbeat. Preserve the result when
    // a phone stops input, opens its result screen, or leaves the foreground.
    if (this.mode !== 'practice' && this.rules.phase === 'complete') {
      for (const controller of humans) controller.remoteStale = false;
      return;
    }
    if (this.paused) {
      this.clearStrokeInput();
      for (const controller of humans) {controller.settling = true; controller.settleUntil = this.time + .15;}
      return;
    }
    for (const [index, controller] of humans.entries()) {
      controller.remoteStale = controller.remote && this.now() - controller.inputAt > INPUT_GRACE;
      if (controller.remoteStale) this.clearStrokeInput(index + 1);
      const expiry = this.settings.assistance === 'friendly' ? FRIENDLY_STROKE_BUFFER : .5;
      if (controller.pendingStroke && this.now() - controller.pendingStroke.receivedAt > expiry) controller.pendingStroke = null;
      const strokeExpiry = controller.stroke.phase === 'forward' ? .3 : expiry;
      const strokeStarted = controller.stroke.phase === 'forward' ? controller.stroke.forwardAt : controller.stroke.receivedAt;
      if (strokeStarted !== undefined && this.now() - strokeStarted > strokeExpiry) controller.stroke = newStroke(controller.input.hand);
    }
    const stale = humans.some(controller => controller.remoteStale);
    this.physics.advance(seconds, dt => {
      this.time += dt;
      const settling = humans.some(controller => controller.settling);
      if (this.mode === 'practice' && !this.physics.ball.active && this.time >= this.nextFeed && !stale && !settling) this.feed();
      if (this.mode !== 'practice' && !this.physics.ball.active && this.rules.phase === 'ready' &&
        this.time >= this.nextFeed && !stale && !settling) this.serve();
      this.updatePaddles(dt, stale);
      return !stale && !humans.some(controller => controller.settling);
    });
  }

  updateHumanPaddle(player, dt, stale) {
    const controller = this.players[player - 1], paddle = this.physics.paddles[player - 1];
    const ball = this.physics.ball, sign = player === 1 ? 1 : -1;
    const friendly = this.settings.assistance === 'friendly';
    const assist = friendly ? 1 : .65;
    const incoming = ball.active && ball.velocity.z * sign > .1;
    let plane = friendly ? receivePlane(ball, player, this.lastBounceSide === player) : sign * 1.1;
    if (friendly && incoming) {
      // A slightly late reaction can still reach behind the table. Move the
      // visible paddle there first; never collect a ball behind its collider.
      plane = controller.stroke.phase === 'forward' && controller.stroke.plane !== undefined
        ? controller.stroke.plane : sign * clamp(Math.max(plane * sign, ball.position.z * sign + .1), .56, 1.8);
    }
    const baseZ = plane + sign * .1;
    const intercept = ball.active ? predictInterception(ball, plane) : v3(0, 1.02, sign * 1.1);
    const reach = controller.input.reach;
    if (stale) controller.stroke = newStroke(controller.input.hand);
    const wasReady = controller.stroke.phase === 'ready';
    const request = incoming && !controller.settling ? controller.pendingStroke : null;
    const oldPhase = controller.stroke.phase;
    const active = controller.strokeDetector.active;
    const strength = request ? Math.max(request.strength, active?.id === request.id ? active.strength : 0)
      : active && active.id === controller.stroke.gestureId ? active.strength : 0;
    advanceStroke(controller.stroke, {rate: stale ? 0 : strength, dt, time: this.time,
      trigger: !stale && !controller.settling && incoming && (controller.localStrokeRequested || Boolean(request)), friendly, allowRateTrigger: false,
      nearBall: incoming && this.lastBounceSide === player && (!friendly || (paddle.position.z - ball.position.z) * sign > .035) &&
        (baseZ - ball.position.z) * sign / (ball.velocity.z * sign + 1.3) <= .14});
    if (wasReady && controller.stroke.phase !== 'ready') {
      captureStrokeIntent(controller, player, request, this.now());
    }
    if (oldPhase !== 'forward' && controller.stroke.phase === 'forward') {
      controller.stroke.plane = plane;
      // Once a buffered action visibly starts, finish this bounded physical
      // stroke instead of canceling it halfway through its contact window.
      controller.stroke.forwardAt = this.now();
    }
    refreshAim(controller, player);
    controller.localStrokeRequested = false;
    // Assistance follows the ball only after a deliberate stroke. A still
    // controller holds a stable ready pose instead of chasing every prediction.
    const receiving = ['queued', 'forward'].includes(controller.stroke.phase);
    const target = receiving ? v3(clamp(intercept.x * assist + (friendly ? 0 : sign * reach.x * .4), -.9, .9),
      clamp(intercept.y + (friendly ? 0 : reach.y * .18), .81, 1.42), baseZ - sign * controller.stroke.offset)
      : v3(sign * controller.idleReach.x * .20, 1.02 + controller.idleReach.y * .08, sign * 1.45);
    if (!stale) paddle.position = approach(paddle.position, target, dt * (friendly ? 6 : 3));
    paddle.radiusX = friendly ? .13 : .095;
    paddle.radiusY = friendly ? .16 : .12;
    if (controller.settling && this.time >= controller.settleUntil && length(sub(target, paddle.position)) < .025) controller.settling = false;
    paddle.enabled = !stale && !controller.settling && (friendly ? controller.stroke.phase === 'forward' : controller.stroke.phase !== 'recovery') &&
      (!friendly || this.lastBounceSide === player);
    const face = receiving ? stabilizedNormal(ball, player, controller.stroke.velocity || 0,
      friendly ? [0, 0, 0, 1] : controller.input.orientation, friendly, this.settings.sensitivity)
      : unit(v3(0, .06, -sign));
    paddle.normal = unit(mix(paddle.normal, face, 1 - Math.exp(-dt / .025)));
  }

  updatePaddles(dt, stale) {
    this.updateHumanPaddle(1, dt, stale);
    const ball = this.physics.ball, p2 = this.physics.paddles[1];
    if (this.mode === 'versus') this.updateHumanPaddle(2, dt, stale);
    else {
      p2.radiusX = .095; p2.radiusY = .12;
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
    }
    if (this.serveMotion) {
      const motion = this.serveMotion;
      const paddle = this.physics.paddles[motion.player - 1];
      const sign = motion.player === 1 ? 1 : -1;
      const elapsed = this.time - motion.started;
      if (elapsed > .16) this.serveMotion = null;
      else {
        paddle.position = v3(motion.aim * .3, 1.02, sign * (1.2 - elapsed * 1.9));
        paddle.normal = unit(v3(motion.aim * .1, -.3, -sign));
        paddle.enabled = !stale;
      }
    }
  }

  resolveContact(contact) {
    if (this.serveMotion || this.settings.assistance !== 'friendly') return null;
    const stroke = contact.player === 1 ? this.playerStroke : this.botStroke;
    // Friendly contacts exist only during a deliberate stroke. Auto-positioning
    // alone cannot hit a ball using a different, unexpected response model.
    if (stroke.phase !== 'forward') return null;
    const intent = contact.player === 1 || this.mode === 'versus'
      ? stroke.intent || shotIntent(this.players[contact.player - 1].input, contact.player)
      : shotIntent({reach: {x: 0}, angularVelocity: v3()}, 2);
    return planFriendlyReturn(contact.position, intent, stroke.power);
  }

  handleCollision(event) {
    if (event.kind === 'bounce') this.lastBounceSide = event.side;
    if (event.kind === 'hit') {
      if (event.player === 1) this.botReactAt = this.time + .10;
      this.lastContact = {player: event.player, position: {...event.position},
        target: event.assisted ? {...(event.player === 1 || this.mode === 'versus' ? this.players[event.player - 1].aimTarget : shotIntent({reach: {x: 0}}, 2).target)} : null,
        speed: length(event.velocity || this.physics.ball.velocity), assisted: event.assisted, id: event.id};
      if (this.serveMotion?.player === event.player) this.serveMotion = null;
      const stroke = event.player === 1 ? this.playerStroke : this.botStroke;
      stroke.phase = 'recovery'; stroke.offset = Math.max(stroke.offset, .12);
      this.players[event.player - 1].pendingStroke = null;
      this.physics.paddles[event.player - 1].enabled = false;
      this.onEvent({type: 'hit', player: event.player, id: event.id});
      this.lastReason = event.player === 1 ? 'Contact' : this.mode === 'versus' ? 'Player 2 returned' : 'Bot returned';
    }
    if (this.mode !== 'practice') {
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
      stale: this.remoteStale || this.mode === 'versus' && this.players[1].remoteStale, mode: this.mode, players: this.mode === 'versus' ? 2 : 1, settings: {...this.settings}};
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
      !['practice', 'bot', 'versus'].includes(payload.mode) || !Number.isInteger(payload.seed) || payload.seed < 0 || payload.seed > 0xffffffff ||
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
    this.recenter(); this.recenter(2);
    this.nextFeed = this.time + 1.4;
    this.lastReason = 'Restored at the last completed point';
    this.onEvent({type: 'state'});
    return true;
  }
}
