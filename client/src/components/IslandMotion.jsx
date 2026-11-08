import {useLayoutEffect, useRef, useState} from 'react';
import {createIslandMotion} from '../lib/islandMotion.js';

/** An optional full-resolution paint layer; the original image stays beneath. */
export function IslandMotion({source, variant, ocean = false, enabled}) {
  const canvas = useRef(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const surface = canvas.current;
    surface.dataset.ready = 'false';
    setReady(false);
    if (!enabled) return;
    const image = new Image();
    let stopped = false, renderer, observer, frame, start, previous = -Infinity;
    let sized = false, painted = false;
    const show = value => {
      painted = value;
      // ResizeObserver and context-loss callbacks must hide an unavailable
      // frame immediately, without waiting for a React state commit.
      surface.dataset.ready = String(value);
      setReady(value);
    };
    const stop = () => {
      stopped = true;
      surface.dataset.ready = 'false';
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.dispose();
      renderer = null;
    };
    const contextLost = event => {
      event.preventDefault();
      show(false);
      stop();
    };
    surface.addEventListener('webglcontextlost', contextLost);
    image.onload = () => {
      if (stopped) return;
      renderer = createIslandMotion(surface, image, {variant, ocean});
      if (!renderer) return;
      const resize = () => {
        if (stopped) return;
        const now = performance.now();
        if (start === undefined) start = now;
        sized = renderer.resize(surface.clientWidth, surface.clientHeight, (now - start) / 1000);
        if (!sized) {show(false); return;}
        previous = now;
        if (!painted) show(true);
      };
      observer = new ResizeObserver(resize);
      observer.observe(surface);
      resize();
      const paint = now => {
        if (stopped) return;
        if (start === undefined) start = now;
        // Decorative motion is intentionally 30 fps. Image resolution is never
        // reduced to chase a frame-rate target, and React does not run per frame.
        if (sized && now - previous >= 1000 / 30 - 1) {
          if (!renderer.draw((now - start) / 1000)) {show(false); stop(); return;}
          previous = now;
          if (!painted) show(true);
        }
        frame = requestAnimationFrame(paint);
      };
      frame = requestAnimationFrame(paint);
    };
    image.src = source;
    return () => {
      stop();
      image.onload = null;
      surface.removeEventListener('webglcontextlost', contextLost);
    };
  }, [source, variant, ocean, enabled]);
  return <canvas ref={canvas} className="island-motion" data-ready={enabled && ready}
    data-motion-layer={ocean ? 'ocean' : variant} aria-hidden="true" />;
}
