import * as THREE from 'three';
import {TABLE, BALL} from './physics.js';

/** Lightweight court presentation. Every ball and paddle transform comes from
 * the simulation; the scene never smooths or predicts a contact separately. */
export function createTableTennisScene(container, game, {onMove, onAction, labels = []} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce5e1');
  scene.fog = new THREE.Fog('#dce5e1', 8, 20);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 35);
  camera.position.set(0, 3.25, 5.3);
  camera.lookAt(0, .72, -.10);
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#ffffff', '#708e83', 2.2));
  const light = new THREE.DirectionalLight('#fff1cf', 2.8);
  light.position.set(-3, 7, 4); light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, {left: -4, right: 4, top: 4, bottom: -4, near: .5, far: 16});
  light.shadow.normalBias = .025; scene.add(light);
  const materials = new Map();
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({color, roughness: .76}));
    return materials.get(color);
  };
  function mesh(geometry, color, parent = scene) {
    const item = new THREE.Mesh(geometry, material(color));
    item.receiveShadow = true; item.castShadow = true; parent.add(item); return item;
  }
  function box(size, position, color, parent = scene) {
    const item = mesh(new THREE.BoxGeometry(...size), color, parent);
    item.position.set(...position); return item;
  }
  function sphere(radius, position, color, parent = scene) {
    const item = mesh(new THREE.SphereGeometry(radius, 16, 12), color, parent);
    item.position.set(...position); return item;
  }
  box([24, .08, 24], [0, -.055, 0], '#c8d6cf');
  box([4.6, .012, 6], [0, -.005, 0], '#95b4a4');
  for (const x of [-2.25, 2.25]) box([.025, .014, 5.85], [x, .004, 0], '#dfe6d2');
  for (const z of [-2.93, 2.93]) box([4.5, .014, .025], [0, .004, z], '#dfe6d2');
  // Quiet surroundings keep the moving ball, paddles and court readable.
  // No garden props or background geometry compete with the rally.
  box([TABLE.width + .025, .10, TABLE.length + .025], [0, TABLE.height - .075, 0], '#efe2be');
  box([TABLE.width, .055, TABLE.length], [0, TABLE.height - .0275, 0], '#276d75');
  for (const x of [-.55, .55]) for (const z of [-1, 1]) box([.075, .65, .075], [x, .33, z], '#284b50');
  for (const x of [-.55, .55]) box([.055, .055, 2.1], [x, .22, 0], '#284b50');
  for (const x of [-TABLE.width / 2 + .012, TABLE.width / 2 - .012]) box([.018, .002, TABLE.length], [x, TABLE.height + .001, 0], '#fff9e7');
  for (const z of [-TABLE.length / 2 + .012, TABLE.length / 2 - .012]) box([TABLE.width, .002, .018], [0, TABLE.height + .001, z], '#fff9e7');
  box([.008, .002, TABLE.length], [0, TABLE.height + .001, 0], '#d2e4dc');
  // One line-segment mesh for the whole net keeps draw calls bounded.
  const netPoints = [];
  for (let y = TABLE.height; y <= TABLE.height + TABLE.netHeight; y += .019) netPoints.push(-.84, y, 0, .84, y, 0);
  for (let x = -.84; x <= .84; x += .04) netPoints.push(x, TABLE.height, 0, x, TABLE.height + TABLE.netHeight, 0);
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPoints, 3));
  scene.add(new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({color: '#edf0df', transparent: true, opacity: .64})));
  box([1.68, .014, .014], [0, TABLE.height + TABLE.netHeight, 0], '#fff9df');
  for (const x of [-.84, .84]) box([.025, .2, .025], [x, TABLE.height + .07, 0], '#203c42');
  const ball = sphere(BALL.radius, [0, 1, 0], '#fff8e4');
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.032, 12, 8), new THREE.MeshBasicMaterial({color: '#fffbe8', transparent: true, opacity: .23, depthWrite: false}));
  scene.add(halo);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(.035, 20), new THREE.MeshBasicMaterial({color: '#122f36', transparent: true, opacity: .25, depthWrite: false}));
  ballShadow.rotation.x = -Math.PI / 2; scene.add(ballShadow);
  const aim = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(.085, .092, 40), new THREE.MeshBasicMaterial({color: '#e6f1a2', transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; aim.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(.012, 12), ring.material);
  dot.rotation.x = -Math.PI / 2; aim.add(dot); scene.add(aim);
  const contact = new THREE.Mesh(new THREE.RingGeometry(.038, .045, 24), new THREE.MeshBasicMaterial({color: '#fff8d6', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide}));
  scene.add(contact);
  const paddles = [0, 1].map(index => {
    const group = new THREE.Group();
    const face = mesh(new THREE.CylinderGeometry(.095, .095, .012, 32), index === 0 ? '#dce988' : '#e9997e', group);
    face.rotation.x = Math.PI / 2; face.scale.z = .12 / .095;
    const handle = box([.034, .115, .018], [0, -.14, 0], '#d2a672', group);
    scene.add(group); return {group, handle};
  });
  const up = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3(), mid = new THREE.Vector3();
  function segment(item, start, end) {
    delta.subVectors(end, start); item.scale.y = delta.length();
    item.position.copy(mid.addVectors(start, end).multiplyScalar(.5));
    item.quaternion.setFromUnitVectors(up, delta.normalize());
  }
  function avatar(index) {
    const group = new THREE.Group(), sign = index === 0 ? 1 : -1;
    const shirt = index === 0 ? '#bace71' : '#df967d', skin = index === 0 ? '#b88160' : '#e3b58d';
    const torso = mesh(new THREE.CapsuleGeometry(.16, .21, 4, 12), shirt, group);
    torso.position.y = .83; torso.scale.z = .7;
    sphere(.145, [0, 1.18, 0], skin, group);
    const hair = sphere(.149, [0, 1.235, .025 * sign], '#3b3933', group);
    hair.scale.y = .65;
    for (const x of [-.09, .09]) {
      const leg = mesh(new THREE.CapsuleGeometry(.062, .28, 3, 8), '#354f57', group);
      leg.position.set(x, .36, 0);
      const shoe = sphere(.08, [x, .09, -.045 * sign], '#f4ecdb', group); shoe.scale.set(1, .65, 1.5);
    }
    // An off hand rests at the hip; the playing arm connects to the real handle.
    sphere(.056, [-.20 * sign, .70, -.025 * sign], skin, group);
    const offArm = mesh(new THREE.CapsuleGeometry(.05, .20, 3, 8), shirt, group);
    offArm.position.set(-.18 * sign, .85, 0); offArm.rotation.z = -.25 * sign;
    for (const x of [-.045, .045]) sphere(.012, [x, 1.19, -.137 * sign], '#293c3a', group);
    const upper = mesh(new THREE.CylinderGeometry(.053, .048, 1, 10), shirt);
    const forearm = mesh(new THREE.CylinderGeometry(.042, .034, 1, 10), skin);
    const hand = sphere(.052, [0, 1, 0], skin); hand.scale.y = 1.2;
    scene.add(group);
    return {group, upper, forearm, hand, sign, shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), grip: new THREE.Vector3()};
  }
  const players = [avatar(0), avatar(1)];
  let width = 1, height = 1;
  function resize() {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height); camera.aspect = width / height;
    camera.position.set(0, width / height < 1 ? 3.8 : 3.25, width / height < 1 ? 6.5 : 5.3);
    camera.lookAt(0, .72, -.10); camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerdown', onAction);
  const normal = new THREE.Vector3(), lookAt = new THREE.Vector3(), screen = new THREE.Vector3();
  let contactId = null, contactAt = -Infinity;
  function render(now) {
    const p = game.physics.ball.position;
    ball.position.set(p.x, p.y, p.z); ball.visible = game.physics.ball.active;
    halo.position.copy(ball.position); halo.visible = ball.visible;
    ballShadow.position.set(p.x, TABLE.height + .004, p.z);
    ballShadow.visible = ball.visible && Math.abs(p.x) < TABLE.width / 2 && Math.abs(p.z) < TABLE.length / 2;
    ballShadow.scale.setScalar(1 + Math.max(0, p.y - TABLE.height) * .6);
    aim.visible = Boolean(game.aimTarget) && game.settings.assistance === 'friendly' && !game.paused;
    if (aim.visible) aim.position.set(game.aimTarget.x, TABLE.height + .006, game.aimTarget.z);
    game.physics.paddles.forEach((paddle, index) => {
      const display = paddles[index].group, player = players[index];
      display.position.set(paddle.position.x, paddle.position.y, paddle.position.z);
      normal.set(paddle.normal.x, paddle.normal.y, paddle.normal.z).normalize();
      display.lookAt(lookAt.copy(display.position).add(normal));
      // Collision-disabled recovery is still a visible hand and paddle.
      display.visible = true;
      player.group.position.set((index === 0 ? -.60 : .60) + paddle.position.x * .35, 0, player.sign * 1.78);
      player.shoulder.set(player.group.position.x + .17 * player.sign, .94, player.sign * 1.73);
      player.grip.set(0, -.14, 0).applyQuaternion(display.quaternion).add(display.position);
      player.elbow.copy(player.shoulder).lerp(player.grip, .5);
      player.elbow.x += .1 * player.sign; player.elbow.y -= .09;
      segment(player.upper, player.shoulder, player.elbow); segment(player.forearm, player.elbow, player.grip);
      player.hand.position.copy(player.grip); player.hand.quaternion.copy(display.quaternion);
      if (labels[index]) {
        screen.set(player.group.position.x, 1.43, player.group.position.z).project(camera);
        labels[index].style.transform = `translate(${(screen.x * .5 + .5) * width}px, ${(-screen.y * .5 + .5) * height}px) translate(-50%, 0)`;
      }
    });
    if (game.lastContact && game.lastContact.id !== contactId) {
      contactId = game.lastContact.id; contactAt = now;
      const p = game.lastContact.position; contact.position.set(p.x, p.y, p.z);
      contact.quaternion.copy(camera.quaternion);
    }
    const age = (now - contactAt) / 1000;
    contact.visible = age < .18;
    if (contact.visible) { contact.scale.setScalar(1 + age * 3); contact.material.opacity = (1 - age / .18) * .7; }
    renderer.render(scene, camera);
  }
  return {render, dispose() {
    observer.disconnect(); renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('pointerdown', onAction);
    scene.traverse(item => { item.geometry?.dispose(); });
    for (const value of materials.values()) value.dispose();
    renderer.dispose();
  }};
}
