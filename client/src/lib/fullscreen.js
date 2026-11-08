/** The game always has a viewport-filling fallback when browser fullscreen is unavailable. */
export function fullscreenElement(doc) {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function canEnterFullscreen(doc) {
  const element = doc.documentElement;
  if (typeof element?.requestFullscreen === 'function') return doc.fullscreenEnabled !== false;
  return typeof element?.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false;
}

/** Invoke directly in a click handler: browsers require transient user activation. */
export async function enterFullscreen(doc) {
  if (fullscreenElement(doc)) return true;
  if (!canEnterFullscreen(doc)) return false;
  const element = doc.documentElement;
  const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
  if (!request) return false;
  try {
    await request.call(element);
    return Boolean(fullscreenElement(doc));
  } catch {
    return false;
  }
}

export async function exitFullscreen(doc) {
  if (!fullscreenElement(doc)) return;
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  try { await exit?.call(doc); } catch { /* Browser already exited or the tab lost focus. */ }
}
