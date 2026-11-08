# Tennis response and fullscreen across browsers

This repair follows the report that early swings worked but swings near the
ball missed, and that fullscreen still needed another interaction across browsers.
It preserves the courts, rules, scoring and existing controller features.

## Confirmed problems and changes

- **Late input had no valid contact window.** The game searched only future
  ball positions. With the shipped models, all eight player/hand/shot
  combinations missed at 80–160 ms late on the previous versions tested.
  Tennis now keeps 200 ms of actual ball and player transforms. An identified
  phone stroke with timing assistance may use a recent reachable contact from
  the same incoming flight when ordinary contact is no longer available.
  A contact in the current physics interval also takes precedence over an
  approximate future prediction. This resolves the idle-to-swing edge case.
- **The direct route could silently lose a discrete swing.** Its short-lived
  datagrams and 160 ms receiver cutoff were suitable for replaceable poses,
  but a controlled 180 ms TV message stall discarded a tennis action.
  Tennis now uses reliable unordered delivery, with a bounded 250 ms
  receiver allowance and explicit expiry feedback. Table-tennis poses keep
  their existing transport expiry. Accepted actions are never replayed through
  the other route.
- **Recognition used more slowdown evidence than necessary.** The fast detector
  now accepts a sustained 12% slowdown, retaining the 40 ms post-peak evidence,
  repeated readings, travel/strength checks and return suppression. Across 19
  selected recorded strokes, peak-to-recognition median fell from 66 to 51 ms
  and p95 from 117 to 100 ms, with the same labels and peaks. This is fixture
  timing, not measured phone-to-TV latency.
- **Repeated UI work and room snapshots competed with input.** Unchanged
  controller text, attributes and styles no longer trigger DOM writes on each
  poll. Unchanged sensor buffers are not reclassified by watchdog ticks.
  Direct-input lease checks use a small authoritative room view instead of
  repeatedly building public/private lobby snapshots for unrelated rooms.
- **Optional signaling could block polling input.** A controlled 120 ms polling
  POST for a direct-input lease made a fresh swing miss its former transport deadline.
  Optional direct negotiation now waits for WebSocket transport and resumes
  after an upgrade, keeping those requests out of the polling input path.
- **The polling handoff deadline was too short.** A traced ordinary handoff
  had no writable TV transport until about 145 ms, beyond the old 80 ms limit.
  Tennis now shares a bounded 160 ms queue-wait budget between phone and server;
  the phone's measured wait is deducted at the server. This excludes network
  travel and sensor recognition time. Invalid metadata cannot extend the
  server's cap. Only one action can wait; old generations and expired actions
  are rejected. Bowling keeps its 80 ms wait.

The historical-contact allowance has strict boundaries: same live flight,
legal bounce state, actual historical player position, simulation age and wall
clock age. It cannot reopen an awarded point, cross a pause/reset, recover an
unreachable ball or produce a second hit. Only the returned ball advances to
its current position; players and scores are never rewound. Catch-up that would
cross a net/bounce/point boundary is rejected instead of skipping those rules.

## Fullscreen

Countdown/game entry still attempts fullscreen, while the lobby stays windowed.
Trusted clicks/Enter inside the same-origin game iframe now reach the fullscreen
handler synchronously. Previously those events did not reach the parent page.
An existing automatic-fullscreen permission is also observed where Chrome
supports it; granting it during an active game can trigger a retry.

Standard and prefixed WebKit requests now observe their native completion/error
events. Older WebKit APIs can return `void` while entry is still pending;
checking immediately incorrectly reported failure. Legacy method/property
spellings are supported too, with bounded listener cleanup. A denied standard
policy is respected, rather than retried through another API.

A phone tap does not grant transient activation to the TV's browser tab. If
the browser denies automatic fullscreen, code cannot force it without a TV gesture.
A recent TV interaction can explain why a quick start works while a later start
does not. No browser policy was changed and no synthetic click substitutes for
permission. Intentional exits remain respected.

## Measurement limits

Controlled delays, real model contact and browser regression checks establish
specific code behavior. They do not establish Seattle-to-Railway delay,
physical iPhone gesture timing, Toshiba TV frame rate or successful local WebRTC
on the user's Wi-Fi. Managed Chromium blocks local ICE candidates here, so
actual direct-channel payload delivery remains a device validation item.
The Safari/WebKit compatibility paths have regression tests; an actual Safari
run was unavailable in this environment.

## Final validation

- TypeScript compilation, repository lint and the production build passed.
  All six built entry pages, player/racket models, island artwork and local font
  were verified.
- The final Vitest run passed 842 of 843 checks. One unchanged bowling physics
  test exceeded its five-second timeout while compilation/build work ran in
  parallel; all three tests in that file passed on an isolated retry without
  code changes. The earlier full run also passed before the final queue-budget
  and WebKit compatibility additions.
- All 84 native-controller tests passed with the final shared queue helper.
- All 224 server tests passed after the polling fix, including 104/104
  exactly-once swings over WebSocket and 104/104 over polling. The final local
  relay p95 was 11.68 ms and 28.79 ms respectively; these figures exclude
  physical motion recognition, rendering and the deployed network. Earlier
  polling failures and the trace that led to the fix are preserved in the
  transport audit below.
- Chromium checks passed: eight real-model tennis contacts, five controller UI
  cases, four fullscreen cases and four production controller/TV flows. Actual
  Safari, physical sensors and successful direct WebRTC delivery remain subject
  to the measurement limits above.

## Recorded evidence

- [Before/after model matrix](system-plan/tennis-late-contact-matrix.json): both
  seats, hands and stroke types, including early and delayed input.
- [Chromium contact checks](system-plan/tennis-late-contact-browser.json): eight
  real-model cases, including 120 ms delayed delivery; one contact per input.
- [Controller UI checks](system-plan/controller-ui-work-browser.json): five
  cases, including quiet motion at sensor cadence, touch shots and Settings.
- [Transport audit](system-plan/transport-response-audit.json): bounded direct
  delivery, polling contention and room-snapshot measurements.
- [Chrome fullscreen checks](system-plan/fullscreen-iframe-browser.json): four
  cases, including real iframe-focused Enter and intentional exit.
- [Production controller/TV flow](system-plan/response-game-flow-browser.json):
  four fallback-route checks, including input and Go home cleanup.
