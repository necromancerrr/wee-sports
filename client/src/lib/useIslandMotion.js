import {useSyncExternalStore} from 'react';

const STORAGE_KEY = 'wee:island-motion';
const listeners = new Set();
const system = window.matchMedia('(prefers-reduced-motion: reduce)');
let preference = true;

function readPreference() {
  try { preference = window.localStorage.getItem(STORAGE_KEY) !== 'off'; }
  catch { /* Keep the current choice when storage is unavailable. */ }
}
readPreference();

const notify = () => { for (const listener of listeners) listener(); };
function storageChanged(event) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  readPreference();
  notify();
}

function subscribe(listener) {
  if (listeners.size === 0) {
    readPreference();
    system.addEventListener('change', notify);
    document.addEventListener('visibilitychange', notify);
    window.addEventListener('storage', storageChanged);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      system.removeEventListener('change', notify);
      document.removeEventListener('visibilitychange', notify);
      window.removeEventListener('storage', storageChanged);
    }
  };
}

const snapshot = () => (preference ? 1 : 0) | (system.matches ? 2 : 0) | (document.hidden ? 4 : 0);
function setEnabled(value) {
  preference = Boolean(value);
  try { window.localStorage.setItem(STORAGE_KEY, preference ? 'on' : 'off'); }
  catch { /* The toggle still works for this visit. */ }
  notify();
}

/** Decorative motion only. Hidden pages and reduced-motion settings always stop it.
 * Subscribers release all event listeners when the island screens unmount. */
export function useIslandMotion() {
  const state = useSyncExternalStore(subscribe, snapshot, () => 2);
  return {enabled: state === 1, preference: Boolean(state & 1),
    reducedMotion: Boolean(state & 2), setEnabled};
}
