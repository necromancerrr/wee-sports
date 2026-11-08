# How table-tennis motion becomes a shot

The phone supplies orientation and angular velocity. It cannot reliably measure
the position of your hand in the room. Wee Sports maps those readings into a
bounded virtual paddle and a landing target.

1. **Aim.** Turn or tilt the phone to move the landing ring across the opponent's
   table. Both players use their own camera-relative left and right. The latest
   gyro readings continue the aim between slower browser orientation updates.
2. **Swing.** A deliberate change in angular velocity and enough angular travel
   requests one stroke. An idle phone cannot hit. The target comes from the aim
   before the fast swing, so follow-through does not whip the shot elsewhere.
   A newer gesture can replace one still waiting for the ball; an active forward
   stroke keeps its target and cannot stack another hit for the following ball.
3. **Reach and contact.** In Friendly mode, the paddle moves to meet the incoming
   ball independently of your chosen landing spot. This is why the paddle and
   landing ring do not move together. A finite swept paddle face still has to
   make contact after the legal bounce; automatic positioning alone cannot hit.
4. **Placement and power.** At contact, Friendly mode calculates one outgoing
   velocity toward the captured target. Power changes pace and arc. Forehands
   favor camera-left and backhands camera-right, while deliberate pointing has
   greater influence. Wrist rotation adds bounded spin. Standard mode instead
   uses the physical paddle-face collision response.
5. **Flight and score.** After launch, gravity, air drag, spin, the net and table
   contacts determine the ball's path. The game does not steer a flying ball
   toward the ring. Scoring is first to 12, win by two.

The TV runs one simulation for both players at 120 fixed updates per second,
with four collision substeps per update. Continuous sweeps check the movement
between positions so a fast ball cannot simply skip through a thin paddle.
Contact response includes relative surface velocity, restitution and bounded
friction. These coefficients are game tuning, not a laboratory ball model.

## Responsiveness repair

- A cached browser orientation used to overwrite fresh gyro movement repeatedly,
  making aim freeze and jump when the two browser sensors updated at different
  rates. Each attitude reading is now consumed once, with gyro continuation.
- A previously queued swing could fire at its old target despite a newer swing.
  Only the newest waiting gesture is kept; the active hit remains locked.
- The ring now refreshes as soon as input arrives. Deliberate turning uses a
  smaller movement threshold; the larger resting threshold still rejects tremor.
- Automatic setup could reset held aim at live point boundaries. The reference
  now stays fixed during play. Reconnect, explicit reset and screen rotation
  still discard unsafe partial movement.

Pose messages use the existing authenticated, volatile relay. They do not wait
for acknowledgements or accumulate a replay queue. Sensor delivery, network
travel and display refresh still take time: this repair does not establish
zero latency. Generated sensor/browser tests check software behavior; actual
iPhone motion, grip comfort and wireless delay require a physical-device trial.

For that trial, aim left, hold still, then aim right before a compact swing.
The ring should follow and stay where you hold it, including between points.
Repeat with both players; a waiting earlier swing should not pull the new shot
back to its former side. Try a harder swing at the same target, then background
and reopen the phone to confirm old movement is not replayed.

Implementation: `shared/motion.js`, `src/controller/webMotionAdapter.js`,
`src/tabletennis/controllerSession.js`, `src/tabletennis/game.js`,
`src/tabletennis/shot.js`, and `src/tabletennis/physics.js`.

## Validation

On 8 November 2026, 635 root tests in 73 files and all 69 native controller
tests passed, along with TypeScript, the six-page production build and
iOS/Android Expo bundle exports. Exports are not signed installable apps.
The [ten browser checks](system-plan/table-tennis-aim-response-browser.json)
exercise the real controller, room relay and TV game: slow attitude delivery,
held off-centre aim, repeated legal returns on two swing axes, no idle hits,
and safe background/sensor-silence recovery. The camera and collision geometry
were audited without changing the physical model.
