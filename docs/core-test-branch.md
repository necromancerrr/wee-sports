# Four-proposal test branch

`test/prs-1-2-4-5` is a branch on `necromancerrr/wee-sports` for testing the four
functional proposals together before publishing PRs.

`fix/browser-motion-regressions` is the repair candidate derived from that test
branch. The original proposal refs are preserved; `repair/pr-*` branches carry
the corresponding fixes in stack order for separate validation before PRs.

The base is `ab98186` (`pr/5-profiles-and-production`), which already contains:

| Proposal | Included scope | Head included |
| --- | --- | --- |
| 1 | Platform, phone UI, controller reliability | `7a67823` |
| 2 | Tennis/Bowling gameplay, scoring, live recovery | `4dece36` |
| 4 | Expo controller | `ec2c053` |
| 5 | Profiles, saved Bowling games, production handling | `ab98186` |

Team main `78d04a0` is an ancestor; it was still the current main when checked
on November 12, 2026. The PR 14 compatibility work is included in this stack.

## Presentation and controls

- The original sport-card homepage opens directly at `/`.
- The Classic/Island switch, extra landing pages, Island artwork and PR 6 are
  excluded. Table Tennis is excluded.
- Phone UI, profiles and the existing phone-led QR lobby remain included. The
  empty Bowling lobby still shows Scan to play, the QR/code, Waiting for players,
  sound/theme controls and Close lobby.
- The sport-card hover fix is retained. It keeps the full-card click target
  stationary while preserving keyboard activation and disabled states.
- Bowling aim/curve/power can be selected before release. The ball cannot be
  steered after release. Native adjustment controls now also lock while a roll is
  pending, while the ball is rolling, and during another player's turn. They
  become available again on the player's next ready turn.

The translucent experimental header remains only in the separate
`integration/all-proposals-test` worktree. It is not part of these four proposals.
The additional hover fix belongs with proposal 1; the native control lock belongs
with proposal 4 when those proposals are next updated. Existing proposal branches
have not been changed or pushed by preparing this test branch.

## Test locally

Use Node 24 and npm 11. From this checkout:

```sh
npm ci
PORT=5201 npm run play
```

Open the address printed by the server. Port 5201 avoids an existing session on
5173. For physical-phone motion permissions, stop that server and use
`PORT=5201 npm run dev:phone` instead, following the README's cloudflared setup.
Follow `apps/controller/README.md` for an installed Expo controller.
The QR code appears once a secure phone URL is available. A plain localhost
session without a configured HTTPS origin does not advertise a phone QR link.

Use disposable profiles and test rooms. Try phone joining, Tennis forehand and
backhand, Bowling rolls/turns/scoring, pause/resume, TV reload recovery, and
background/reconnect on your actual phones. During a Bowling roll, confirm that
changing phone orientation does not steer the ball and native adjustment buttons
are disabled until the next ready turn.

## Latency interpretation

Automated checks cover sustained once-only input delivery, stale-input rejection,
reconnect cancellation and controlled delays. Tennis's 160 ms queue-wait budget
and Bowling's 80 ms transport-wait budget are internal limits, not end-to-end
latency guarantees. Physical sensors, Wi-Fi, the production server and display
rendering still require an actual-device test.

## Verification of this branch

Compile/lint and production build passed for the repair candidate, along with
872 main tests, 74 server tests and 72 native tests. Expo Android and iOS exports
passed. The five recorded
Tennis fixtures retained all 19 expected strokes in both detector modes; Bowling
gesture tests use synthetic samples, not a physical-device motion recording.

Browser checks passed for stable sport-card hover, keyboard activation, phone
entry/joining, Bowling/Tennis gameplay, scoring progression, TV checkpoint
recovery, and disposable profile registration/history. Tennis contact checks
passed for both hands and stroke directions at 0 and 120 ms injected delay.
No homepage experiment or Table Tennis entry point is served by this branch.
The unchanged QR-lobby layout was rendered using a test HTTPS-link fixture;
physical camera scanning and joining still require the secure phone session.

The local Bowling relay test delivered 16 of 16 releases exactly once across
eight synthetic players: median 0.45 ms over WebSocket and 7.65 ms over polling
(maxima 2.06 and 9.54 ms). These are same-machine relay round trips only, not
measurements of a real phone, network or screen.

## Bowling follow-up

A browser-controller regression kept the phone waiting for a release reply even
after the TV authoritatively announced the next ball. The next turn now retires
that old pending release. Same-turn pause/reconnect snapshots and late replies
still cannot unlock duplicate throws. A real-browser test drops the first roll
acknowledgement and verifies that the second ball can still be played.

The existing 250 ms steady-hand arming period is now visible as "Hold still for a
moment", followed by the swing prompt. This repair does not change gesture
thresholds, sensitivity or physics. PR 14 conflict resolution did not change
Bowling's detector or physics; earlier controller work had already changed
automatic arming and tilt/curve sensitivity compared with `update-homepage`.

The browser motion aim also passed through the touch slider's `0.05` step before
being sent to the TV. Real Chromium reproduced values such as `0.02` becoming
`0` and `0.03` becoming `0.05`, making a smooth tilt appear stepped. Motion now
keeps its precise aim independently of the slider; the TV preview, swing lock
and released ball use that same value. Touch controls retain their existing
steps. This removes input quantization without adding smoothing delay or changing
the physics, sensor thresholds or post-release steering restrictions.
`scripts/browser-bowling-aim-smoke.cjs` verifies this through the real browser
controller and authenticated room using synthetic motion. It also confirms
that tilting away after locking cannot alter the released ball's direction.

This is a correction to aiming precision, not proof that every reported TV
stutter is resolved. Automated graphics checks cannot establish the frame rate
of a physical TV or motion-to-screen latency over the phone's network.

## Automatic-motion repair candidate

The review reproduced two more problems: a diagonal positioning movement could
lock and release an automatic Bowling throw, and a 280 ms foreground sensor gap
caused another approximately 180 ms of frozen aim after fresh readings returned.

Automatic swings remain automatic. A candidate now requires three supporting
samples, 40 ms and 8 degrees of forward-dominant movement before locking the
pre-candidate aim. The final release checks, power/curve formulas and TV physics
are preserved. Browser setup survives brief foreground gaps, while interrupted
gesture evidence is discarded. Saved Tennis strength is also restored after
fresh sensor readiness without saving provisional bias as verified calibration.

The real-browser regression rejects the reproduced diagonal/twitch motion,
keeps intermediate aim precision, and accepts one genuine roll with the exact
locked direction. A separate browser probe preserves readiness through a 320 ms
sensor interruption and resumes fresh aim without a throw. These use synthetic
sensors; actual-device feel is still an acceptance check.

[Controller ownership and state transitions](controller-design.md) is the
concrete design contract. The Bowling and shared-motion notes now describe the
actual filters, player capacity and checkpoint behavior instead of older settings.

### Independently checked proposal repairs

These local candidates preserve the original published proposal commits and form
the same dependency chain. No proposal PR or main-branch merge was created.

| Candidate branch | Commit | Main tests | Server tests | Native tests |
| --- | --- | ---: | ---: | ---: |
| `repair/pr-1-platform-phone-controller` | `fc97950` | 759 | 31 | — |
| `repair/pr-2-gameplay-and-scoring` | `76d1f38` | 825 | 51 | — |
| `repair/pr-4-expo-controller` | `aa6a20b` | 825 | 53 | 68 |
| `repair/pr-5-profiles-and-production` | `d02bf16` | 872 | 74 | 72 |

Every row also passed compile, lint, recorded-motion replay and production build.
Final PR5 has the same application and test files as the combined repair candidate;
only this test-branch document is omitted. Native profile code remains in PR5.
The candidates can advance the corresponding published branches without rewriting
their existing history after the combined candidate passes physical-phone testing.
