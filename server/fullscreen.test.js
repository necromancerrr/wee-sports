import { describe, expect, it, vi } from 'vitest';
import { canEnterFullscreen, enterFullscreen, exitFullscreen, fullscreenElement, isFullscreenStartGesture } from '../client/src/lib/fullscreen.js';

describe('host fullscreen request', () => {
  it('requests synchronously in the user gesture, before waiting for a server start', async () => {
    const doc = { fullscreenElement: null, documentElement: {} };
    doc.documentElement.requestFullscreen = vi.fn(function () { doc.fullscreenElement = this; return Promise.resolve(); });
    const pending = enterFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(await pending).toBe(true);
    doc.exitFullscreen = vi.fn(() => { doc.fullscreenElement = null; });
    await exitFullscreen(doc);
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(fullscreenElement(doc)).toBe(null);
  });

  it('allows the game to start when the browser denies or does not support fullscreen', async () => {
    const denied = { documentElement: { requestFullscreen: () => Promise.reject(new Error('Denied')) } };
    expect(await enterFullscreen(denied)).toBe(false);
    expect(await enterFullscreen({ documentElement: {} })).toBe(false);
    expect(await exitFullscreen(denied)).toBeUndefined();
  });

  it('retries a remote-start denial synchronously on the first local gesture', async () => {
    let hasLocalGesture = false;
    const doc = { fullscreenElement: null, fullscreenEnabled: true, documentElement: {} };
    doc.documentElement.requestFullscreen = vi.fn(function () {
      if (!hasLocalGesture) return Promise.reject(new Error('User activation required'));
      doc.fullscreenElement = this;
      return Promise.resolve();
    });
    expect(await enterFullscreen(doc)).toBe(false);
    expect(canEnterFullscreen(doc)).toBe(true);
    hasLocalGesture = true;
    const retry = enterFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
    expect(await retry).toBe(true);
  });

  it('does not offer unsupported or policy-disabled fullscreen as an available action', async () => {
    const requestFullscreen = vi.fn();
    const policyDisabled = { fullscreenEnabled: false, documentElement: { requestFullscreen } };
    expect(canEnterFullscreen(policyDisabled)).toBe(false);
    expect(await enterFullscreen(policyDisabled)).toBe(false);
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(canEnterFullscreen({ documentElement: {} })).toBe(false);
    expect(canEnterFullscreen({ webkitFullscreenEnabled: false, documentElement: { webkitRequestFullscreen: vi.fn() } })).toBe(false);
  });

  it('supports Safari’s prefixed API and safely exits an already ended session', async () => {
    const doc = { webkitFullscreenElement: null, documentElement: {} };
    doc.documentElement.webkitRequestFullscreen = function () { doc.webkitFullscreenElement = this; };
    expect(await enterFullscreen(doc)).toBe(true);
    doc.webkitExitFullscreen = vi.fn(() => { doc.webkitFullscreenElement = null; });
    await exitFullscreen(doc);
    await exitFullscreen(doc);
    expect(doc.webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it('coalesces an in-flight entry and allows a fresh gesture after rejection', async () => {
    let reject;
    const doc = {fullscreenElement:null,documentElement:{requestFullscreen:vi.fn(() => new Promise((_,fail) => {reject = fail;}))}};
    const first = enterFullscreen(doc), second = enterFullscreen(doc);
    expect(second).toBe(first);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    reject(new Error('User activation required'));
    expect(await first).toBe(false);
    doc.documentElement.requestFullscreen.mockImplementation(function () {doc.fullscreenElement=this;});
    expect(await enterFullscreen(doc)).toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it('retries only a real stage tap or remote Enter, leaving menus and Escape alone', () => {
    const event = {type:'keydown',key:'Enter',isTrusted:true,target:{closest:() => null}};
    expect(isFullscreenStartGesture(event)).toBe(true);
    expect(isFullscreenStartGesture({...event,type:'click',key:undefined})).toBe(true);
    for (const change of [{isTrusted:false},{key:'Escape'},{key:'P'},{repeat:true},{defaultPrevented:true},
      {altKey:true},{ctrlKey:true},{metaKey:true},{target:{closest:() => ({})}}]) {
      expect(isFullscreenStartGesture({...event,...change})).toBe(false);
    }
  });
});
