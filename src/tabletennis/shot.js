import {TABLE, BALL, FIXED_STEP, MATERIAL, v3, add, sub, scale, length, clamp} from './physics.js';

/** The target is table-relative, independent of the paddle's assisted reach.
 * Capture this at the start of the stroke so the swing itself cannot re-aim it. */
export function shotIntent(input, player = 1, stroke = null) {
  const sign = player === 1 ? -1 : 1;
  const aim = clamp(input.reach?.x || 0, -1, 1);
  const direction = stroke?.direction || 0;
  // Forehand goes left and backhand right in the player's own camera view.
  // Deliberate pointing remains stronger than this gentle stroke tendency.
  const placement = clamp(aim * .55 + direction * .20 * (1 - Math.abs(aim) * .65), -.58, .58);
  return {
    target: v3(-sign * placement || 0, TABLE.height + BALL.radius, sign * .9),
    kind: stroke?.kind || 'drive', hand: stroke?.hand || (input.hand === 'Left' ? 'Left' : 'Right'), direction,
    // Deliberate wrist rotation shapes the flight slightly. Swing pitch is
    // power, not an accidental source of alternating top/backspin.
    spin: v3(sign * 12, clamp((input.angularVelocity?.z || 0) * 3, -18, 18), 0),
  };
}

function trace(position, velocity, spin, seconds) {
  let x = position.x, y = position.y, z = position.z;
  let vx = velocity.x, vy = velocity.y, vz = velocity.z;
  let wx = spin.x, wy = spin.y, wz = spin.z;
  const step = FIXED_STEP / 4;
  const decay = Math.exp(-.12 * step);
  for (let elapsed = 0; elapsed < seconds - 1e-9;) {
    const dt = Math.min(step, seconds - elapsed);
    // Same semi-implicit drag/Magnus force as flightAcceleration, with scalar
    // scratch values so a contact does not allocate thousands of vectors.
    const drag = -MATERIAL.drag * Math.hypot(vx, vy, vz);
    const ax = drag * vx + MATERIAL.magnus * (wy * vz - wz * vy);
    const ay = -9.81 + drag * vy + MATERIAL.magnus * (wz * vx - wx * vz);
    const az = drag * vz + MATERIAL.magnus * (wx * vy - wy * vx);
    vx += ax * dt; vy += ay * dt; vz += az * dt;
    const damp = dt === step ? decay : Math.exp(-.12 * dt);
    wx *= damp; wy *= damp; wz *= damp;
    x += vx * dt; y += vy * dt; z += vz * dt;
    elapsed += dt;
  }
  return v3(x, y, z);
}

/** Friendly chooses one bounded impulse at real contact. The same table target
 * remains the target for a harder stroke; power changes pace and arc. The live
 * simulation still owns all flight, net, bounce and out decisions afterward.
 * Numerical correction uses the same drag/Magnus integration as live flight. */
export function planFriendlyReturn(position, intent, power = 0) {
  const target = {...intent.target};
  const spin = {...intent.spin};
  const distance = Math.hypot(target.x - position.x, target.z - position.z);
  const pace = 3.4 + clamp(power, 0, 9) * .20;
  const fraction = clamp(Math.abs(position.z / (target.z - position.z)), .05, .95);
  const lineHeight = position.y + (target.y - position.y) * fraction;
  const clearance = TABLE.height + TABLE.netHeight + BALL.radius + .065;
  const minimumArc = Math.sqrt(Math.max(0, clearance - lineHeight) / (4.905 * fraction * (1 - fraction)));
  const seconds = clamp(Math.max(distance / pace, minimumArc), .28, .85);
  let velocity = scale(sub(target, position), 1 / seconds);
  velocity.y += 4.905 * seconds;
  // Contact planning runs only at hits, not every render/physics frame.
  for (let iteration = 0; iteration < 5; iteration++) {
    const miss = sub(target, trace(position, velocity, spin, seconds));
    velocity = add(velocity, scale(miss, 1.06 / seconds));
  }
  return {velocity, spin, target, seconds, speed: length(velocity)};
}
