# Consistent shots and clearer TV play

The scan → Play → allow motion flow remains automatic. This follow-up focuses
on repeatable table-tennis placement, visible contact, scoring and feedback.

## Table tennis

Friendly mode captures a table-relative landing target when a stroke starts.
Assisted paddle movement receives the incoming ball independently of that
target; it can no longer add accidental sideways speed to the shot. The target
stays fixed while the wrist recovers. Power changes the outgoing pace. At a
real swept-paddle collision, a bounded contact calculation selects the launch
velocity and spin. Drag, gravity, spin, net and table collisions determine the
flight afterward; the game does not steer a ball in flight. Standard mode keeps
the raw paddle-contact response.

Neutral practice feeds and serves repeat. The bot has finite movement and a
100 ms reaction interval; wide placement can win a point, while repeated
centered strokes can sustain a rally. Software tests cover 27 actual-game
aim/power/receiving-position combinations and 54 mirrored contact-height/spin
trajectories, with landing error below 2 cm in those cases. These are simulation
checks, not phone recognition accuracy measurements.

The TV shows a landing ring before the shot and a marker at the actual contact
position. The rendered paddle matches the collider's position, face and size,
and remains visible while recovering even when contact is disabled. Simple
avatars and connected hands make the paddle's ownership clear. The garden
court uses static geometry, one net mesh and bounded pixel density. Score,
serve, deuce, game-point and winner banners accompany short local sound cues.
Muted, paused and hidden sessions remain silent. The TV's activated audio
context now survives sport changes.

## Rules and other sports

Tennis is best of three sets. New table-tennis games finish at 12 with a
two-point lead; service alternates after every point from 11–11. Existing
11-point saves retain their original finish line. See [match rules](match-rules.md).

Bowling now has a filled, outlined arrow that follows accepted live aim,
turns gold when locked, hides during delivery and resets for the next turn.
Its projection uses the physical ball's release origin and direction. The
active lane, TV aim readout, tennis court and avatar colours have clearer
contrast. Static backgrounds keep attention on the ball and court.

`GameFrame.jsx` names the existing production bridge accurately: it owns the
authenticated iframe messages, pause/reconnect gating and saved-game recovery.
Separate game documents isolate each WebGL scene's lifetime from React's lobby
updates. Renaming the bridge does not substitute for gameplay validation.

## Responsiveness

Browser table-tennis motion now sends from the sensor callback, with a 16 ms
minimum interval. A render frame can flush only the latest unsent sample; it
does not resend the same motion or catch up a buffered queue. Previously input
waited for a render frame and a 33.3 ms send gate. Native sends preserve the
60 Hz sensor cadence, and the server's 12 ms minimum admits normal timing
jitter while still rejecting bursts. Authentication, input generations,
foreground freshness and volatile transport remain enforced.

A regression with rendering stalled verifies that 60 fresh sensor events still
send during one second. This measures code scheduling only. Network, sensor,
display and haptic latency require measurements on an actual phone and TV;
no end-to-end latency number is claimed.

## Expo and validation

The [Expo guide](../apps/controller/README.md) covers Android SDK 58 Expo Go,
the app QR followed by the TV room QR, and iPhone development builds from
Windows, Linux or Mac. `npm run expo:install` and `npm run expo` are the root
entry points. Bundle exports are not signed installable apps.

Automated validation for this follow-up:

- 505 root tests in 56 files, using four workers to avoid shared-executor CPU
  contention in rigid-body simulations.
- 162 standalone Node server tests and 26 native controller tests.
- TypeScript, all six production pages and required model assets.
- Android/iOS Hermes exports, SDK bundled-module compatibility and live Expo Go
  development manifests/bundles.
- Production visual review of all three sports, including bowling live/locked
  aim, rejected stale aim, roll hiding, and table-tennis avatars/score layout.
- [12 production browser flow checks](system-plan/quality-browser-touch.json),
  covering optional-name pairing, the 12-point bot mode, sport switching,
  pause/reconnect, profile isolation and exact saved-game restoration.
- [11 synthetic-motion browser checks](system-plan/quality-browser-motion.json),
  including one-shot delivery, opposite curve, stale/hidden input cancellation,
  table-tennis setup and pose continuity, and denied/silent-sensor fallback.

Both browser runs completed with zero uncaught page errors.

The functional browser harness uses software WebGL. A measured bowling run
rendered 97 frames in 35.6 seconds on this shared executor; its bounded physics
clock therefore needs more wall time to settle. The harness waits up to 60
seconds for the real settled state. That timing is not a supported-device
frame-rate or latency result, and no simulation timing was changed for the test.

The automated checks establish software behavior. Real iOS/Android motion feel,
comfortable grip, haptics, network latency and installed iPhone signing remain
device acceptance checks before a production release.

For a quick phone trial: aim at one table-tennis spot and repeat five compact
strokes, then keep the aim and vary power; try left/right placement, complete a
12-point game, and background/resume once. In bowling, confirm the visible
arrow follows aim and stops changing when the delivery starts.
