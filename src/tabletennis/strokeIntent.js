const finiteVector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const aimOf = input => ({x: clamp(input.reach?.x || 0, -1, 1), y: clamp(input.reach?.y || 0, -1, 1)});

/** A phone supplies a short rotational gesture, not tracked hand position.
 * Use all three axes so portrait, landscape and screen-up grips can swing.
 * Movement plus a peak rejects tiny spikes; quiet rearming prevents one swing
 * and its follow-through from producing several queued returns. This runs on
 * input receipt, independently of the TV's render/physics frame rate.
 */
export function createStrokeIntentDetector() {
  let previous = null, candidate = null, current = null, quiet = 0;
  let stableAim = {x: 0, y: 0}, armed = true, identity = 0;
  const reset = () => {previous = candidate = current = null; quiet = 0; armed = true; stableAim = {x: 0, y: 0};};
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
      if (!armed) return null;
      if (!candidate || now - candidate.startedAt > .24) {
        candidate = {startedAt: now - dt, travel: 0, peak: 0, aim: {...stableAim}};
      }
      candidate.travel += travel;
      candidate.peak = Math.max(candidate.peak, rate);
      // Leave margin for a gentle 1.5 rad/s pulse sampled between its peak.
      if (candidate.peak < 1.3 || candidate.travel < .08) return null;
      current = {id: ++identity, strength: Math.min(candidate.peak, 30),
        aim: {...candidate.aim}, spin: {...input.angularVelocity}, startedAt: candidate.startedAt};
      candidate = null; armed = false;
      return copy(current);
    },
  };
}
