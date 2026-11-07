import * as THREE from 'three';

/** A quiet floor around the court; it has no collision or animated scenery. */
export function createCourtBackdrop(): {group: THREE.Group; dispose: () => void} {
    const group = new THREE.Group();
    group.name = 'Court backdrop';
    const geometry = new THREE.PlaneGeometry(160, 160);
    const material = new THREE.MeshStandardMaterial({color: 0xaabcb5, roughness: 1});
    const floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.02;
    floor.receiveShadow = true;
    group.add(floor);
    return {group, dispose: () => {
        group.removeFromParent();
        geometry.dispose();
        material.dispose();
    }};
}
