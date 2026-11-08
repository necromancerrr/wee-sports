import * as THREE from 'three';

/** One simulation, viewed from each human player's end of the table. */
export function createTableTennisViews() {
  const cameras = [1, -1].map(sign => {
    const camera = new THREE.PerspectiveCamera(42, 1, .05, 35);
    camera.userData.player = sign === 1 ? 1 : 2;
    // Shared court on layer 0; each pavilion end has its own camera cutaway.
    camera.layers.enable(camera.userData.player);
    return camera;
  });
  return {
    cameras,
    layout(width, height, split) {
      const count = split ? 2 : 1, firstWidth = split ? Math.floor(width / 2) : width;
      return cameras.slice(0, count).map((camera, index) => {
        const view = {x: index ? firstWidth : 0, y: 0, width: index ? width - firstWidth : firstWidth, height, camera};
        const sign = index ? -1 : 1;
        camera.aspect = view.width / height;
        camera.position.set(0, camera.aspect < .65 ? 3.8 : 3.25, sign * (camera.aspect < .65 ? 6.5 : 5.3));
        camera.lookAt(0, .72, -sign * .10);
        camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        return view;
      });
    },
  };
}
