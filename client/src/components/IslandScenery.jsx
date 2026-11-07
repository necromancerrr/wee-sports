import {useLayoutEffect, useRef, useState} from 'react';
import {fitIsland} from '../lib/island.js';

/** Art and controls share one contained image rectangle at every screen size. */
export function IslandScenery({image, children}) {
  const viewport = useRef(null);
  const [size, setSize] = useState({width: 0, height: 0});
  const [state, setState] = useState('loading');
  useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => setSize({width: element.clientWidth, height: element.clientHeight});
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rect = fitIsland(size.width, size.height, image);
  return <div ref={viewport} className="island-scenery" data-image-state={state}>
    <div className="island-scenery__plane" style={{left: rect.x, top: rect.y,
      width: rect.width, height: rect.height, '--scene-width': `${rect.width}px`}}>
      <img data-testid="island-background" className="island-scenery__image" src={image.src}
        width={image.width} height={image.height} alt="" draggable="false"
        decoding="async" fetchPriority="high" onLoad={() => setState('ready')} onError={() => setState('error')} />
      {children?.(rect)}
    </div>
    {state === 'error' && <p className="island-image-error" role="status">The island image couldn’t load. The controls are still available.</p>}
  </div>;
}
