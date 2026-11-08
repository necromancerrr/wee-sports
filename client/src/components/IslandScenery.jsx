import {useLayoutEffect, useRef, useState} from 'react';
import {fitIsland} from '../lib/island.js';
import {IslandMotion} from './IslandMotion.jsx';
import {useIslandMotion} from '../lib/useIslandMotion.js';

/** Full-bleed, aspect-correct camera framing shared by art, effects and anchors. */
export function IslandScenery({image, children}) {
  const viewport = useRef(null);
  const {enabled} = useIslandMotion();
  const [size, setSize] = useState({width: 0, height: 0});
  const [loaded, setLoaded] = useState(null);
  const [oceanLoaded, setOceanLoaded] = useState(null);
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
  const rect = fitIsland(size.width, size.height, image);
  return <div ref={viewport} className="island-scenery" data-image-state={state}>
    <div className="island-scenery__ocean" style={{top: rect.y - 8, height: rect.height + 16}}>
      <img src={image.ocean} alt="" draggable="false" decoding="async" onLoad={() => setOceanLoaded(image.ocean)} />
      <IslandMotion source={image.ocean} variant={image.water} ocean enabled={enabled && oceanLoaded === image.ocean} />
    </div>
    <div className="island-scenery__plane" style={{left: rect.x, top: rect.y,
      width: rect.width, height: rect.height, '--scene-width': `${rect.width}px`}}>
      <div className="island-scenery__artwork">
        <img key={image.src} data-testid="island-background" className="island-scenery__image" src={image.src}
          width={image.width} height={image.height} alt="" draggable="false"
          decoding="async" fetchPriority="high" onLoad={() => setLoaded(image.src)} onError={() => setFailed(image.src)} />
        <IslandMotion source={image.src} variant={image.water} enabled={enabled && state === 'ready'} />
      </div>
      {children?.(rect, size)}
    </div>
    {state === 'error' && <p className="island-image-error" role="status">The island image couldn’t load. The controls are still available.</p>}
  </div>;
}
