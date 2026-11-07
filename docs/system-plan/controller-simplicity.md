# A simpler phone controller

The chosen flow is **scan → Play → allow motion if asked → play**. The player
does not need to enter a name, choose a hand, confirm a grip, pass a direction
check, press Ready, or arm every bowling delivery. Touch is always available.
The phone shows the current turn and one useful cue; optional settings live
behind Options. Returning to the lobby pauses automatic entry so the group can
choose another game instead of immediately restarting the previous one.

This is automatic setup, not a claim that a phone knows the player's position
or the television's direction. The visible controller can be simple while its
input checks remain strict.

## What the sensors establish

Research checked the standards and browser implementations on 2026-11-07:

| Question | Evidence and design consequence |
| --- | --- |
| Can scanning grant motion access automatically? | No. When a permission prompt is needed, the [W3C permission algorithm](https://w3c.github.io/deviceorientation/#dom-devicemotionevent-requestpermission) requires transient user activation. The top-level Play tap requests access before waiting for a network join. The controller iframe reuses granted access. |
| Does a gyroscope provide position? | No. It provides angular velocity. Gravity can help estimate tilt when acceleration is quiet; neither tells us which way the TV is, the player's hand, or the phone's position in the room. Controls use bounded virtual paddle movement rather than double-integrating acceleration as a position tracker. |
| Can relative orientation drift? | Yes. The [Relative Orientation Sensor definition](https://w3c.github.io/orientation-sensor/#relative-orientation-sensor-type) describes an arbitrary reference frame and drift. Neutral setup and recentering operate on that local reference; they do not identify a world heading. |
| Can hidden pages keep playing? | The [DeviceMotion processing model](https://w3c.github.io/deviceorientation/#devicemotion) requires visible documents for event dispatch. The app clears pending input when hidden or samples go stale and waits for fresh readings on return. It never completes a swing from buffered pre-background samples. |
| Which axes does `rotationRate` use? | The [DeviceMotion rotation-rate interface](https://w3c.github.io/deviceorientation/#device-motion-event-rotation-rate-api) defines `alpha = X`, `beta = Y`, `gamma = Z`. That differs from DeviceOrientation Euler angles (`alpha = Z`, `beta = X`, `gamma = Y`). The two APIs must not share a guessed axis mapping. |

The axis distinction was corroborated in the actual browser engines:

- Chromium's [device_motion_event_pump.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_pump.cc)
  passes gyro `x`, `y`, `z` to the `alpha`, `beta`, `gamma` constructor in
  [device_motion_event_rotation_rate.cc](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/device_orientation/device_motion_event_rotation_rate.cc).
- WebKit's [WebCoreMotionManager.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm)
  converts the native `x`, `y`, `z` rates to degrees, and
  [DeviceMotionClientIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/DeviceMotionClientIOS.mm)
  forwards them in the same order.

This corrects the earlier canonical adapter assumption while preserving the
browser detector's legacy degree-based inputs through its paired inverse.
Native gyroscope radians now enter the same physical axis contract. Bowling
aim now treats opposite gravity/support-vector signs equivalently for a
screen-up grip, with a unit regression and no browser-name detection. A player
should not need to compensate manually for platform gravity-sign conventions.

## Automatic input setup

The shared startup guard uses a short continuous window of actual gyro samples.
Permission alone is not evidence of a functioning sensor. Initial startup can
use zero provisional bias rather than wait indefinitely for stillness; a quiet
window at a safe game boundary can refine it later. No bias or neutral update
is applied in the middle of a swing. Missing axes remain unavailable rather
than silently becoming zero measurements.

Motion denial or missing sensors selects touch controls automatically. A player
can switch back to motion with a deliberate tap. Backgrounding, screen rotation,
sample gaps and changing sports clear stale gesture state. Setup acknowledgement
belongs to the matching request, so a late reply cannot enable an obsolete mode.

## Concrete bowling behavior

When it is your turn, a brief quiet interval makes a delivery eligible. Tilting
shows a live aim line on the TV. The line freezes when a deliberate forward
swing begins, rather than when a separate Arm button is tapped. The detector
requires forward rotation followed by deceleration; a backswing alone does not
bowl. Wrist turn during the delivery sets bounded left/right curve. It does not
need a handedness setting to reverse the television's left and right.

One release stays latched until the authoritative game advances from rolling
to the next ready turn. An acknowledgement, reconnection or timeout cannot
manufacture another delivery. A short interrupted gesture is discarded, and
the next delivery begins from fresh motion.

## Table-tennis direction

The implementation review found physical errors in spin torque and an input
mapping that treated angular speed as paddle position. That could pull the
paddle backwards as a stroke slowed and make ordinary contacts nearly vertical.
Those mechanics were corrected independently of the new phone layout.

The controller now maps compact strokes into bounded virtual paddle motion,
keeps recovery movement separate from contact, and uses declared Friendly
assistance for reach. Spin and ball flight still follow
physical contact. Practice counts a legal return reaching the other side rather than every
paddle collision. Automatic feeds and serves remove the repeated Feed/Serve
tap. Deterministic tests require legal returns in at least 100 of 108 selected
stroke timing/speed/duration combinations and more than 20 legal returns in a
synthetic bot game. These fixtures establish useful software behavior, not
real-phone recognition accuracy.

## Verification and limits

Final validation passed 476 root tests in 53 files, 161 standalone Node server
tests, 24 native tests, TypeScript, the six-page production build and Android/iOS
bundle exports. These suites overlap and are not summed into a coverage claim.

The [touch/profile/recovery report](browser-smoke.json) passed 12 browser checks.
The [generated-motion report](browser-motion-smoke.json) passed 11 checks through
the real controller, socket and host paths, including sensor permission-call
timing, automatic startup, opposite bowling curve, background/gap cancellation,
table-tennis pose continuity, denied/silent fallback and Wait for friends. Both
runs had zero uncaught page errors. Mobile visual review at 375×812 found no
horizontal overflow.

The reusable runners are
[`browser-platform-smoke.cjs`](../../scripts/browser-platform-smoke.cjs) and
[`browser-motion-smoke.cjs`](../../scripts/browser-motion-smoke.cjs). One browser
regression exposed a table-tennis freshness-clock mismatch: the animation-frame
batch time sometimes preceded a just-received sensor sample. Using the actual
performance clock fixed the repeated setup reset. Hidden-page input now clears
immediately even when browser timers freeze, and permission-granted but silent
sensors select touch after three seconds instead of leaving the player waiting.

Generated events can verify axes, lifecycle gating, one-shot behavior, curve
direction and permission-call timing. They cannot establish real sensor quality,
real permission dialogs, comfortable grips, haptic output, physical latency or
the feel of a complete game. Those remain physical-device acceptance trials.
