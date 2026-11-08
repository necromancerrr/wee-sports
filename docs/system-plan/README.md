# Sports platform implementation and trials

This runbook accompanies the implementation of `wee-sports-system-plan.zip`.
The plan is design input, not evidence that its proposed performance or hardware
acceptance targets have been achieved. Browser guest play remains the default;
accounts and the native controller are optional.

## Development

Use Node 24 and the existing checkout. Install root dependencies with the saved
cloud environment install script when available. In another development machine,
follow [the build manual](../../manuals/BUILD.md). Root npm installation also
resolves the local `@wee/shared` workspace for standalone Node server tests:

```sh
npm ci
npm run dev:local
```

The combined development server listens on port 5173. For actual phone motion,
use a trusted HTTPS deployment or the existing `npm run dev:phone` launcher after
installing `cloudflared`. A plain HTTP LAN address cannot provide sensor access
on all browsers. A normal camera scan must open browser joining directly.

The cloud environment can validate browser behavior using simulated controllers
and software rendering. It cannot establish physical phone sensing, haptics, or
motion-to-display timing without the owner's hardware.

## Checks

Some legacy output files under `build/` and `dist/` are tracked despite the ignore
rules. Use separate cache/output paths to avoid changing them during validation:

```sh
mkdir -p /tmp/wee-sports-checks
npm run compile -- --tsBuildInfoFile /tmp/wee-sports-checks/tsconfig.tsbuildinfo
npm test -- --maxWorkers=4
npm --prefix server test
WEE_BUILD_DIR=/tmp/wee-sports-checks/dist npm run build
node scripts/replay-motion.mjs --json /tmp/wee-sports-checks/motion-replay.json
```

The replay command refuses to overwrite an existing report; choose a fresh
filename for another run. The server suite includes sustained transport tests
and normally takes about a minute. A successful build alone does not establish
that phone control or complete games work.

For production-equivalent browser testing after the build:

```sh
PORT=5174 WEE_PROFILE_DB=/tmp/wee-sports-checks/profiles.sqlite WEE_BUILD_DIR=/tmp/wee-sports-checks/dist node server/main.js --production
```

With Playwright available to Node and a Chromium executable installed, run the
integrated smoke against that disposable server in another terminal:

```sh
WEE_SMOKE_URL=http://127.0.0.1:5174 WEE_SMOKE_REPORT=/tmp/wee-sports-checks/browser-smoke.json node scripts/browser-platform-smoke.cjs
```

`WEE_SMOKE_CHROMIUM` overrides the default `/usr/bin/chromium` executable;
`WEE_SMOKE_SCREENSHOT` optionally saves a Table Tennis screenshot. The script
creates a synthetic account in the selected database, joins rooms in separate
browser contexts, uses Play and automatic touch fallback, checks host reload and Profile Continue,
and closes its rooms on success. Use a test database. Report files are created
without overwriting prior results. Playwright is an environment validation
dependency and is not bundled with the game.

The separate `scripts/browser-motion-smoke.cjs` accepts the same environment
variables and generates deterministic sensor events through the real browser
and authenticated room. It checks permission-call timing, automatic readiness,
single bowling releases, curve direction, sensor gaps and visibility changes.
Its sensor/permission mocks are software evidence, not real phone acceptance.
See [the controller design and research](controller-simplicity.md).

`scripts/browser-party-smoke.cjs` checks an eight-player bowling lobby, sequential
Play readiness, ninth-seat rejection, player-eight reconnect, compact standings,
and two table-tennis phones making real paddle contacts. It accepts the same
server and report variables. `WEE_PARTY_SCREENSHOT` saves the eight-player TV view.
Run browser checks separately from CPU-heavy physics suites on shared machines.

## Owner trial: bowling

1. Create a Bowling room on the display, choose the party size (up to eight), scan its QR with the normal phone
   camera, and join as a guest. No account or native app is required.
2. Tap Play and allow motion if asked. No name, grip checklist, Ready button or
   per-roll Arm button is required. Confirm left/center/right aim on the display;
   the line freezes when the forward swing begins.
3. Try several backswing-only preparations: none should release. Compare gentle,
   medium and stronger forward deliveries. Aim should freeze during delivery.
4. Finish ten frames, including normal second balls. Record missed or false
   releases and whether standing pins preserve their positions between balls.
5. Pause, background the phone briefly, reconnect, and resume. No old motion
   should become a new roll. Repeat with button controls after denying motion.

Use automated scoring cases for all gutters (0), nine then miss (90), five-spares
with a five fill ball (150), and twelve strikes (300). These deterministic
oracles complement a real game; neither substitutes for the other.

## Owner trial: table tennis

1. From the same room, return to the lobby and choose Table Tennis. Check that
   the player name and seat remain; fresh motion samples set up the paddle
   automatically without another permission prompt or direction check.
2. Solo starts a scored bot match. Choose Practice for repeated feeds, then try
   compact flat returns and upward/downward brushing. In Friendly mode an idle
   paddle must not hit the ball; make a deliberate short swing after the bounce.
3. Try touch controls; use the standalone diagnostic view for keyboard controls
   to distinguish sensor mapping from simulation behavior. The ball should react at physical paddle contact,
   without waiting for a completed tennis swing animation.
4. Pause and recenter between points. Neither action should cause an invisible
   high-speed strike. Test a short interruption and confirm stale input is frozen.
5. Set the TV party size to two before joining a second phone and play head to
   head. Both paddles must respond to their own phone. Finish a game at 12 with
   a two-point lead, rematch, and switch back to bowling. Verify deuce,
   alternating service at deuce, and serve lets through the automated rule cases.

Assisted reach and an assisted serve are accessibility/gameplay choices. They
do not establish room-scale phone tracking or full tournament officiating.

## Optional accounts, history, and recovery

Guest play must remain usable when account storage is unavailable. Follow the
profile UI for registration/sign-in and preference changes. Test another account
in a separate browser context to verify isolation; public room codes never grant
profile access or host privileges.

Only report a game boundary as saved after its checkpoint is acknowledged.
In-memory phone reconnect is different from durable host recovery. Recover only
the supported stable boundary; an interrupted roll or rally must be repeated
from that boundary, not reconstructed from missing mid-flight state. Confirm
the actual persistence and recovery capabilities in [acceptance evidence](acceptance.md)
before relying on a process restart.

To continue a saved solo Bowling or Table Tennis game, sign into the owning
profile on the display and choose **Continue on this screen** under Profile &
history. Join the new code from a phone signed into the same profile, finish
tap Play. Sensor setup and readiness complete automatically. The original saved source remains read-only;
progress continues under a new game identity. A source can have only one active
continuation and disappears from available sources after continuation. Party
archive recovery and existing Tennis score recovery are not implemented.

## Native controller

The optional project lives in [apps/controller](../../apps/controller/). Its own
README covers the pinned SDK, development build, QR/manual pairing, permissions,
and native validation. Use the same host, phone, network route, game settings and
assists when comparing native and browser behavior. A successful bundle or type
check does not prove device sensor axes, permission handling, or haptic output.

## Recording a trial

Use [the acceptance report](acceptance.md) to record build/source revision,
device and browser/OS, connection route, settings, procedure, expected and actual
results, sample counts, timing distributions, video/trace paths, and limitations.
Never label detector replay or localhost acknowledgement timing as measured
physical motion-to-display latency.
