import {
  applyMotionCalibration, createMotionCalibration, createPaddleIntentController,
  createTimeConstantFilter, normalizeNativeGyroscope, toLegacyMotionSample,
} from '../../../shared/motion.js';
import { bowlingTiltAim, createBowlingMotionDetector } from '../../../src/controller/motionGestures.js';

/** Native collection only; units, calibration, filters and sport recognition are shared. */
export class MotionController {
  constructor({ session, sensors, onStatus = () => {}, onRelease = () => {}, hand = 'Right', sensitivity = 1 }) {
    this.Gyroscope = sensors.Gyroscope;
    this.DeviceMotion = sensors.DeviceMotion;
    this.session = session;
    this.onStatus = onStatus;
    this.onRelease = onRelease;
    this.hand = hand;
    this.sensitivity = sensitivity;
    this.sequence = 0;
    this.attempt = 0;
    this.revision = 0;
    this.aim = 0;
    this.active = false;
    this.filter = createTimeConstantFilter();
    this.paddle = createPaddleIntentController({ hand, sensitivity });
  }

  async calibrate() {
    this.stop();
    const attempt = this.attempt;
    const permission = await this.Gyroscope.requestPermissionsAsync();
    if (this.attempt !== attempt) return;
    const available = permission.granted && await this.Gyroscope.isAvailableAsync();
    if (this.attempt !== attempt) return;
    if (!available) throw new Error('Motion is unavailable. You can still use touch controls.');
    this.active = true;
    this.calibration = null;
    this.calibrator = createMotionCalibration({ revision: ++this.revision });
    this.paddle.reset();
    this.filter.reset(0);
    this.started = performance.now();
    this.samples = 0;
    this.lastUi = -Infinity;
    this.lastTime = null;
    this.largestGap = 0;
    this.Gyroscope.setUpdateInterval(1000 / 60);
    const gravityAvailable = await this.DeviceMotion.isAvailableAsync();
    if (!this.active || this.attempt !== attempt) return;
    if (gravityAvailable) {
      this.DeviceMotion.setUpdateInterval(1000 / 30);
      this.deviceSubscription = this.DeviceMotion.addListener(reading => {
        this.device = reading;
        this.deviceReceived = performance.now();
      });
    }
    this.gyroSubscription = this.Gyroscope.addListener(reading => this.sample(reading));
    this.noDataTimer = setTimeout(() => {
      if (!this.calibration) this.onStatus({ state: 'no-readings', message: 'No stable reading yet. Hold still or choose touch controls.' });
    }, 10000);
  }

  sample(reading) {
    if (!this.active) return;
    const time = performance.now();
    const sample = normalizeNativeGyroscope(reading, {
      timeSeconds: time / 1000, sequence: this.sequence++,
      screenAngle: this.device?.orientation ?? 0, calibrationRevision: this.revision,
    });
    if (!sample) return;
    this.samples++;
    if (this.lastTime !== null) this.largestGap = Math.max(this.largestGap, time - this.lastTime);
    this.lastTime = time;
    if (this.device && time - this.deviceReceived < 100) {
      const { acceleration, accelerationIncludingGravity: total } = this.device;
      if (acceleration && ['x', 'y', 'z'].every(axis => Number.isFinite(acceleration[axis]))) sample.acceleration = acceleration;
      if (sample.acceleration && total && ['x', 'y', 'z'].every(axis => Number.isFinite(total[axis]))) {
        sample.gravity = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, total[axis] - sample.acceleration[axis]]));
      }
    }
    if (!this.calibration) {
      const status = this.calibrator.push(sample);
      if (status.state === 'done') { this.calibration = status.calibration; clearTimeout(this.noDataTimer); }
      if (time - this.lastUi > 100 || status.state === 'done') { this.lastUi = time; this.onStatus(status); }
      return;
    }
    const corrected = applyMotionCalibration(sample, this.calibration);
    if (!corrected) { this.stop(); this.onStatus({ state: 'recalibrate', message: 'Your grip changed. Recalibrate before using motion.' }); return; }
    if (this.session.seat?.sport === 'bowling') {
      const legacy = toLegacyMotionSample(corrected);
      if (!this.detector) {
        const tilt = bowlingTiltAim(corrected.gravity, Math.hypot(legacy.rotationAlpha, legacy.rotationBeta, legacy.rotationGamma));
        if (tilt !== null) this.aim = this.filter.push(tilt, corrected.timeSeconds);
      }
      this.session.latest('aim', { aim: this.detector ? this.frozenAim : this.aim, locked: Boolean(this.detector) });
      if (this.detector && this.session.playing()) {
        const release = this.detector.push(legacy);
        if (release) { this.detector = null; this.onRelease({ ...release, aim: this.frozenAim }); }
      }
    } else if (this.session.seat?.sport === 'table-tennis') {
      const intent = this.paddle.push(corrected);
      if (intent) {
        const { orientation, angularVelocity, reach, calibrationRevision } = intent;
        this.session.latest('pose', { orientation, angularVelocity, reach, calibrationRevision });
      }
    }
    if (time - this.lastUi > 100) {
      this.lastUi = time;
      this.onStatus({ state: 'ready', aim: this.aim, armed: Boolean(this.detector),
        achievedHz: this.samples / Math.max(.001, (time - this.started) / 1000), largestGapMs: this.largestGap });
    }
  }

  arm() {
    if (!this.active || !this.calibration || !this.session.playing() || this.session.seat?.gameState?.phase !== 'ready') return false;
    this.frozenAim = this.aim;
    this.detector = createBowlingMotionDetector();
    return true;
  }

  recenter() { this.detector = null; this.paddle.reset(); this.aim = 0; this.filter.reset(0); }
  stop() {
    this.attempt++;
    this.active = false;
    this.detector = null;
    this.deviceSubscription?.remove(); this.deviceSubscription = null;
    this.gyroSubscription?.remove(); this.gyroSubscription = null;
    clearTimeout(this.noDataTimer);
    this.device = null;
    this.paddle.reset();
  }
}
