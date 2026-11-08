import {createAutomaticMotionSetup, createPaddleIntentController} from '../../shared/motion.js';
import {createDiagnostics} from '../../shared/diagnostics.js';

// A 60 Hz target with room for sub-millisecond browser scheduling jitter.
// Latest state is coalesced, never buffered for a later catch-up burst.
const POSE_INTERVAL_SECONDS = .012;

/** Touch input has no sensor callback. Keep its heartbeat and short pulse on a
 * bounded timer so a busy TV/compositor cannot swallow it between display
 * frames. Lifecycle and setup checks still belong to the session. */
export function createTableTennisTouchPump(session, {now = () => performance.now() / 1000,
  schedule = callback => setInterval(callback, 16), cancel = id => clearInterval(id)} = {}) {
  let timer = null;
  return {
    start() {
      if (timer !== null) return;
      timer = schedule(() => { if (session.state.mode === 'touch') session.frame(now()); });
    },
    stop() { if (timer !== null) {cancel(timer); timer = null;} },
  };
}

/** Owns freshness and acknowledged readiness; browser permission alone never
 * makes a motion controller playable. No DOM or sensor APIs live here. */
export function createTableTennisControllerSession({send = () => {}, onChange = () => {}, diagnostics = createDiagnostics(), player = 1} = {}) {
  const automatic = createAutomaticMotionSetup();
  let paddle = createPaddleIntentController();
  let playingHand = 'Right';
  let mode = null, connected = false, playing = false, paused = true, suspended = false;
  let phase = 'ready', accepted = null, requested, pending = null, setupId = 0;
  let clock = 0, setupSentAt = 0, retryAfter = Infinity;
  let latest = null, corrected = null, motionReady = false, setupError = false;
  let neutralPose = true;
  let sentSampleSequence = null;
  let gameId = null, generation = null, sequence = 0, lastSent = -Infinity, strokeUntil = 0, touchRevision = 1;
  let reach = {x: 0, y: 0};
  let diagnosticSampleTime = null;
  const changed = () => onChange(api.state);
  const expected = () => mode === 'touch' ? 'buttons' : mode === 'motion' && motionReady ? 'motion' : null;
  function setup(value, force = false, reason) {
    if (!force && requested === value) return;
    requested = value; accepted = null; setupError = false;
    pending = ++setupId;
    setupSentAt = clock; retryAfter = Infinity;
    send({type: 'wee:controller-setup', setup: value, requestId: pending, ...(reason ? {reason} : {})});
  }
  function clearMotion() {
    automatic.reset(); paddle.reset(); latest = corrected = null; motionReady = false; strokeUntil = 0; neutralPose = true; sentSampleSequence = null;
  }
  function invalidate(reason) {
    clearMotion(); setup(null, Boolean(reason), reason); changed();
  }
  const api = {
    get state() {return {mode, connected, playing, paused, suspended, setup: accepted, pending: pending !== null,
      setupError, motionReady, phase, gameId, reach: {...reach}};},
    configure({hand, sensitivity} = {}) {
      // Profile reads can finish after the parent starts motion. Handedness
      // describes the next stroke without changing the current paddle setup.
      if (hand === 'Left' || hand === 'Right') playingHand = hand;
      if (mode) return;
      paddle = createPaddleIntentController({hand: playingHand, sensitivity});
    },
    select(next, {announce = true} = {}) {
      if (!['motion', 'touch'].includes(next)) return;
      const switched = mode !== next;
      mode = next; touchRevision++; clearMotion();
      if (switched && announce) send({type: 'wee:controller-mode', mode});
      setup(suspended ? null : expected(), true); changed();
    },
    sample(sample) {
      if (mode !== 'motion' || suspended) return;
      if (diagnostics.enabled && Number.isFinite(sample?.timeSeconds)) {
        diagnostics.count('sensorSamples');
        if (diagnosticSampleTime !== null) diagnostics.observe('sensorIntervalMs', (sample.timeSeconds - diagnosticSampleTime) * 1000);
        diagnosticSampleTime = sample.timeSeconds;
      }
      // A player can deliberately hold a target between points. Bias updates
      // change the calibration revision, so keep this frame fixed throughout
      // play; learn quiet bias in the lobby/countdown or while paused instead.
      const value = automatic.push(sample, {safeBoundary: !playing || paused});
      if (!value.ready || !value.sample) {
        if (motionReady) {motionReady = false; paddle.reset(); latest = corrected = null; neutralPose = true; setup(null); changed();}
        return;
      }
      corrected = value.sample;
      if (latest && latest.sequence !== sentSampleSequence) diagnostics.count('posesCoalesced');
      latest = paddle.push(corrected);
      if (!motionReady) {motionReady = true; setup('motion'); changed();}
      // Send fresh input on receipt instead of first waiting for the display's
      // animation frame. frame() still flushes a coalesced sample and watches
      // freshness when sensor delivery stops.
      return api.frame(sample.timeSeconds);
    },
    acknowledge(requestId, result) {
      if (requestId !== pending) return;
      pending = null;
      accepted = result?.ok && !suspended && requested === expected() ? requested : null;
      setupError = result?.ok !== true;
      if (setupError) retryAfter = clock + 1;
      changed();
    },
    lobby(value) {
      const reconnected = !connected && value.connected;
      const interrupted = connected && !value.connected;
      const newGame = gameId !== value.gameId;
      const newBoundary = newGame || generation !== value.generation || paused !== Boolean(value.paused);
      gameId = value.gameId; generation = value.generation;
      connected = value.connected === true; playing = value.playing === true; paused = value.paused === true;
      if (newGame || !playing) phase = 'ready';
      if (newBoundary) {latest = null; paddle.reset(); strokeUntil = 0; neutralPose = true; sentSampleSequence = null;}
      if (interrupted && mode === 'motion') clearMotion();
      if (reconnected && mode) setup(suspended ? null : expected(), true);
      changed();
    },
    setPhase(value) {phase = value;},
    suspend() {if (!suspended) {suspended = true; invalidate('background');}},
    resume() {
      if (!suspended) return;
      suspended = false; clearMotion(); setup(expected(), true); changed();
    },
    resetMotion() {if (mode === 'motion') invalidate('reset');},
    recenter() {
      if (phase !== 'ready' && phase !== 'complete') return false;
      if (corrected) paddle.recenter(corrected);
      latest = null; strokeUntil = 0; neutralPose = true; reach = {x: 0, y: 0}; touchRevision++; changed();
      return true;
    },
    move(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      reach = {x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y))}; changed();
    },
    stroke(now) {
      if (mode !== 'touch' || !api.canSend || !Number.isFinite(now)) return;
      strokeUntil = now + .24;
    },
    get canSend() {return connected && playing && !paused && !suspended && accepted !== null && accepted === expected() && pending === null;},
    frame(now) {
      if (!Number.isFinite(now)) return null;
      clock = now;
      if (connected && !suspended && mode && (pending !== null && now - setupSentAt > 6 || setupError && now >= retryAfter)) setup(expected(), true);
      if (mode === 'motion' && motionReady && !automatic.read(now).ready) invalidate();
      if (!api.canSend || !Number.isFinite(now) || now - lastSent < POSE_INTERVAL_SECONDS - 1e-9) return null;
      let value = latest;
      if (mode === 'touch') {
        const pulse = now < strokeUntil ? Math.sin((.24 - strokeUntil + now) / .24 * Math.PI) : 0;
        value = {orientation: [0, 0, 0, 1], angularVelocity: {x: Math.max(0, pulse) * 12, y: 0, z: 0}, reach, calibrationRevision: touchRevision};
      }
      if (!value || mode === 'motion' && (now < value.sampleTime || now - value.sampleTime > .12)) return null;
      if (mode === 'motion' && value.sequence === sentSampleSequence) return null;
      const event = {seq: sequence++, hand: playingHand, orientation: value.orientation,
        angularVelocity: mode === 'motion' && neutralPose ? {x: 0, y: 0, z: 0} : value.angularVelocity,
        reach: {...value.reach}, calibrationRevision: value.calibrationRevision};
      neutralPose = false;
      if (mode === 'motion') sentSampleSequence = value.sequence;
      lastSent = now;
      diagnostics.count('posesSent'); diagnostics.mark(`p${player}.pose.${event.seq}`, 'poseSend');
      if (mode === 'motion') diagnostics.observe('sampleReceiptToSendMs', (now - value.sampleTime) * 1000);
      send({type: 'wee:player-pose', event});
      return event;
    },
  };
  return api;
}
