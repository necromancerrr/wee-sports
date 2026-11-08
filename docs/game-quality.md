# Consistent shots and clearer TV play

The scan → name → Play → allow motion flow keeps automatic motion setup. This follow-up focuses
on repeatable table-tennis placement, visible contact, scoring and feedback.

The subsequent [input and contact repair](table-tennis-research.md) addresses
missed phone gestures, accidental idle contacts and inconsistent spin response.
It includes primary-source research and new complete-motion-path regressions;
the earlier selected-contact checks below did not establish phone hit accuracy.

## Controller play and TV presentation

The native controller now has one play card with compact scoring. Racket
animations follow recognized swings and confirmed contacts; the bowling ball
responds to release. Native-driver transforms do not control gameplay. Pause,
Tools, backgrounding and Reduce Motion cancel decorative movement, and resuming
does not replay an old animation. Motion and haptics still need an iPhone trial.

A lobby shows the selected sport and its joined players. The leader chooses
**Start game → Start now**, including in a full room. **Keep waiting** cancels;
roster, setup or sport changes invalidate an open confirmation. Sport selection
lives in **Tools → Change sport** on the phone. Web and native still have their
own UI implementations; the proposed shared UI migration is deferred.

The lobby stays windowed. The TV requests fullscreen at countdown, then stays
in the game view. Browser denial keeps a full-window stage with a Full screen
action on the TV; the phone cannot grant the TV browser transient activation. The large 5–1
countdown keeps the original rounded type and tick animation, with the number
on its own above the lobby’s faint sports-icon backdrop. There is no colored
box behind the number; reduced-motion preferences are respected.

Two-human table tennis renders one authoritative simulation through two scissor
viewports, each looking from that player's end. Solo tennis uses one view and
two-human tennis retains two. Table-tennis aim, serve placement and raw paddle
pointing mirror into each player's camera coordinates. Forehand/backhand
recognition uses accumulated angular movement within the existing recognition
window; it adds no extra wait for classification. Deliberate aiming still
overrides the left-forehand/right-backhand tendency in Friendly mode.

The table-tennis final score and winner stay on the TV until a rematch or lobby
return. Completion takes priority over stale input and reconnect overlays. A
phone result modal no longer opens automatically for table tennis; its game
options retain replay controls.

Validation: 620 full-suite tests passed, followed by 110 focused table-tennis
tests after the final camera/contact adjustment. Native controller tests: 65.
Server startup, capacity, reconnect and relay regressions were checked, including
a targeted rerun of the socket startup fixture for explicit confirmation.
TypeScript, all six production pages and iOS/Android bundle exports passed.
[Production browser evidence](system-plan/controller-play-flow-browser.json)
covers confirmations and cancellation, both fullscreen permission outcomes,
TV-sized countdowns, 8-player bowling, actual two-human table-tennis returns,
continuous generated motion, restored TV results, phone departure and lobby
restart/sport switching for every sport. Browser input is synthetic; the restored
winner check seeds a valid 12–10 checkpoint. These checks do not measure physical
recognition accuracy or wireless latency. Exports are not signed iPhone builds.

## Join, aim and unfinished-room recovery

Web keeps **Pick up. Play.** and Expo keeps **Ready to play?**. Both show a
playing-name field before joining; scanning in Expo no longer joins a default
“Player” immediately. Both automatic ready paths request tutorial skipping,
so the server goes directly from countdown to play. Legacy vote handling remains
compatible without showing a choice or “You picked No” screen on modern phones.

All three games retain stable checkpoints on a TV departure or return to lobby.
The TV chooses **Continue game / New game**, and the controllers show a matching
waiting message. Continue preserves the match identity and score, rotates input
generation and host epoch, and starts with a fresh countdown. A different roster
invalidates the saved match. A missing TV stays reserved while any controller is
connected; an abandoned room with nobody connected still expires. Explicitly
closing a room removes its players. A late resume or join response cannot undo
Leave/Close, including a close during the motion permission prompt.

Tennis now checkpoints seven-point sets, service order and settings between
points. Its checkpoint is live-room memory, not durable profile history. Bowling
and table tennis retain their existing disk-backed checkpoints. Interrupted
rallies and rolls restart at the last completed boundary; server restarts still
expire room codes. The homepage offers a link back to the last hosted room.

Table-tennis web pose delivery allows ordinary 15–19 ms sensor jitter without
dropping alternating samples. Gentle, sustained repositioning refreshes the
stroke's aim even without a full stop; the stroke still locks its onset target
and continuous wrist movement still needs a genuine new gesture. Tests cover
both directions, stale input, sensor gaps, idle motion and the complete contact
path. Native reconnect now retains its seat across transient request timeouts
and keeps gameplay input suspended until the resume handshake succeeds.

Validation for this follow-up: 628 root tests, 170 server tests and 68 native
controller tests passed, along with TypeScript, all six production pages and
iOS/Android Hermes exports. The [browser evidence](system-plan/room-recovery-browser.json)
records name entry, countdown-only fullscreen requests, automatic tutorial
skipping, nonzero score restoration, new-game resets and controller exit, plus
generated-motion contact checks. Physical iPhone motion and wireless latency
remain device checks; exports are not signed installable builds.

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
and remains visible while recovering even when contact is disabled. Player labels identify the two paddles; table-tennis avatars and limbs have been removed.
The court now takes its setting from the homepage island's table-tennis pavilion:
a blue table on a muted deck, warm wood supports, peripheral greenery and water.
Each camera sees a cutaway at its own end so a roof beam cannot cover the rally.
Scenery has no colliders, and the table dimensions, cameras and contact geometry
stay unchanged. Trees and shoreline rocks use instanced meshes; subtle water
strokes freeze with Reduce Motion. One net mesh and bounded pixel density keep
the presentation inexpensive in both solo and split views. Score,
serve, deuce, game-point and winner banners accompany short local sound cues.
Muted, paused and hidden sessions remain silent. The TV's activated audio
context now survives sport changes.

## Rules and other sports

Tennis is best of three sets, each first to seven points, winning by two;
there are no games within sets. Each set gets an announcement and a short
break before the next serve. New table-tennis games finish at 12 with a
two-point lead; service alternates after every point from 11–11. Existing
11-point saves retain their original finish line. See [match rules](match-rules.md).

Bowling now has a filled, outlined arrow that follows accepted live aim,
turns gold when locked, hides during delivery and resets for the next turn.
Its projection uses the physical ball's release origin and direction. The
active lane and TV aim readout have clearer contrast. Tennis retains its visible avatars and Park Club background. The simplified
background and avatar removal apply to table tennis.

`GameFrame.jsx` names the existing production bridge accurately: it owns the
authenticated iframe messages, pause/reconnect gating and saved-game recovery.
Separate game documents isolate each WebGL scene's lifetime from React's lobby
updates. Renaming the bridge does not substitute for gameplay validation.

## Responsiveness

Browser table-tennis motion now sends from the sensor callback, with a 12 ms
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

Automated validation recorded for the earlier placement follow-up (`1e56d66`):

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

The subsequent input/contact repair passed 528 root tests in 59 files,
TypeScript, the six-page production build and [eight focused production browser
checks](system-plan/table-tennis-repair-browser.json). Those browser checks
include actual legal returns from generated Y- and Z-axis phone motion, idle
input, and hidden/silent sensor recovery. That earlier repair also removed Tennis avatars; the current follow-up restores
them and applies avatar removal to table tennis, as requested. Native packaging was unchanged;
the earlier Expo export results were not repeated for this repair.

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
