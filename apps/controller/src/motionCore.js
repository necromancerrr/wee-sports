import {
  createAutomaticMotionSetup, createPaddleIntentController,
  createTimeConstantFilter, normalizeNativeGyroscope, toLegacyMotionSample,
} from '../../../shared/motion.js';
import { bowlingTiltAim, createBowlingDeliveryGate } from '../../../src/controller/motionGestures.js';
import { nativeBowlingSupportVector, nativeDeviceMotionFields } from './nativeSample.js';

/** Native collection only; units, calibration, filters and sport recognition are shared. */
export class MotionController {
  constructor({ session, sensors, onStatus = () => {}, onRelease = () => {}, hand = 'Right', sensitivity = 1, now = () => performance.now() }) {
    this.Gyroscope = sensors.Gyroscope;
    this.DeviceMotion = sensors.DeviceMotion;
    this.session = session;
    this.onStatus = onStatus;
    this.onRelease = onRelease;
    this.hand = hand;
    this.sensitivity = sensitivity;
    this.now = now;
    this.sequence = 0;
    this.attempt = 0;
    this.revision = 0;
    this.aim = 0;
    this.active = false;
    this.filter = createTimeConstantFilter();
    this.paddle = createPaddleIntentController({ hand, sensitivity });
    this.automatic = createAutomaticMotionSetup();
    this.delivery = createBowlingDeliveryGate();
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
    this.automatic.reset();
    this.paddle.reset();
    this.filter.reset(0);
    this.started = this.now();
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
        this.deviceReceived = this.now();
      });
    }
    this.gyroSubscription = this.Gyroscope.addListener(reading => this.sample(reading));
    this.noDataTimer = setInterval(() => {
      if (!this.active) return;
      const silence = this.now() - (this.lastTime ?? this.started);
      if (silence > 2000) this.onStatus({state:'no-readings'});
      else if (!this.automatic.read(this.now() / 1000).ready) {
        this.delivery.suspend(); this.paddle.reset();
        this.onStatus({state:'warming'});
      }
    }, 250);
  }

  sample(reading) {
    if (!this.active) return;
    const time = this.now();
    const sample = normalizeNativeGyroscope(reading, {
      timeSeconds: time / 1000, sequence: this.sequence++,
      screenAngle: this.device?.orientation ?? 0, calibrationRevision: this.revision,
    });
    if (!sample) return;
    this.samples++;
    if (this.lastTime !== null) this.largestGap = Math.max(this.largestGap, time - this.lastTime);
    this.lastTime = time;
    if (this.device && time - this.deviceReceived < 100) {
      Object.assign(sample, nativeDeviceMotionFields(this.device));
    }
    const seat = this.session.seat;
    const safeBoundary = !this.session.playing() ||
      (seat?.sport === 'bowling' && seat.gameState?.phase === 'ready' && this.delivery.phase !== 'forward') ||
      (seat?.sport === 'table-tennis' && seat.gameState?.phase !== 'rally');
    const status = this.automatic.push(sample, {safeBoundary,recenter:safeBoundary});
    this.calibration = status.calibration;
    if (!status.ready) {
      this.delivery.suspend(); this.paddle.reset();
      if (time - this.lastUi > 100) {this.lastUi = time; this.onStatus({state:'warming'});}
      return;
    }
    if (status.justReady) this.onStatus({state:'ready'});
    const corrected = status.sample;
    if (this.session.inputSetup !== 'motion') return;
    if (this.session.seat?.sport === 'bowling') {
      const legacy = toLegacyMotionSample(corrected);
      if (this.delivery.lockedAim === null) {
        const tilt = bowlingTiltAim(nativeBowlingSupportVector(corrected.gravity), Math.hypot(legacy.rotationAlpha, legacy.rotationBeta, legacy.rotationGamma));
        if (tilt !== null) this.aim = this.filter.push(tilt, corrected.timeSeconds);
      }
      const turnKey = this.session.bowlingTurnKey;
      const active = this.session.playing() && seat.gameState?.phase === 'ready' &&
        seat.gameState?.currentPlayer === seat.slot + 1 && this.session.bowlingReleasedTurn !== turnKey;
      const release = this.delivery.push(legacy, {active,turnKey,aim:this.aim});
      this.session.latest('aim', {aim:this.delivery.lockedAim ?? this.aim,locked:this.delivery.lockedAim !== null});
      if (release) {this.session.bowlingReleasedTurn = turnKey; this.onRelease(release);}
    } else if (this.session.seat?.sport === 'table-tennis') {
      const intent = this.paddle.push(corrected);
      if (intent) {
        const { orientation, angularVelocity, reach, calibrationRevision } = intent;
        this.session.latest('pose', { orientation, angularVelocity, reach, calibrationRevision });
      }
    }
    if (time - this.lastUi > 100) {
      this.lastUi = time;
      this.onStatus({ state: 'ready', aim: this.aim, delivery:this.delivery.phase,
        achievedHz: this.samples / Math.max(.001, (time - this.started) / 1000), largestGapMs: this.largestGap });
    }
  }

  resetInput() { this.delivery.suspend(); this.paddle.reset(); this.aim = 0; this.filter.reset(0); }
  allowNewDelivery() { this.delivery = createBowlingDeliveryGate(); }
  recenter() { this.resetInput(); this.automatic.reset(); }
  stop() {
    this.attempt++;
    this.active = false;
    this.delivery.suspend();
    this.deviceSubscription?.remove(); this.deviceSubscription = null;
    this.gyroSubscription?.remove(); this.gyroSubscription = null;
    clearInterval(this.noDataTimer);
    this.device = null;
    this.automatic.reset();
    this.paddle.reset();
  }
}
