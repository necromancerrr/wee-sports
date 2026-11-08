const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const aligned = () => ({x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0});

/** Anticipation and recovery happen only outside the physical contact window.
 * The live paddle face never departs from the simulation's collision ellipse. */
export function paddlePresentation({phase = 'ready', kind = 'drive', hand = 'Right', direction, player = 1, elapsed = 0,
  enabled = false, reducedMotion = false} = {}) {
  if (enabled || reducedMotion || phase === 'forward') return aligned();
  const handSign = hand === 'Left' ? -1 : 1;
  const landingSide = Number.isFinite(direction) ? Math.sign(direction)
    : (kind === 'forehand' ? -1 : kind === 'backhand' ? 1 : 0) * handSign;
  // The near paddle faces -Z, so its local X points left on the TV. Prepare
  // opposite the landing side, then follow through toward it at either end.
  const side = landingSide * (player === 1 ? 1 : -1);
  const rest = {pitch: -.12, yaw: .04 * handSign, roll: .17 * handSign};
  if (phase === 'queued') {
    const amount = ease(elapsed / .10);
    return {x: side * .045 * amount, y: -.012 * amount, z: -.04 * amount,
      pitch: rest.pitch - (side ? .15 : .25) * amount,
      yaw: rest.yaw + side * .30 * amount,
      roll: rest.roll + side * .55 * amount};
  }
  if (phase === 'recovery') {
    const progress = clamp01(elapsed / .26);
    const swing = Math.sin(progress * Math.PI), settle = ease(progress);
    return {x: -side * .055 * swing, y: .025 * swing, z: .02 * swing,
      pitch: (side ? .20 : .4) * swing + rest.pitch * settle,
      yaw: -side * .25 * swing + rest.yaw * settle,
      roll: -side * .68 * swing + rest.roll * settle};
  }
  // A steady held pose, not an idle animation that resembles sensor noise.
  return {...aligned(), ...rest};
}
