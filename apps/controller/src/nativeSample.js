import { isVector3 } from '../../../shared/motion.js';

const axes = ['x', 'y', 'z'];
const copy = vector => Object.fromEntries(axes.map(axis => [axis, vector[axis]]));

/** Expo 58 returns gravity-down on both platforms. iOS adds CoreMotion.gravity
 * to userAcceleration; Android subtracts twice TYPE_GRAVITY from its raw
 * accelerometer. Keep that physical direction in canonical native samples.
 * Native DeviceMotion rotationRate is deliberately unused: its iOS and Android
 * implementations name the angular axes differently. Gyroscope supplies XYZ.
 */
export function nativeDeviceMotionFields(reading) {
  const result = {};
  if (isVector3(reading?.acceleration)) result.acceleration = copy(reading.acceleration);
  if (isVector3(reading?.accelerationIncludingGravity)) result.accelerationIncludingGravity = copy(reading.accelerationIncludingGravity);
  if (result.acceleration && result.accelerationIncludingGravity) {
    result.gravity = Object.fromEntries(axes.map(axis => [axis,
      result.accelerationIncludingGravity[axis] - result.acceleration[axis]]));
  }
  return result;
}

/** Bowling's established screen-up aim consumes a support/up vector. This is
 * an explicit adapter conversion, not a claim that all browser totals agree.
 */
export function nativeBowlingSupportVector(gravity) {
  return isVector3(gravity) ? Object.fromEntries(axes.map(axis => [axis, -gravity[axis] || 0])) : undefined;
}
