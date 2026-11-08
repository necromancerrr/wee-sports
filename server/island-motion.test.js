import {afterEach, beforeEach, expect, test, vi} from 'vitest';

const hooks = vi.hoisted(() => ({effects: [], refs: [], refIndex: 0}));
vi.mock('react', async () => ({...(await vi.importActual('react')),
  useRef(value) {return hooks.refs[hooks.refIndex++] ??= {current: value};},
  useState(value) {return [value, () => {}];},
  useEffect(effect) {hooks.effects.push(effect);},
  useLayoutEffect(effect) {hooks.effects.push(effect);},
}));
import {IslandMotion} from '../client/src/components/IslandMotion.jsx';
import {createIslandMotion} from '../client/src/lib/islandMotion.js';

let surface, gl, images, observers, frames, now, cleanup, events;
function createSurface() {
  let width = 300, height = 150;
  const listeners = new Map();
  const canvas = {clientWidth: 800, clientHeight: 450, dataset: {}, painted: false,
    get width() {return width;}, set width(value) {width = value; canvas.painted = false; events.push('width');},
    get height() {return height;}, set height(value) {height = value; canvas.painted = false; events.push('height');},
    getContext: vi.fn(() => gl),
    addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
    removeEventListener: vi.fn((name, callback) => {if (listeners.get(name) === callback) listeners.delete(name);}),
    emit(name, event) {listeners.get(name)?.(event);},
  };
  return canvas;
}
function createGL() {
  const context = {MAX_RENDERBUFFER_SIZE: 0x84e8, COLOR_BUFFER_BIT: 0x4000,
    lost: false, isContextLost: vi.fn(() => context.lost),
    getParameter: vi.fn(() => 4096), getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true), getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn((_program, name) => name),
    drawArrays: vi.fn(() => {surface.painted = true; events.push('draw');}),
    clear: vi.fn(() => {surface.painted = false; events.push('clear');}),
  };
  for (const name of ['createShader', 'createProgram', 'createBuffer', 'createTexture']) context[name] = vi.fn(() => ({}));
  for (const name of ['deleteShader', 'deleteProgram', 'deleteBuffer', 'deleteTexture', 'shaderSource',
    'compileShader', 'attachShader', 'linkProgram', 'useProgram', 'bindBuffer', 'bufferData',
    'enableVertexAttribArray', 'vertexAttribPointer', 'bindTexture', 'texParameteri', 'texImage2D',
    'uniform1i', 'uniform2f', 'uniform1f', 'viewport', 'clearColor']) context[name] = vi.fn();
  return context;
}
const source = {naturalWidth: 1672, naturalHeight: 941};
function mount(enabled = true) {
  hooks.refIndex = 0;
  IslandMotion({source: '/island/homepage.webp', variant: 'bay', enabled});
  cleanup = hooks.effects.at(-1)();
}
function resize(width, height) {
  surface.clientWidth = width; surface.clientHeight = height;
  observers.at(-1).callback();
}
function advance(time) {
  now = time;
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(callback => callback(now));
}
beforeEach(() => {
  hooks.effects = []; hooks.refs = []; hooks.refIndex = 0;
  images = []; observers = []; frames = new Map(); now = 0; events = []; cleanup = null;
  surface = createSurface(); gl = createGL(); let frameId = 0;
  vi.stubGlobal('window', {devicePixelRatio: 1});
  vi.stubGlobal('performance', {now: () => now});
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {frames.set(++frameId, callback); return frameId;}));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(id => frames.delete(id)));
  vi.stubGlobal('Image', class {constructor() {Object.assign(this, source); images.push(this);}});
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) {this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this);}
  });
  vi.stubGlobal('React', {createElement: (_tag, props) => {
    props.ref.current = surface; surface.dataset.ready = String(props['data-ready']); return null;
  }});
});
afterEach(() => {cleanup?.(); vi.unstubAllGlobals();});

test('each buffer resize paints synchronously with transparent clears and no preserved buffer', () => {
  const renderer = createIslandMotion(surface, source, {variant: 'bay'});
  expect(surface.getContext.mock.calls[0][1]).toMatchObject({alpha: true, preserveDrawingBuffer: false});
  expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
  expect(renderer.resize(800, 450, .75)).toBe(true);
  expect(events).toEqual(['width', 'height', 'draw']);
  expect(gl.uniform1f).toHaveBeenCalledWith('time', .75);
  expect(surface.painted).toBe(true);
  events = [];
  expect(renderer.resize(430, 900, .76)).toBe(true);
  expect(events).toEqual(['width', 'height', 'draw']);
  expect(surface.painted).toBe(true);
  renderer.dispose();
});

test('unsupported dimensions reveal the still and recover even to the previous buffer size', () => {
  window.devicePixelRatio = 3;
  const renderer = createIslandMotion(surface, source, {variant: 'bay'});
  expect(renderer.resize(800, 450, 0)).toBe(true);
  expect([surface.width, surface.height]).toEqual([1600, 900]);
  const draws = gl.drawArrays.mock.calls.length;
  for (const [width, height] of [[0, 450], [-1, 450], [NaN, 450], [Infinity, 450], [800, 3000]]) {
    expect(renderer.resize(width, height, 1)).toBe(false);
    expect(surface.painted).toBe(false);
    expect([surface.width, surface.height]).toEqual([1600, 900]);
    expect(gl.drawArrays).toHaveBeenCalledTimes(draws);
  }
  expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
  expect(renderer.resize(800, 450, 2)).toBe(true);
  expect(surface.painted).toBe(true);
  expect(gl.drawArrays).toHaveBeenCalledTimes(draws + 1);
  renderer.dispose();
});

test('only the ocean crops to the centered source aspect in tall windows and restores wide mapping', () => {
  window.devicePixelRatio = 2;
  const ocean = createIslandMotion(surface, source, {variant: 'bay', ocean: true});
  expect(ocean.resize(430, 900)).toBe(true);
  expect(gl.uniform1f).toHaveBeenCalledWith('u_crop', 430 / 900 * 941 / 1672);
  expect([surface.width, surface.height]).toEqual([860, 1800]);
  gl.uniform1f.mockClear();
  expect(ocean.resize(1800, 900)).toBe(true);
  expect(gl.uniform1f).toHaveBeenCalledWith('u_crop', 1);
  ocean.dispose();
  gl.uniform1f.mockClear();
  const island = createIslandMotion(surface, source, {variant: 'bay'});
  expect(island.resize(430, 900)).toBe(true);
  expect(gl.uniform1f).toHaveBeenCalledWith('u_crop', 1);
  island.dispose();
});

test('visible resize bypasses the frame throttle and zero/oversized surfaces recover without another loop', () => {
  mount(); images[0].onload();
  expect(surface.dataset.ready).toBe('true');
  advance(1000);
  const draws = gl.drawArrays.mock.calls.length;
  now = 1001; resize(430, 900);
  expect(surface.dataset.ready).toBe('true');
  expect(surface.painted).toBe(true);
  expect(gl.drawArrays).toHaveBeenCalledTimes(draws + 1);
  expect(frames.size).toBe(1);
  for (const [width, height] of [[0, 0], [5000, 900]]) {
    resize(width, height);
    expect(surface.dataset.ready).toBe('false');
    const previous = gl.drawArrays.mock.calls.length;
    advance(now + 100);
    expect(gl.drawArrays).toHaveBeenCalledTimes(previous);
    resize(430, 900);
    expect(surface.dataset.ready).toBe('true');
    expect(surface.painted).toBe(true);
    expect(frames.size).toBe(1);
  }
});

test.each([[0, 0], [5000, 900]])('an initial %i × %i surface waits for a supported size before revealing motion', (width, height) => {
  surface.clientWidth = width; surface.clientHeight = height;
  mount(); images[0].onload(); advance(100);
  expect(surface.dataset.ready).toBe('false');
  expect(gl.drawArrays).not.toHaveBeenCalled();
  resize(800, 450);
  expect(surface.dataset.ready).toBe('true');
  expect(surface.painted).toBe(true);
});

test('context loss immediately reveals the still and cancels draws, including queued resize callbacks', () => {
  mount(); images[0].onload();
  const preventDefault = vi.fn();
  surface.emit('webglcontextlost', {preventDefault});
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(surface.dataset.ready).toBe('false');
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(gl.deleteProgram).toHaveBeenCalledOnce();
  const draws = gl.drawArrays.mock.calls.length;
  expect(() => observers[0].callback()).not.toThrow();
  advance(1000);
  expect(gl.drawArrays).toHaveBeenCalledTimes(draws);
  expect(frames.size).toBe(0);
});

test('failed draws stop rendering and cleanup cannot revive a late image load', () => {
  mount(); images[0].onload(); gl.lost = true; advance(1000);
  expect(surface.dataset.ready).toBe('false');
  expect(frames.size).toBe(0);
  cleanup();
  expect(surface.removeEventListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
  mount(); const lateLoad = images[1].onload; cleanup(); lateLoad();
  expect(images[1].onload).toBeNull();
  expect(surface.getContext).toHaveBeenCalledTimes(1);
});

test('disabling motion releases resources and reactivation starts one fresh renderer', () => {
  mount(); images[0].onload(); cleanup();
  expect(surface.dataset.ready).toBe('false');
  expect(frames.size).toBe(0);
  mount(false);
  expect(surface.dataset.ready).toBe('false');
  expect(images).toHaveLength(1);
  mount(); images[1].onload();
  expect(surface.dataset.ready).toBe('true');
  expect(frames.size).toBe(1);
  expect(surface.getContext).toHaveBeenCalledTimes(2);
});

test('unavailable WebGL keeps the original still without an animation loop', () => {
  surface.getContext.mockReturnValue(null);
  mount(); images[0].onload();
  expect(surface.dataset.ready).toBe('false');
  expect(observers).toHaveLength(0);
  expect(frames.size).toBe(0);
});
