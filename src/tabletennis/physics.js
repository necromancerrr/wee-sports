/** Metres, seconds, kg, radians. No DOM or renderer dependencies. */
export const TABLE = Object.freeze({width: 1.525, length: 2.74, height: .76, netHeight: .1525});
export const BALL = Object.freeze({radius: .02, mass: .0027});
export const FIXED_STEP = 1 / 120;
export const MATERIAL = Object.freeze({tableRestitution: .88, paddleRestitution: .8,
  drag: .045, magnus: .00055, maxSpeed: 15, maxSpin: 180});

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
  const tangentX = unit(cross(v3(0, 1, 0), normal));
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
      beforeStep(FIXED_STEP);
      this.step(FIXED_STEP);
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
    const speed = length(ball.velocity);
    const force = add(v3(0, -9.81, 0), add(scale(ball.velocity, -MATERIAL.drag * speed),
      scale(cross(ball.spin, ball.velocity), MATERIAL.magnus)));
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
        const hit = sweepPaddle(start, end, paddle, from, to);
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
          const tangent = sub(relative, scale(hit.normal, normalSpeed));
          ball.velocity = add(surface, add(scale(hit.normal, -normalSpeed * MATERIAL.paddleRestitution), scale(tangent, .88)));
          ball.spin = bounded(add(scale(ball.spin, .5), scale(cross(hit.normal, tangent), -18)), MATERIAL.maxSpin);
          ball.velocity = bounded(ball.velocity, MATERIAL.maxSpeed);
          this.emit('hit', {player: hit.paddle.player, position: {...ball.position}});
        }
      } else if (hit.kind === 'bounce') {
        const surface = cross(ball.spin, v3(0, -BALL.radius, 0));
        const slip = add(ball.velocity, surface);
        const friction = v3(-slip.x * .12, 0, -slip.z * .12);
        ball.velocity = add(v3(ball.velocity.x, -ball.velocity.y * MATERIAL.tableRestitution, ball.velocity.z), friction);
        ball.spin = bounded(add(ball.spin, scale(cross(v3(0, -BALL.radius, 0), friction), -2.5 / (BALL.radius * BALL.radius))), MATERIAL.maxSpin);
        this.emit('bounce', {side: hit.side, position: {...ball.position}});
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
