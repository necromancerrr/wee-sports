# Controller return and input delivery

## Phone navigation

Web and Expo expose **Go home** without opening Tools, including during
reconnection. Home stops input and preserves the existing private seat proof.
**Return to room** explicitly resumes that identity while it remains valid;
**Forget room** removes the shortcut. No token is placed in a URL.

**Leave room** clears local state immediately, with a best-effort server leave.
It does not wait for an offline server. Closing the room on the TV returns the
phone home; a temporary TV departure instead explains that the TV is missing.
Late join/resume responses cannot override a subsequent departure. Expo secure
storage writes are ordered so a late save cannot restore a forgotten room.

These are shortcuts into existing server rooms, not durable lobby saves.
The normal player reservation remains 60 seconds. Server restarts expire live
rooms; existing saved-match recovery rules are unchanged.

## Tennis and bowling response

- Tennis records bounded aim history and captures the pose immediately before
  the recognized swing starts. Repositioning below the gesture threshold no
  longer freezes an older target. Web and Expo map the onset to the same sensor
  clock; gaps and calibration changes discard stale history.
- Tennis fast recognition retains at least 40 ms of post-peak evidence while
  accepting sustained deceleration sooner. The 19 recorded strokes preserve
  their labels: peak-to-recognition median 84 to 66 ms, p95 150 to 117 ms.
- Bowling can release after two quiet samples and 40 ms of deceleration. Active
  wrist turns retain the original 80 ms spin window. Straight synthetic traces
  at 30–100 Hz save 17–33 ms with identical power/spin; active and late curves
  keep their previous result and timing.
- Bowling releases wait at most 80 ms for a writable transport on each relay
  leg, then expire. They use volatile delivery and are never retried or replayed
  on reconnect. The server rechecks the player, TV, game, turn and generation.
- A correlated definite rejection permits a new deliberate roll. Missing
  acknowledgements, including a lost game-iframe reply, remain **outcome
  unknown** and cannot unlock a duplicate release. Bowling's 5 s outer reply
  deadline allows the server's 2.5 s delivery outcome to settle; it does not
  extend the 80 ms transport wait.

Recorded recognition and synthetic release measurements exclude wireless,
Railway, TV rendering, sensor delivery and physical motion-to-display time.
The phone-to-Railway-to-TV route remains. Use the existing opt-in diagnostics
to distinguish network round trips, input confirmation and rendering delays.

## Regression coverage

`npm test`, `npm run test:server`, `npm --prefix apps/controller test` and
`npm run test:motion` cover aim clocks, recorded gestures, stalled transport,
eight-player bowling on WebSocket/polling, uncertain outcomes, room departure,
reconnection races and private storage. Browser recovery checks exercise the
production build with separate TV and phone contexts. These checks do not
replace physical iPhone and TV testing.

Validation on 2026-11-08: the full game/client run passed 773 checks, followed
by 42 focused checks after the final iframe-acknowledgement correction; all
200 standalone server and 83 native checks passed. TypeScript, ESLint, the
six-page production build and iOS/Android Expo exports passed. All seven
[phone-home browser scenarios](system-plan/controller-home-recovery-browser.json)
and all nine [game lifecycle browser checks](system-plan/controller-home-game-lifecycle-browser.json)
across bowling, table tennis and tennis passed with no uncaught page errors.
