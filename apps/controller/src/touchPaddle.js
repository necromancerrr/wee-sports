const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const still = () => ({x:0,y:0,z:0});

/** The TV needs a fresh paddle even while no finger is touching the screen.
 * Keep that heartbeat tied to the match lifecycle, not to a drag gesture.
 */
export class TouchPaddleStream {
  constructor({send, playing, now = () => performance.now(), schedule = setInterval, cancel = clearInterval}) {
    Object.assign(this, {send,playing,now,schedule,cancel});
    this.timer = null;
    this.reset();
  }

  reset() {
    this.reach = {x:0,y:0};
    this.clearGesture();
  }

  clearGesture() {
    this.pressed = false;
    this.updated = -Infinity;
    this.velocity = still();
  }

  publish() {
    if (this.timer === null || !this.playing()) { this.clearGesture(); return; }
    const angularVelocity = this.pressed && this.now() - this.updated < 70 ? {...this.velocity} : still();
    this.send({orientation:[0,0,0,1],reach:{...this.reach},angularVelocity,calibrationRevision:0,sourceTime:this.now()/1000});
  }

  start() {
    if (this.timer !== null) return;
    this.clearGesture();
    this.timer = this.schedule(() => this.publish(), 1000 / 60);
    this.publish();
  }

  move(reach, start = false) {
    if (this.timer === null || !this.playing()) { this.clearGesture(); return; }
    const time = this.now();
    const next = {x:clamp(reach.x,-1,1),y:clamp(reach.y,-1,1)};
    const dt = this.pressed && !start ? Math.max(.016, (time - this.updated) / 1000) : Infinity;
    this.velocity = Number.isFinite(dt) ? {x:clamp((next.y - this.reach.y) / dt,-12,12),y:clamp((next.x - this.reach.x) / dt,-12,12),z:0} : still();
    this.reach = next;
    this.updated = time;
    this.pressed = true;
    this.publish();
  }

  release() {
    this.clearGesture();
    this.publish();
  }

  stop() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.clearGesture();
  }
}
