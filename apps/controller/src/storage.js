import * as SecureStore from 'expo-secure-store';

export async function readPrivate(key) {
  const raw = await SecureStore.getItemAsync(`wee.${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function writePrivate(key, value) {
  if (value === null) await SecureStore.deleteItemAsync(`wee.${key}`);
  else await SecureStore.setItemAsync(`wee.${key}`, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function profileRequest(origin, path = '', { method = 'GET', body, token } = {}) {
  const response = await fetch(`${origin}/api/profile${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Wee-Client': 'native', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.message || result.error || 'Profile request failed'); error.status = response.status; throw error; }
  return result;
}
