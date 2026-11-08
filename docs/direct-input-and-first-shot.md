# Faster racket input and first-shot placement

## Browser input route

Supported browser controllers now negotiate a direct WebRTC data channel with
their TV. On a reachable local network, racket input avoids the trip through
Railway. Railway still owns rooms, player identities, game generations and
signaling; the TV still simulates the game and reports its state.

The channel carries tennis swings, table-tennis poses and correlated tennis
results. Bowling retains its current delivery path. Expo retains the server
route and gains the shared table-tennis timing/intent fixes.

No external STUN/TURN service is configured. Unsupported browsers, isolated
Wi-Fi clients and failed negotiation use the existing server relay. Direct
input requires a current server lease, matched game/generation/TV epoch and
healthy peer heartbeat. It stops on pause, background, departure or replacement.
Failed negotiation retries back off from 5 seconds to 60 seconds; a browser
that refuses to construct a peer connection disables the attempt for that session.
Packets expire, channels use bounded retransmission without ordered delivery,
and both routes share input deduplication. An uncertain sent swing is never
resent through the fallback. A lost direct connection can lose detailed stroke
feedback; the ordinary server hit feedback and authoritative game state remain.

Opt-in diagnostics add `direct.roundTripMs`, direct delivery counters and
`swingRoute.direct/server` or `poseRoute.direct/server` in the bridge scopes.
They measure local durations and round trips, not physical motion-to-display
latency. The actual browser/network must support a direct route to gain its
network benefit.

## Placement and contact

Table tennis distinguishes a steady aim adjustment from a compact stroke.
Moderate aiming no longer consumes the first serve/return with the old target.
Gentle strokes require a small rise and fall; stronger strokes commit after
minimum travel. The phone's validated monotonic sample time survives both
routes, so packet batching cannot redefine the gesture's duration. Receipt
time still governs freshness. The relay admits at most six fresh timed samples
in a burst, replenished at 60 Hz by server time, without storing a replay queue.

Tennis starts confirmed serves closer to their actual racket contact and
chooses the earliest robust assisted contact window. Tests with the shipped
models simulate receipt-to-contact at 8–17 ms of game time for serves (previously
50–58 ms), and 0–67 ms improvement across the tested rally matrix. These exclude network,
sensor and screen delays. The real collider still decides contact, including
necessary waiting when an incoming ball has not reached the racket.

The table-tennis island receives another small lift to ambient light, sky and
water while keeping the blue table and white ball clearly separated.

## Fullscreen

Both countdown and direct/recovered game entry prepare the full viewport before
paint and attempt the browser fullscreen API. The lobby remains windowed.
Concurrent requests coalesce; intentional Escape/exit is respected.

A remote phone tap cannot provide transient user activation to the TV browser.
Chromium testing confirms that a start after the TV's activation expires can
reject fullscreen. On these browsers, a genuine TV-stage tap or Enter retries
immediately. No web implementation can promise automatic browser fullscreen
without the required permission/gesture. The game still fills the viewport.

## Verification

Regression suites cover first-shot targets and real legal landings for both
players, source-time batching, stale clock input, delayed tennis contact across
30/60/144 FPS, peer authentication, scope revocation, rate/queue bounds and
mixed-route deduplication.

The browser scripts require real direct delivery by default. This managed
Chromium environment sets `WebRtcIPHandling=disable_non_proxied_udp`, so offers
and answers complete but local ICE candidates are unavailable. The explicitly
selected blocked-policy checks verify real server fallback and the integrated
controller/game flow; they do **not** prove direct data delivery or its latency.
No browser or network policy was changed to get a passing result.

Fullscreen checks use the original DOM fullscreen API in headless Chromium.
They cover expired activation, a subsequent trusted TV gesture, intentional
exit and saved-match continuation. These checks cannot verify physical browser
chrome or the Toshiba TV's fullscreen support. Physical iPhone Safari and
Toshiba TV response, and direct delivery on their Wi-Fi, still require device
testing.

Recorded on 2026-11-08:

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Full Vitest suite | 806 passed across 90 files |
| Server suite | 221 passed |
| Expo controller suite | 84 passed |
| Final direct-input, GameFrame and fullscreen regression run after retry hardening | 59 passed, including 13 direct-input tests |
| Production build and six-page/model/font verification | Passed |
| Headless fullscreen API scenarios | 4 passed; physical browser chrome unverified |
| Actual controller/TV UI with confirmed blocked-ICE fallback | 4 passed; no browser errors |
| Real offer/answer, fallback delivery and pause revocation | 4 passed; direct delivery blocked by browser policy |

Reports: [fullscreen](system-plan/fullscreen-activation-browser.json) and
[controller/TV flow](system-plan/direct-game-flow-browser.json), plus
[signaling and fallback](system-plan/direct-input-browser.json). The final
focused run includes three additional retry/unsupported-browser cases added
after the full suite; its counts overlap the full suite.

For a direct-delivery check on a browser that permits local WebRTC, run
`node scripts/browser-direct-input-smoke.cjs`. The UI counterpart is
`scripts/browser-direct-game-flow-smoke.cjs`, against a running production build
selected by `WEE_SMOKE_URL`. Both require Playwright and Chromium. The scripts'
explicit blocked-ICE modes are only for a separately confirmed policy
restriction; they must not be used to label an unexpected negotiation failure
as a successful direct connection.
