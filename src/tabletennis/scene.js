import * as THREE from 'three';
import {TABLE, BALL} from './physics.js';
import {paddlePresentation} from './paddlePresentation.js';
import {createTableTennisViews} from './views.js';
import {createIslandCourt} from './islandCourt.js';
import {createFrameQuality} from '../rendering/frameQuality.ts';
import {browserDiagnostics} from '../../shared/diagnostics.js';

/** Lightweight court presentation. The live contact face follows the simulation;
 * only disabled windup/recovery poses receive a decorative follow-through. */
export function createTableTennisScene(container, game, {onMove, onAction, labels = []} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#6c9fa7');
  scene.fog = new THREE.Fog('#6c9fa7', 12, 32);
  const views = createTableTennisViews(), camera = views.cameras[0];
  const frameQuality = createFrameQuality({maxPixelRatio: Math.min(devicePixelRatio || 1, 1.75)});
  const diagnostics = browserDiagnostics('render.table-tennis');
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(frameQuality.settings.pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .82;
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#cee2de', '#324b3b', 1.5));
  const light = new THREE.DirectionalLight('#ffedce', 1.7);
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
  const island = createIslandCourt(scene);
  box([TABLE.width + .025, .10, TABLE.length + .025], [0, TABLE.height - .075, 0], '#b8b99e');
  box([TABLE.width, .055, TABLE.length], [0, TABLE.height - .0275, 0], '#247da0');
  for (const x of [-.55, .55]) for (const z of [-1, 1]) box([.075, .65, .075], [x, .33, z], '#1d3441');
  for (const x of [-.55, .55]) box([.055, .055, 2.1], [x, .22, 0], '#1d3441');
  for (const x of [-TABLE.width / 2 + .012, TABLE.width / 2 - .012]) box([.018, .002, TABLE.length], [x, TABLE.height + .001, 0], '#dcebf1');
  for (const z of [-TABLE.length / 2 + .012, TABLE.length / 2 - .012]) box([TABLE.width, .002, .018], [0, TABLE.height + .001, z], '#dcebf1');
  box([.008, .002, TABLE.length], [0, TABLE.height + .001, 0], '#a5c5d3');
  // One line-segment mesh for the whole net keeps draw calls bounded.
  const netPoints = [];
  for (let y = TABLE.height; y <= TABLE.height + TABLE.netHeight; y += .019) netPoints.push(-.84, y, 0, .84, y, 0);
  for (let x = -.84; x <= .84; x += .04) netPoints.push(x, TABLE.height, 0, x, TABLE.height + TABLE.netHeight, 0);
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPoints, 3));
  scene.add(new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({color: '#c4dce7', transparent: true, opacity: .55})));
  box([1.68, .014, .014], [0, TABLE.height + TABLE.netHeight, 0], '#dcebf1');
  for (const x of [-.84, .84]) box([.025, .2, .025], [x, TABLE.height + .07, 0], '#152b3a');
  const ball = sphere(BALL.radius, [0, 1, 0], '#fffaf1');
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.032, 12, 8), new THREE.MeshBasicMaterial({color: '#fffbe8', transparent: true, opacity: .23, depthWrite: false}));
  scene.add(halo);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(.035, 20), new THREE.MeshBasicMaterial({color: '#122f36', transparent: true, opacity: .25, depthWrite: false}));
  ballShadow.rotation.x = -Math.PI / 2; scene.add(ballShadow);
  const aims = ['#e6f1a2', '#e9997e'].map(color => {
    const aim = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(.085, .092, 40), new THREE.MeshBasicMaterial({color, transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2; aim.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(.012, 12), ring.material);
    dot.rotation.x = -Math.PI / 2; aim.add(dot);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(.081, 32), new THREE.MeshBasicMaterial({color, transparent:true, opacity:.18, depthWrite:false, side:THREE.DoubleSide}));
    fill.rotation.x = -Math.PI / 2; aim.add(fill);
    const corners = new THREE.BufferGeometry();
    corners.setAttribute('position', new THREE.Float32BufferAttribute([-.13,0,0,-.105,0,0,.105,0,0,.13,0,0,0,0,-.13,0,0,-.105,0,0,.105,0,0,.13],3));
    const lock = new THREE.LineSegments(corners, new THREE.LineBasicMaterial({color, transparent:true, opacity:.85, depthWrite:false}));
    aim.add(lock); aim.userData = {fill,lock}; scene.add(aim);
    return aim;
  });
  // The optional practice challenge is a world-space target and three pips.
  // It teaches through placement and progress without text over the rally.
  const practiceTarget = new THREE.Group();
  const practiceRing = new THREE.Mesh(new THREE.RingGeometry(.205,.22,48), new THREE.MeshBasicMaterial({color:'#ffe5a0',transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide}));
  practiceRing.rotation.x = -Math.PI/2; practiceTarget.add(practiceRing);
  const practiceCenter = new THREE.Mesh(new THREE.CircleGeometry(.05,20), practiceRing.material);
  practiceCenter.rotation.x = -Math.PI/2; practiceTarget.add(practiceCenter); scene.add(practiceTarget);
  const practicePips = [0,1,2].map(index => {
    const pip = new THREE.Mesh(new THREE.CircleGeometry(.027,16),new THREE.MeshBasicMaterial({color:'#ffe5a0',transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide}));
    pip.rotation.x = -Math.PI/2; pip.position.set((index-1)*.09,TABLE.height+.007,-TABLE.length/2+.07); scene.add(pip); return pip;
  });
  const contact = new THREE.Mesh(new THREE.RingGeometry(.038, .045, 24), new THREE.MeshBasicMaterial({color: '#fff8d6', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide}));
  scene.add(contact);
  const paddles = [0, 1].map(index => {
    const group = new THREE.Group(), body = new THREE.Group();
    group.add(body);
    const color = index === 0 ? '#dce988' : '#e9997e';
    const face = mesh(new THREE.CylinderGeometry(.095, .095, .018, 32), color, body);
    face.material = [material('#bc9870'), material(color), material(color)];
    face.rotation.x = Math.PI / 2; face.scale.z = .12 / .095;
    const handle = box([.034, .115, .018], [0, -.14, 0], '#b48a60', body);
    scene.add(group); return {group, body, face, handle, phase: null, phaseAt: 0, gestureId: null};
  });
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let width = 1, height = 1, split = game.mode === 'versus', viewports = [];
  function resize() {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    viewports = views.layout(width, height, split);
    container.dataset.views = split ? '2' : '1';
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerdown', onAction);
  const normal = new THREE.Vector3(), lookAt = new THREE.Vector3(), screen = new THREE.Vector3();
  let contactId = null, contactAt = -Infinity, renderedFrames = 0, previousFrame = null;
  function render(now) {
    const workAt = performance.now();
    if (!document.hidden && previousFrame !== null && now > previousFrame && now - previousFrame <= 1000) diagnostics.observe('frameGapMs',now-previousFrame);
    previousFrame = document.hidden ? null : now;
    island.update(now, motionPreference?.matches);
    if (split !== (game.mode === 'versus')) {split = game.mode === 'versus'; resize();}
    const p = game.physics.ball.position;
    ball.position.set(p.x, p.y, p.z); ball.visible = game.physics.ball.active;
    halo.position.copy(ball.position); halo.visible = ball.visible;
    ballShadow.position.set(p.x, TABLE.height + .004, p.z);
    ballShadow.visible = ball.visible && Math.abs(p.x) < TABLE.width / 2 && Math.abs(p.z) < TABLE.length / 2;
    ballShadow.scale.setScalar(1 + Math.max(0, p.y - TABLE.height) * .6);
    aims.forEach((aim, index) => {
      const controller = game.players[index];
      const target = index === 0 || game.mode === 'versus' ? controller.pendingStroke?.intent?.target || controller.aimTarget : null;
      aim.visible = Boolean(target) && game.settings.assistance === 'friendly' && !game.paused;
      if (aim.visible) {
        aim.position.set(target.x, TABLE.height + .006, target.z);
        const locked = Boolean(controller.pendingStroke || ['queued','forward'].includes(controller.stroke.phase));
        aim.userData.fill.visible = locked; aim.userData.lock.visible = locked;
      }
    });
    const challenge = game.practiceChallenge;
    practiceTarget.visible = game.mode === 'practice' && Boolean(challenge?.target) && !game.paused;
    if (practiceTarget.visible) {
      practiceTarget.position.set(challenge.target.x,TABLE.height+.008,challenge.target.z);
      practiceTarget.scale.setScalar((challenge.radius || .22)/.22);
    }
    practicePips.forEach((pip,index) => {
      pip.visible = game.mode === 'practice' && Boolean(challenge) && !game.paused;
      pip.material.opacity = challenge?.returns > index ? .9 : .22;
    });
    game.physics.paddles.forEach((paddle, index) => {
      const presentation = paddles[index];
      const {group: display, body, face, handle} = presentation;
      display.position.set(paddle.position.x, paddle.position.y, paddle.position.z);
      normal.set(paddle.normal.x, paddle.normal.y, paddle.normal.z).normalize();
      display.lookAt(lookAt.copy(display.position).add(normal));
      const controller = game.players[index];
      const pending = controller.pendingStroke;
      const stroke = pending && !paddle.enabled && controller.stroke.phase !== 'forward'
        ? {...controller.stroke,...pending.intent,phase:'queued',gestureId:pending.id} : controller.stroke;
      if (presentation.phase !== stroke.phase || presentation.gestureId !== stroke.gestureId) {
        presentation.phase = stroke.phase; presentation.phaseAt = now; presentation.gestureId = stroke.gestureId;
      }
      const pose = paddlePresentation({...stroke, player: index + 1, elapsed: (now - presentation.phaseAt) / 1000,
        enabled: paddle.enabled, reducedMotion: game.paused || motionPreference?.matches});
      body.position.set(pose.x, pose.y, pose.z);
      body.rotation.set(pose.pitch, pose.yaw, pose.roll);
      // During the contact window this transform is exactly the collider,
      // including the larger Friendly face. Windup never creates a hidden hit.
      face.scale.set(paddle.radiusX / .095, 1, paddle.radiusY / .095);
      handle.position.y = -paddle.radiusY - .055;
      display.visible = true;
      if (labels[index]) {
        if (split) {
          const view = viewports[index];
          labels[index].style.transform = `translate(${view.x + view.width / 2}px, ${height - 68}px) translate(-50%, 0)`;
        } else {
        // Names sit outside the table and remain still while players swing.
        screen.set(index === 0 ? -1.05 : 1.05, TABLE.height + .10, index === 0 ? 1.5 : -1.5).project(camera);
        labels[index].style.transform = `translate(${(screen.x * .5 + .5) * width}px, ${(-screen.y * .5 + .5) * height}px) translate(-50%, 0)`;
        }
      }
    });
    if (game.lastContact && game.lastContact.id !== contactId) {
      contactId = game.lastContact.id; contactAt = now;
      const p = game.lastContact.position; contact.position.set(p.x, p.y, p.z);
      contact.quaternion.copy(camera.quaternion);
    }
    const age = (now - contactAt) / 1000;
    contact.visible = age < .18;
    if (contact.visible) { contact.scale.setScalar(motionPreference?.matches ? 1 : 1 + age * 3); contact.material.opacity = (1 - age / .18) * .7; }
    renderer.info.reset();
    renderer.shadowMap.needsUpdate = renderedFrames++ % frameQuality.settings.shadowEvery === 0;
    renderer.setScissorTest(split);
    for (const view of viewports) {
      renderer.setViewport(view.x, view.y, view.width, view.height);
      renderer.setScissor(view.x, view.y, view.width, view.height);
      contact.quaternion.copy(view.camera.quaternion);
      renderer.render(scene, view.camera);
    }
    renderer.setScissorTest(false);
    const workMs = performance.now()-workAt, previousLevel = frameQuality.settings.level;
    if (!document.hidden) diagnostics.observe('renderSubmissionMs',workMs);
    const quality = frameQuality.sample(now, workMs, !document.hidden);
    if (quality) diagnostics.count(quality.level > previousLevel ? 'qualityReduced' : 'qualityRecovered');
    if (quality && renderer.getPixelRatio() !== quality.pixelRatio) renderer.setPixelRatio(quality.pixelRatio);
    if (quality && renderer.shadowMap.enabled !== quality.shadows) {
      renderer.shadowMap.enabled = quality.shadows;
      renderer.shadowMap.needsUpdate = quality.shadows;
      // Refresh Three's cached shader variants too, so disabled shadows do
      // not stay frozen on screen or keep costing fragment shader work.
      scene.traverse(object => {
        if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
      });
    }
  }
  return {render, diagnostics: () => ({...frameQuality.diagnostics(),views:split ? 2 : 1,
    drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles}), dispose() {
    observer.disconnect(); renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('pointerdown', onAction);
    const geometries = new Set(), usedMaterials = new Set();
    scene.traverse(item => {
      if (item.geometry) geometries.add(item.geometry);
      for (const value of Array.isArray(item.material) ? item.material : [item.material]) {
        if (value) usedMaterials.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const value of usedMaterials) value.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }};
}
