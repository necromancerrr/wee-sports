import {createAutomaticMotionSetup, createPaddleIntentController} from '../../shared/motion.js';

/** Owns freshness and acknowledged readiness; browser permission alone never
 * makes a motion controller playable. No DOM or sensor APIs live here. */
export function createTableTennisControllerSession({send = () => {}, onChange = () => {}} = {}) {
  const automatic = createAutomaticMotionSetup();
  let paddle = createPaddleIntentController();
  let mode = null, connected = false, playing = false, paused = true, suspended = false;
  let phase = 'ready', accepted = null, requested, pending = null, setupId = 0;
  let latest = null, corrected = null, motionReady = false, setupError = false;
  let neutralPose = true;
  let gameId = null, generation = null, sequence = 0, lastSent = -Infinity, strokeUntil = 0, touchRevision = 1;
  let reach = {x: 0, y: 0};
  const changed = () => onChange(api.state);
  const expected = () => mode === 'touch' ? 'buttons' : mode === 'motion' && motionReady ? 'motion' : null;
  function setup(value, force = false) {
    if (!force && requested === value) return;
    requested = value; accepted = null; setupError = false;
    pending = ++setupId;
    send({type: 'wee:controller-setup', setup: value, requestId: pending});
  }
  function clearMotion() {
    automatic.reset(); paddle.reset(); latest = corrected = null; motionReady = false; strokeUntil = 0; neutralPose = true;
  }
  function invalidate() {
    clearMotion(); setup(null); changed();
  }
  const api = {
    get state() {return {mode, connected, playing, paused, suspended, setup: accepted, pending: pending !== null,
      setupError, motionReady, phase, gameId, reach: {...reach}};},
    configure({hand, sensitivity} = {}) {
      if (mode) return;
      paddle = createPaddleIntentController({hand, sensitivity});
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
      const value = automatic.push(sample, {safeBoundary: !playing || paused || phase === 'ready' || phase === 'complete'});
      if (!value.ready || !value.sample) {
        if (motionReady) {motionReady = false; paddle.reset(); latest = corrected = null; neutralPose = true; setup(null); changed();}
        return;
      }
      corrected = value.sample;
      latest = paddle.push(corrected);
      if (!motionReady) {motionReady = true; setup('motion'); changed();}
    },
    acknowledge(requestId, result) {
      if (requestId !== pending) return;
      pending = null;
      accepted = result?.ok && !suspended && requested === expected() ? requested : null;
      setupError = result?.ok !== true;
      changed();
    },
    lobby(value) {
      const reconnected = !connected && value.connected;
      const interrupted = connected && !value.connected;
      const newBoundary = gameId !== value.gameId || generation !== value.generation || paused !== Boolean(value.paused);
      gameId = value.gameId; generation = value.generation;
      connected = value.connected === true; playing = value.playing === true; paused = value.paused === true;
      if (newBoundary) {latest = null; paddle.reset(); strokeUntil = 0; neutralPose = true;}
      if (interrupted && mode === 'motion') clearMotion();
      if (reconnected && mode) setup(suspended ? null : expected(), true);
      changed();
    },
    setPhase(value) {phase = value;},
    suspend() {if (!suspended) {suspended = true; invalidate();}},
    resume() {
      if (!suspended) return;
      suspended = false; clearMotion(); setup(expected(), true); changed();
    },
    resetMotion() {if (mode === 'motion') invalidate();},
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
      if (mode === 'motion' && motionReady && !automatic.read(now).ready) invalidate();
      if (!api.canSend || !Number.isFinite(now) || now - lastSent < 1 / 30) return null;
      let value = latest;
      if (mode === 'touch') {
        const pulse = now < strokeUntil ? Math.sin((.24 - strokeUntil + now) / .24 * Math.PI) : 0;
        value = {orientation: [0, 0, 0, 1], angularVelocity: {x: Math.max(0, pulse) * 12, y: 0, z: 0}, reach, calibrationRevision: touchRevision};
      }
      if (!value || mode === 'motion' && (now < value.sampleTime || now - value.sampleTime > .12)) return null;
      const event = {seq: sequence++, orientation: value.orientation,
        angularVelocity: mode === 'motion' && neutralPose ? {x: 0, y: 0, z: 0} : value.angularVelocity,
        reach: {...value.reach}, calibrationRevision: value.calibrationRevision};
      neutralPose = false;
      lastSent = now;
      send({type: 'wee:player-pose', event});
      return event;
    },
  };
  return api;
}
