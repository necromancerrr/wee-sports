import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {EVENTS, PHASES} from '../shared/protocol.js';

const harness = vi.hoisted(() => ({effects: [], request: vi.fn(async () => ({ok: true}))}));
vi.mock('react', async () => ({...(await vi.importActual('react')),
  useState: initial => [initial, () => {}],
  useEffect: effect => {harness.effects.push(effect);},
}));
vi.mock('../client/src/lib/socket.js', () => ({request: harness.request}));
vi.mock('../client/src/lib/useCountdown.js', () => ({useCountdown: () => 5}));
import {PhoneReady} from '../client/src/components/PhoneReady.jsx';

beforeEach(() => {
  harness.effects = []; harness.request.mockClear();
  vi.stubGlobal('React', {createElement: () => null});
});
afterEach(() => vi.unstubAllGlobals());
function render({phase = PHASES.READY, setup = 'motion', ready = false, ...props} = {}) {
  PhoneReady({lobby: {code: 'ABCD', phase, sport: 'bowling', countdown: {msLeft: 5000}, players: [{slot: 0, setup, ready}]},
    slot: 0, automatic: true, ...props});
  harness.effects.forEach(effect => effect());
}

test.each(['motion', 'buttons'])('accepted %s setup starts without an extra Ready tap', async setup => {
  render({setup});
  expect(harness.request).toHaveBeenCalledExactlyOnceWith(EVENTS.PLAYER_READY, {ready: true});
});

test.each([
  {setup: null}, {ready: true}, {disabled: true}, {allowStart: false},
  {phase: PHASES.COUNTDOWN}, {phase: PHASES.GAME},
])('automatic readiness respects setup, lifecycle and a held lobby: %j', props => {
  render(props);
  expect(harness.request).not.toHaveBeenCalled();
});
