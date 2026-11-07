import {createWebMotionAdapter} from '../controller/webMotionAdapter.js';
import {createTableTennisControllerSession} from './controllerSession.js';
import './controller.css';

const $ = id => document.getElementById(id);
const embedded = window.parent !== window && new URLSearchParams(location.search).has('lobby');
const post = message => { if (embedded) window.parent.postMessage(message, location.origin); };
let attempt = 0, lastParentIntent = null, pendingRecenter = null, commandSequence = 0;
let haptics = true, notice = '', noticeUntil = 0, motionStartedAt = null, motionAcquired = false;
let frameTime = 0;
const session = createTableTennisControllerSession({send(message) {
  post(message);
  if (!embedded && message.type === 'wee:controller-setup') {
    queueMicrotask(() => session.acknowledge(message.requestId, {ok: true}));
  }
}, onChange: render});

function render() {
  const state = session.state;
  if (state.mode === 'motion' && state.motionReady) motionAcquired = true;
  let title = 'Ready to rally', cue = state.mode === 'touch' ? 'Slide to aim. Tap to return.' : 'Swing to return';
  let label = state.mode === 'touch' ? 'Touch controls' : state.setup ? 'Motion on' : 'Getting ready…';
  if (state.suspended) {title = 'See you in a moment'; cue = 'Your paddle pauses with this screen.'; label = 'Paused';}
  else if (!state.connected && embedded) {title = 'Reconnecting…'; cue = 'Keep this page open.'; label = 'Connecting';}
  else if (state.playing && state.paused) {title = 'Hang tight'; cue = 'Watch the TV. Play will resume here.'; label = 'Paused';}
  else if (state.phase === 'complete') {title = 'Good game!'; cue = 'See the score on the TV.'; label = 'Finished';}
  else if (!state.mode) {title = 'Your phone. Your paddle.'; cue = 'Tap Play, then watch the TV.'; label = 'Let’s play';}
  else if (!state.setup) {title = 'Getting ready…'; cue = 'Pick up your phone. We’ll do the rest.';}
  else if (!state.playing) {title = 'You’re in'; cue = 'Watch the TV. The game starts together.';}
  if (state.setupError) {title = 'Let’s reconnect'; cue = 'Tap Play to try again, or use touch.'; label = 'Connection interrupted';}
  $('tt-title').textContent = title;
  $('tt-cue').textContent = cue;
  $('tt-phone-status').textContent = label;
  $('tt-enable-motion').hidden = Boolean(state.mode) && !state.setupError;
  $('tt-use-touch').textContent = state.mode === 'touch' ? 'Use motion' : 'Use touch';
  $('tt-use-touch').hidden = false;
  $('tt-touch').hidden = state.mode !== 'touch';
  $('tt-illustration').hidden = state.mode === 'touch';
  $('tt-options').hidden = !state.mode;
  $('tt-touch-stroke').disabled = !session.canSend;
  for (const id of ['tt-practice-phone', 'tt-match-phone', 'tt-recenter-phone']) $(id).disabled = !session.canSend;
  const showNotice = notice && performance.now() < noticeUntil;
  $('tt-notice').textContent = showNotice ? notice : '';
  $('tt-notice').hidden = !showNotice;
  $('tt-touch-paddle').style.left = `${(state.reach.x + 1) * 50}%`;
  $('tt-touch-paddle').style.top = `${(1 - state.reach.y) * 50}%`;
  $('tt-touchpad').setAttribute('aria-valuenow', Math.round(state.reach.x * 100));
}
function showNotice(message, duration = 3500) {notice = message; noticeUntil = performance.now() + duration; render();}

const adapter = createWebMotionAdapter({
  onSample(sample) {session.sample(sample);},
  onReset(reason) {
    if (['hidden', 'pagehide'].includes(reason)) session.suspend();
    else if (['visible', 'pageshow'].includes(reason)) session.resume();
    else if (reason === 'screen-rotation') session.resetMotion();
  },
});

function useTouch(message = '') {
  attempt++; session.select('touch'); adapter.stop();
  if (message) showNotice(message, 5000);
}
async function useMotion({requestPermission = true} = {}) {
  const current = ++attempt;
  motionAcquired = false; motionStartedAt = null; session.select('motion');
  // Call start directly on a user's tap when a browser prompt is necessary.
  try {
    await adapter.start({requestPermission});
    if (current !== attempt || session.state.mode !== 'motion') return;
    motionStartedAt = performance.now();
  } catch {
    if (current === attempt) useTouch('Motion is off. You can play by touch.');
  }
}
$('tt-enable-motion').onclick = () => session.state.mode === 'touch' ? useTouch() : useMotion();
$('tt-use-touch').onclick = () => session.state.mode === 'touch' ? useMotion() : useTouch();

function command(action) {
  const state = session.state;
  if (!state.gameId || !session.canSend) return null;
  const id = `tt-${Date.now().toString(36)}-${commandSequence++}`;
  post({type: 'wee:player-game-command', command: {id, gameId: state.gameId, action}});
  return id;
}
$('tt-practice-phone').onclick = () => command('practice-start');
$('tt-match-phone').onclick = () => command('practice-stop');
$('tt-recenter-phone').onclick = () => {
  if (!['ready', 'complete'].includes(session.state.phase)) {showNotice('We can center your paddle after this point.'); return;}
  pendingRecenter = command('recenter');
  if (!embedded) session.recenter();
};
$('tt-touch-stroke').onclick = () => session.stroke(performance.now() / 1000);
function moveTouch(event) {
  const rect = $('tt-touchpad').getBoundingClientRect();
  session.move((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
}
$('tt-touchpad').onpointerdown = event => {
  $('tt-touchpad').setPointerCapture(event.pointerId); moveTouch(event);
};
$('tt-touchpad').onpointermove = event => {
  if ($('tt-touchpad').hasPointerCapture(event.pointerId)) moveTouch(event);
};
$('tt-touchpad').onpointerup = event => {
  if (!$('tt-touchpad').hasPointerCapture(event.pointerId)) return;
  moveTouch(event); session.stroke(performance.now() / 1000);
  $('tt-touchpad').releasePointerCapture(event.pointerId);
};
$('tt-touchpad').onpointercancel = event => {
  if ($('tt-touchpad').hasPointerCapture(event.pointerId)) $('tt-touchpad').releasePointerCapture(event.pointerId);
};
$('tt-touchpad').onkeydown = event => {
  if (event.key === ' ' || event.key === 'Enter') {event.preventDefault(); session.stroke(performance.now() / 1000); return;}
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const {x, y} = session.state.reach;
  session.move(x + (event.key === 'ArrowRight' ? .1 : event.key === 'ArrowLeft' ? -.1 : 0),
    y + (event.key === 'ArrowUp' ? .1 : event.key === 'ArrowDown' ? -.1 : 0));
};

window.addEventListener('message', event => {
  if (!embedded || event.origin !== location.origin || event.source !== window.parent) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'table-tennis') session.lobby(data);
  else if (data?.type === 'wee:controller-intent' && ['motion', 'touch'].includes(data.mode)) {
    const key = `${data.mode}:${data.permission}`;
    if (lastParentIntent === key) return;
    lastParentIntent = key;
    if (session.state.mode === data.mode) return;
    if (data.mode === 'motion' && data.permission === 'granted') void useMotion({requestPermission: false});
    else useTouch(data.permission === 'denied' ? 'Motion is off. You can play by touch.' : '');
  } else if (data?.type === 'wee:setup-ack') session.acknowledge(data.requestId, data.result);
  else if (data?.type === 'wee:table-tennis-state' && data.gameId === session.state.gameId) {
    session.setPhase(data.phase); render();
  } else if (data?.type === 'wee:game-command-result' && data.id === pendingRecenter) {
    if (data.result?.ok && session.recenter()) showNotice('Paddle centered.');
    else showNotice('We can center your paddle after this point.');
    pendingRecenter = null;
  } else if (data?.type === 'wee:profile-preferences') {
    const preferences = data.preferences;
    if (!preferences || typeof preferences !== 'object') return;
    if (!session.state.mode) session.configure({hand: preferences.hand === 'Left' ? 'Left' : 'Right', sensitivity: preferences.sensitivity});
    if (typeof preferences.haptics === 'boolean') haptics = preferences.haptics;
  } else if (data?.type === 'wee:game-hit' && data.kind === 'table-tennis') {
    showNotice('Nice contact!', 700);
    if (haptics) navigator.vibrate?.(12);
  }
});

document.addEventListener('visibilitychange', () => document.hidden ? session.suspend() : session.resume());
window.addEventListener('pagehide', () => session.suspend());
window.addEventListener('pageshow', () => session.resume());
function frame(now) {
  // rAF's frame timestamp can precede a sensor callback already delivered in
  // this turn. Freshness must use the same receipt clock as the motion adapter.
  session.frame(performance.now() / 1000);
  if (session.state.mode === 'motion' && motionStartedAt !== null && !motionAcquired && !document.hidden &&
      now - motionStartedAt > 3000) useTouch('Motion isn’t available here. Touch controls are ready.');
  if (now - frameTime > 500) {frameTime = now; render();}
  requestAnimationFrame(frame);
}
if (typeof ResizeObserver !== 'undefined') {
  const content = document.querySelector('.tt-phone');
  new ResizeObserver(() => post({type: 'wee:controller-height', height: Math.ceil(content.getBoundingClientRect().height) + 2})).observe(content);
}
if (!embedded) session.lobby({connected: true, playing: true, paused: false, gameId: 'standalone', generation: 0});
render();
post({type: 'wee:bridge-ready'});
requestAnimationFrame(frame);
