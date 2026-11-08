/** Metres, seconds, kg, radians. No DOM or renderer dependencies. */
export const TABLE = Object.freeze({width: 1.525, length: 2.74, height: .76, netHeight: .1525});
// A hollow table-tennis ball is approximated as a thin spherical shell.
export const BALL = Object.freeze({radius: .02, mass: .0027, inertiaFactor: 2 / 3});
export const FIXED_STEP = 1 / 120;
export const MATERIAL = Object.freeze({tableRestitution: .88, paddleRestitution: .8,
  tableFriction: .12, paddleFriction: .45, drag: .045, magnus: .00055, maxSpeed: 15, maxSpin: 180});

export const v3 = (x = 0, y = 0, z = 0) => ({x, y, z});
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, n) => v3(a.x * n, a.y * n, a.z * n);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = a => Math.hypot(a.x, a.y, a.z);
export const unit = a => scale(a, 1 / (length(a) || 1));
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const mix = (a, b, t) => add(scale(a, 1 - t), scale(b, t));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bounded = (a, max) => length(a) > max ? scale(unit(a), max) : a;

/** Live force law; the contact-time planner uses its allocation-free equivalent. */
export const flightAcceleration = (velocity, spin) => add(v3(0, -9.81, 0),
  add(scale(velocity, -MATERIAL.drag * length(velocity)), scale(cross(spin, velocity), MATERIAL.magnus)));

/** Impulse against an infinite-mass surface, evaluated at the ball's contact
 * point. Coulomb friction is limited by normal impulse and cannot reverse slip.
 * The same impulse changes both linear velocity and shell angular momentum. */
export function sphereContact(velocity, spin, normal, surface, restitution, friction) {
  const relative = sub(velocity, surface);
  const closing = dot(relative, normal);
  if (closing >= 0) return {velocity: {...velocity}, spin: {...spin}};
  const normalImpulse = -(1 + restitution) * closing;
  const radius = scale(normal, -BALL.radius);
  const contactVelocity = add(relative, cross(spin, radius));
  const slip = sub(contactVelocity, scale(normal, dot(contactVelocity, normal)));
  const slipSpeed = length(slip);
  const tangentialImpulse = Math.min(slipSpeed / (1 + 1 / BALL.inertiaFactor), friction * normalImpulse);
  const tangent = slipSpeed > 1e-9 ? scale(slip, -tangentialImpulse / slipSpeed) : v3();
  return {
    velocity: bounded(add(velocity, add(scale(normal, normalImpulse), tangent)), MATERIAL.maxSpeed),
    spin: bounded(add(spin, scale(cross(radius, tangent), 1 / (BALL.inertiaFactor * BALL.radius ** 2))), MATERIAL.maxSpin),
  };
}

export function makePaddle(player) {
  const sign = player === 1 ? 1 : -1;
  return {player, position: v3(0, 1.02, sign * 1.19), previous: v3(0, 1.02, sign * 1.19),
    normal: v3(0, .06, -sign), previousNormal: v3(0, .06, -sign),
    radiusX: .095, radiusY: .12, enabled: true};
}

/** Sphere swept against a finite, moving paddle face. Rotation is substepped. */
export function sweepPaddle(start, end, paddle, from = 0, to = 1) {
  if (!paddle.enabled) return null;
  const a = mix(paddle.previous, paddle.position, from);
  const b = mix(paddle.previous, paddle.position, to);
  const n0 = unit(mix(paddle.previousNormal, paddle.normal, from));
  const n1 = unit(mix(paddle.previousNormal, paddle.normal, to));
  const d0 = dot(sub(start, a), n0), d1 = dot(sub(end, b), n1);
  const radius = BALL.radius + .006;
  if (d0 < radius - .003 || d1 >= d0 || d1 > radius) return null;
  const t = clamp((d0 - radius) / (d0 - d1), 0, 1);
  const normal = unit(mix(n0, n1, t));
  const center = mix(a, b, t);
  const point = mix(start, end, t);
  // Near-horizontal faces need a different reference axis; a zero cross
  // product would otherwise make the finite ellipse an infinite plane.
  const tangentX = unit(cross(Math.abs(normal.y) > .98 ? v3(0, 0, 1) : v3(0, 1, 0), normal));
  const tangentY = unit(cross(normal, tangentX));
  const delta = sub(point, center);
  const x = dot(delta, tangentX) / (paddle.radiusX + BALL.radius);
  const y = dot(delta, tangentY) / (paddle.radiusY + BALL.radius);
  if (x * x + y * y > 1) return null;
  return {t, normal, point, center, paddle, kind: 'hit'};
}

/** The ball has one authority. Each contact emits one event, even at high speed. */
export class TableTennisPhysics {
  constructor() {
    this.ball = {position: v3(0, 1, 0), velocity: v3(), spin: v3(), active: false};
    this.paddles = [makePaddle(1), makePaddle(2)];
    this.time = 0;
    this.eventSequence = 0;
    this.accumulator = 0;
    this.droppedSeconds = 0;
    this.onEvent = () => {};
    // Optional game assistance resolves only an actual swept contact. It may
    // choose the outgoing impulse, never move the ball or steer it in flight.
    this.resolvePaddleContact = null;
  }

  launch(position, velocity, spin = v3()) {
    this.ball = {position: {...position}, velocity: bounded({...velocity}, MATERIAL.maxSpeed),
      spin: bounded({...spin}, MATERIAL.maxSpin), active: true};
  }

  emit(kind, data = {}) {
    this.onEvent({kind, id: ++this.eventSequence, time: this.time, ...data});
  }

  advance(seconds, beforeStep = () => {}) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const accepted = Math.min(seconds, .1);
    this.droppedSeconds += seconds - accepted;
    this.accumulator += accepted;
    while (this.accumulator >= FIXED_STEP) {
      if (beforeStep(FIXED_STEP) !== false) this.step(FIXED_STEP);
      else for (const paddle of this.paddles) {
        // Safe input resynchronization may move a non-contact paddle while
        // play is frozen. Do not turn that relocation into a later impulse.
        paddle.previous = {...paddle.position};
        paddle.previousNormal = {...paddle.normal};
      }
      this.accumulator -= FIXED_STEP;
    }
  }

  step(dt = FIXED_STEP) {
    // Four conservative substeps bound the swept face rotation to the kinematic
    // controller's angular-rate limit. Each substep still sweeps, not samples.
    for (let slice = 0; slice < 4; slice++) this.substep(dt / 4, slice / 4, (slice + 1) / 4, dt);
    this.time += dt;
    for (const p of this.paddles) { p.previous = {...p.position}; p.previousNormal = {...p.normal}; }
  }

  substep(dt, from, to, fullDt) {
    const ball = this.ball;
    if (!ball.active) return;
    const force = flightAcceleration(ball.velocity, ball.spin);
    ball.velocity = bounded(add(ball.velocity, scale(force, dt)), MATERIAL.maxSpeed);
    ball.spin = scale(ball.spin, Math.exp(-.12 * dt));
    let remaining = dt;
    for (let contact = 0; contact < 4 && remaining > 1e-7 && ball.active; contact++) {
      const start = ball.position;
      const end = add(start, scale(ball.velocity, remaining));
      const hits = [];
      const top = TABLE.height + BALL.radius;
      if (start.y >= top - 1e-6 && end.y < top && ball.velocity.y < 0) {
        const t = (start.y - top) / (start.y - end.y);
        const point = mix(start, end, t);
        if (Math.abs(point.x) <= TABLE.width / 2 && Math.abs(point.z) <= TABLE.length / 2) {
          hits.push({kind: 'bounce', t, normal: v3(0, 1, 0), point, side: point.z >= 0 ? 1 : 2});
        }
      }
      const netSide = Math.sign(start.z) || -Math.sign(ball.velocity.z);
      const netPlane = netSide * (BALL.radius + .004);
      if (netSide * start.z >= Math.abs(netPlane) - 1e-6 && netSide * end.z < Math.abs(netPlane)) {
        const t = (start.z - netPlane) / (start.z - end.z);
        const point = mix(start, end, t);
        if (Math.abs(point.x) <= TABLE.width / 2 + .15 && point.y >= TABLE.height - BALL.radius &&
          point.y <= TABLE.height + TABLE.netHeight + BALL.radius) {
          const grazesTop = point.y > TABLE.height + TABLE.netHeight;
          hits.push({kind: 'net', t, point, normal: grazesTop ? v3(0, 1, 0) : v3(0, 0, netSide), grazesTop});
        }
      }
      for (const paddle of this.paddles) {
        // A preceding table/net contact consumes part of this interval. Do not
        // sweep the paddle through that elapsed movement for a second time.
        const cursor = to - (to - from) * remaining / dt;
        const hit = sweepPaddle(start, end, paddle, cursor, to);
        if (hit) hits.push(hit);
      }
      hits.sort((a, b) => a.t - b.t);
      const hit = hits[0];
      if (!hit) { ball.position = end; break; }
      ball.position = add(hit.point, scale(hit.normal, .0001));
      if (hit.kind === 'hit') {
        const paddleVelocity = scale(sub(hit.paddle.position, hit.paddle.previous), 1 / fullDt);
        // Face rotation contributes contact-point velocity as well as its moving pivot.
        const rotation = scale(cross(unit(hit.paddle.previousNormal), unit(hit.paddle.normal)), 1 / fullDt);
        const surface = add(paddleVelocity, cross(rotation, sub(hit.point, hit.center)));
        const relative = sub(ball.velocity, surface);
        const normalSpeed = dot(relative, hit.normal);
        if (normalSpeed < 0) {
          const incomingVelocity = {...ball.velocity};
          const physical = sphereContact(ball.velocity, ball.spin, hit.normal, surface,
            MATERIAL.paddleRestitution, MATERIAL.paddleFriction);
          ball.velocity = physical.velocity;
          ball.spin = physical.spin;
          const response = this.resolvePaddleContact?.({player: hit.paddle.player, position: {...ball.position},
            incomingVelocity, velocity: {...ball.velocity}, spin: {...ball.spin}});
          let assisted = false;
          if (response && [response.velocity, response.spin].every(vector => vector &&
            ['x', 'y', 'z'].every(axis => Number.isFinite(vector[axis])))) {
            ball.velocity = bounded({...response.velocity}, MATERIAL.maxSpeed);
            ball.spin = bounded({...response.spin}, MATERIAL.maxSpin);
            assisted = true;
          }
          this.emit('hit', {player: hit.paddle.player, position: {...ball.position},
            velocity: {...ball.velocity}, assisted});
        }
      } else if (hit.kind === 'bounce') {
        const physical = sphereContact(ball.velocity, ball.spin, hit.normal, v3(),
          MATERIAL.tableRestitution, MATERIAL.tableFriction);
        ball.velocity = physical.velocity;
        ball.spin = physical.spin;
        this.emit('bounce', {side: hit.side, position: {...ball.position}});
        // A resting ball is a terminal play state. The separation epsilon must
        // not keep recycling gravity into an endless series of tiny bounces.
        if (ball.active && ball.velocity.y < .18 && Math.hypot(ball.velocity.x, ball.velocity.z) < .2) {
          ball.velocity = v3(); ball.spin = v3(); ball.active = false;
          this.emit('out', {reason: 'settled-on-table'});
        }
      } else {
        if (hit.grazesTop) {
          ball.velocity.y = Math.abs(ball.velocity.y) * .25;
          ball.velocity.z *= .55;
          // Put the ball beyond the thin net after a legal top clip.
          ball.position.z -= netSide * .055;
        } else ball.velocity = add(scale(ball.velocity, .35), scale(hit.normal, -dot(ball.velocity, hit.normal) * .5));
        this.emit('net');
      }
      remaining *= 1 - hit.t;
    }
    if (ball.position.y < BALL.radius || Math.abs(ball.position.x) > 2.2 || Math.abs(ball.position.z) > 2.8) {
      ball.active = false;
      this.emit('out');
    }
  }
}

/** Bounded receiving forecast using the live solver, with paddle contacts off.
 * One instance is reused per game and callers cache its result between inputs.
 * This includes drag, Magnus, table friction and net contacts without inventing
 * a second set of flight equations or changing the authoritative ball. */
export function createBallForecast() {
  const simulation = new TableTennisPhysics();
  for (const paddle of simulation.paddles) paddle.enabled = false;
  return (ball, horizon = 1) => {
    const samples = [{time: 0, position: {...ball.position}}], bounces = [];
    simulation.launch(ball.position, ball.velocity, ball.spin || v3());
    simulation.time = 0;
    simulation.onEvent = event => {
      if (event.kind === 'bounce') bounces.push({time: simulation.time, side: event.side, position: {...event.position}});
    };
    const steps = Math.ceil(clamp(horizon, 0, 1) / FIXED_STEP);
    for (let i = 0; i < steps && simulation.ball.active; i++) {
      simulation.step();
      samples.push({time: simulation.time, position: {...simulation.ball.position}});
    }
    return {samples, bounces};
  };
}
