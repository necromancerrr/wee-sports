import {TableTennisGame} from './game.js';
import {clamp, v3} from './physics.js';
import {createTableTennisScene} from './scene.js';
import {tableTennisAnnouncement, tableTennisResult} from './presentation.js';
import {createSportsAudio} from '../audio/sportsAudio';
import {browserDiagnostics} from '../../shared/diagnostics.js';
import './style.css';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const embedded = window.parent !== window && params.has('lobby');
const diagnosticsEnabled = params.get('diagnostics') === '1';
document.body.classList.toggle('tt-diagnostics', diagnosticsEnabled);
const diagnostics = browserDiagnostics('game.table-tennis');
const pendingPoseRender = new Map(), activeStrokeTrace = new Map();
const post = message => { if (embedded) window.parent.postMessage(message, location.origin); };
let gameId = null, connected = !embedded, playing = !embedded, generation = null, hostEpoch = null, lastSeq = [-1, -1];
let localPaused = false, lastCheckpoint = '', lastState = '';
let playerName = 'You', opponentName = 'Bot', humanCount = 1, announcedServe = -1, announcementUntil = 0;
const sound = embedded ? null : createSportsAudio('table-tennis');
sound?.mountButton($('tt-sound'));
function audioEvent(event) {
  if (embedded) {
    if (gameId) post({type: 'wee:game-audio', sport: 'table-tennis', gameId, event});
  } else if (event === 'stop') sound?.stop();
  else sound?.play(event);
}
function announce(event) {
  const state = game.snapshot();
  const message = tableTennisAnnouncement(state, event, playerName, opponentName);
  if (!message) return;
  $('tt-announcement-title').textContent = message.title;
  $('tt-announcement-detail').textContent = message.detail;
  $('tt-announcement').dataset.tone = message.tone;
  $('tt-announcement').hidden = false;
  announcementUntil = performance.now() + (state.winner ? 7000 : event.type === 'serve' ? 1150 : 1600);
}
const game = new TableTennisGame({now: () => performance.now() / 1000, onEvent: event => {
  if (diagnostics.enabled && event.type === 'stroke') {
    const id = `p${event.player}.stroke.${event.id}`;
    activeStrokeTrace.set(event.player, {id, gestureId: event.id});
    diagnostics.mark(id, 'accepted'); diagnostics.count('stroke.accepted');
  }
  if (event.type === 'hit') {
    const trace = activeStrokeTrace.get(event.player);
    if (trace && event.gestureId === trace.gestureId) {
      diagnostics.mark(trace.id, 'contact');
      diagnostics.measure(trace.id, 'accepted', 'contact', 'stroke.acceptedToContactMs');
      activeStrokeTrace.delete(event.player);
    }
    if (gameId) post({type: 'wee:game-hit', gameId, player: event.player});
    audioEvent('paddle-hit');
  }
  if (event.type === 'point') {
    const celebrate = game.mode === 'versus' || (game.rules.winner || event.winner) === 1;
    audioEvent(game.rules.winner ? celebrate ? 'match-win' : 'match-lose' : celebrate ? 'point-win' : 'point-lose');
    announce(event);
  } else if (event.type === 'let') { audioEvent('let'); announce(event); }
  if (event.type === 'state' && game.mode !== 'practice' && game.rules.phase === 'serve' && game.rules.pointId !== announcedServe) {
    announcedServe = game.rules.pointId; audioEvent('serve'); announce({type: 'serve'});
  }
  if (['state', 'point', 'let'].includes(event.type)) publish();
}});
game.remote = embedded;
game.paused = embedded;
sound?.setActive(!game.paused);
const handleCollision = game.physics.onEvent;
game.physics.onEvent = event => {
  handleCollision(event);
  if (event.kind === 'bounce') audioEvent('table-bounce');
  else if (event.kind === 'net') audioEvent('net-hit');
};

function publish() {
  const state = game.snapshot();
  const encoded = JSON.stringify(state);
  if (gameId && encoded !== lastState) {
    lastState = encoded;
    post({type: 'wee:table-tennis-state', gameId, phase: state.phase, score: state.score,
      server: state.server, winner: state.winner, practice: state.practice, pointId: String(state.pointId)});
    post({type: 'wee:game-options', gameId, sport: 'table-tennis', settings: {...game.settings}, practice: {active: state.practice}});
  }
  const payload = game.checkpoint();
  const checkpoint = JSON.stringify(payload);
  if (gameId && payload && checkpoint !== lastCheckpoint) {
    lastCheckpoint = checkpoint;
    post({type: 'wee:game-checkpoint', gameId, sport: 'table-tennis', rulesVersion: 1, checkpointVersion: 1, payload});
  }
}

function command(value) {
  if (['new-match', 'practice-stop', 'practice-start', 'recenter'].includes(value.action)) {
    pendingPoseRender.clear(); activeStrokeTrace.clear();
  }
  if (value.action === 'new-match' || value.action === 'practice-stop') { announcedServe = -1; lastCheckpoint = ''; lastState = ''; game.startMatch({players: humanCount}); return true; }
  if (value.action === 'practice-start') { if (humanCount > 1) return false; announcedServe = -1; lastCheckpoint = ''; lastState = ''; game.startPractice(); return true; }
  if (value.action === 'feed') return game.mode === 'practice' ? game.feed() : game.serve();
  if (value.action === 'recenter') return game.recenter();
  if (value.action === 'configure') return game.configure(value.settings);
  return false;
}

window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'table-tennis') {
    humanCount = data.players?.some(player => player.slot === 1) ? 2 : 1;
    opponentName = humanCount === 2 ? data.players.find(player => player.slot === 1)?.name || 'Player 2' : 'Bot';
    if (data.gameId !== gameId) {
      pendingPoseRender.clear(); activeStrokeTrace.clear();
      gameId = data.gameId;
      announcedServe = -1; announcementUntil = 0;
      game.startMatch({players: humanCount});
      game.players[1].remote = humanCount === 2;
      lastState = ''; lastCheckpoint = ''; lastSeq = [-1, -1];
    }
    if (generation !== data.generation || hostEpoch !== data.hostEpoch || data.paused || !data.connected) {
      pendingPoseRender.clear(); activeStrokeTrace.clear();
      lastSeq = [-1, -1];
      for (const player of game.players) player.inputAt = -Infinity;
    }
    playerName = data.players?.find(player => player.slot === 0)?.name || 'You';
    generation = data.generation;
    hostEpoch = data.hostEpoch;
    connected = data.connected;
    playing = data.playing;
    game.paused = Boolean(data.paused || !connected || !playing);
    sound?.setActive(!game.paused);
    if (game.paused) audioEvent('stop');
    publish();
  } else if (data?.type === 'wee:table-tennis-pose' && connected && playing && !game.paused) {
    const input = data.event;
    const player = input?.player;
    if (![1, 2].includes(player) || player > humanCount || input.gameId !== gameId || !Number.isInteger(input.seq) || input.seq <= lastSeq[player - 1] ||
      (generation != null && input.generation !== generation) || (hostEpoch != null && input.hostEpoch !== hostEpoch)) return;
    const id = `p${player}.pose.${input.seq}`;
    diagnostics.mark(id, 'received');
    if (game.setInput(input, {remote: true, player})) {
      lastSeq[player - 1] = input.seq;
      diagnostics.count('pose.accepted');
      if (diagnostics.enabled) {
        if (pendingPoseRender.has(player)) diagnostics.count('pose.coalescedBeforeRender');
        pendingPoseRender.set(player, id);
      }
    } else diagnostics.count('pose.rejected');
  } else if (data?.type === 'wee:game-command' && !game.paused) {
    const value = data.command;
    if (value?.gameId !== gameId) return;
    const ok = command(value);
    post({type: 'wee:game-command-result', id: value.id, gameId, result: {ok, ...(ok ? {} : {error: 'Wait until the point ends'})}});
    publish();
  } else if (data?.type === 'wee:restore-checkpoint') {
    if (data.gameId !== gameId) return;
    const payload = data.payload || data.checkpoint?.payload;
    const ok = game.restore(payload);
    post({type: 'wee:restore-checkpoint-result', gameId, ok, ...(ok ? {} : {error: 'invalid-checkpoint'})});
    if (ok) { pendingPoseRender.clear(); activeStrokeTrace.clear(); lastState = ''; lastCheckpoint = ''; publish(); }
  } else if (data?.type === 'wee:checkpoint-request' && data.gameId === gameId) {
    lastCheckpoint = '';
    publish();
  }
});

const pointer = {x: 0, y: 0};
function localInput() {
  if (!embedded) game.setInput({orientation: [0, 0, 0, 1], angularVelocity: v3(), reach: pointer});
}
function action() {
  if (embedded) return;
  if (game.mode === 'practice' && !game.physics.ball.active) game.feed(); else game.stroke();
}
$('tt-practice').onclick = () => { if (!game.paused) { announcedServe = -1; announcementUntil = 0; game.startPractice($('tt-feed').value); publish(); } };
$('tt-match').onclick = () => { if (!game.paused) { announcedServe = -1; announcementUntil = 0; game.startMatch(); publish(); } };
$('tt-action').onclick = action;
$('tt-recenter').onclick = () => { if (game.recenter()) { pointer.x = 0; pointer.y = 0; } else game.lastReason = 'Recenter between points'; };
$('tt-pause').onclick = () => {
  if (embedded) post({type: 'wee:pause-toggle', gameId});
  else {
    localPaused = !localPaused;
    game.paused = localPaused;
    game.clearStrokeInput();
    sound?.setActive(!localPaused);
  }
};
$('tt-assistance').onchange = () => { game.configure({assistance: $('tt-assistance').value}); publish(); };
$('tt-sensitivity').oninput = () => { game.configure({sensitivity: Number($('tt-sensitivity').value)}); publish(); };
$('tt-feed').onchange = () => game.startPractice($('tt-feed').value);
if (embedded) {
  document.body.classList.add('tt-embedded');
  $('tt-help').textContent = 'Tilt to move the ring. Swing after the bounce.';
  // Embedded matches change rounds through authenticated P1 commands. The
  // standalone diagnostic controls must not reset a durable room locally.
  document.querySelector('.tt-controls').hidden = true;
}
window.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); action(); }
  else if (event.code === 'KeyP') $('tt-pause').click();
  else if (!embedded && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
    event.preventDefault();
    if (event.code === 'ArrowLeft') pointer.x = clamp(pointer.x - .12, -1, 1);
    if (event.code === 'ArrowRight') pointer.x = clamp(pointer.x + .12, -1, 1);
    if (event.code === 'ArrowUp') pointer.y = clamp(pointer.y + .12, -1, 1);
    if (event.code === 'ArrowDown') pointer.y = clamp(pointer.y - .12, -1, 1);
    localInput();
  }
});

let court;
try {
  court = createTableTennisScene($('table-court'), game, {
    onMove: event => {
      if (embedded) return;
      const rect = event.currentTarget.getBoundingClientRect();
      pointer.x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
      pointer.y = clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1);
      localInput();
    }, onAction: action, labels: [$('tt-player-tag'), $('tt-bot-tag')],
  });
} catch {
  $('tt-error').hidden = false;
  $('tt-error').textContent = 'This browser could not start 3D graphics. Enable WebGL or try a current Chrome, Safari, or Firefox browser.';
}
const setText = (id, text) => { if ($(id).textContent !== String(text)) $(id).textContent = text; };
const setHidden = (id, hidden) => { if ($(id).hidden !== hidden) $(id).hidden = hidden; };
const app = $('table-tennis-app'), score = document.querySelector('.tt-score');
const setData = (key, value) => { const text = String(value); if (app.dataset[key] !== text) app.dataset[key] = text; };
let previous = performance.now(), nextPublish = 0;
function frame(now) {
  const frameStartedAt = performance.now();
  if (!document.hidden) diagnostics.observe('frame.intervalMs', now - previous);
  game.update((now - previous) / 1000); previous = now;
  const physicsEndedAt = diagnostics.enabled ? performance.now() : 0;
  const state = game.snapshot();
  const result = tableTennisResult(state, playerName, opponentName);
  setData('mode', state.mode);
  setData('phase', state.phase);
  setData('stale', Boolean(state.stale));
  setData('challenge', state.practiceChallenge?.stage || '');
  setData('targetHits', state.practiceChallenge?.hits || 0);
  setHidden('tt-connection', diagnosticsEnabled || Boolean(result) || !(game.paused || state.stale));
  setText('tt-connection', game.paused ? 'Paused' : 'Controller paused');
  setHidden('tt-result', !result);
  if (result) {setText('tt-winner', result.title); setText('tt-final-score', result.score); setText('tt-result-detail', result.detail);}
  const winnerName = state.winner === 1 ? playerName : opponentName;
  const winnerText = winnerName === 'You' ? 'You win' : `${winnerName} wins`;
  setText('tt-you-label', state.practice ? 'Returns' : playerName);
  setText('tt-bot-label', state.practice ? 'Best rally' : opponentName);
  const scoreLabel = state.practice ? 'Practice returns and best rally' : 'Match score';
  if (score.getAttribute('aria-label') !== scoreLabel) score.setAttribute('aria-label', scoreLabel);
  setText('tt-you', state.practice ? state.returns : state.score[0]);
  setText('tt-bot', state.practice ? game.bestRally : state.score[1]);
  setText('tt-mode', state.practice ? `${game.settings.assistance === 'friendly' ? 'Friendly' : 'Standard'} practice` : `First to ${state.targetPoints || 12} · win by 2`);
  setText('tt-status', state.winner ? `${winnerText} · ${state.score.join(' – ')}` : game.paused ? 'Paused' : state.stale ? 'Waiting for your controller' : state.practice ? game.physics.ball.active ? 'Swing after the bounce' : 'Next ball coming' : state.deuce ? 'Deuce · win by two' : state.gamePoint ? `Game point · ${state.gamePoint === 1 ? playerName : opponentName}` : game.physics.ball.active ? 'Keep the rally going' : `${state.server === 1 ? playerName : opponentName} serves next`);
  setText('tt-detail', state.winner ? 'Match complete' : game.paused ? 'Resume when everyone is ready.' : state.stale ? 'Play resumes when fresh motion arrives.' : game.lastReason === 'Contact' || game.lastReason === 'Bot returned' ? 'Aim ring shows your next return.' : state.reason);
  setText('tt-action', game.physics.ball.active ? 'Stroke · Space' : state.practice ? 'Feed ball · Space' : 'Serve · Space');
  setText('tt-pause', game.paused ? 'Resume · P' : 'Pause · P');
  setText('tt-player-tag', playerName);
  setText('tt-bot-tag', opponentName);
  $('tt-practice').classList.toggle('selected', state.practice); $('tt-match').classList.toggle('selected', !state.practice);
  $('tt-you-side').classList.toggle('serving', !state.practice && state.server === 1);
  $('tt-bot-side').classList.toggle('serving', !state.practice && state.server === 2);
  setHidden('tt-announcement', Boolean(state.winner) || game.paused || state.stale || now >= announcementUntil);
  if (now >= nextPublish) { publish(); nextPublish = now + 250; }
  const renderStart = diagnostics.enabled ? performance.now() : 0;
  court?.render(now, frameStartedAt);
  if (diagnostics.enabled && court) {
    diagnostics.observe('frame.physicsMs', physicsEndedAt - frameStartedAt);
    diagnostics.observe('frame.hudMs', renderStart - physicsEndedAt);
    diagnostics.observe('frame.renderSubmissionMs', performance.now() - renderStart);
    diagnostics.observe('frame.workMs', performance.now() - frameStartedAt);
    for (const id of pendingPoseRender.values()) {
      diagnostics.mark(id, 'renderSubmission');
      diagnostics.measure(id, 'received', 'renderSubmission', 'pose.receivedToRenderSubmissionMs');
    }
    pendingPoseRender.clear();
  }
  requestAnimationFrame(frame);
}
window.addEventListener('pagehide', event => { if (!event.persisted) { sound?.dispose(); court?.dispose(); } });
localInput();
post({type: 'wee:bridge-ready'});
requestAnimationFrame(frame);
