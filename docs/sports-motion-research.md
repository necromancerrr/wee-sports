# Making Tennis and Table Tennis feel better

Research reviewed 8 November 2026 against `feat/sports-platform` at `1a67d41`.
The original audit and recommendations below describe that commit. The status
table records the subsequent implementation; this document is not a
physical-phone latency benchmark.

The research prioritized a responsive, understandable control loop:
acknowledge a swing promptly, apply assistance near a reachable contact, let
players deliberately place the ball, and give opponents readable behavior.
The present fixed-step and swept-contact foundations are worth retaining.

## Implementation status

| Priority | Implemented behavior | Remaining limits |
| --- | --- | --- |
| 1. Delivery and measurement | Native Tennis now uses the same expiring, volatile swing sender as the browser. Gyro capture timestamps are mapped onto the local receipt clock, stale batches are rejected, and developer diagnostics collect local stage timings, round trips and frame percentiles. | No hardware movement-to-display measurement has been made; local timestamps and RTT do not establish end-to-end latency. |
| 2. Timing and preparation | Tennis uses reachable-contact timing with preparation waits capped at 360 ms standard / 460 ms beginner. Table Tennis uses incoming-ball prediction with a Friendly allowance capped at 450 ms. Both show non-contact preparation promptly and retain actual collision checks for a hit. | These are bounded assistance limits, not fixed delays or evidence of universally optimal timing. Real players must evaluate comfort and early/late misses. |
| 3. Placement | Web and Expo Tennis carry bounded pre-swing aim and depth through to the shot planner. Table Tennis adds pre-swing pitch depth from 0.6–1.2 m around the existing 0.9 m neutral return. Follow-through cannot rewrite the accepted shot target. | Phone orientation remains rotational control, not measured hand position. Depth sensitivity and grip comfort need iPhone playtesting. |
| 4. Rallies, practice and feedback | Tennis difficulty now influences deliberate placement; Table Tennis offers Rally/Challenge bot styles. Optional practice progresses from legal returns to a target. Table-tennis live/locked rings use shape/fill, and normal TV play hides instructional and diagnostic paragraphs while retaining scores and important announcements. | No player study has established that these styles maximize enjoyment or suit every skill level. Tutorials remain skipped at startup. |
| 5. Prediction and frame pacing | Table-tennis receiving forecasts now share live flight/table-bounce behavior and cache bounded prediction work. Both TV renderers expose frame diagnostics and adapt pixel density/shadow refresh under sustained expensive frames, without changing physics or camera framing. | GPU completion, device frame pacing and prediction under real input remain acceptance checks. No physics-engine replacement or stronger-spin tuning is claimed. |
| 6. Network route | The existing authenticated Socket.IO route remains, with newer pose data replacing older data and expiring swing delivery. | Direct WebRTC remains a conditional future experiment if route measurements justify its complexity. No new hosting service, TURN infrastructure or Expo native WebRTC module has been installed. |

Implementation details are described in [table-tennis controls](table-tennis-controls.md)
and [game quality](game-quality.md). The earlier passing test counts belong to
their recorded revisions; final integration evidence for this implementation is
tracked separately. Physical iPhone testing has not been completed.

## Original audit at `1a67d41`

| Area | Tennis | Table Tennis |
| --- | --- | --- |
| Timing assistance | Standard can hold an early swing for 650 ms; beginner for 750 ms. Animation can wait until an authored contact is reachable. | Friendly can hold an early swing for 800 ms before forward contact motion. |
| Placement | Planner supports explicit `aim`, but gameplay does not supply it. Forehand/backhand, timing and hitter position choose the side. Primary depth is 8.5 world units, with a 7-unit fallback. | Phone pointing chooses lateral placement; Friendly depth is fixed at 0.9 m on the opponent's side. |
| Contact | A swept racket contact is required, then the arcade planner selects a legal ballistic launch. | A finite swept paddle contact is required. Friendly computes one launch toward the captured target; Standard uses the contact response. |
| Opponent | Difficulty changes reaction, movement and power, but shot policy is limited. | Friendly bot returns target the center, with fixed reaction and reach parameters. |
| Transport | Web swings have an 80 ms writable-transport deadline; native swings use the ordinary acknowledged request path. | Browser and native already send volatile poses, with sequence checks and 12 ms gates. |

The buffer durations are **maximum assistance windows**, not measured latency
on every shot. Their existence can explain a disconnected-feeling swing, but
physical testing must establish which stage dominates a particular complaint.
The native Tennis transport difference is a code-supported congestion risk,
not a reproduced claim about the user's connection.

Original code references: `src/Tennis/gameLogic.ts`, `src/Tennis/shotTrajectory.ts`,
`src/tabletennis/game.js`, `src/tabletennis/shot.js`,
`src/network/swingRequest.js`, `apps/controller/src/session.js`.

The following sections preserve the research rationale and proposed validation
as written for that audit. Refer to the implementation status above for what
has since changed; descriptions such as “current integration” below mean the
audited `1a67d41` code.

## Priority 1: measure the whole action and make swing delivery consistent

Extend the existing Tennis recognition/delivery/contact timing statistics with
one correlated diagnostic trace: sensor receipt, recognition, transmission,
server relay, TV receipt, first visible preparation, contact and confirmation.
Measure sensor cadence, dropped/coalesced input, transport type, and median,
95th and 99th percentile frame times alongside network round trips.

Keep local durations on each device's monotonic clock. Phone and TV timestamps
cannot be directly subtracted without a clock-offset model; RTT divided by two
is not measured motion-to-screen latency. Use high-frame-rate video of physical
phone movement and the TV to validate the visible result. Keep these diagnostics
out of the normal controller UI. [Sources 1, 2, 3]

Give native Tennis an expiring, non-replaying swing-delivery path comparable to
the browser's. A congested connection should reject an old swing rather than
release it into a later rally. Retain action identity and explicit rejection or
unknown outcomes. Lobby changes and durable bowling actions need their own
delivery rules; do not make every message volatile. Test congestion, reconnects,
lost acknowledgements and duplicate delivery. [Sources 2, 3]

Expo Gyroscope supplies a sensor timestamp, while current integration uses JS
receipt time. Record capture-versus-receipt age first; if batching is material,
map native timestamps to the local clock and reject stale bursts. The existing
native sensor clock helper is a starting point. Native-driver artwork already
helps, but it does not move the sensor/network code off the JS thread. Profile
release builds, since development mode has extra cost. [Sources 4, 5]

## Priority 2: contact-aware timing assistance and immediate acknowledgement

For both sports, show a small preparation response as soon as a deliberate
gesture is recognized. Reserve the impact sound, contact effect and stronger
haptic for a confirmed hit. This makes accepted movement visible without
pretending that a ball was struck before contact.

Replace broad waiting windows with bounded assistance based on predicted time
to a reachable incoming-ball contact. Compare shorter windows with the current
defaults; do not assume one duration suits both sports, every grip or beginners.
Allow one waiting gesture for the current receive, discard expired actions, and
keep the active forward stroke's target fixed.

Judge an experiment by gesture-to-preparation delay, assistance waiting time,
early/late misses, false hits, duplicate hits and player comfort. Simply reducing
the buffer can make beginners miss more often. Preserve finite collisions and
the recent fix that lets a newer waiting gesture replace an older target.
Continuous visual input should not wait unnecessarily for physics ticks, but
visual acknowledgement must remain distinct from authoritative contact.
[Sources 6, 7]

## Priority 3: give players useful shot choices

**Tennis:** connect bounded pre-swing aiming to the planner's existing `aim`
input. Start with understandable left/center/right placement while preserving
automatic movement. Timing can affect shot quality without unexpectedly taking
over the player's intended side. Add short/deep choices after lateral control
is repeatable.

**Table Tennis:** use a small, bounded component of pre-swing pitch to choose
short versus deep placement, visible in the existing landing ring. Keep power
separate from placement. Preserve the requested forehand-left/backhand-right
tendency as assistance while letting deliberate aiming dominate. Do not let
follow-through rewrite the target. This is an experiment: pitch may be coupled
to a player's grip, so test it before enabling it by default.

Avoid another calibration checklist or additional phone buttons. Phones provide
rotation and acceleration, not reliable absolute hand position. Full physical
racket tracking cannot be obtained from gyro integration alone. [Source 8]

Test repeatability at the same aim with different power, intentional opposite
placement, both hands, screen orientations and both split-screen cameras.
Meaningful control means players can intentionally change outcomes, not merely
that more ball trajectories exist.

## Priority 4: readable rallies, practice and feedback

Use the existing practice mode for a short optional challenge: three clean
returns, then a clearly marked target. Keep tutorials automatically skipped at
startup. Brief TV cues such as “Early” or “Late” should appear only when the
game can establish that reason; do not label every miss a timing error.

Make the same ring visibly distinguish live aiming from an accepted/locked
stroke through a small shape/fill change. Use contact audio and restrained ball
feedback to make successful hits satisfying. Avoid persistent diagnostic labels
and distracting effects over the rally. Haptics are an enhancement: Expo notes
that iOS can suppress them in Low Power Mode, with Camera/dictation active, or
when disabled; browser vibration also depends on support. Visual/audio feedback
must carry the meaning independently. [Source 9]

Give bots readable styles: a cooperative opponent returns reachable balls;
a challenge opponent varies safe placement and depth. Retain bounded reaction,
movement and the same collision rules. Use explicit difficulty or clearly
offered changes between matches, not hidden mid-rally score manipulation.
Measure rally-length distributions, one-sided matches, deliberate winning shots,
and whether players want another game. Longer rallies alone do not establish fun.

## Priority 5: improve prediction and frame pacing where measurements justify it

Table-tennis receiving prediction uses linear horizontal travel, ballistic height
and an approximate bounce, while live physics includes drag, spin and contact
friction. Measure prediction error against actual simulated crossings across
pace, height, spin and short/deep bounces. If meaningful errors appear, share a
bounded version of the live force/contact model with the predictor and cache
its results. Do this before increasing spin strength.

Retain fixed-step simulation and swept collision detection. Sources support
those mechanisms for stable contacts and avoiding tunneling; they do not show
that changing engines would improve this game's input feel. Tennis uses legacy
scaled units and Table Tennis uses metres/seconds, so do not copy physical
constants between them. [Source 7]

Aim for stable rendering on the actual TV/computer, including two-player views.
Profile shadows, pixel ratio and scenery before raising physics frequency.
Consider adaptive visual quality if frame-time spikes are the cause. Keep the
aim marker responsive: ordinary previous/current interpolation displays one
physics tick in the past, and extrapolating a ball through a bounce can predict
the wrong position. Choose presentation smoothing separately for aim, camera
and ball. A 120 Hz solver does not guarantee a 120 FPS display. [Sources 5, 6]

## Later experiment: a shorter network route

Compare a secure local route, the current tunnel, and a nearby persistent game
server. Sharing Wi-Fi does not guarantee a local path if the phone connects
through a public tunnel. Vercel hosting the frontend does not determine the
separate gameplay socket's route.

Prototype direct phone-to-TV WebRTC only if measured relay delay warrants it.
Unordered, limited-retransmission data channels can suit replaceable poses;
retain sequence/generation validation, bounded sending and automatic fallback.
ICE/STUN/TURN and Wi-Fi isolation mean a direct or faster route is not guaranteed.
Socket.IO volatile messages still use the underlying transport's ordering; they
do not turn WebSockets into UDP. React Native WebRTC also requires native setup
and is not included in Expo Go by default. [Sources 2, 3, 10, 11]

## A practical first validation pass

Use the same iPhone for Safari and a release Expo build, the same TV and the same
network route. Cover solo and two-player games, both hands, gentle/fast swings,
holding aim still, rapid placement changes, short/deep balls and background/resume.
Then repeat under congestion and a slower TV frame rate.

Compare the current build against one change at a time. Log response and miss
distributions, verify no idle/duplicate/stale hits, and ask players whether the
result matched their intended shot. Start with delivery parity and timing help,
then placement, feedback and bot variety. Re-run the existing contact, motion,
reconnect and browser suites for each implementation; the earlier passing tests
are a baseline, not proof that these proposed experiments work.

## Primary sources checked

1. [W3C High Resolution Time](https://github.com/w3c/hr-time/blob/gh-pages/index.html): monotonic timing and clock semantics.
2. [Socket.IO emitting events](https://github.com/socketio/socket.io-website/blob/main/docs/categories/04-Events/emitting-events.md): volatile events may be dropped when transport is not ready; latest-position use case.
3. [Socket.IO delivery guarantees](https://github.com/socketio/socket.io-website/blob/main/docs/categories/01-Documentation/delivery-guarantees.md): ordering and delivery are separate guarantees.
4. [Expo Gyroscope](https://github.com/expo/expo/blob/main/packages/expo-sensors/src/Gyroscope.ts) and [DeviceSensor](https://github.com/expo/expo/blob/main/packages/expo-sensors/src/DeviceSensor.ts): measurement timestamps, radians/second and requested update intervals.
5. [React Native performance](https://github.com/facebook/react-native-website/blob/main/docs/performance.md): JS/UI frame budgets, native-driven animation and release-build profiling.
6. [Godot interpolation introduction](https://github.com/godotengine/godot-docs/blob/master/tutorials/physics/interpolation/physics_interpolation_introduction.rst) and [advanced interpolation](https://github.com/godotengine/godot-docs/blob/master/tutorials/physics/interpolation/advanced_physics_interpolation.rst): presentation delay, extrapolation limits and responsive continuous input.
7. [Box2D simulation documentation](https://github.com/erincatto/box2d/blob/main/docs/simulation.md): fixed steps, substeps, continuous collisions and time of impact. This is a design reference, not a proposal to use a 2D engine here.
8. [W3C Device Orientation and Motion](https://github.com/w3c/deviceorientation/blob/main/index.bs): reference frames, rotation and acceleration sensor information.
9. [Expo Haptics](https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/haptics.mdx): native/browser support and conditions that suppress feedback.
10. [W3C WebRTC](https://github.com/w3c/webrtc-pc/blob/main/webrtc.html): ordered delivery, bounded retransmission/lifetime and buffered data.
11. [React Native WebRTC](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/README.md): native module requirements and Expo development-build integration.
