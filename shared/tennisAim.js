import {createPaddleIntentController, isMotionSample} from './motion.js';

/** Capture pointing before the fast part of a swing, not its follow-through.
 * Rotation supplies bounded placement; it does not measure hand position. */
export function createTennisAim({sensitivity = 1} = {}) {
  const paddle = createPaddleIntentController({sensitivity});
  let live = {aim: 0, depth: 0}, captured = {...live}, turningFast = false;
  let previous = null;
  const reset = () => {paddle.reset(); live = captured = {aim:0,depth:0}; turningFast = false; previous = null;};
  return {
    reset,
    push(sample) {
      if (!isMotionSample(sample) || !sample.angularVelocity) {reset(); return null;}
      const pose = paddle.push(sample);
      if (!pose) return null;
      const continuous = previous && sample.timeSeconds - previous.timeSeconds <= .15 &&
        sample.screenAngle === previous.screenAngle && sample.calibrationRevision === previous.calibrationRevision;
      if (!continuous) {live = captured = {aim:0,depth:0}; turningFast = false;}
      // Gesture thresholds use physical rad/s, independent of aim sensitivity.
      const speed = Math.hypot(...Object.values(sample.angularVelocity));
      if (speed >= 1.1 && !turningFast) {captured = {...live}; turningFast = true;}
      if (speed < .7) turningFast = false;
      if (!turningFast) live = {aim: pose.reach.x, depth: pose.reach.y};
      previous = sample;
      return {...live};
    },
    capture() {return {...captured};},
  };
}
