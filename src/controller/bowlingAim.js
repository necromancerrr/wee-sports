/** Replaceable aim state: bounded traffic, no queued history or acknowledgement. */
export function createBowlingAimStream(send, { intervalMs = 16, heartbeatMs = 200 } = {}) {
  let sequence = 0;
  let last = null;
  return {
    publish(aim, locked, timeMs, active) {
      if (!active || !Number.isFinite(aim) || Math.abs(aim) > 1 || !Number.isFinite(timeMs)) {
        last = null;
        return false;
      }
      const changedLock = last && last.locked !== locked;
      const elapsed = last ? timeMs - last.timeMs : Infinity;
      if (last && !changedLock && elapsed >= 0 &&
          (elapsed < intervalMs || (Math.abs(last.aim - aim) < .005 && elapsed < heartbeatMs))) return false;
      const event = { aim, locked: Boolean(locked), sequence: ++sequence };
      send(event);
      last = { ...event, timeMs };
      return true;
    },
    reset() { last = null; },
  };
}

/** Small hand tremors get a short low-pass filter; deliberate changes catch up
 * within a couple of sensor samples. Time-based gain preserves phone-rate parity. */
export function createBowlingAimFilter() {
  let value = 0, previous = null;
  return {
    push(input, timeSeconds) {
      if (!Number.isFinite(input) || !Number.isFinite(timeSeconds)) return value;
      input = Math.max(-1, Math.min(1, input));
      if (previous !== null && timeSeconds <= previous) return value;
      const dt = previous === null ? Infinity : timeSeconds - previous;
      previous = timeSeconds;
      if (dt > .25) {value = input; return value;}
      const motion = Math.min(1, Math.abs(input - value) / .12);
      const timeConstant = .035 - .023 * motion;
      value += (input - value) * -Math.expm1(-dt / timeConstant);
      return value;
    },
    reset(input = 0, timeSeconds = null) {
      value = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0;
      previous = Number.isFinite(timeSeconds) ? timeSeconds : null;
    },
  };
}
