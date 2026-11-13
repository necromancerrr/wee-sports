# Four-proposal test branch

`test/prs-1-2-4-5` is a branch on `necromancerrr/wee-sports` for testing the four
functional proposals together before publishing PRs.

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

Compile/lint and production build passed, along with 841 main tests, 74 server
tests and 69 native tests. Expo Android and iOS exports passed. The five recorded
motion fixtures retained all 19 expected strokes in both detector modes.

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
