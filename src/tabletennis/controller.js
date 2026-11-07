import {createWebMotionAdapter} from '../controller/webMotionAdapter.js';
import {createMotionCalibration, applyMotionCalibration, createPaddleIntentController} from '../../shared/motion.js';
import './controller.css';

const $ = id => document.getElementById(id);
const embedded = window.parent !== window && new URLSearchParams(location.search).has('lobby');
const post = message => { if (embedded) window.parent.postMessage(message, location.origin); };
let gameId = null, connected = !embedded, playing = !embedded, paused = embedded;
let setup = null, calibration = null, calibrator = null, latestSample = null, latestIntent = null;
let sequence = 0, revision = 0, lastSent = 0, mode = null, strokeUntil = 0;
let generation = null, phase = 'ready', pendingRecenter = null, setupPending = false, directionStage = 0;
let haptics = true;
let intent = createPaddleIntentController();
const reach = {x: 0, y: 0};
const status = message => { $('tt-phone-status').textContent = message; };
const controls = ['tt-feed-phone', 'tt-recenter-phone', 'tt-practice-phone', 'tt-match-phone'];
const enableControls = () => { for (const id of controls) $(id).disabled = !setup || !playing || paused || !connected; };

function reportSetup(value) {
  setupPending = true;
  post({type: 'wee:controller-setup', setup: value});
  if (!embedded) { setup = value; setupPending = false; }
  enableControls();
}

const adapter = createWebMotionAdapter({
  calibrationRevision: () => revision,
  onSample(sample) {
    latestSample = sample;
    if (calibrator) {
      const result = calibrator.push(sample);
      $('tt-calibration').value = result.progress;
      if (result.state === 'done') {
        calibration = result.calibration; calibrator = null;
        intent.reset();
        $('tt-calibration').hidden = true;
        directionStage = 1;
        status('Grip saved. Gently tilt one way, then the other to check paddle direction.');
      } else status(result.state === 'moving' ? 'Hold still in your paddle grip…' : 'Checking your grip…');
    }
    if (!calibration) return;
    const corrected = applyMotionCalibration(sample, calibration);
    if (!corrected) { invalidate('Screen orientation changed. Check your grip again.'); return; }
    latestIntent = intent.push(corrected);
    if (latestIntent && directionStage) {
      if (directionStage === 1 && Math.abs(latestIntent.reach.x) > .15) {
        directionStage = latestIntent.reach.x > 0 ? 2 : 3;
        status('Now tilt gently the other way.');
      } else if ((directionStage === 2 && latestIntent.reach.x < -.15) ||
        (directionStage === 3 && latestIntent.reach.x > .15)) {
        directionStage = 0; reportSetup('motion');
        status('Grip and direction checked. Press Ready above.');
      }
    }
  },
  onReset(reason) {
    intent.reset(); latestIntent = null;
    if (['hidden', 'pagehide', 'screen-rotation'].includes(reason)) invalidate('Motion paused. Tap Enable motion to check your grip again.');
  },
});

function invalidate(message) {
  calibration = null; calibrator = null; setup = null; latestIntent = null; directionStage = 0;
  post({type: 'wee:controller-setup', setup: null});
  status(message); enableControls();
}

$('tt-enable-motion').onclick = async () => {
  mode = 'motion';
  revision++;
  latestSample = null; directionStage = 0;
  calibration = null;
  calibrator = createMotionCalibration({revision});
  intent.reset(); setup = null; latestIntent = null;
  $('tt-calibration').hidden = false; $('tt-calibration').value = 0;
  $('tt-touch').hidden = true;
  status('Hold still in a comfortable paddle grip…');
  try {
    await adapter.start();
    window.setTimeout(() => {
      if (mode === 'motion' && !latestSample && !calibration) status('No motion readings arrived. Try touch controls or check sensor permissions.');
    }, 3000);
  } catch (error) {
    calibrator = null; $('tt-calibration').hidden = true;
    status(error.message);
  }
};
$('tt-use-touch').onclick = () => {
  adapter.stop(); mode = 'touch'; calibration = null; calibrator = null; directionStage = 0; intent.reset();
  $('tt-calibration').hidden = true; $('tt-touch').hidden = false;
  reportSetup('buttons'); status('Touch paddle ready. Press Ready above, then slide and stroke.');
};

function command(action, extras = {}) {
  if (!gameId || !connected || !playing || paused) return null;
  const id = `tt-${Date.now().toString(36)}-${sequence++}`;
  post({type: 'wee:player-game-command', command: {id, gameId, action, ...extras}});
  return id;
}
$('tt-feed-phone').onclick = () => command('feed');
$('tt-practice-phone').onclick = () => command('practice-start');
$('tt-match-phone').onclick = () => command('new-match');
$('tt-recenter-phone').onclick = () => {
  if (phase !== 'ready' && phase !== 'complete') { status('Recenter between points, after the ball stops.'); return; }
  pendingRecenter = command('recenter');
  if (!embedded && latestSample && calibration) intent.recenter(applyMotionCalibration(latestSample, calibration));
};
$('tt-touch-stroke').onclick = () => { strokeUntil = performance.now() + 240; };
function moveTouch(event) {
  const rect = $('tt-touchpad').getBoundingClientRect();
  reach.x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
  reach.y = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
  renderTouch();
}
function renderTouch() {
  $('tt-touch-paddle').style.left = `${(reach.x + 1) * 50}%`;
  $('tt-touch-paddle').style.top = `${(1 - reach.y) * 50}%`;
  $('tt-touchpad').setAttribute('aria-valuenow', Math.round(reach.x * 100));
}
$('tt-touchpad').onpointerdown = event => { $('tt-touchpad').setPointerCapture(event.pointerId); moveTouch(event); };
$('tt-touchpad').onpointermove = event => { if ($('tt-touchpad').hasPointerCapture(event.pointerId)) moveTouch(event); };
$('tt-touchpad').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft') reach.x = Math.max(-1, reach.x - .1);
  if (event.key === 'ArrowRight') reach.x = Math.min(1, reach.x + .1);
  if (event.key === 'ArrowUp') reach.y = Math.min(1, reach.y + .1);
  if (event.key === 'ArrowDown') reach.y = Math.max(-1, reach.y - .1);
  renderTouch();
};

window.addEventListener('message', event => {
  if (!embedded || event.origin !== location.origin || event.source !== window.parent) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'table-tennis') {
    if (gameId !== data.gameId || generation !== data.generation) {
      latestIntent = null; intent.reset(); strokeUntil = 0;
    }
    gameId = data.gameId; generation = data.generation;
    connected = data.connected; playing = data.playing; paused = data.paused;
    if (!connected) status('Connection lost. Input stops until the session returns.');
    else if (paused) status('Game paused. Your paddle will resume with fresh input.');
    else if (setup && playing) status(mode === 'touch' ? 'Slide to aim. Tap Stroke as the ball reaches you.' : 'Tilt and use compact strokes.');
    enableControls();
  } else if (data?.type === 'wee:setup-ack') {
    setupPending = false;
    if (data.result?.ok) setup = mode === 'motion' && calibration ? 'motion' : mode === 'touch' ? 'buttons' : null;
    else status('Controller setup was not accepted. Choose your controls again.');
    enableControls();
  } else if (data?.type === 'wee:table-tennis-state' && data.gameId === gameId) {
    phase = data.phase;
  } else if (data?.type === 'wee:game-command-result' && data.id === pendingRecenter) {
    if (data.result?.ok) {
      if (latestSample && calibration) intent.recenter(applyMotionCalibration(latestSample, calibration));
      reach.x = reach.y = 0; renderTouch(); latestIntent = null; status('Paddle centered.');
    } else status('Wait until the point ends before recentering.');
    pendingRecenter = null;
  } else if (data?.type === 'wee:profile-preferences' && !mode) {
    const prefs = data.preferences;
    if (!prefs || typeof prefs !== 'object') return;
    intent = createPaddleIntentController({hand: prefs.hand === 'Left' ? 'Left' : 'Right',
      sensitivity: Number.isFinite(prefs.sensitivity) ? Math.max(.25, Math.min(2, prefs.sensitivity)) : 1});
    haptics = prefs.haptics !== false;
    if (prefs.touchControls) status('Your saved preference is touch controls. Choose Use touch controls to get ready.');
  } else if (data?.type === 'wee:game-hit' && data.kind === 'table-tennis') {
    status('Ball contact — nice return');
    if (haptics) navigator.vibrate?.(12);
  }
});

function stream(now) {
  if (setup && !setupPending && playing && connected && !paused && !document.hidden && now - lastSent >= 1000 / 30) {
    let sample = latestIntent;
    if (mode === 'touch') {
      const tilt = Number($('tt-face').value);
      const pulse = now < strokeUntil ? Math.sin((240 - strokeUntil + now) / 240 * Math.PI) : 0;
      sample = {orientation: [0, Math.sin(tilt / 2), 0, Math.cos(tilt / 2)], angularVelocity: {x: pulse * 12, y: 0, z: 0}, reach: {...reach}, calibrationRevision: revision};
    }
    if (sample && (mode === 'touch' || now / 1000 - sample.sampleTime <= .15)) {
      post({type: 'wee:player-pose', event: {seq: sequence++, orientation: sample.orientation,
        angularVelocity: sample.angularVelocity, reach: sample.reach, calibrationRevision: sample.calibrationRevision}});
      lastSent = now;
    }
  }
  requestAnimationFrame(stream);
}
new ResizeObserver(() => post({type: 'wee:controller-height', height: document.documentElement.scrollHeight})).observe(document.body);
window.addEventListener('pagehide', () => adapter.stop());
post({type: 'wee:bridge-ready'});
requestAnimationFrame(stream);
