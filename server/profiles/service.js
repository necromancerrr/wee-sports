import {resolve} from 'node:path';
import {ProfileStore} from './store.js';
import {ProfileError, fail, keys} from './validation.js';

const COOKIE = 'wee_profile';
function credential(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return authorization.slice(7);
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
async function body(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) fail('json-required', 415);
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16384) fail('request-too-large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('invalid-json'); }
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol) && url.host === request.headers.host;
    } catch { return false; }
  }
  // Native requests do not have browser Origin/cookie semantics. Cross-site web
  // requests cannot add this custom header without a CORS preflight (not served).
  return request.headers['x-wee-client'] === 'native' || request.headers.authorization?.startsWith('Bearer ') ||
    request.headers['sec-fetch-site'] === 'same-origin';
}

export function createProfileService({filename = process.env.WEE_PROFILE_DB || resolve('.wee-data/profiles.sqlite'), store, secureCookies = process.env.NODE_ENV === 'production', now = Date.now} = {}) {
  const persistence = store || new ProfileStore({filename, now});
  const attempts = new Map();
  const cookie = (request, value, expire = false) => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire ? 0 : 604800}${secureCookies || request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
  const send = (response, status, data) => {
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
    response.end(JSON.stringify(data));
  };
  const rateLimit = request => {
    const key = request.socket.remoteAddress || 'unknown';
    const at = now();
    for (const [ip, bucket] of attempts) if (bucket.until <= at) attempts.delete(ip);
    const current = attempts.get(key) || {count: 0, until: at + 15 * 60 * 1000};
    if (attempts.size > 1000 && !attempts.has(key)) fail('too-many-attempts', 429);
    attempts.set(key, current);
    if (++current.count > 10) fail('too-many-attempts', 429);
  };
  return {
    store: persistence,
    close: () => persistence.close(),
    authenticateRequest: request => persistence.authenticate(credential(request)),
    async handle(request, response) {
      const path = request.url?.split('?')[0];
      if (path !== '/api/profile' && !path?.startsWith('/api/profile/')) return false;
      try {
        if (!['GET', 'POST', 'PATCH'].includes(request.method)) fail('method-not-allowed', 405);
        if (request.method !== 'GET' && !sameOrigin(request)) fail('wrong-origin', 403);
        if (request.method === 'POST' && ['/api/profile/register', '/api/profile/login'].includes(path)) {
          rateLimit(request);
          const session = await persistence[path.endsWith('/register') ? 'register' : 'login'](await body(request));
          response.setHeader('set-cookie', cookie(request, session.token));
          send(response, path.endsWith('/register') ? 201 : 200, {profile: session.profile,
            ...(request.headers['x-wee-client'] === 'native' ? {token: session.token} : {})});
          return true;
        }
        const profile = persistence.authenticate(credential(request));
        if (!profile) fail('not-signed-in', 401);
        if (path === '/api/profile' && request.method === 'GET') send(response, 200, {profile});
        else if (path === '/api/profile' && request.method === 'PATCH') send(response, 200, {profile: persistence.updateProfile(profile.id, await body(request))});
        else if (path === '/api/profile/history' && request.method === 'GET') send(response, 200, {history: persistence.history(profile.id)});
        else if (path === '/api/profile/recovery' && request.method === 'GET') send(response, 200, {matches: persistence.recoverableMatches(profile.id)});
        else if (path === '/api/profile/logout' && request.method === 'POST') {
          persistence.logout(credential(request)); response.setHeader('set-cookie', cookie(request, '', true)); send(response, 200, {ok: true});
        } else if (path === '/api/profile/claim' && request.method === 'POST') {
          const input = await body(request); keys(input, ['claim']);
          send(response, 200, persistence.claimGuestResult(profile.id, input.claim));
        } else if (request.method === 'GET' && /^\/api\/profile\/matches\/[A-Za-z0-9:_-]+\/checkpoint$/.test(path)) {
          send(response, 200, {checkpoint: persistence.getCheckpointForProfile(profile.id, path.split('/')[4])});
        } else fail('not-found', 404);
      } catch (error) {
        send(response, error instanceof ProfileError ? error.status : 503,
          {error: error instanceof ProfileError ? error.code : 'profile-storage-unavailable'});
      }
      return true;
    },
  };
}
