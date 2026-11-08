import {beforeEach,afterEach,expect,test,vi} from 'vitest';
import {EVENTS} from '../shared/protocol.js';
const h = vi.hoisted(() => ({refs:[],states:[],effects:[],ri:0,si:0,handlers:new Map(),
  request:vi.fn(),save:vi.fn(),clear:vi.fn()}));
vi.mock('react', () => ({
  useRef(value) {return h.refs[h.ri++] ??= {current:value};},
  useState(value) {const i=h.si++;if (!(i in h.states)) h.states[i]=typeof value==='function'?value():value;
    return [h.states[i],next=>{h.states[i]=typeof next==='function'?next(h.states[i]):next;}];},
  useCallback(fn) {return fn;}, useEffect(fn) {h.effects.push(fn);},
}));
vi.mock('../client/src/lib/socket.js',()=>({request:h.request,socket:{connected:true,
  on(event,fn) {h.handlers.set(event,fn);},off(event) {h.handlers.delete(event);},emit:vi.fn()}}));
vi.mock('../client/src/lib/reconnect.js',()=>({loadToken:()=> 'private',saveToken:h.save,clearToken:h.clear}));
import {useReconnect} from '../client/src/lib/useReconnect.js';
let cleanup;
beforeEach(()=>{
  vi.useFakeTimers();h.refs=[];h.states=[];h.effects=[];h.handlers.clear();vi.clearAllMocks();
  vi.stubGlobal('window',new EventTarget());vi.stubGlobal('document',new EventTarget());
});
afterEach(()=>{cleanup?.();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
function render() {h.ri=0;h.si=0;return useReconnect('player','K7PM');}
const restored = {ok:true,code:'K7PM',token:'private',phase:'game',gameId:'old-game'};

test.each(['close','leave'])('a delayed resume cannot restore gameplay after %s',async action=>{
  let reply;
  h.request.mockImplementation(event=>event===EVENTS.SESSION_RESUME?new Promise(resolve=>{reply=resolve;}):Promise.resolve({ok:true}));
  const view=render();cleanup=h.effects[0]();
  if(action==='close') h.handlers.get(EVENTS.ROOM_CLOSED)({code:'K7PM'});
  else expect(await view.leave()).toBe(true);
  reply(restored);await Promise.resolve();
  expect(render().snapshot).toBe(null);expect(h.save).not.toHaveBeenCalled();
  if(action==='leave') expect(h.request).toHaveBeenCalledWith(EVENTS.PLAYER_LEAVE,{code:'K7PM',token:'private'});
});

test('closing a room during the motion permission sheet invalidates its pending join',()=>{
  h.request.mockReturnValue(new Promise(()=>{}));
  const view=render();cleanup=h.effects[0]();
  const ticket=view.beginJoin();
  h.handlers.get(EVENTS.ROOM_CLOSED)({code:'K7PM'});
  expect(view.accept(restored,ticket)).toBe(false);expect(render().snapshot).toBe(null);
});

test('a saved-room account mismatch stops reconnecting without discarding a valid seat token', async()=>{
  h.request.mockResolvedValue({ok:false,error:'recovery-owner-required'});
  render();cleanup=h.effects[0]();
  await Promise.resolve();
  expect(render().reconnecting).toBe(false);
  expect(render().ended).toBe('recovery-owner-required');
  expect(render().snapshot).toBe(null);
  expect(h.clear).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.request).toHaveBeenCalledTimes(1);
});

test.each(['timeout','rate-limited','server-shutting-down'])('a transient %s keeps retrying the same seat',async error=>{
  h.request.mockResolvedValueOnce({ok:false,error}).mockResolvedValue(restored);
  render();cleanup=h.effects[0]();
  await Promise.resolve();
  expect(render().reconnecting).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(render().snapshot).toEqual(restored);
  expect(render().reconnecting).toBe(false);
  expect(h.clear).not.toHaveBeenCalled();
});
