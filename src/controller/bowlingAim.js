/** Replaceable aim state: bounded traffic, no queued history or acknowledgement. */
export function createBowlingAimStream(send, { intervalMs = 50, heartbeatMs = 200 } = {}) {
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
