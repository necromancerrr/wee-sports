import * as THREE from 'three';
import {TableTennisGame} from './game.js';
import {TABLE, BALL, clamp, v3} from './physics.js';
import './style.css';

const $ = id => document.getElementById(id);
const embedded = window.parent !== window && new URLSearchParams(location.search).has('lobby');
const post = message => { if (embedded) window.parent.postMessage(message, location.origin); };
let gameId = null, connected = !embedded, playing = !embedded, generation = null, hostEpoch = null, lastSeq = -1;
let localPaused = false, lastCheckpoint = '', lastState = '';
const game = new TableTennisGame({onEvent: event => {
  if (event.type === 'hit' && gameId) post({type: 'wee:game-hit', gameId, player: event.player});
  if (['state', 'point', 'let'].includes(event.type)) publish();
}});
game.remote = embedded;
game.paused = embedded;

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
  if (value.action === 'new-match' || value.action === 'practice-stop') { lastCheckpoint = ''; lastState = ''; game.startMatch(); return true; }
  if (value.action === 'practice-start') { lastCheckpoint = ''; lastState = ''; game.startPractice(); return true; }
  if (value.action === 'feed') return game.mode === 'practice' ? game.feed() : game.serve();
  if (value.action === 'recenter') return game.recenter();
  if (value.action === 'configure') return game.configure(value.settings);
  return false;
}

window.addEventListener('message', event => {
  if (!embedded || event.source !== window.parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'wee:lobby-state' && data.sport === 'table-tennis') {
    if (data.gameId !== gameId) {
      gameId = data.gameId;
      game.startPractice();
      lastState = ''; lastCheckpoint = ''; lastSeq = -1;
    }
    if (generation !== data.generation || hostEpoch !== data.hostEpoch || data.paused || !data.connected) {
      lastSeq = -1;
      game.inputAt = -Infinity;
    }
    generation = data.generation;
    hostEpoch = data.hostEpoch;
    connected = data.connected;
    playing = data.playing;
    game.paused = Boolean(data.paused || !connected || !playing);
    publish();
  } else if (data?.type === 'wee:table-tennis-pose' && connected && playing && !game.paused) {
    const input = data.event;
    if (!input || input.gameId !== gameId || !Number.isInteger(input.seq) || input.seq <= lastSeq ||
      (generation != null && input.generation !== generation) || (hostEpoch != null && input.hostEpoch !== hostEpoch)) return;
    if (game.setInput(input, {remote: true})) lastSeq = input.seq;
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
    if (ok) { lastState = ''; lastCheckpoint = ''; publish(); }
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
$('tt-practice').onclick = () => { if (!game.paused) { game.startPractice($('tt-feed').value); publish(); } };
$('tt-match').onclick = () => { if (!game.paused) { game.startMatch(); publish(); } };
$('tt-action').onclick = action;
$('tt-recenter').onclick = () => { if (game.recenter()) { pointer.x = 0; pointer.y = 0; } else game.lastReason = 'Recenter between points'; };
$('tt-pause').onclick = () => {
  if (embedded) post({type: 'wee:pause-toggle', gameId});
  else { localPaused = !localPaused; game.paused = localPaused; }
};
$('tt-assistance').onchange = () => { game.configure({assistance: $('tt-assistance').value}); publish(); };
$('tt-sensitivity').oninput = () => { game.configure({sensitivity: Number($('tt-sensitivity').value)}); publish(); };
$('tt-feed').onchange = () => game.startPractice($('tt-feed').value);
if (embedded) {
  $('tt-help').textContent = 'Tilt your phone for paddle angle. Make compact strokes. Recenter between points.';
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

function makeScene() {
  const container = $('table-court');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#173f4c');
  scene.fog = new THREE.Fog('#173f4c', 6, 14);
  const camera = new THREE.PerspectiveCamera(43, 1, .01, 40);
  camera.position.set(0, 3.05, 5.0); camera.lookAt(0, .65, 0);
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const ambient = new THREE.HemisphereLight('#e5fbff', '#234251', 2.2); scene.add(ambient);
  const light = new THREE.DirectionalLight('#fff2cf', 3); light.position.set(-2, 5, 2); light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -3; light.shadow.camera.right = 3;
  light.shadow.camera.top = 3; light.shadow.camera.bottom = -3; scene.add(light);
  const box = (size, position, color) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({color, roughness: .6}));
    mesh.position.set(...position); mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh); return mesh;
  };
  box([14, .08, 14], [0, -.06, 0], '#23515d');
  box([TABLE.width, .055, TABLE.length], [0, TABLE.height - .0275, 0], '#297580');
  box([TABLE.width + .02, .08, TABLE.length + .02], [0, TABLE.height - .09, 0], '#f0e4bb');
  for (const x of [-.55, .55]) for (const z of [-1, 1]) box([.065, .65, .065], [x, .33, z], '#102f38');
  for (const x of [-TABLE.width / 2 + .012, TABLE.width / 2 - .012]) box([.018, .001, TABLE.length], [x, TABLE.height + .001, 0], '#e6f5e4');
  for (const z of [-TABLE.length / 2 + .012, TABLE.length / 2 - .012]) box([TABLE.width, .001, .018], [0, TABLE.height + .001, z], '#e6f5e4');
  box([.008, .001, TABLE.length], [0, TABLE.height + .001, 0], '#c2e2db');
  const net = new THREE.Group();
  const netMaterial = new THREE.LineBasicMaterial({color: '#d3e9de', transparent: true, opacity: .58});
  for (let y = TABLE.height; y <= TABLE.height + TABLE.netHeight; y += .019) {
    net.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.84, y, 0), new THREE.Vector3(.84, y, 0)]), netMaterial));
  }
  for (let x = -.84; x <= .84; x += .04) {
    net.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, TABLE.height, 0), new THREE.Vector3(x, TABLE.height + TABLE.netHeight, 0)]), netMaterial));
  }
  scene.add(net);
  box([1.68, .012, .012], [0, TABLE.height + TABLE.netHeight, 0], '#fff9df');
  for (const x of [-.84, .84]) box([.025, .2, .025], [x, TABLE.height + .07, 0], '#132e3a');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 20, 12), new THREE.MeshStandardMaterial({color: '#fff6dd', emissive: '#625131', emissiveIntensity: .18, roughness: .55}));
  ball.castShadow = true; scene.add(ball);
  // A larger translucent halo improves readability without changing collision radius.
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.035, 16, 10), new THREE.MeshBasicMaterial({color: '#fff7c5', transparent: true, opacity: .15, depthWrite: false}));
  scene.add(halo);
  const paddles = [0, 1].map(index => {
    const group = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(.095, .095, .012, 32), new THREE.MeshStandardMaterial({color: index === 0 ? '#eafa9e' : '#eea68a', roughness: .78}));
    face.rotation.x = Math.PI / 2; face.scale.y = 1; face.scale.z = 1.23; face.castShadow = true; group.add(face);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(.034, .115, .018), new THREE.MeshStandardMaterial({color: '#e5c390'}));
    handle.position.y = -.14; handle.castShadow = true; group.add(handle); scene.add(group); return group;
  });
  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    renderer.setSize(width, height); camera.aspect = width / height;
    camera.position.z = width / height < 1 ? 6.2 : 5;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  renderer.domElement.addEventListener('pointermove', event => {
    if (embedded) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    pointer.y = clamp(1 - (event.clientY - rect.top) / rect.height * 2, -1, 1);
    localInput();
  });
  renderer.domElement.addEventListener('pointerdown', action);
  const normal = new THREE.Vector3();
  return () => {
    const p = game.physics.ball.position;
    ball.position.set(p.x, p.y, p.z); ball.visible = game.physics.ball.active;
    halo.position.copy(ball.position); halo.visible = ball.visible;
    game.physics.paddles.forEach((paddle, index) => {
      paddles[index].position.set(paddle.position.x, paddle.position.y, paddle.position.z);
      normal.set(paddle.normal.x, paddle.normal.y, paddle.normal.z).normalize();
      paddles[index].lookAt(paddles[index].position.clone().add(normal));
      paddles[index].visible = paddle.enabled;
    });
    renderer.render(scene, camera);
  };
}

let render;
try { render = makeScene(); } catch {
  $('tt-error').hidden = false;
  $('tt-error').textContent = 'This browser could not start 3D graphics. Enable WebGL or try a current Chrome, Safari, or Firefox browser.';
  render = () => {};
}
let previous = performance.now(), nextPublish = 0;
function frame(now) {
  game.update((now - previous) / 1000); previous = now;
  const state = game.snapshot();
  $('tt-you-label').textContent = state.practice ? 'Returns' : 'You';
  $('tt-bot-label').textContent = state.practice ? 'Best rally' : 'Bot';
  document.querySelector('.tt-score').setAttribute('aria-label', state.practice ? 'Practice returns and best rally' : 'Match score');
  $('tt-you').textContent = state.practice ? state.returns : state.score[0];
  $('tt-bot').textContent = state.practice ? game.bestRally : state.score[1];
  $('tt-mode').textContent = state.practice ? `${game.settings.assistance === 'friendly' ? 'Friendly' : 'Standard'} practice` : 'First to 11 · win by 2';
  $('tt-status').textContent = game.paused ? 'Paused' : state.stale ? 'Controller paused — reconnect or touch the controls' : state.winner ? `${state.winner === 1 ? 'You win' : 'Bot wins'} · ${state.score.join(' – ')}` : state.reason;
  $('tt-detail').textContent = state.practice ? `${state.returns} returns · best rally ${game.bestRally} · feeds: ${game.feedStyle}` : `Player ${state.server} serves · assisted toss`;
  $('tt-action').textContent = game.physics.ball.active ? 'Stroke · Space' : state.practice ? 'Feed ball · Space' : 'Serve · Space';
  $('tt-pause').textContent = game.paused ? 'Resume · P' : 'Pause · P';
  $('tt-practice').classList.toggle('selected', state.practice); $('tt-match').classList.toggle('selected', !state.practice);
  render();
  if (now >= nextPublish) { publish(); nextPublish = now + 250; }
  requestAnimationFrame(frame);
}
localInput();
post({type: 'wee:bridge-ready'});
requestAnimationFrame(frame);
