import * as THREE from 'three';

/** The homepage's open-air table-tennis pavilion, seen from the player's end.
 * Scenery stays outside the rally and has no colliders or camera movement. */
export function createIslandCourt(scene) {
  const matte = color => new THREE.MeshStandardMaterial({color, roughness: .94});
  const wood = matte('#aa8b60'), stone = matte('#9caa91'), grass = matte('#53725a');
  const deck = matte('#8d9b7b'), shade = matte('#c4bd9a');
  const mesh = (geometry, material, position, {shadow = false} = {}) => {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(...position); item.receiveShadow = true; item.castShadow = shadow;
    scene.add(item); return item;
  };
  const box = (size, position, material, shadow = false) => mesh(new THREE.BoxGeometry(...size), material, position, {shadow});

  const water = mesh(new THREE.PlaneGeometry(90,90), matte('#2a8eaf'), [0,-.52,0]);
  water.rotation.x = -Math.PI/2;
  mesh(new THREE.CylinderGeometry(5.35,5.8,.4,48), [stone,grass,stone], [0,-.29,0]);
  box([5.2,.16,6.7], [0,-.10,0], stone);
  box([4.9,.025,6.4], [0,-.0125,0], deck);
  // The pavilion's warm frame and pale eaves leave the middle open to the sky.
  // Both ends are identical, so the second player's view is equally clear.
  for (const x of [-2.55,2.55]) {
    for (const z of [-3.15,3.15]) {
      box([.14,2.65,.14], [x,1.30,z], wood, true);
      box([.26,.16,.26], [x,.08,z], stone);
    }
    box([.17,.16,6.55], [x,2.65,0], wood, true);
    box([.55,.07,6.8], [x,2.77,0], shade, true);
  }
  // A cutaway at each camera's near end keeps the roof frame out of the rally.
  // Each player sees only the opposite crossbeam, including in split screen.
  for (const z of [-3.15,3.15]) {
    box([5.25,.15,.14], [0,2.65,z], wood).layers.set(z < 0 ? 1 : 2);
  }
  // Quiet deck seams: one draw call, with no moving texture beneath the ball.
  const seams = [];
  for (let x=-2.25;x<=2.25;x+=.5) seams.push(x,.001,-3.1,x,.001,3.1);
  const lines = (points, color, opacity) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    const item = new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
    scene.add(item); return item;
  };
  lines(seams,'#405d4d',.18);

  // Instancing keeps the surrounding trees and shore inexpensive in split view.
  const object = new THREE.Object3D();
  const instances = (geometry, material, placements) => {
    const batch = new THREE.InstancedMesh(geometry,material,placements.length);
    placements.forEach(({position,scale,rotation=0},index) => {
      object.position.set(...position); object.scale.set(...scale); object.rotation.set(0,rotation,0);
      object.updateMatrix(); batch.setMatrixAt(index,object.matrix);
    });
    batch.receiveShadow = true;
    scene.add(batch); return batch;
  };
  const trees = [[-4.5,-2.1],[4.4,2.1],[-3.8,3.8],[3.8,-3.8]];
  instances(new THREE.CylinderGeometry(.07,.11,1.8,8),wood,
    trees.map(([x,z])=>({position:[x,.7,z],scale:[1,1,1]})));
  const crowns = [];
  for (const [x,z] of trees) for (const [dx,y,dz,size] of [[0,1.65,0,.68],[-.4,1.4,.15,.48],[.4,1.45,-.1,.5],[.05,1.85,.1,.42]]) {
    crowns.push({position:[x+dx,y,z+dz],scale:[size,size*.8,size]});
  }
  instances(new THREE.SphereGeometry(1,12,8),matte('#55754e'),crowns);
  const rocks = [];
  for (let i=0;i<14;i++) {
    const angle=i/14*Math.PI*2, radius=5.34;
    rocks.push({position:[Math.cos(angle)*radius,-.26,Math.sin(angle)*radius],
      scale:[.22+(i%3)*.06,.22,.3],rotation:angle});
  }
  instances(new THREE.IcosahedronGeometry(1,1),stone,rocks);
  // A few restrained wave strokes animate only beyond the island's edge.
  const waves = [];
  for (const side of [-1,1]) for (let i=0;i<12;i++) {
    const x=side*(6.4+(i%3)*1.1), z=-7+Math.floor(i/3)*4+(i%3)*.6;
    for(let part=0;part<5;part++) {
      const a=part/5,b=(part+1)/5;
      waves.push(x+a*.9,-.51,z+Math.sin(a*Math.PI)*.07,x+b*.9,-.51,z+Math.sin(b*Math.PI)*.07);
    }
  }
  const ripples = lines(waves,'#a4d0c6',.20);
  return {update(now, reducedMotion) {
    ripples.position.z = reducedMotion ? 0 : Math.sin(now * .0003) * .12;
  }};
}
