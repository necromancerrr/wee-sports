import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {fitIsland} from '../lib/island.js';
import {IslandWater} from './IslandWater.jsx';
import {useIslandMotion} from '../lib/useIslandMotion.js';

/** Full-bleed, aspect-correct camera framing shared by art, effects and anchors. */
export function IslandScenery({image, children}) {
  const viewport = useRef(null);
  const plane = useRef(null);
  const {enabled} = useIslandMotion();
  const [size, setSize] = useState({width: 0, height: 0});
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const state = failed === image.src ? 'error' : loaded === image.src ? 'ready' : 'loading';
  useEffect(() => {
    const surface = viewport.current;
    const camera = plane.current;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reset = () => {camera.style.setProperty('--depth-x', '0px'); camera.style.setProperty('--depth-y', '0px');};
    reset();
    if (!enabled) return;
    const move = event => {
      if (!finePointer.matches || event.pointerType === 'touch') return;
      const bounds = surface.getBoundingClientRect();
      const clamp = value => Math.max(-1, Math.min(1, value));
      camera.style.setProperty('--depth-x', `${clamp((event.clientX - bounds.left) / bounds.width * 2 - 1) * -4}px`);
      camera.style.setProperty('--depth-y', `${clamp((event.clientY - bounds.top) / bounds.height * 2 - 1) * -3}px`);
    };
    surface.addEventListener('pointermove', move, {passive: true});
    surface.addEventListener('pointerleave', reset);
    return () => {surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', reset); reset();};
  }, [enabled]);
  const rect = fitIsland(size.width, size.height, image);
  return <div ref={viewport} className="island-scenery" data-image-state={state}>
    <img className="island-scenery__ocean" src={image.ocean} alt="" draggable="false" decoding="async"
      style={{top: rect.y - 8, height: rect.height + 16}} />
    <div ref={plane} className="island-scenery__plane" style={{left: rect.x, top: rect.y,
      width: rect.width, height: rect.height, '--scene-width': `${rect.width}px`}}>
      <img key={image.src} data-testid="island-background" className="island-scenery__image" src={image.src}
        width={image.width} height={image.height} alt="" draggable="false"
        decoding="async" fetchPriority="high" onLoad={() => setLoaded(image.src)} onError={() => setFailed(image.src)} />
      <IslandWater variant={image.water} />
      {children?.(rect, size)}
    </div>
    {state === 'error' && <p className="island-image-error" role="status">The island image couldn’t load. The controls are still available.</p>}
  </div>;
}
