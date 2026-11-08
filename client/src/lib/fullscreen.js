/** The game always has a viewport-filling fallback when browser fullscreen is unavailable. */
const requests = new WeakMap();

export function fullscreenElement(doc) {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function canEnterFullscreen(doc) {
  const element = doc.documentElement;
  if (typeof element?.requestFullscreen === 'function') return doc.fullscreenEnabled !== false;
  return typeof element?.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false;
}

/** Invoke directly in a click handler: browsers require transient user activation. */
export function enterFullscreen(doc) {
  if (fullscreenElement(doc)) return Promise.resolve(true);
  if (requests.has(doc)) return requests.get(doc);
  if (!canEnterFullscreen(doc)) return Promise.resolve(false);
  const element = doc.documentElement;
  const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
  if (!request) return Promise.resolve(false);
  try {
    // Start inside the original gesture, rather than in a deferred callback.
    const result = request.call(element);
    const pending = Promise.resolve(result).then(() => Boolean(fullscreenElement(doc)), () => false)
      .finally(() => { if (requests.get(doc) === pending) requests.delete(doc); });
    requests.set(doc, pending);
    return pending;
  } catch {
    return Promise.resolve(false);
  }
}

/** A TV remote's OK/Enter or a tap on the open stage can finish a denied
 * remote start. Never consume typing, menu actions, Escape or synthetic input. */
export function isFullscreenStartGesture(event) {
  return event.isTrusted === true && !event.defaultPrevented &&
    !event.altKey && !event.ctrlKey && !event.metaKey &&
    (event.type === 'click' || event.type === 'keydown' && event.key === 'Enter' && !event.repeat) &&
    !event.target?.closest?.('button, a, input, select, textarea, summary, [role="button"], [role="dialog"], [contenteditable="true"]');
}

export async function exitFullscreen(doc) {
  if (!fullscreenElement(doc)) return;
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  try { await exit?.call(doc); } catch { /* Browser already exited or the tab lost focus. */ }
}
