const finiteVector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const aimOf = input => ({x: clamp(input.reach?.x || 0, -1, 1), y: clamp(input.reach?.y || 0, -1, 1)});

/** Screen-relative angular motion describes wrist rotation, not tracked arm
 * position. Lateral yaw (or roll for a flat grip) gives a repeatable arcade
 * forehand/backhand. A predominantly forward pitch remains a straight drive.
 * Hand preference changes the gesture label, never the sensor coordinate frame.
 */
export function classifyStroke(input) {
  const hand = input.hand === 'Left' ? 'Left' : 'Right';
  const rate = input.angularVelocity || {x: 0, y: 0, z: 0};
  const yaw = Math.abs(rate.y), roll = Math.abs(rate.z);
  // Opposing axes in a diagonal wrist movement do not give a dependable side.
  // Treat the ambiguous band as a drive, rather than flipping the target when
  // tiny sensor noise changes which component happens to be largest.
  if (rate.y * rate.z < 0 && Math.min(yaw, roll) > Math.max(yaw, roll) * .65) {
    return {kind: 'drive', direction: 0, hand};
  }
  const axis = yaw >= roll ? 'y' : 'z';
  const lateral = rate[axis];
  if (Math.abs(lateral) < Math.max(.65, Math.abs(rate.x) * .65)) return {kind: 'drive', direction: 0, hand};
  const forehand = lateral * (hand === 'Left' ? -1 : 1) < 0;
  return {kind: forehand ? 'forehand' : 'backhand', direction: forehand ? -1 : 1, hand};
}

/** A phone supplies a short rotational gesture, not tracked hand position.
 * Use all three axes so portrait, landscape and screen-up grips can swing.
 * Movement plus a peak rejects tiny spikes; a new acceleration or quiet rest
 * rearms the next swing without counting a held rate as repeated hits. This runs on
 * input receipt, independently of the TV's render/physics frame rate.
 */
export function createStrokeIntentDetector() {
  let previous = null, candidate = null, current = null, quiet = 0, valley = null;
  let stableAim = {x: 0, y: 0}, armed = true, identity = 0;
  const reset = () => {previous = candidate = current = valley = null; quiet = 0; armed = true; stableAim = {x: 0, y: 0};};
  const copy = value => value ? {...value, aim: {...value.aim}, spin: {...value.spin}} : null;
  return {
    reset,
    get active() {return copy(current);},
    push(input, now) {
      if (!Number.isFinite(now) || !finiteVector(input?.angularVelocity)) return null;
      if (previous && now <= previous.time) return null;
      const rate = Math.hypot(...['x', 'y', 'z'].map(axis => input.angularVelocity[axis]));
      if (!Number.isFinite(rate)) return null;
      if (previous && now - previous.time > .25) reset();
      if (!previous) {
        previous = {time: now, rate}; stableAim = aimOf(input);
        return null;
      }
      const dt = now - previous.time;
      const travel = (rate + previous.rate) * .5 * dt;
      previous = {time: now, rate};
      if (rate <= .55) {
        stableAim = aimOf(input);
        candidate = null;
        quiet += dt;
        if (quiet >= .06 - 1e-9) {armed = true; current = null;}
        return null;
      }
      quiet = 0;
      if (current) current.strength = Math.max(current.strength, Math.min(rate, 30));
      if (!armed) {
        // Players keep moving between shots. A genuine deceleration followed
        // by another acceleration can rearm without asking them to hold still.
        // Constant rotation and a direction reversal at the same speed remain
        // one gesture; a minimum separation rejects the same stroke's recoil.
        const relaxed = Math.max(.9, (current?.strength || 0) * .45);
        if (rate <= relaxed) {
          if (!valley) valley = {startedAt: now, rate, aim: aimOf(input)};
          if (rate < valley.rate) {valley.rate = rate; valley.aim = aimOf(input);}
        }
        if (!valley || now - valley.startedAt < .025 ||
          now - current.startedAt < .24 || rate < Math.max(1.1, valley.rate + .4)) return null;
        armed = true; stableAim = {...valley.aim}; candidate = null; valley = null;
      }
      if (!candidate || now - candidate.startedAt > .24) {
        candidate = {startedAt: now - dt, travel: 0, peak: 0, aim: {...stableAim}};
      }
      candidate.travel += travel;
      candidate.peak = Math.max(candidate.peak, rate);
      // Recognize a compact wrist movement promptly, while requiring travel
      // as well as a peak so single-sample noise and slow aiming stay quiet.
      if (candidate.peak < 1.1 || candidate.travel < .06) return null;
      current = {id: ++identity, strength: Math.min(candidate.peak, 30),
        aim: {...candidate.aim}, spin: {...input.angularVelocity}, startedAt: candidate.startedAt,
        ...classifyStroke(input)};
      candidate = null; armed = false; valley = null;
      return copy(current);
    },
  };
}
