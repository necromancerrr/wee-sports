# Table-tennis input and contact review

Reviewed on 7 November 2026 after the player reported both missed strokes and
unpredictable ball response. The code findings below describe `1e56d66`, before
this repair. Earlier target-placement tests exercised selected successful
contacts; they did not establish that ordinary phone swings reliably reach
those contacts.

## What the sources establish

| Primary source consulted | Relevant fact | Consequence for this game |
| --- | --- | --- |
| [W3C Device Orientation and Motion](https://github.com/w3c/deviceorientation/blob/main/index.bs), device motion model and rotation-rate interface | Motion supplies local acceleration and angular rate. Orientation and rotation-rate fields have different axis conventions. | The phone is an input device, not a measured six-degree-of-freedom paddle pose. Keep canonical axes and do not infer reliable room position from gyro alone. |
| [W3C Orientation Sensor](https://github.com/w3c/orientation-sensor/blob/main/index.bs), RelativeOrientationSensor model | Relative orientation is rotation against a stationary reference that can drift from gyro bias. | Use bounded virtual aim and motion intent. Quiet automatic setup/recentering cannot turn relative orientation into absolute hand tracking. |
| [W3C High Resolution Time](https://github.com/w3c/hr-time/blob/main/index.bs), clocks section | A monotonic clock does not decrease with system clock adjustments. Throttling or freezing periodic callbacks must not change its accuracy. | Measure input age and gesture expiry with the host's local monotonic arrival clock, separately from accumulated physics time. Never subtract unsynchronized phone and TV timestamps. |
| [Box2D simulation documentation](https://github.com/erincatto/box2d/blob/main/docs/simulation.md), simulation, body types and bullets | Fixed steps and substeps improve consistency. Kinematic bodies move with defined velocity; setting transforms as teleports can produce undesirable behavior. CCD addresses tunneling. | Keep a bounded fixed-step ball simulation and explicit paddle motion. Automatic repositioning must not become an unintended stroke impulse. This is a design reference, not a proposal to use this 2D engine for the 3D game. |
| [Box2D collision documentation](https://github.com/erincatto/box2d/blob/main/docs/collision.md), time of impact | Sweeps contain initial/final transforms and find the earliest contact; rotation complicates continuous collision. | Keep finite paddle geometry, test high-speed and glancing contacts, and advance the remaining time interval after each collision. |
| [Rapier rigid-body implementation](https://github.com/dimforge/rapier/blob/master/src/dynamics/rigid_body.rs), `set_next_kinematic_translation` and `set_next_kinematic_position` | Position-based kinematic targets imply a velocity over the next timestep. | Contact response must use the intended motion of the paddle over that interval, rather than a visually repositioned paddle with unrelated velocity. |
| [Bullet sequential impulse solver](https://github.com/bulletphysics/bullet3/blob/master/src/BulletDynamics/ConstraintSolver/btSequentialImpulseConstraintSolver.cpp), `setupFrictionConstraint` and `solveSingleIteration` | Contact velocity includes linear and angular terms; friction impulse is limited by the normal impulse times friction coefficient. | Compute spin-dependent slip at the actual contact and use bounded friction rather than arbitrary spin loss or unlimited tangential impulse. |

These sources do not identify a universally best table-tennis engine or certify
this game's coefficients. They support a consistent separation of input,
kinematic motion, collision time and response.

## Failure chains in the reviewed code

- `game.js` read only `angularVelocity.x` to request a stroke. A plausible
  sideways or mixed-axis phone swing could move the aim without requesting a
  hit. The accepted phone movement needs an explicit, tested gesture definition.
- `setInput()` replaced the latest pose, but stroke detection ran in
  `updatePaddles()` during render-driven simulation. A short burst followed by
  rest between TV frames could disappear. Conversely, a retained peak could be
  read repeatedly during catch-up substeps.
- Input freshness used `this.time`, a simulation clock whose catch-up was
  capped. Slow rendering therefore extended the real lifetime of stale input.
- Friendly mode enabled collision while the paddle was ready or waiting for a
  stroke. Its automatic receiving movement could hit the ball before the
  accepted forward stroke. Only a forward stroke received the stable placement
  response, so apparently similar hits could use two different response models.
- Paddle sweeps reused a whole substep's transform range after an earlier
  collision had already consumed part of that substep. Subsequent contact must
  use only the remaining interval.

## Recommended implementation

Treat phone movement as **aim plus one deliberate stroke request**. Recognize
the request when fresh input arrives, using angular travel/rate and quiet
rearming across the supported grip directions. Latch at most one short-lived
request, its aim and its power; keep the latest orientation separately. Do not
buffer an unlimited stream of old swings or let a later recovery movement
change the accepted target.

Let a bounded virtual paddle approach the receiving location, then enter an
explicit forward contact window for that request. In Friendly mode, automatic
positioning and recovery are non-contact movement. A legal finite swept contact
consumes the request once. A missed or expired request ends rather than waiting
for a future ball. Assisted placement may choose the outgoing impulse at that
contact; it must remain a declared game rule and must not steer the ball later.

Use one consistent relative contact-point velocity and bounded friction model
for the physical response. Spin must affect surface slip, rather than being
halved arbitrarily on every impact. A hollow-ball inertia approximation is a
model choice, not a measured property of every real ball. Restitution, drag and
spin strengths still need real-play evaluation; changing them speculatively
does not fix an input or contact-window bug.

An engine replacement would not recover a burst discarded before simulation,
correct the accepted swing directions, or decide when assistance may hit. Fix
those contracts first. Consider a library replacement only if remaining
collision cases demonstrably exceed the maintained solver's scope.

## Evidence required for this repair

Test the complete path from canonical samples through controller output to the
game, varying sensor rate, TV frame rate, sample/frame phase, swing direction,
power, early/late timing and contact location. Include failures as assertions:
stillness cannot rally, a preparation/recovery gesture cannot duplicate a hit,
an expired request cannot hit the next feed, and backgrounding, a sample gap,
pause or reconnect cannot replay a stroke. Check repeated contact, net/table
order, energy/slip behavior and high-speed finite-face misses independently of
the assisted landing planner.

Then play on actual phones. Synthetic fixtures can expose software mistakes;
they cannot establish comfortable movement, natural timing, sensor accuracy or
end-to-end motion latency. Keep the exact phone/browser, grip, miss examples and
reproduction steps with that acceptance evidence.

## Implemented repair and checks

The repair recognizes all three angular-rate axes on input receipt, with a
minimum angular travel and quiet rearming. It retains one request, its initial
aim and growing peak power even when a complete gesture falls between TV
frames. Host monotonic arrival time bounds freshness and request lifetime;
pause, recalibration, a sensor gap and a new feed discard old gestures.

Friendly collision is now limited to the forward stroke. Automatic receiving
movement cannot make an idle hit. Deep feeds are received near the table end;
short feeds still use bounded reach, with the blade held above the tabletop.
The finite swept paddle still has to contact the ball. The physics response
uses contact-point slip, hollow-ball inertia and a friction impulse bounded by
both normal impulse and the impulse needed to stop sliding. Subsequent
collisions use only the unconsumed paddle-motion interval. Near-horizontal
paddles retain a finite face.

On 7 November 2026, all 528 root tests in 59 files passed with two workers.
New regressions cover browser/native motion normalization, six swing
directions, 30/60/100 Hz sensors, low-rate rendering and jitter, complete bursts
between frames, stale/pause/recalibration cancellation, spin/friction response,
finite faces and sequential collision timing. TypeScript and the six-page
production build also passed.

The [production browser report](system-plan/table-tennis-repair-browser.json)
records eight passing checks through the actual controller, room transport and
host game. Generated Y- and Z-axis motion each caused a host contact and a legal
opponent-table return. Idle input caused none. The harness is
`scripts/browser-table-tennis-smoke.cjs`; with Playwright available, run it
against a built server using `WEE_SMOKE_URL=http://127.0.0.1:5173 node
scripts/browser-table-tennis-smoke.cjs`.

These checks demonstrate repaired software paths, not a physical-phone success
rate or latency result. The browser harness cycles gestures until a return,
rather than measuring the accuracy of naturally timed human strokes. The table
still uses a planar surface rather than detailed rounded-edge geometry, and
material coefficients remain game parameters. Actual-device play is still
needed to judge comfort, timing and final tuning.
